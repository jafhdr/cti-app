const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { evidencePath } = require('./asm-v2-evidence-path.cjs');
const { chromium } = require('@playwright/test');
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const bcrypt = require('../../backend/node_modules/bcrypt');

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL).pathname.slice(1), 'cti_asm60_qa_20261028_1935');
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const tenantIds = [];
  const userIds = [];
  let packageId;
  let browser;
  try {
    const asm = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'attack-surface-management' } });
    const pkg = await prisma.subscriptionPackage.create({ data: { name: `ASM60 browser ${marker}`, type: 'PREDEFINED', priceMonthly: 0, priceYearly: 0, modules: { create: [{ moduleId: asm.id }] } } });
    packageId = pkg.id;
    const own = await prisma.tenant.create({ data: { name: 'ASM60 browser A', slug: `asm60-browser-a-${marker}` } });
    const foreign = await prisma.tenant.create({ data: { name: 'ASM60 browser B', slug: `asm60-browser-b-${marker}` } });
    tenantIds.push(own.id, foreign.id);
    for (const tenantId of tenantIds) {
      await prisma.tenantSubscription.create({ data: { tenantId, packageId, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
      await prisma.tenantModule.create({ data: { tenantId, moduleId: asm.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    }
    const password = `Qa-${randomUUID()}`;
    const passwordHash = await bcrypt.hash(password, 4);
    const accounts = [];
    for (const [role, tenantId, granted] of [['ADMIN', own.id, true], ['USER', own.id, true], ['USER', own.id, false], ['USER', foreign.id, false]]) {
      const account = await prisma.user.create({ data: { name: `ASM60 ${role} ${accounts.length}`, email: `asm60-browser-${accounts.length}-${marker}@example.test`, passwordHash, role, tenantId } });
      accounts.push(account); userIds.push(account.id);
      await prisma.userModuleAccess.create({ data: { userId: account.id, tenantId, moduleId: asm.id, featureKeys: granted ? ['asset-management', 'asset-correlation-review'] : ['asset-management'] } });
    }
    const [admin, reviewer, denied, foreignUser] = accounts;
    const asset = await prisma.asset.create({ data: { tenantId: own.id, name: 'ASM60 review asset', type: 'IP_ADDRESS', value: '192.0.2.180' } });
    await prisma.asset.create({ data: { tenantId: foreign.id, name: 'ASM60 foreign asset', type: 'IP_ADDRESS', value: '192.0.2.181' } });
    await prisma.assetPortService.create({ data: { tenantId: own.id, assetId: asset.id, protocol: 'TCP', port: 22, product: 'OpenSSH', version: '8.4', source: 'QA_PROBE', status: 'OPEN' } });
    for (const [cveId, name] of [['CVE-2026-60011', 'Relevant SSH'], ['CVE-2026-60012', 'False match SSH']]) {
      await prisma.vulnerability.create({ data: { tenantId: own.id, cveId, name, severity: 'HIGH', affectedProduct: 'OpenSSH', affectedVersionExact: '8.4', source: 'QA' } });
    }
    browser = await chromium.launch({ headless: true });
    async function login(account) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      page.on('dialog', dialog => void dialog.accept());
      await page.goto('http://localhost:3200/login');
      await page.getByLabel('Email address').fill(account.email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: /Sign In/ }).click();
      await page.waitForURL('**/dashboard');
      return { context, page };
    }
    async function openAsset(page) {
      await page.goto('http://localhost:3200/attack-surface/assets');
      await page.getByRole('button', { name: 'ASM60 review asset' }).click();
      return page.getByRole('region', { name: /Asset Intelligence Workspace/ }).getByRole('region', { name: 'Vulnerabilities' });
    }
    async function decide(page, section, cve, choice, reason) {
      await section.getByRole('row').filter({ hasText: cve }).getByRole('button', { name: 'Analyst review' }).click();
      const panel = page.getByRole('region', { name: 'Analyst correlation review' });
      await panel.getByText('No analyst decisions recorded.').waitFor();
      await panel.getByLabel('Decision').selectOption(choice);
      await panel.getByLabel('Reason').fill(reason);
      if (choice === 'ACCEPT') await panel.getByLabel('I inspected this evidence revision').check();
      await panel.getByRole('button', { name: 'Confirm decision' }).click();
      await panel.getByText(reason).waitFor();
      return panel;
    }
    const adminSession = await login(admin);
    const adminSection = await openAsset(adminSession.page);
    await adminSection.getByRole('button', { name: 'Enable V2 evidence for this tenant' }).click();
    await adminSection.getByRole('button', { name: 'Refresh correlations' }).click();
    await adminSection.getByText('High-confidence candidate').first().waitFor();
    const acceptedPanel = await decide(adminSession.page, adminSection, 'CVE-2026-60011', 'ACCEPT', 'Observed SSH version supports relevance');
    await acceptedPanel.getByText('ACCEPTED').first().waitFor();
    await adminSection.getByRole('row').filter({ hasText: 'CVE-2026-60011' }).getByRole('button', { name: 'Hide analyst review' }).click();
    await decide(adminSession.page, adminSection, 'CVE-2026-60012', 'REJECT', 'False match for this asset');
    for (const width of [1280, 768, 375]) {
      await adminSession.page.setViewportSize({ width, height: 900 });
      await adminSession.page.screenshot({ path: evidencePath(`asm60-review-detail-${width}.png`), fullPage: true });
      assert.equal(await adminSession.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `review detail overflow ${width}`);
      if (width <= 768) {
        const labels = await adminSection.locator('.asm-vulnerability-table tbody tr').first().locator('td').evaluateAll(cells => cells.map(cell => getComputedStyle(cell, '::before').content));
        assert.match(labels[5], /Observation \/ review/);
        assert.match(labels[6], /Evidence/);
      }
    }
    await adminSession.page.setViewportSize({ width: 1280, height: 900 });
    const rejectedRow = await prisma.assetVulnerabilityCorrelation.findFirstOrThrow({ where: { tenantId: own.id, vulnerability: { cveId: 'CVE-2026-60012' } } });
    await adminSection.getByRole('button', { name: 'Refresh correlations' }).click();
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: rejectedRow.id } })).reviewStatus, 'REJECTED');
    const queueUrl = 'http://localhost:3200/attack-surface/review';
    await adminSession.page.goto(queueUrl);
    await adminSession.page.getByRole('heading', { name: 'Correlation review queue' }).waitFor();
    await adminSession.page.getByLabel('Review state').selectOption('REJECTED');
    await adminSession.page.getByText('CVE-2026-60012').waitFor();
    for (const width of [1280, 768, 375]) {
      await adminSession.page.setViewportSize({ width, height: 900 });
      await adminSession.page.screenshot({ path: evidencePath(`asm60-review-queue-${width}.png`), fullPage: true });
      assert.equal(await adminSession.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `horizontal overflow ${width}`);
    }
    await adminSession.page.getByRole('link', { name: 'ASM60 review asset' }).click();
    await adminSession.page.getByRole('region', { name: 'Analyst correlation review' }).getByText('False match for this asset').waitFor();
    await adminSession.context.close();

    const reviewerSession = await login(reviewer);
    const reviewerSection = await openAsset(reviewerSession.page);
    await reviewerSection.getByRole('row').filter({ hasText: 'CVE-2026-60011' }).getByRole('button', { name: 'Analyst review' }).click();
    const reviewerPanel = reviewerSession.page.getByRole('region', { name: 'Analyst correlation review' });
    await reviewerPanel.getByText('ACCEPTED').first().waitFor();
    await reviewerPanel.getByLabel('Decision').selectOption('REQUEST_REVIEW');
    await reviewerPanel.getByLabel('Reason').fill('Second analyst requests reassessment');
    await reviewerPanel.getByRole('button', { name: 'Confirm decision' }).click();
    await reviewerPanel.getByText('Second analyst requests reassessment').waitFor();
    await reviewerSession.page.reload();
    const reopened = await openAsset(reviewerSession.page);
    await reopened.getByRole('row').filter({ hasText: 'CVE-2026-60011' }).getByRole('button', { name: 'Analyst review' }).click();
    await reviewerSession.page.getByRole('region', { name: 'Analyst correlation review' }).getByText('Second analyst requests reassessment').waitFor();
    await reviewerSession.context.close();

    const deniedSession = await login(denied);
    const deniedSection = await openAsset(deniedSession.page);
    await deniedSection.getByRole('row').filter({ hasText: 'CVE-2026-60011' }).getByRole('button', { name: 'Analyst review' }).click();
    await deniedSession.page.getByText('Review actions are unavailable for this account or rollout.').waitFor();
    const row = await prisma.assetVulnerabilityCorrelation.findFirstOrThrow({ where: { tenantId: own.id, vulnerability: { cveId: 'CVE-2026-60011' } } });
    const countBefore = await prisma.asmCorrelationDecision.count({ where: { tenantId: own.id } });
    const auditBefore = await prisma.auditLog.count({ where: { tenantId: own.id, action: 'ASM_V2_CORRELATION_DECISION' } });
    const deniedResponse = await deniedSession.page.request.post(`http://localhost:3201/attack-surface/v2/assets/${asset.id}/correlations/${row.id}/decisions`, { data: { kind: 'ACCEPT', reason: 'Forbidden', expectedRevision: row.revision, evidenceHash: row.evidenceHash, requestKey: randomUUID(), inspectedEvidence: true } });
    assert.equal(deniedResponse.status(), 403);
    assert.equal(await prisma.asmCorrelationDecision.count({ where: { tenantId: own.id } }), countBefore);
    assert.equal(await prisma.auditLog.count({ where: { tenantId: own.id, action: 'ASM_V2_CORRELATION_DECISION' } }), auditBefore);
    await deniedSession.context.close();

    const foreignSession = await login(foreignUser);
    await foreignSession.page.goto('http://localhost:3200/attack-surface/assets');
    assert.equal(await foreignSession.page.getByText('ASM60 review asset').count(), 0);
    const foreignResponse = await foreignSession.page.request.get(`http://localhost:3201/attack-surface/v2/assets/${asset.id}/correlations/${row.id}`);
    assert.equal(foreignResponse.status(), 404);
    await foreignSession.context.close();
    console.log('ASM60 browser PASS: ADMIN accept/reject, reviewer USER, denied USER, Tenant B, queue, responsive');
  } finally {
    if (browser) await browser.close();
    await prisma.asmCorrelationDecision.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ tenantId: { in: tenantIds } }, { userId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    if (packageId) await prisma.subscriptionPackage.delete({ where: { id: packageId } });
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
