const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const actions = [
  'CASE_V2_ORIGIN_CREATED', 'CASE_TASK_CREATED', 'CASE_TASK_UPDATED', 'CASE_HANDOFF',
  'CASE_DUE_DATE_CHANGED', 'CASE_EVIDENCE_REVISED', 'CASE_REVIEW_REQUESTED',
  'CASE_REVIEW_DECIDED', 'CASE_CLOSED_V2', 'CASE_REOPENED_V2',
];

async function main() {
  const events = await prisma.caseActivity.findMany({ where: { action: { in: actions } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  assert.ok(events.length > 0, 'Expected actual V2 Case activity records');
  assert.equal(await prisma.auditLog.count({ where: { action: { in: actions } } }), events.length, 'V2 audit/activity totals diverge');
  const ids = new Set();
  for (const event of events) {
    const metadata = event.metadata;
    assert.equal(typeof metadata?.requestId, 'string', `${event.action} lacks requestId`);
    assert.match(metadata.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(Number.isInteger(metadata.revision), true, `${event.action} lacks Case revision`);
    assert.equal(metadata.caseId, event.caseId);
    assert.equal(metadata.tenantId, event.tenantId);
    assert.equal(metadata.actorId, event.actorId);
    assert.equal(metadata.action, event.action);
    assert.ok(event.createdAt instanceof Date);
    assert.equal(ids.has(metadata.requestId), false, 'Duplicate request ID across distinct events');
    ids.add(metadata.requestId);
    const audit = await prisma.auditLog.findMany({ where: { action: event.action, tenantId: event.tenantId, metadata: { path: ['requestId'], equals: metadata.requestId } } });
    assert.equal(audit.length, 1, `${event.action} must have exactly one matching audit record`);
    assert.equal(audit[0].userId, event.actorId);
    assert.equal(audit[0].metadata.caseId, event.caseId);
    assert.equal(audit[0].metadata.revision, metadata.revision);
    assert.equal(audit[0].metadata.tenantId, event.tenantId);
    assert.equal(audit[0].createdAt.getTime(), event.createdAt.getTime());
    const record = await prisma.case.findFirst({ where: { id: event.caseId, tenantId: event.tenantId } });
    assert.ok(record);
    assert.ok(metadata.revision >= 0 && metadata.revision <= record.revision);
    if (event.action === 'CASE_V2_ORIGIN_CREATED') assert.equal(metadata.revision, 0);
    if (event.action === 'CASE_HANDOFF') {
      const handoff = await prisma.caseHandoff.findUniqueOrThrow({ where: { id: metadata.handoffId } });
      assert.equal(metadata.revision, handoff.caseRevision);
      assert.equal(metadata.previousAssigneeId, handoff.previousAssigneeId);
      assert.equal(metadata.newAssigneeId, handoff.newAssigneeId);
    }
    if (event.action === 'CASE_REVIEW_DECIDED') {
      const decision = await prisma.caseReviewDecision.findUniqueOrThrow({ where: { id: metadata.decisionId } });
      assert.equal(metadata.revision, decision.caseRevision);
      assert.equal(metadata.toReviewState, decision.kind);
    }
    if (event.action === 'CASE_CLOSED_V2') assert.deepEqual([metadata.fromStatus, metadata.toStatus], ['RESOLVED', 'CLOSED']);
    if (event.action === 'CASE_REOPENED_V2') assert.deepEqual([metadata.fromStatus, metadata.toStatus], ['CLOSED', 'IN_PROGRESS']);
  }
  const protectedEvent = events[0];
  await assert.rejects(prisma.caseActivity.update({ where: { id: protectedEvent.id }, data: { action: 'TAMPERED' } }));
  await assert.rejects(prisma.caseActivity.delete({ where: { id: protectedEvent.id } }));
  const protectedAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: protectedEvent.action, tenantId: protectedEvent.tenantId, metadata: { path: ['requestId'], equals: protectedEvent.metadata.requestId } } });
  await assert.rejects(prisma.auditLog.update({ where: { id: protectedAudit.id }, data: { action: 'TAMPERED' } }));
  await assert.rejects(prisma.auditLog.delete({ where: { id: protectedAudit.id } }));
  const owner = await prisma.user.findFirstOrThrow({ where: { tenantId: protectedEvent.tenantId } });
  const legacy = await prisma.case.create({ data: { tenantId: protectedEvent.tenantId, caseNumber: `AUDIT-V1-${Date.now()}`, title: 'V1 trigger compatibility', createdBy: owner.id } });
  const legacyActivity = await prisma.caseActivity.create({ data: { tenantId: legacy.tenantId, caseId: legacy.id, actorId: owner.id, action: 'CASE_STATUS_CHANGED', metadata: { toStatus: 'IN_PROGRESS' } } });
  const legacyAudit = await prisma.auditLog.create({ data: { tenantId: legacy.tenantId, userId: owner.id, action: 'CASE_STATUS_CHANGED', metadata: { caseId: legacy.id } } });
  await prisma.caseActivity.update({ where: { id: legacyActivity.id }, data: { metadata: { toStatus: 'OPEN' } } });
  await prisma.auditLog.update({ where: { id: legacyAudit.id }, data: { metadata: { caseId: legacy.id, note: 'V1 allowed' } } });
  await prisma.case.delete({ where: { id: legacy.id } });
  await prisma.auditLog.delete({ where: { id: legacyAudit.id } });
  console.log(JSON.stringify({ verdict: 'PASS', inspectedEvents: events.length, actionCounts: Object.fromEntries(actions.map(action => [action, events.filter(event => event.action === action).length])) }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
