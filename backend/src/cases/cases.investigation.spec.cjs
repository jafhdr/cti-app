const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const { CasesService } = require('../../dist/src/cases/cases.service.js');
const { CasesController } = require('../../dist/src/cases/cases.controller.js');
const { Prisma } = require('@prisma/client');

const actor = { sub: 'user-1', role: 'USER', tenantId: 'tenant-1' };
const baseCase = { id: 'case-1', tenantId: 'tenant-1', caseNumber: 'CASE-1', assigneeId: null };

function fakePrisma() {
  const notes = [];
  const evidence = [];
  const activities = [];
  const audits = [];
  const tx = {
    caseInvestigationNote: {
      findUnique: async ({ where }) => notes.find((item) => item.id === where.id) || null,
      create: async ({ data }) => {
        const value = { id: `note-${notes.length + 1}`, ...data, createdAt: new Date(), author: { id: actor.sub, name: 'Analyst', email: 'analyst@test' } };
        notes.push(value);
        return value;
      },
    },
    caseEvidence: {
      findUnique: async ({ where }) => evidence.find((item) => item.id === where.id) || null,
      create: async ({ data }) => {
        const value = { id: `evidence-${evidence.length + 1}`, ...data, createdAt: new Date(), creator: { id: actor.sub, name: 'Analyst', email: 'analyst@test' } };
        evidence.push(value);
        return value;
      },
    },
    caseActivity: { create: async ({ data }) => { const value = { id: `activity-${activities.length + 1}`, ...data, createdAt: new Date() }; activities.push(value); return value; } },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
  };
  return {
    notes,
    evidence,
    activities,
    audits,
    case: { findFirst: async ({ where }) => where.id === baseCase.id && (!where.tenantId || where.tenantId === baseCase.tenantId) ? baseCase : null },
    caseInvestigationNote: { findMany: async ({ where }) => notes.filter((item) => item.caseId === where.caseId && item.tenantId === where.tenantId) },
    caseEvidence: { findMany: async ({ where }) => evidence.filter((item) => item.caseId === where.caseId && item.tenantId === where.tenantId) },
    caseActivity: { findMany: async ({ where }) => activities.filter((item) => item.caseId === where.caseId && item.tenantId === where.tenantId) },
    $transaction: async (operation) => operation(tx),
  };
}

test('Given a tenant case, when an analyst adds a note, then author, activity, and audit are persisted', async () => {
  const prisma = fakePrisma();
  const note = await new CasesService(prisma).addNote(actor, baseCase.id, { requestId: 'note-request-1', content: '  IOC tervalidasi  ' });
  assert.equal(note.content, 'IOC tervalidasi');
  assert.equal(note.authorId, actor.sub);
  assert.equal(prisma.activities[0].action, 'NOTE_ADDED');
  assert.equal(prisma.audits[0].action, 'CASE_NOTE_ADDED');
});

test('Given existing notes, when notes are requested, then only scoped case notes are returned', async () => {
  const prisma = fakePrisma();
  await new CasesService(prisma).addNote(actor, baseCase.id, { requestId: 'note-request-2', content: 'Temuan' });
  assert.equal((await new CasesService(prisma).getNotes(actor, baseCase.id)).length, 1);
});

test('Given a tenant case, when evidence is added, then required fields and creator are persisted', async () => {
  const prisma = fakePrisma();
  const item = await new CasesService(prisma).addEvidence(actor, baseCase.id, { requestId: 'evidence-request-1', name: 'auth.log', type: 'log', description: 'Login gagal', source: 'SIEM' });
  assert.equal(item.name, 'auth.log');
  assert.equal(item.createdBy, actor.sub);
  assert.equal(prisma.activities[0].action, 'EVIDENCE_ADDED');
});

