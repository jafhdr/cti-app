require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const { NextStepService } = require('../../dist/src/intelligence/next-step.service.js');

if (!/^\/cti_phase2b_qa_/.test(new URL(process.env.DATABASE_URL || '').pathname)) throw new Error('Disposable Phase 2B QA database required');
const fixture = JSON.parse(readFileSync('../.omo/evidence/sicti-phase2b-browser-fixture.json', 'utf8'));
const prisma = new PrismaClient();
const service = new NextStepService(prisma);
const admin = { sub: '', tenantId: fixture.tenantId, role: 'ADMIN' };
const user = { sub: '', tenantId: fixture.tenantId, role: 'USER' };
const other = { sub: '', tenantId: fixture.otherTenantId, role: 'ADMIN' };
const marker = `${Date.now()}-${process.pid}`;

async function observation(id, evidenceId, techniqueId, observedAt, tlp = 'AMBER') {
  const row = await prisma.ttpObservation.create({ data: { tenantId: fixture.tenantId, idempotencyKey: `${marker}-${id}`, threatActorId: fixture.actorId, mitreTechniqueId: techniqueId, attackVersion: 'Enterprise QA', sirEvidenceId: evidenceId, evidenceSnapshot: 'Synthetic independent QA source', evidenceDigest: 'qa-synthetic', attributionBasis: 'Synthetic analyst corroborated the behavior.', observedStartAt: observedAt, observedEndAt: observedAt, timePrecision: 'INSTANT', tlp, actorConfidence: 80, techniqueConfidence: 90, createdById: admin.sub, status: 'CONFIRMED' } });
  await prisma.ttpObservationReview.create({ data: { tenantId: fixture.tenantId, observationId: row.id, status: 'CONFIRMED', reason: 'Synthetic QA analyst review.', reviewerId: admin.sub } });
  return row;
}

test('Given confirmed independent sources, when an as-of run is created, then history, cutoff, security and outcome remain auditable', { timeout: 30000 }, async () => {
  try {
    admin.sub = (await prisma.user.findUniqueOrThrow({ where: { email: fixture.email } })).id;
    user.sub = (await prisma.user.findUniqueOrThrow({ where: { email: fixture.userEmail } })).id;
    other.sub = (await prisma.user.findUniqueOrThrow({ where: { email: fixture.otherEmail } })).id;
    await observation('first', fixture.evidenceId, fixture.commandId, new Date(Date.now() - 7200000));
    await observation('second', fixture.secondEvidenceId, fixture.commandId, new Date(Date.now() - 3600000));
    const asOf = new Date().toISOString();
    const request = { idempotencyKey: `${marker}-run`, threatActorId: fixture.actorId, asOf, horizonDays: 14 };
    const first = await service.create(admin, request);
    assert.equal(first.status, 'GENERATED', first.abstentionReason ?? undefined);
    assert.equal(first.candidates.length, 1);
    assert.equal(first.candidates[0].techniqueExternalId, 'T1105');
    assert.equal((await service.create(admin, request)).id, first.id);
    await assert.rejects(service.create(admin, { ...request, horizonDays: 7 }), { status: 409 });
    await assert.rejects(service.create(other, { ...request, idempotencyKey: `${marker}-foreign` }), { status: 404 });
    await assert.rejects(service.create(admin, { ...request, idempotencyKey: `${marker}-future`, asOf: new Date(Date.now() + 60000).toISOString() }), { status: 400 });
    const late = await observation('late', fixture.evidenceId, fixture.commandId, new Date(Date.now() - 1800000));
    await prisma.mitreTechnique.create({ data: { tenantId: fixture.tenantId, externalId: `T-LATE-${marker}`, name: 'Late catalog entry', tactic: 'Discovery', platform: 'Windows' } });
    const repeated = await service.create(admin, { ...request, idempotencyKey: `${marker}-replay` });
    assert.equal(repeated.inputDigest, first.inputDigest);
    assert.deepEqual(repeated.candidates[0].ruleTrace, first.candidates[0].ruleTrace);
    assert.ok(!repeated.candidates[0].supportingObservationIds.includes(late.id));
    await prisma.mitreTechnique.update({ where: { id: fixture.commandId }, data: { name: 'Command technique revised after cutoff' } });
    const drifted = await service.create(admin, { ...request, idempotencyKey: `${marker}-drift` });
    assert.equal(drifted.status, 'ABSTAINED');
    assert.match(drifted.abstentionReason, /catalog changed after cutoff/i);
    const visible = await service.list(user, { actorId: fixture.actorId });
    assert.ok(visible.some(row => row.id === first.id));
    await assert.rejects(service.list(other, { actorId: fixture.actorId }), { status: 404 });
    const candidateId = first.candidates[0].id;
    const attempts = await Promise.allSettled([service.review(admin, candidateId, { kind: 'DISPOSITION', disposition: 'ACCEPT_FOR_INVESTIGATION', expectedReviewId: null, reason: 'Investigate source-backed command activity.' }), service.review(admin, candidateId, { kind: 'DISPOSITION', disposition: 'DISMISSED', expectedReviewId: null, reason: 'Dismissal attempted concurrently.' })]);
    assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
    const last = await prisma.nextStepReview.findFirstOrThrow({ where: { candidateId }, orderBy: { createdAt: 'desc' } });
    const preIngested = await observation('pre-ingested', fixture.outcomeEvidenceId, fixture.transferId, new Date());
    await prisma.ttpObservation.update({ where: { id: preIngested.id }, data: { ingestedAt: new Date(asOf) } });
    await assert.rejects(service.review(admin, candidateId, { kind: 'OUTCOME', outcome: 'VERIFIED', outcomeObservationId: preIngested.id, expectedReviewId: last.id, reason: 'Future-dated pre-ingested record is invalid.' }), { status: 400 });
    const outcome = await observation('outcome', fixture.outcomeEvidenceId, fixture.transferId, new Date(), 'RED');
    const verified = await service.review(admin, candidateId, { kind: 'OUTCOME', outcome: 'VERIFIED', outcomeObservationId: outcome.id, expectedReviewId: last.id, reason: 'Independent later confirmed technique observation.' });
    assert.equal(verified.outcome, 'VERIFIED');
    assert.ok(!(await service.list(user, { actorId: fixture.actorId })).some(row => row.id === first.id));
    const red = await observation('red', fixture.evidenceId, fixture.commandId, new Date(Date.now() - 900000), 'RED');
    assert.ok(red.id);
    const redRun = await service.create(admin, { ...request, idempotencyKey: `${marker}-red`, asOf: new Date().toISOString() });
    assert.equal(redRun.maxTlp, 'RED');
    assert.ok(!(await service.list(user, { actorId: fixture.actorId })).some(row => row.id === redRun.id));
  } finally { await prisma.$disconnect(); }
});
