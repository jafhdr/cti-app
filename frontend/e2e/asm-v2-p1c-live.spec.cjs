const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { evidencePath } = require('./asm-v2-evidence-path.cjs');
const { chromium } = require('@playwright/test');
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const bcrypt = require('../../backend/node_modules/bcrypt');

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL).pathname.slice(1), 'cti_asm61_qa_20261028_2145');
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const tenants = [];
  const users = [];
  let packageId;
  let browser;
  try {
    const asm = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'attack-surface-management' } });
    const pkg = await prisma.subscriptionPackage.create({ data: { name: `ASM61 browser ${marker}`, type: 'PREDEFINED', priceMonthly: 0, priceYearly: 0, modules: { create: [{ moduleId: asm.id }] } } });
    packageId = pkg.id;
    for (const suffix of ['own', 'foreign']) {
      const tenant = await prisma.tenant.create({ data: { name: `ASM61 ${suffix}`, slug: `asm61-browser-${suffix}-${marker}` } });
      tenants.push(tenant.id);
      await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, packageId, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
      await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: asm.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    }
    const password = `Qa-${randomUUID()}`;
    const hash = await bcrypt.hash(password, 4);
    const accounts = [];
    for (const [role, tenantId, featureKeys] of [['ADMIN', tenants[0], ['asset-management', 'asset-correlation-review']], ['USER', tenants[0], ['asset-management']], ['USER', tenants[0], ['asset-management', 'asset-correlation-review']], ['USER', tenants[1], ['asset-management']]]) {
      const account = await prisma.user.create({ data: { name: `ASM61 ${role}`, email: `asm61-browser-${accounts.length}-${marker}@example.test`, passwordHash: hash, role, tenantId } });
      users.push(account.id); accounts.push(account);
      await prisma.userModuleAccess.create({ data: { userId: account.id, tenantId, moduleId: asm.id, featureKeys } });
    }
    const [admin, reader, reviewer, foreign] = accounts;
    const asset = await prisma.asset.create({ data: { tenantId: tenants[0], name: 'ASM61 priority asset', type: 'IP_ADDRESS', value: '192.0.2.191', criticality: 'HIGH' } });
    await prisma.asset.create({ data: { tenantId: tenants[0], name: 'ASM61 empty asset', type: 'IP_ADDRESS', value: '192.0.2.192', criticality: 'LOW' } });
    const service = await prisma.assetPortService.create({ data: { tenantId: tenants[0], assetId: asset.id, protocol: 'TCP', port: 22, product: 'OpenSSH', version: '8.4', source: 'QA_PROBE', status: 'OPEN' } });
    const vulnerability = await prisma.vulnerability.create({ data: { tenantId: tenants[0], cveId: 'CVE-2026-61011', name: 'Relevant SSH', severity: 'HIGH', cvssScore: 8.4, affectedProduct: 'OpenSSH', affectedVersionExact: '8.4', source: 'PRIVATE_TI_SOURCE' } });
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
    async function open(page) {
      await page.goto('http://localhost:3200/attack-surface/assets');
      await page.getByRole('button', { name: 'ASM61 priority asset' }).click();
      return page.getByRole('region', { name: 'V2 contextual priority' });
    }
    const adminSession = await login(admin);
    const priority = await open(adminSession.page);
    await priority.getByText('Priority is unavailable for this tenant or account.').waitFor();
    const vulnerabilities = adminSession.page.getByRole('region', { name: 'Vulnerabilities' });
    await vulnerabilities.getByRole('button', { name: 'Enable V2 evidence for this tenant' }).click();
    await vulnerabilities.getByRole('button', { name: 'Refresh correlations' }).click();
    await vulnerabilities.getByRole('row').filter({ hasText: 'CVE-2026-61011' }).getByRole('button', { name: 'Analyst review' }).click();
    const review = adminSession.page.getByRole('region', { name: 'Analyst correlation review' });
    await review.getByText('No analyst decisions recorded.').waitFor();
    await review.getByLabel('Decision').selectOption('ACCEPT');
    await review.getByLabel('Reason').fill('Observed version matches reviewed CVE');
    await review.getByLabel('I inspected this evidence revision').check();
    await review.getByRole('button', { name: 'Confirm decision' }).click();
    await priority.getByText('HIGH', { exact: true }).first().waitFor();
    assert.match(await priority.innerText(), /CVE-2026-61011/);
    assert.match(await priority.innerText(), /Context score\s*78/);
    assert.match(await adminSession.page.getByRole('region', { name: 'V1 risk posture' }).innerText(), /Risk posture/);
    for (const width of [1280, 768, 375]) {
      await adminSession.page.setViewportSize({ width, height: 900 });
      await adminSession.page.screenshot({ path: evidencePath(`asm61-priority-${width}.png`), fullPage: true });
      assert.equal(await priority.isVisible(), true);
      assert.equal(await priority.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, `priority overflow ${width}`);
    }
    const readerSession = await login(reader);
    const readerPriority = await open(readerSession.page);
    await readerPriority.getByText('HIGH', { exact: true }).first().waitFor();
    assert.ok(!(await readerPriority.innerText()).includes('PRIVATE_TI_SOURCE'));
    assert.equal(await readerSession.page.getByRole('button', { name: 'Confirm decision' }).count(), 0);
    await readerSession.page.getByRole('button', { name: 'Back to assets' }).click();
    await readerSession.page.getByRole('button', { name: 'ASM61 empty asset' }).click();
    const emptyPriority = readerSession.page.getByRole('region', { name: 'V2 contextual priority' });
    await emptyPriority.getByText('NOT ASSESSED').waitFor();
    assert.ok(!(await emptyPriority.innerText()).includes('CVE-2026-61011'));
    await prisma.assetPortService.update({ where: { id: service.id }, data: { version: '8.4.1' } });
    await prisma.vulnerability.update({ where: { id: vulnerability.id }, data: { affectedVersionExact: '8.4.1' } });
    await vulnerabilities.getByRole('button', { name: 'Refresh correlations' }).click();
    await priority.getByText('NOT ASSESSED').waitFor();
    assert.match(await priority.innerText(), /review required 1/i);
    const reviewerSession = await login(reviewer);
    await open(reviewerSession.page);
    const reviewerVulnerabilities = reviewerSession.page.getByRole('region', { name: 'Vulnerabilities' });
    await reviewerVulnerabilities.getByRole('row').filter({ hasText: 'CVE-2026-61011' }).getByRole('button', { name: 'Analyst review' }).click();
    const reviewerPanel = reviewerSession.page.getByRole('region', { name: 'Analyst correlation review' });
    await reviewerPanel.getByLabel('Decision').selectOption('REJECT');
    await reviewerPanel.getByLabel('Reason').fill('QA false match after changed fingerprint');
    await reviewerPanel.getByRole('button', { name: 'Confirm decision' }).click();
    const rejectedPriority = reviewerSession.page.getByRole('region', { name: 'V2 contextual priority' });
    await rejectedPriority.getByText(/Excluded: rejected 1/i).waitFor();
    assert.match(await rejectedPriority.innerText(), /rejected 1/i);
    const foreignSession = await login(foreign);
    const response = await foreignSession.page.request.get(`http://localhost:3201/attack-surface/v2/assets/${asset.id}/priority`);
    assert.equal(response.status(), 403);
    await foreignSession.context.close(); await reviewerSession.context.close(); await readerSession.context.close(); await adminSession.context.close();
    console.log('ASM61 browser PASS: ADMIN, USER, reviewer, tenant B, transitions, switch, 1280/768/375');
  } finally {
    if (browser) await browser.close();
    await prisma.asmCorrelationDecision.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ tenantId: { in: tenants } }, { userId: { in: users } }] } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
    if (packageId) await prisma.subscriptionPackage.delete({ where: { id: packageId } });
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
