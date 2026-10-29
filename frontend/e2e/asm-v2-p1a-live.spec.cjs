const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { evidencePath } = require('./asm-v2-evidence-path.cjs');
const { chromium } = require('@playwright/test');
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const bcrypt = require('../../backend/node_modules/bcrypt');

async function main() {
  assert.match(new URL(process.env.DATABASE_URL || 'postgresql://invalid/cti').pathname.slice(1), /^cti_asm(59|60)_qa_/);
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const tenantIds = [];
  const userIds = [];
  let packageId;
  let browser;
  try {
    const asm = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'attack-surface-management' } });
    const pkg = await prisma.subscriptionPackage.create({ data: { name: `ASM59 browser ${marker}`, type: 'PREDEFINED', priceMonthly: 0, priceYearly: 0, modules: { create: [{ moduleId: asm.id }] } } });
    packageId = pkg.id;
    const tenant = await prisma.tenant.create({ data: { name: 'ASM59 browser A', slug: `asm59-browser-a-${marker}` } });
    tenantIds.push(tenant.id);
    await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, packageId, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
    await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: asm.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }] } } });
    const password = `Qa-${randomUUID()}`;
    const admin = await prisma.user.create({ data: { name: 'ASM59 browser admin', email: `asm59-browser-${marker}@example.test`, passwordHash: await bcrypt.hash(password, 4), role: 'ADMIN', tenantId: tenant.id } });
    userIds.push(admin.id);
    await prisma.userModuleAccess.create({ data: { userId: admin.id, tenantId: tenant.id, moduleId: asm.id, featureKeys: ['asset-management'] } });
    const asset = await prisma.asset.create({ data: { tenantId: tenant.id, name: 'ASM59 candidate asset', type: 'IP_ADDRESS', value: '192.0.2.90' } });
    await prisma.asset.create({ data: { tenantId: tenant.id, name: 'ASM59 empty asset', type: 'IP_ADDRESS', value: '192.0.2.91' } });
    await prisma.assetPortService.create({ data: { tenantId: tenant.id, assetId: asset.id, protocol: 'TCP', port: 22, product: 'OpenSSH', version: '8.4', source: 'QA_PROBE', status: 'OPEN' } });
    await prisma.vulnerability.create({ data: { tenantId: tenant.id, cveId: 'CVE-2026-59002', name: 'Synthetic SSH relevance', severity: 'HIGH', affectedProduct: 'OpenSSH', affectedVersionExact: '8.4', source: 'QA' } });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto('http://localhost:3200/login');
    await page.getByLabel('Email address').fill(admin.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: /Sign In/ }).click();
    await page.waitForURL('**/dashboard');
    await page.goto('http://localhost:3200/attack-surface/assets');
    await page.getByRole('button', { name: 'ASM59 candidate asset' }).click();
    const section = page.getByRole('region', { name: /Asset Intelligence Workspace/ }).getByRole('region', { name: 'Vulnerabilities' });
    await section.getByRole('button', { name: 'Enable V2 evidence for this tenant' }).click();
    await section.getByRole('button', { name: 'Refresh correlations' }).click();
    await section.getByText('High-confidence candidate').waitFor();
    await section.getByText('PENDING').waitFor();
    await section.getByRole('button', { name: 'Evidence history' }).click();
    await section.getByText(/MATCHED/).waitFor();
    assert.equal(await prisma.asmCorrelationObservation.count({ where: { tenantId: tenant.id } }), 1);
    await section.getByRole('button', { name: 'Refresh correlations' }).click();
    assert.equal(await prisma.asmCorrelationObservation.count({ where: { tenantId: tenant.id } }), 1);
    for (const width of [1280, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: evidencePath(`asm59-candidate-${width}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `horizontal overflow at ${width}`);
    }
    await page.getByRole('button', { name: 'Back to assets' }).click();
    await page.getByRole('button', { name: 'ASM59 empty asset' }).click();
    await section.getByText('No vulnerability correlations recorded.').waitFor();
    assert.equal(await section.getByText('CVE-2026-59002').count(), 0);
    console.log('ASM59 authenticated browser PASS: login, enrollment, candidate, history, dedup, responsive, asset switch');
  } finally {
    if (browser) await browser.close();
    await prisma.auditLog.deleteMany({ where: { OR: [{ tenantId: { in: tenantIds } }, { userId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    if (packageId) await prisma.subscriptionPackage.delete({ where: { id: packageId } });
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
