const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { evidencePath } = require('./asm-v2-evidence-path.cjs');
const { chromium } = require('@playwright/test');
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const bcrypt = require('../../backend/node_modules/bcrypt');

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL).pathname.slice(1), 'cti_asm62_qa_20261029_0930');
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const tenants = [];
  const users = [];
  let packageId;
  let browser;
  try {
    const asm = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'attack-surface-management' } });
    const pkg = await prisma.subscriptionPackage.create({ data: { name: `ASM62 browser ${marker}`, type: 'PREDEFINED', priceMonthly: 0, priceYearly: 0, modules: { create: [{ moduleId: asm.id }] } } });
    packageId = pkg.id;
    for (const suffix of ['A', 'B']) {
      const tenant = await prisma.tenant.create({ data: { name: `ASM62 browser ${suffix}`, slug: `asm62-browser-${suffix.toLowerCase()}-${marker}` } });
      tenants.push(tenant.id);
      await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, packageId, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
      await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: asm.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    }
    await prisma.asmV2Enrollment.create({ data: { tenantId: tenants[1], enabled: true } });
    const password = `Qa-${randomUUID()}`;
    const passwordHash = await bcrypt.hash(password, 4);
    const accounts = [];
    for (const [role, tenantId, featureKeys] of [['ADMIN', tenants[0], ['asset-management', 'asset-correlation-review']], ['USER', tenants[0], ['asset-management']], ['USER', tenants[0], []], ['USER', tenants[1], ['asset-management']], ['SUPER_ADMIN', null, []]]) {
      const account = await prisma.user.create({ data: { name: `ASM62 browser ${role} ${accounts.length}`, email: `asm62-browser-${accounts.length}-${marker}@example.test`, passwordHash, role, tenantId } });
      accounts.push(account); users.push(account.id);
      if (tenantId) await prisma.userModuleAccess.create({ data: { userId: account.id, tenantId, moduleId: asm.id, featureKeys } });
    }
    const [admin, reader, restricted, foreign, root] = accounts;
    const asset = await prisma.asset.create({ data: { tenantId: tenants[0], name: 'ASM62 browser priority asset', type: 'IP_ADDRESS', value: '192.0.2.232', criticality: 'HIGH' } });
    for (let index = 0; index < 12; index++) await prisma.asset.create({ data: { tenantId: tenants[0], name: `ASM62 browser empty ${index}`, type: 'IP_ADDRESS', value: `192.0.2.${233 + index}` } });
    await prisma.asset.create({ data: { tenantId: tenants[1], name: 'ASM62 browser B empty', type: 'IP_ADDRESS', value: '192.0.2.250' } });
    const service = await prisma.assetPortService.create({ data: { tenantId: tenants[0], assetId: asset.id, protocol: 'TCP', port: 22, product: 'OpenSSH', version: '8.4', source: 'QA', status: 'OPEN' } });
    for (const [cveId, name] of [['CVE-2026-62111', 'Valid'], ['CVE-2026-62112', 'False']]) await prisma.vulnerability.create({ data: { tenantId: tenants[0], cveId, name, severity: 'HIGH', cvssScore: 8.4, affectedProduct: 'OpenSSH', affectedVersionExact: '8.4', source: 'PRIVATE_TI_SOURCE' } });
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
    async function openOperations(page) { await page.goto('http://localhost:3200/attack-surface/operations'); return page.getByRole('main', { name: 'ASM V2 operations' }); }
    const adminSession = await login(admin);
    const operations = await openOperations(adminSession.page);
    await operations.getByText('Operational reporting is unavailable for this tenant or account.').waitFor();
    await adminSession.page.goto(`http://localhost:3200/attack-surface/assets?assetId=${asset.id}`);
    const vulnerabilities = adminSession.page.getByRole('region', { name: 'Vulnerabilities' });
    await vulnerabilities.getByRole('button', { name: 'Enable V2 evidence for this tenant' }).click();
    await vulnerabilities.getByRole('button', { name: 'Refresh correlations' }).click();
    await adminSession.page.goto('http://localhost:3200/attack-surface/operations');
    const summary = adminSession.page.getByRole('region', { name: 'Operational summary' });
    await summary.getByText('Pending').waitFor();
    assert.match(await summary.innerText(), /Pending\s*2/);
    async function decide(cve, kind) {
      await adminSession.page.goto(`http://localhost:3200/attack-surface/assets?assetId=${asset.id}`);
      const section = adminSession.page.getByRole('region', { name: 'Vulnerabilities' });
      await section.getByRole('row').filter({ hasText: cve }).getByRole('button', { name: 'Analyst review' }).click();
      const panel = adminSession.page.getByRole('region', { name: 'Analyst correlation review' });
      await panel.getByLabel('Decision').selectOption(kind);
      await panel.getByLabel('Reason').fill(`ASM62 browser ${kind} inspected`);
      if (kind === 'ACCEPT') await panel.getByLabel('I inspected this evidence revision').check();
      await panel.getByRole('button', { name: 'Confirm decision' }).click();
      await panel.getByText(`ASM62 browser ${kind} inspected`).waitFor();
    }
    await decide('CVE-2026-62111', 'ACCEPT');
    await decide('CVE-2026-62112', 'REJECT');
    await openOperations(adminSession.page);
    await summary.getByText('Current actionable relevance').waitFor();
    assert.match(await summary.innerText(), /Current actionable relevance\s*1/);
    assert.match(await summary.innerText(), /HIGH \/ CRITICAL assets\s*1/);
    assert.match(await summary.innerText(), /Rejected\s*1/);
    await operations.getByRole('link', { name: 'Accepted queue' }).click();
    await adminSession.page.getByRole('heading', { name: 'Correlation review queue' }).waitFor();
    assert.equal(await adminSession.page.getByLabel('Review state').inputValue(), 'ACCEPTED');
    await adminSession.page.getByText('CVE-2026-62111').waitFor();
    await openOperations(adminSession.page);
    const assetSection = adminSession.page.getByRole('region', { name: 'Prioritized assets' });
    await assetSection.getByLabel('Priority').selectOption('HIGH');
    await assetSection.getByRole('link', { name: 'ASM62 browser priority asset' }).waitFor();
    assert.equal(await assetSection.locator('tbody tr').count(), 1);
    await assetSection.getByRole('link', { name: 'ASM62 browser priority asset' }).click();
    await adminSession.page.getByRole('region', { name: 'V2 contextual priority' }).getByText('HIGH', { exact: true }).waitFor();
    await openOperations(adminSession.page);
    await assetSection.getByLabel('Priority').selectOption('');
    await assetSection.getByRole('button', { name: 'Next' }).click();
    await assetSection.getByText(/page 2/).waitFor();
    await assetSection.getByRole('button', { name: 'Previous' }).click();
    await assetSection.getByText(/page 1/).waitFor();
    await assetSection.getByLabel('Priority').selectOption('LOW');
    await assetSection.getByText('No assets match these filters.').waitFor();
    await assetSection.getByLabel('Priority').selectOption('NOT_ASSESSED');
    assert.match(await assetSection.innerText(), /NOT ASSESSED/);
    for (const width of [1280, 768, 375]) {
      await adminSession.page.setViewportSize({ width, height: 900 });
      await adminSession.page.screenshot({ path: evidencePath(`asm62-operations-${width}.png`), fullPage: true });
      const overflow = await operations.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth,
        children: [...element.querySelectorAll('*')].filter(child => { const rect = child.getBoundingClientRect(); return rect.width > 0 && rect.right > element.getBoundingClientRect().right + 1; }).slice(0, 8).map(child => ({ tag: child.tagName, className: child.className, right: Math.round(child.getBoundingClientRect().right), width: Math.round(child.getBoundingClientRect().width) })) }));
      assert.equal(overflow.scroll <= overflow.width + 1, true, `operations overflow ${width}: ${JSON.stringify(overflow)}`);
    }
    const readerSession = await login(reader);
    const readerOperations = await openOperations(readerSession.page);
    await readerOperations.getByText('Current actionable relevance').waitFor();
    assert.ok(!(await readerOperations.innerText()).includes('PRIVATE_TI_SOURCE'));
    assert.equal(await readerSession.page.getByRole('button', { name: 'Confirm decision' }).count(), 0);
    const restrictedSession = await login(restricted);
    await restrictedSession.page.goto('http://localhost:3200/attack-surface/operations');
    await restrictedSession.page.getByText('Access denied').waitFor();
    const foreignSession = await login(foreign);
    const foreignOperations = await openOperations(foreignSession.page);
    await foreignOperations.getByText('Current workload').waitFor();
    assert.ok(!(await foreignOperations.innerText()).includes('ASM62 browser priority asset'));
    assert.equal((await foreignSession.page.request.get(`http://localhost:3201/attack-surface/v2/operations/assets?tenantId=${tenants[0]}`)).status(), 403);
    const rootSession = await login(root);
    await rootSession.page.goto(`http://localhost:3200/attack-surface/operations?tenantId=${tenants[0]}`);
    const rootOperations = rootSession.page.getByRole('main', { name: 'ASM V2 operations' });
    await rootOperations.getByText('Current actionable relevance').waitFor();
    await rootSession.page.getByLabel('Tenant Attack Surface').selectOption(tenants[1]);
    await rootOperations.getByText('0 distinct V2 correlations').waitFor();
    await prisma.assetPortService.update({ where: { id: service.id }, data: { version: '8.4.1' } });
    await prisma.vulnerability.updateMany({ where: { tenantId: tenants[0] }, data: { affectedVersionExact: '8.4.1' } });
    await adminSession.page.setViewportSize({ width: 1280, height: 900 });
    await adminSession.page.goto(`http://localhost:3200/attack-surface/assets?assetId=${asset.id}`);
    await adminSession.page.getByRole('region', { name: 'Vulnerabilities' }).getByRole('button', { name: 'Refresh correlations' }).click();
    await openOperations(adminSession.page);
    await summary.getByText('Current actionable relevance').waitFor();
    assert.match(await summary.innerText(), /Current actionable relevance\s*0/);
    assert.match(await summary.innerText(), /Review required\s*2/);
    await rootSession.context.close(); await foreignSession.context.close(); await restrictedSession.context.close(); await readerSession.context.close(); await adminSession.context.close();
    console.log('ASM62 browser PASS: ADMIN, USER, restricted, tenant B, SUPER_ADMIN switch, queue, priority, pagination, transitions, 1280/768/375');
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