test('Given existing evidence, when evidence is requested, then scoped evidence is returned', async () => {
  const prisma = fakePrisma();
  const service = new CasesService(prisma);
  await service.addEvidence(actor, baseCase.id, { requestId: 'evidence-request-2', name: 'sample.bin', type: 'file' });
  assert.equal((await service.getEvidence(actor, baseCase.id))[0].type, 'file');
});

test('Given another tenant, when investigation data is requested, then the case is hidden', async () => {
  const service = new CasesService(fakePrisma());
  await assert.rejects(() => service.getNotes({ ...actor, tenantId: 'tenant-2' }, baseCase.id), /Case tidak ditemukan/);
});

test('Given an assignee without a tenant, when assignment is requested, then assignment is rejected', async () => {
  const prisma = fakePrisma();
  prisma.user = { findUnique: async () => ({ id: 'platform-user', tenantId: null }) };
  prisma.case.update = async () => baseCase;
  await assert.rejects(
    () => new CasesService(prisma).assign(actor, baseCase.id, 'platform-user'),
    /Assignee harus dari tenant yang sama/,
  );
});

test('Given investigation routes, then authentication module and analyst role authorization remain required', () => {
  assert.equal(Reflect.getMetadata('requiredModule', CasesController), 'case-management');
  assert.deepEqual(Reflect.getMetadata('roles', CasesController.prototype.addNote), ['SUPER_ADMIN', 'ADMIN', 'USER']);
  assert.deepEqual(Reflect.getMetadata('roles', CasesController.prototype.addEvidence), ['SUPER_ADMIN', 'ADMIN', 'USER']);
});

test('Given investigation changes, when timeline is requested, then note and evidence activities are ordered data', async () => {
  const prisma = fakePrisma();
  const service = new CasesService(prisma);
  await service.addNote(actor, baseCase.id, { requestId: 'note-request-3', content: 'Temuan' });
  await service.addEvidence(actor, baseCase.id, { requestId: 'evidence-request-3', name: 'trace.json', type: 'file' });
  assert.deepEqual((await service.getActivity(actor, baseCase.id)).map((item) => item.action), ['NOTE_ADDED', 'EVIDENCE_ADDED']);
});

test('Given the same request id, when a note retry arrives, then no duplicate note or activity is created', async () => {
  const prisma = fakePrisma();
  const service = new CasesService(prisma);
  const input = { requestId: 'note-retry-1', content: 'Temuan tunggal' };
  const first = await service.addNote(actor, baseCase.id, input);
  const retry = await service.addNote(actor, baseCase.id, input);
  assert.equal(retry.id, first.id);
  assert.equal(prisma.notes.length, 1);
  assert.equal(prisma.activities.length, 1);
});

test('Given the same request id, when an evidence retry arrives, then no duplicate evidence or activity is created', async () => {
  const prisma = fakePrisma();
  const service = new CasesService(prisma);
  const input = { requestId: 'evidence-retry-1', name: 'trace.json', type: 'file' };
  const first = await service.addEvidence(actor, baseCase.id, input);
  const retry = await service.addEvidence(actor, baseCase.id, input);
  assert.equal(retry.id, first.id);
  assert.equal(prisma.evidence.length, 1);
  assert.equal(prisma.activities.length, 1);
});

test('Given overlapping note retries, when the database reports a duplicate request id, then the committed note is returned', async () => {
  const prisma = fakePrisma();
  const committed = { id: 'note-race-1', caseId: baseCase.id, tenantId: baseCase.tenantId, authorId: actor.sub, content: 'Temuan tunggal', author: { id: actor.sub } };
  prisma.caseInvestigationNote.findUnique = async () => committed;
  prisma.$transaction = async () => { throw new Prisma.PrismaClientKnownRequestError('duplicate note', { code: 'P2002', clientVersion: '6.14.0' }); };
  assert.equal((await new CasesService(prisma).addNote(actor, baseCase.id, { requestId: committed.id, content: committed.content })).id, committed.id);
});

