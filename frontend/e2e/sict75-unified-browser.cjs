const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const bcrypt = require('../../backend/node_modules/bcrypt');

const web = 'http://localhost:3000';
const evidenceDir = path.resolve(__dirname, '../../docs/audits/sict75-unified-e2e');

async function login(page, email, password) {
  await page.goto(`${web}/login`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /Sign In/ }).click();
  await page.waitForURL(/dashboard/);
}

async function waitForSettledPage(page) {
  await page.evaluate(() => document.fonts.ready);
  let previous = -1;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = await page.evaluate(() => document.documentElement.scrollHeight);
    if (current === previous) return current;
    previous = current;
    await page.waitForTimeout(250);
  }
  throw new Error('Page height did not settle before capture');
}

async function main() {
  const database = new URL(process.env.DATABASE_URL).pathname;
  assert.match(database, /^\/cti_unified_qa_[a-z0-9]+$/);
  assert.equal(process.env.SICTI_ISOLATED_QA, 'true');
  assert.equal(process.env.SICTI_UNIFIED_QA_ENABLED, 'true');
  const state = JSON.parse(readFileSync(path.resolve(__dirname, '../../backend/qa-sict39-state.json'), 'utf8'));
  const prisma = new PrismaClient();
  const password = `Sict75-${randomBytes(18).toString('base64url')}`;
  const passwordHash = await bcrypt.hash(password, 8);
  const browser = await chromium.launch({ headless: true });
  const consoleErrors = [];
  const httpFailures = [];
  try {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: state.tenantId } });
    const admin = await prisma.user.update({ where: { id: state.adminId }, data: { passwordHash } });
    const reader = await prisma.user.findFirstOrThrow({ where: { tenantId: tenant.id, role: 'USER' } });
    await prisma.user.update({ where: { id: reader.id }, data: { passwordHash } });
    const modules = await prisma.appModule.findMany({ where: { slug: { in: ['threat-intelligence', 'case-management', 'attack-surface-management', 'appsec-posture'] } }, include: { features: true } });
    assert.equal(modules.length, 4);
    const subscription = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: tenant.id } });
    assert.ok(subscription.packageId);
    for (const module of modules) {
      await prisma.packageModule.upsert({ where: { packageId_moduleId: { packageId: subscription.packageId, moduleId: module.id } }, update: {}, create: { packageId: subscription.packageId, moduleId: module.id } });
      const tenantModule = await prisma.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId: tenant.id, moduleId: module.id } },
        update: { isEnabled: true },
        create: { tenantId: tenant.id, moduleId: module.id, isEnabled: true },
      });
      for (const role of ['ADMIN', 'USER']) await prisma.moduleRoleAccess.upsert({
        where: { tenantModuleId_role: { tenantModuleId: tenantModule.id, role } },
        update: { isAllowed: true }, create: { tenantModuleId: tenantModule.id, role, isAllowed: true },
      });
      const featureKeys = module.features.map(feature => feature.key);
      await prisma.userModuleAccess.upsert({
        where: { userId_tenantId_moduleId: { userId: admin.id, tenantId: tenant.id, moduleId: module.id } },
        update: { featureKeys }, create: { userId: admin.id, tenantId: tenant.id, moduleId: module.id, featureKeys },
      });
    }

    const correlation = await prisma.threatCorrelation.findFirstOrThrow({ where: { alertId: state.alertId }, include: { event: true } });
    const asset = await prisma.asset.upsert({
      where: { tenantId_type_value: { tenantId: tenant.id, type: 'DOMAIN', value: correlation.event.observableValue } },
      update: { name: 'SICT75 shared monitored asset' },
      create: { tenantId: tenant.id, name: 'SICT75 shared monitored asset', type: 'DOMAIN', value: correlation.event.observableValue, status: 'ACTIVE', criticality: 'HIGH' },
    });
    await prisma.monitoringWatchlist.upsert({
      where: { tenantId_kind_value: { tenantId: tenant.id, kind: 'DOMAIN', value: correlation.event.observableValue } },
      update: { assetId: asset.id, assetTenantId: tenant.id, active: true },
      create: { tenantId: tenant.id, kind: 'DOMAIN', value: correlation.event.observableValue, label: correlation.event.observableValue, assetId: asset.id, assetTenantId: tenant.id, createdById: admin.id },
    });
    const application = await prisma.application.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: 'SICT75 shared application' } },
      update: {}, create: { tenantId: tenant.id, name: 'SICT75 shared application', criticality: 'HIGH', owner: 'Unified QA' },
    });
    await prisma.applicationAsset.upsert({ where: { applicationId_assetId: { applicationId: application.id, assetId: asset.id } }, update: {}, create: { tenantId: tenant.id, applicationId: application.id, assetId: asset.id } });
    const finding = await prisma.appSecFinding.upsert({
      where: { tenantId_applicationId_source_sourceKey: { tenantId: tenant.id, applicationId: application.id, source: 'MANUAL', sourceKey: 'sict75-shared' } },
      update: { status: 'IN_PROGRESS' },
      create: { tenantId: tenant.id, applicationId: application.id, title: 'SICT75 shared AppSec finding', severity: 'HIGH', source: 'MANUAL', sourceKey: 'sict75-shared', status: 'IN_PROGRESS', workflowVersion: 2, validationState: 'VALID' },
    });
    await prisma.appSecFindingCase.upsert({ where: { findingId: finding.id }, update: { caseId: state.caseId, tenantId: tenant.id }, create: { findingId: finding.id, tenantId: tenant.id, caseId: state.caseId } });

    mkdirSync(evidenceDir, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ text: message.text().replaceAll(password, '[redacted]'), url: message.location().url ? new URL(message.location().url).pathname : '' }); });
    page.on('response', response => { if (response.status() >= 400) httpFailures.push({ status: response.status(), url: new URL(response.url()).pathname }); });
    await login(page, admin.email, password);
    const routes = [
      ['correlation', `/threat-intelligence/correlations?tenantId=${tenant.id}`, 'Threat correlations', null, correlation.event.observableValue],
      ['soar', `/threat-intelligence/playbooks?tenantId=${tenant.id}`, 'Response playbooks', 'Loading playbook history...', correlation.event.observableValue],
      ['monitoring', `/threat-intelligence/monitoring?tenantId=${tenant.id}`, 'Dark Web & Brand Monitoring', 'Loading monitoring workspace...', correlation.event.observableValue],
      ['asm', `/attack-surface/assets?tenantId=${tenant.id}`, 'Know what is exposed.', 'Loading assets...', 'SICT75 shared monitored asset'],
      ['appsec', `/appsec/findings?tenantId=${tenant.id}`, 'Finding in focus', 'Loading findings...', 'SICT75 shared AppSec finding'],
      ['case', `/cases/${state.caseId}?tenantId=${tenant.id}`, null, 'Loading case...', 'Linked correlation alerts'],
    ];
    const captures = [];
    const captureMetrics = [];
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
      for (const [name, route, heading, loadingText, readyText] of routes) {
        await page.goto(`${web}${route}`);
        if (heading) await page.getByRole('heading', { name: heading }).first().waitFor();
        else await page.locator('main').waitFor();
        if (loadingText) await page.getByText(loadingText, { exact: false }).waitFor({ state: 'detached' });
        if (name === 'soar') await page.locator('.playbook-run').first().waitFor();
        else await page.getByText(readyText, { exact: false }).first().waitFor();
        const scrollHeight = await waitForSettledPage(page);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), true, `${name} overflow at ${width}`);
        if (name === 'case' && width === 390) {
          assert.equal(await page.locator('.case-detail-nav').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'case tab overflow at 390');
        }
        const file = `${name}-${width}.png`;
        await page.screenshot({ path: path.join(evidenceDir, file), fullPage: true });
        captures.push(file);
        captureMetrics.push({ file, width, viewportHeight: width === 1280 ? 900 : 844, scrollHeight, readyText });
      }
    }
    await context.close();

    const deniedContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const deniedPage = await deniedContext.newPage();
    await login(deniedPage, reader.email, password);
    await deniedPage.goto(`${web}/threat-intelligence/playbooks`);
    await deniedPage.getByRole('heading', { name: 'Response playbooks' }).waitFor();
    await deniedPage.getByText('Loading playbook history...', { exact: false }).waitFor({ state: 'detached' });
    await deniedPage.locator('.playbook-run').first().waitFor();
    const deniedScrollHeight = await waitForSettledPage(deniedPage);
    assert.equal(await deniedPage.getByRole('button', { name: 'Create playbook run' }).count(), 0);
    await deniedPage.screenshot({ path: path.join(evidenceDir, 'soar-reader-denied-1280.png'), fullPage: true });
    captureMetrics.push({ file: 'soar-reader-denied-1280.png', width: 1280, viewportHeight: 900, scrollHeight: deniedScrollHeight, readyText: correlation.event.observableValue });
    await deniedContext.close();

    assert.deepEqual(httpFailures, []);
    assert.deepEqual(consoleErrors, []);
    const evidence = {
      sourceRevision: '29d0eca04b0b57409128ff912aae4ccf8845a5cd', database: 'cti_unified_qa_sict75',
      tenantId: tenant.id, alertId: state.alertId, caseId: state.caseId, assetId: asset.id, findingId: finding.id,
      captures: [...captures, 'soar-reader-denied-1280.png'], captureMetrics, httpFailures, consoleErrors,
    };
    writeFileSync(path.join(evidenceDir, 'browser-evidence.json'), JSON.stringify(evidence, null, 2));
    process.stdout.write(JSON.stringify({ verdict: 'PASS', captureCount: evidence.captures.length, httpFailures: 0, consoleErrors: 0 }));
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});
