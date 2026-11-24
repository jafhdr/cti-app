require('reflect-metadata');
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { TtpObservationsService } = require('../../dist/src/intelligence/ttp-observations.service.js');

if (!process.env.DATABASE_URL || !/^\/cti_phase2[ab]_qa_/.test(new URL(process.env.DATABASE_URL).pathname)) throw new Error('Disposable cti_phase2a_qa_* or cti_phase2b_qa_* database required');
const prisma = new PrismaClient();
const service = new TtpObservationsService(prisma);
const run = `${Date.now()}-${process.pid}`;
const ids = {};
const candidate = (overrides = {}) => ({ idempotencyKey: `observation-${run}-${Math.random()}`, threatActorId: ids.actor, mitreTechniqueId: ids.technique, attackVersion: 'Enterprise QA', sirEvidenceId: ids.evidence, attributionBasis: 'Analyst mapped this source-backed behavior to the actor.', observedStartAt: '2026-11-09T08:00:00Z', observedEndAt: '2026-11-09T08:00:00Z', timePrecision: 'INSTANT', tlp: 'AMBER', actorConfidence: 70, techniqueConfidence: 80, ...overrides });
const admin = () => ({ sub: ids.admin, tenantId: ids.tenant, role: 'ADMIN' });
const regular = () => ({ sub: ids.user, tenantId: ids.tenant, role: 'USER' });

before(async () => {
  ids.tenant = (await prisma.tenant.create({ data: { name: `TTP QA ${run}`, slug: `ttp-qa-${run}` } })).id;
  ids.otherTenant = (await prisma.tenant.create({ data: { name: `TTP other ${run}`, slug: `ttp-other-${run}` } })).id;
  ids.admin = (await prisma.user.create({ data: { email: `ttp-admin-${run}@example.test`, name: 'TTP Admin', passwordHash: 'qa-only', role: 'ADMIN', tenantId: ids.tenant } })).id;
  ids.user = (await prisma.user.create({ data: { email: `ttp-user-${run}@example.test`, name: 'TTP User', passwordHash: 'qa-only', role: 'USER', tenantId: ids.tenant } })).id;
  ids.entity = (await prisma.intelligenceEntity.create({ data: { tenantId: ids.tenant, type: 'THREAT_ACTOR', name: `TTP Actor ${run}` } })).id;
  ids.actor = (await prisma.threatActor.create({ data: { tenantId: ids.tenant, entityId: ids.entity, createdBy: ids.admin } })).id;
  ids.campaign = (await prisma.campaign.create({ data: { tenantId: ids.tenant, name: `TTP Campaign ${run}`, threatActorId: ids.actor, createdBy: ids.admin } })).id;
  ids.technique = (await prisma.mitreTechnique.create({ data: { tenantId: ids.tenant, externalId: `T-qa-${run}`, name: 'QA technique', tactic: 'Discovery', platform: 'Windows' } })).id;
  ids.stakeholder = (await prisma.stakeholder.create({ data: { tenantId: ids.tenant, name: `QA stakeholder ${run}`, scope: 'INTERNAL', category: 'OPERATIONAL', type: 'TEAM', createdById: ids.admin, updatedById: ids.admin } })).id;
  ids.pir = (await prisma.pir.create({ data: { tenantId: ids.tenant, stakeholderId: ids.stakeholder, reference: `PIR-${run}`, title: 'QA PIR', question: 'Which behavior was observed?', createdById: ids.admin, updatedById: ids.admin } })).id;
  ids.sir = (await prisma.sir.create({ data: { tenantId: ids.tenant, pirId: ids.pir, reference: `SIR-${run}`, title: 'QA SIR', question: 'Which actor technique?', createdById: ids.admin, updatedById: ids.admin } })).id;
  ids.evidence = (await prisma.sirEvidence.create({ data: { tenantId: ids.tenant, sirId: ids.sir, threatActorId: ids.actor, relevanceNote: 'Independent source describes the technique.', createdById: ids.admin } })).id;
});

after(async () => {
  await prisma.ttpObservationReview.deleteMany({ where: { tenantId: ids.tenant } });
  await prisma.ttpObservation.deleteMany({ where: { tenantId: ids.tenant } });
  await prisma.auditLog.deleteMany({ where: { tenantId: ids.tenant } });
  await prisma.sirEvidence.deleteMany({ where: { tenantId: ids.tenant } });
  await prisma.sir.deleteMany({ where: { tenantId: ids.tenant } });
  await prisma.pir.deleteMany({ where: { tenantId: ids.tenant } });
  await prisma.stakeholder.deleteMany({ where: { tenantId: ids.tenant } });
  await prisma.campaign.deleteMany({ where: { tenantId: ids.tenant } });
  await prisma.mitreTechnique.deleteMany({ where: { tenantId: ids.tenant } });
  await prisma.threatActor.deleteMany({ where: { tenantId: ids.tenant } });
  await prisma.intelligenceEntity.deleteMany({ where: { tenantId: ids.tenant } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.user] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [ids.tenant, ids.otherTenant] } } });
  await prisma.$disconnect();
});

test('Given source-backed actor evidence, when candidate is created and confirmed, then timeline and review history show it', async () => {
  const created = await service.create(admin(), candidate());
  assert.equal(created.status, 'CANDIDATE');
  const confirmed = await service.review(admin(), created.id, { status: 'CONFIRMED', expectedStatus: 'CANDIDATE', reason: 'Source and technique mapping independently checked.' });
  assert.equal(confirmed.status, 'CONFIRMED');
  const timeline = await service.timeline(regular(), { actorId: ids.actor });
  assert.equal(timeline.find(row => row.id === created.id)?.reviews.length, 1);
});

test('Given overlapping intervals, when timeline is loaded, then uncertain ordering is explicit', async () => {
  const first = await service.create(admin(), candidate({ observedStartAt: '2026-11-10T00:00:00Z', observedEndAt: '2026-11-11T00:00:00Z', timePrecision: 'INTERVAL' }));
  const second = await service.create(admin(), candidate({ observedStartAt: '2026-11-10T12:00:00Z', observedEndAt: '2026-11-11T12:00:00Z', timePrecision: 'INTERVAL' }));
  const timeline = await service.timeline(admin(), { actorId: ids.actor });
  assert.equal(timeline.find(row => row.id === first.id)?.ordering, 'BEFORE');
  assert.equal(timeline.find(row => row.id === second.id)?.ordering, 'OVERLAPS');
});

test('Given RED evidence, when regular user reads, then the observation is hidden', async () => {
  const hidden = await service.create(admin(), candidate({ tlp: 'RED' }));
  assert.equal((await service.timeline(regular(), { actorId: ids.actor })).some(row => row.id === hidden.id), false);
  assert.equal((await service.timeline(admin(), { actorId: ids.actor })).some(row => row.id === hidden.id), true);
});

test('Given another tenant, when it references an actor or evidence, then creation and timeline access fail', async () => {
  const intruder = { sub: ids.admin, tenantId: ids.otherTenant, role: 'ADMIN' };
  await assert.rejects(service.create(intruder, candidate()), { name: 'NotFoundException' });
  await assert.rejects(service.timeline(intruder, { actorId: ids.actor }), { name: 'NotFoundException' });
});

test('Given an idempotency key, when reused with different evidence mapping, then conflict is returned', async () => {
  const input = candidate();
  await service.create(admin(), input);
  await assert.rejects(service.create(admin(), { ...input, observedStartAt: '2026-11-12T00:00:00Z', observedEndAt: '2026-11-12T00:00:00Z' }), { name: 'ConflictException' });
});