test('Given overlapping evidence retries, when the database reports a duplicate request id, then the committed evidence is returned', async () => {
  const prisma = fakePrisma();
  const committed = { id: 'evidence-race-1', caseId: baseCase.id, tenantId: baseCase.tenantId, createdBy: actor.sub, name: 'trace.json', type: 'file', creator: { id: actor.sub } };
  prisma.caseEvidence.findUnique = async () => committed;
  prisma.$transaction = async () => { throw new Prisma.PrismaClientKnownRequestError('duplicate evidence', { code: 'P2002', clientVersion: '6.14.0' }); };
  assert.equal((await new CasesService(prisma).addEvidence(actor, baseCase.id, { requestId: committed.id, name: committed.name, type: committed.type })).id, committed.id);
});

test('Given an activity write failure, when note creation is attempted, then the transaction exposes the failure', async () => {
  const prisma = fakePrisma();
  prisma.$transaction = async (operation) => operation({
    caseInvestigationNote: {
      findUnique: async () => null,
      create: async ({ data }) => ({ id: data.id, ...data }),
    },
    caseActivity: { create: async () => { throw new Error('activity write failed'); } },
    auditLog: { create: async () => ({}) },
  });
  await assert.rejects(
    () => new CasesService(prisma).addNote(actor, baseCase.id, { requestId: 'note-failure-1', content: 'Tidak boleh parsial' }),
    /activity write failed/,
  );
});

test('Given list filters and pagination, when cases are listed, then tenant scope and query options are applied', async () => {
  let findManyArgs;
  const prisma = {
    case: {
      findMany: async (args) => { findManyArgs = args; return [baseCase]; },
      count: async () => 1,
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  const result = await new CasesService(prisma).list(actor, { page: 2, limit: 10, search: ' login ', status: 'OPEN', priority: 'HIGH', severity: 'HIGH' });
  assert.equal(findManyArgs.where.tenantId, actor.tenantId);
  assert.equal(findManyArgs.where.status, 'OPEN');
  assert.equal(findManyArgs.where.priority, 'HIGH');
  assert.equal(findManyArgs.where.severity, 'HIGH');
  assert.equal(findManyArgs.where.OR[0].title.contains, 'login');
  assert.equal(findManyArgs.skip, 10);
  assert.equal(findManyArgs.take, 10);
  assert.equal(result.total, 1);
});

test('Given an authorized tenant admin, when a case is created, updated, and deleted, then each mutation is audited', async () => {
  const audits = [];
  const activities = [];
  let currentCase = { ...baseCase, title: 'Initial', priority: 'MEDIUM', status: 'OPEN', severity: 'MEDIUM' };
  const prisma = {
    tenant: { findUnique: async () => ({ id: actor.tenantId }) },
    caseOrigin: { findUnique: async () => null },
    caseEvidenceRevision: { count: async () => 0 },
    caseReviewRequest: { count: async () => 0 },
    case: {
      count: async () => 0,
      findFirst: async () => currentCase,
      create: async ({ data }) => { currentCase = { ...currentCase, ...data }; return currentCase; },
      update: async ({ data }) => { currentCase = { ...currentCase, ...data }; return currentCase; },
      delete: async () => currentCase,
    },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
    caseActivity: { create: async ({ data }) => { activities.push(data); return data; } },
  };
  prisma.$transaction = async operation => operation(prisma);
  const service = new CasesService(prisma);
  await service.create({ ...actor, role: 'ADMIN' }, { title: 'Initial', priority: 'MEDIUM' });
  await service.update({ ...actor, role: 'ADMIN' }, baseCase.id, { title: 'Updated' });
  await service.delete({ ...actor, role: 'ADMIN' }, baseCase.id);
  assert.deepEqual(audits.map((item) => item.action), ['CASE_CREATED', 'CASE_UPDATED', 'CASE_DELETED']);
  assert.deepEqual(activities.map((item) => item.action), ['CASE_CREATED', 'CASE_UPDATED']);
});
