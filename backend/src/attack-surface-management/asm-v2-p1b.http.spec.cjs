const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { ValidationPipe } = require('@nestjs/common');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { AttackSurfaceManagementModule } = require('../../dist/src/attack-surface-management/attack-surface-management.module');
const { AsmV2EvidenceService } = require('../../dist/src/attack-surface-management/asm-v2-evidence.service');
const { VulnerabilityCorrelationsService } = require('../../dist/src/attack-surface-management/vulnerability-correlations.service');

test('ASM V2 P1-B authenticated review decisions and tenant boundaries', { timeout: 120000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname.slice(1), /^cti_asm(60|61|62)_qa_/);
  process.env.ASM_V2_EVIDENCE_ENABLED = 'true';
  process.env.ASM_V2_REVIEW_ENABLED = 'true';
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const tenantIds = [];
  const userIds = [];
  let packageId;
  let app;
  try {
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, AttackSurfaceManagementModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const asm = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'attack-surface-management' }, include: { features: true } });
    assert.ok(asm.features.some(feature => feature.key === 'asset-correlation-review'), 'seeded review feature');
    const pkg = await prisma.subscriptionPackage.create({ data: { name: `ASM60 ${marker}`, type: 'PREDEFINED', priceMonthly: 0, priceYearly: 0, modules: { create: [{ moduleId: asm.id }] } } });
    packageId = pkg.id;
    const own = await prisma.tenant.create({ data: { name: 'ASM60 own', slug: `asm60-own-${marker}` } });
    const foreign = await prisma.tenant.create({ data: { name: 'ASM60 foreign', slug: `asm60-foreign-${marker}` } });
    tenantIds.push(own.id, foreign.id);
    for (const tenantId of tenantIds) {
      await prisma.tenantSubscription.create({ data: { tenantId, packageId, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
      await prisma.tenantModule.create({ data: { tenantId, moduleId: asm.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    }
    const password = randomUUID();
    const passwordHash = await bcrypt.hash(password, 4);
    const accounts = [];
    for (const [role, tenantId, granted] of [['ADMIN', own.id, true], ['USER', own.id, true], ['USER', own.id, false], ['USER', foreign.id, true], ['SUPER_ADMIN', null, true]]) {
      const account = await prisma.user.create({ data: { name: `ASM60 ${role} ${accounts.length}`, email: `asm60-${accounts.length}-${marker}@example.test`, passwordHash, role, tenantId } });
      accounts.push(account); userIds.push(account.id);
      if (tenantId) await prisma.userModuleAccess.create({ data: { userId: account.id, tenantId, moduleId: asm.id, featureKeys: granted ? ['asset-management', 'asset-correlation-review'] : ['asset-management'] } });
    }
    const [admin, reviewer, denied, foreignUser, root] = accounts;
    const asset = await prisma.asset.create({ data: { tenantId: own.id, name: 'ASM60 IP', type: 'IP_ADDRESS', value: '192.0.2.160' } });
    const foreignAsset = await prisma.asset.create({ data: { tenantId: foreign.id, name: 'ASM60 foreign IP', type: 'IP_ADDRESS', value: '192.0.2.161' } });
    const service = await prisma.assetPortService.create({ data: { tenantId: own.id, assetId: asset.id, protocol: 'TCP', port: 22, product: 'OpenSSH', version: '8.4', source: 'QA', status: 'OPEN' } });
    const vuln = await prisma.vulnerability.create({ data: { tenantId: own.id, cveId: 'CVE-2026-60001', name: 'QA CVE', severity: 'HIGH', affectedProduct: 'OpenSSH', affectedVersionExact: '8.4' } });
    const cookies = new Map();
    for (const account of accounts) {
      const response = await fetch(api + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password }) });
      assert.equal(response.status, 201);
      cookies.set(account.id, response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; '));
    }
    async function request(account, path, method = 'GET', body) {
      const response = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', ...(account ? { Cookie: cookies.get(account.id) } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    }
    let observedClock = 0;
    async function verifiedRun() {
      const current = await prisma.assetPortService.findUniqueOrThrow({ where: { id: service.id } });
      observedClock = Math.max(Date.now(), observedClock + 1);
      const observedAt = new Date(observedClock);
      const run = await prisma.asmDiscoveryRun.create({ data: { tenantId: own.id, assetId: asset.id, source: 'QA_VERIFIED_FIXTURE', status: 'COMPLETED', startedAt: new Date(observedAt.getTime() - 1000), completedAt: new Date(observedAt.getTime() + 1000) } });
      await prisma.asmServiceFingerprintObservation.create({ data: { tenantId: own.id, assetId: asset.id, serviceId: service.id, discoveryRunId: run.id, product: current.product, version: current.version, source: current.source, bannerHash: `qa-${randomUUID()}`, observedAt } });
      return run;
    }
    async function verifiedRefresh() {
      const run = await verifiedRun();
      return app.get(VulnerabilityCorrelationsService).refresh({ sub: admin.id, role: 'ADMIN', tenantId: own.id }, asset.id, undefined, run.id);
    }
    const base = `/attack-surface/v2/assets/${asset.id}/correlations`;
    assert.equal((await request(admin, '/attack-surface/v2/enrollment', 'POST', { enabled: true })).status, 201);
    const refresh = `/attack-surface/assets/${asset.id}/vulnerability-correlations/refresh`;
    assert.deepEqual((await request(admin, refresh, 'POST')).body, []);
    await verifiedRefresh();
    const first = await request(admin, refresh, 'POST');
    assert.equal(first.status, 201);
    const id = first.body[0].id;
    const detail = await request(admin, `${base}/${id}`);
    const payload = (kind, reason, row, requestKey = randomUUID(), extra = {}) => ({ kind, reason, expectedRevision: row.revision, evidenceHash: row.evidenceHash, requestKey, inspectedEvidence: true, ...extra });
    const decisionUrl = `${base}/${id}/decisions`;
    assert.equal((await request(admin, decisionUrl, 'POST', payload('ACCEPT', 'Not inspected', detail.body, randomUUID(), { inspectedEvidence: false }))).status, 400);
    assert.equal((await request(null, decisionUrl, 'POST', payload('ACCEPT', 'QA', detail.body))).status, 401);
    assert.equal((await request(denied, decisionUrl, 'POST', payload('ACCEPT', 'QA', detail.body))).status, 403);
    assert.equal((await request(foreignUser, decisionUrl, 'POST', payload('ACCEPT', 'QA', detail.body))).status, 403);
    assert.equal((await request(root, decisionUrl, 'POST', payload('ACCEPT', 'QA', detail.body))).status, 400);
    assert.equal((await request(root, `${decisionUrl}?tenantId=${foreign.id}`, 'POST', payload('ACCEPT', 'QA', detail.body))).status, 403);
    assert.equal((await request(admin, `${decisionUrl}?tenantId=${foreign.id}`, 'POST', payload('ACCEPT', 'QA', detail.body))).status, 403);
    assert.equal((await request(admin, `/attack-surface/v2/assets/${foreignAsset.id}/correlations/${id}/decisions`)).status, 404);
    const key = randomUUID();
    const accept = payload('ACCEPT', 'Fingerprint and CVE range inspected', detail.body, key);
    const accepted = await request(admin, decisionUrl, 'POST', accept);
    assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
    assert.equal(accepted.body.decision.reviewStatus, 'ACCEPTED');
    assert.equal((await request(admin, decisionUrl, 'POST', accept)).body.replayed, true);
    assert.equal((await request(admin, decisionUrl, 'POST', { ...accept, reason: 'Changed' })).status, 409);
    assert.equal((await request(admin, decisionUrl, 'POST', payload('REJECT', 'Old revision', detail.body))).status, 409);
    assert.equal((await prisma.assetFinding.count({ where: { tenantId: own.id } })), 0);
    await request(admin, refresh, 'POST');
    assert.equal((await request(admin, `${base}/${id}`)).body.reviewStatus, 'ACCEPTED');
    const acceptedRow = (await request(admin, `${base}/${id}`)).body;
    assert.equal((await request(admin, decisionUrl, 'POST', payload('REJECT', 'Same actor reversal', acceptedRow))).status, 403);
    const rejected = await request(reviewer, decisionUrl, 'POST', payload('REJECT', 'Version evidence does not support asset relevance', acceptedRow));
    assert.equal(rejected.status, 201, JSON.stringify(rejected.body));
    await request(admin, refresh, 'POST');
    assert.equal((await request(admin, `${base}/${id}`)).body.reviewStatus, 'REJECTED');
    await prisma.assetPortService.update({ where: { id: service.id }, data: { version: '8.4.1' } });
    await prisma.vulnerability.update({ where: { id: vuln.id }, data: { affectedVersionExact: '8.4.1' } });
    await verifiedRefresh();
    await request(admin, refresh, 'POST');
    const changed = (await request(admin, `${base}/${id}`)).body;
    assert.equal(changed.reviewStatus, 'REVIEW_REQUIRED');
    assert.notEqual(changed.evidenceHash, acceptedRow.evidenceHash);
    assert.equal((await prisma.asmCorrelationDecision.findUniqueOrThrow({ where: { id: accepted.body.decision.id } })).evidenceHash, acceptedRow.evidenceHash);
    assert.equal((await request(admin, decisionUrl, 'POST', payload('ACCEPT', 'Stale evidence', acceptedRow))).status, 409);
    const requested = await request(admin, decisionUrl, 'POST', payload('ACCEPT', 'New evidence inspected', changed));
    assert.equal(requested.status, 201, JSON.stringify(requested.body));
    const history = await request(admin, decisionUrl);
    assert.equal(history.body.total, 3);
    assert.equal((await request(admin, '/attack-surface/v2/correlation-queue?review=ACCEPTED')).body.items[0].id, id);
    assert.equal((await request(admin, `${decisionUrl}?page=0`)).status, 400);
    assert.equal(await prisma.asmCorrelationDecision.count({ where: { tenantId: own.id, correlationId: id } }), 3);
    assert.equal(await prisma.auditLog.count({ where: { tenantId: own.id, action: 'ASM_V2_CORRELATION_DECISION' } }), 3);
    const acceptedAgain = (await request(admin, `${base}/${id}`)).body;
    assert.equal((await request(admin, decisionUrl, 'POST', payload('REQUEST_REVIEW', 'Reassess previous acceptance', acceptedAgain))).status, 403);
    const override = await request(admin, decisionUrl, 'POST', payload('REQUEST_REVIEW', 'Reassess previous acceptance', acceptedAgain, randomUUID(), { overrideReason: 'New analyst challenge to prior acceptance' }));
    assert.equal(override.status, 201, JSON.stringify(override.body));
    const reviewRequired = (await request(admin, `${base}/${id}`)).body;
    assert.equal((await request(reviewer, decisionUrl, 'POST', payload('REJECT', 'Unauthorized override', reviewRequired, randomUUID(), { overrideReason: 'Not an ADMIN' }))).status, 403);
    const rejectAgain = await request(reviewer, decisionUrl, 'POST', payload('REJECT', 'Analyst determined false match', reviewRequired));
    assert.equal(rejectAgain.status, 201, JSON.stringify(rejectAgain.body));
    await prisma.assetPortService.update({ where: { id: service.id }, data: { version: '8.4.2' } });
    await prisma.vulnerability.update({ where: { id: vuln.id }, data: { affectedVersionExact: '8.4.2' } });
    const beforeRace = (await request(admin, `${base}/${id}`)).body;
    const [racedDecision, racedRefresh] = await Promise.all([
      request(admin, decisionUrl, 'POST', payload('ACCEPT', 'Race with material refresh', beforeRace)),
      verifiedRefresh(),
    ]);
    assert.ok([201, 409].includes(racedDecision.status), JSON.stringify(racedDecision.body));
    assert.ok(Array.isArray(racedRefresh));
    assert.equal((await request(admin, refresh, 'POST')).status, 201);
    assert.equal((await request(admin, `${base}/${id}`)).body.reviewStatus, 'REVIEW_REQUIRED');
    await prisma.assetPortService.update({ where: { id: service.id }, data: { version: '9.9', status: 'CLOSED', lastSeenAt: new Date() } });
    const closedRun = await verifiedRun();
    await request(admin, refresh, 'POST');
    assert.equal((await request(admin, `${base}/${id}`)).body.status, 'ACTIVE');
    assert.equal(await app.get(AsmV2EvidenceService).markNotObserved(own.id, asset.id, id, closedRun.id), false);
    await prisma.assetPortService.update({ where: { id: service.id }, data: { status: 'OPEN' } });
    const verifiedRunForRetirement = await verifiedRun();
    assert.equal(await app.get(AsmV2EvidenceService).markNotObserved(own.id, asset.id, id, verifiedRunForRetirement.id), true);
    const stale = (await request(admin, `${base}/${id}`)).body;
    assert.equal(stale.status, 'STALE');
    assert.equal((await request(admin, decisionUrl, 'POST', payload('ACCEPT', 'Cannot accept stale', stale))).status, 409);
    assert.equal((await request(admin, decisionUrl)).body.total, await prisma.asmCorrelationDecision.count({ where: { tenantId: own.id, correlationId: id } }));
    assert.equal(await prisma.asmCorrelationDecision.count({ where: { tenantId: own.id } }), await prisma.auditLog.count({ where: { tenantId: own.id, action: 'ASM_V2_CORRELATION_DECISION' } }));
    assert.equal(await prisma.assetFinding.count({ where: { tenantId: own.id } }), 0);
    assert.equal(await prisma.alert.count({ where: { tenantId: own.id } }), 0);
    assert.equal(await prisma.appSecFinding.count({ where: { tenantId: own.id } }), 0);
    assert.equal(await prisma.case.count({ where: { tenantId: own.id } }), 0);
    await prisma.assetPortService.update({ where: { id: service.id }, data: { version: '8.4.2' } });
    await verifiedRefresh();
    await request(admin, refresh, 'POST');
    const rollbackBefore = (await request(admin, `${base}/${id}`)).body;
    const decisionCountBefore = await prisma.asmCorrelationDecision.count({ where: { tenantId: own.id } });
    await prisma.$executeRawUnsafe(`CREATE FUNCTION asm60_reject_decision_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'ASM_V2_CORRELATION_DECISION' THEN RAISE EXCEPTION 'QA audit rejection'; END IF; RETURN NEW; END; $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER asm60_reject_decision_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION asm60_reject_decision_audit()`);
    try {
      assert.equal((await request(admin, decisionUrl, 'POST', payload('ACCEPT', 'Rollback proof', rollbackBefore))).status, 500);
      assert.equal((await request(admin, `${base}/${id}`)).body.revision, rollbackBefore.revision);
      assert.equal(await prisma.asmCorrelationDecision.count({ where: { tenantId: own.id } }), decisionCountBefore);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER asm60_reject_decision_audit ON "AuditLog"`);
      await prisma.$executeRawUnsafe('DROP FUNCTION asm60_reject_decision_audit()');
    }
    process.env.ASM_V2_REVIEW_ENABLED = 'false';
    assert.equal((await request(admin, decisionUrl, 'POST', payload('REQUEST_REVIEW', 'Gate off', (await request(admin, `${base}/${id}`)).body))).status, 403);
  } finally {
    if (app) await app.close();
    await prisma.asmCorrelationDecision.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ tenantId: { in: tenantIds } }, { userId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    if (packageId) await prisma.subscriptionPackage.delete({ where: { id: packageId } });
    await prisma.$disconnect();
  }
});
