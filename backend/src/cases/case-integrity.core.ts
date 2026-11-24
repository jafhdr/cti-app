import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { writeCaseV2Audit } from './case-v2-audit';
import type { AuthUser } from '../users/users.types';

const historyActions = ['CASE_REVIEW_REQUESTED', 'CASE_REVIEW_DECIDED', 'CASE_CLOSED_V2', 'CASE_REOPENED_V2'];

@Injectable()
export class CaseIntegrityCore {
  constructor(private readonly prisma: PrismaService) {}

  scope(user: AuthUser, selected?: string): string {
    if (process.env.CASE_V2_INTEGRITY_ENABLED !== 'true') throw new ForbiddenException('Case V2 integrity belum aktif');
    if (user.role === 'SUPER_ADMIN') {
      if (!selected?.trim()) throw new BadRequestException('Tenant wajib dipilih');
      return selected;
    }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    if (selected && selected !== user.tenantId) throw new NotFoundException('Case tidak ditemukan');
    return user.tenantId;
  }

  async record(caseId: string, tenantId: string) {
    const record = await this.prisma.case.findFirst({ where: { id: caseId, tenantId } });
    if (!record) throw new NotFoundException('Case tidak ditemukan');
    return record;
  }

  async bump(tx: Prisma.TransactionClient, caseId: string, tenantId: string, expectedRevision: number) {
    const result = await tx.case.updateMany({ where: { id: caseId, tenantId, revision: expectedRevision }, data: { revision: { increment: 1 } } });
    if (result.count !== 1) throw new ConflictException('Case berubah; muat ulang sebelum mengubahnya');
  }

  async event(tx: Prisma.TransactionClient, user: AuthUser, tenantId: string, caseId: string, action: string, metadata: Prisma.InputJsonObject) {
    await writeCaseV2Audit(tx, { tenantId, caseId, actorId: user.sub, action, metadata });
  }

  async reviewerGrant(userId: string, tenantId: string): Promise<boolean> {
    const module = await this.prisma.appModule.findUnique({ where: { slug: 'case-management' }, select: { id: true } });
    if (!module) return false;
    const grant = await this.prisma.userModuleAccess.findUnique({ where: { userId_tenantId_moduleId: { userId, tenantId, moduleId: module.id } }, select: { featureKeys: true } });
    return grant?.featureKeys.includes('case-v2-reviewer') ?? false;
  }

  async investigatorIds(caseId: string, tenantId: string, cycle: number, requesterId?: string): Promise<Set<string>> {
    const [record, notes, evidence, tasks, activities, handoffs, reopen] = await Promise.all([
      this.record(caseId, tenantId),
      this.prisma.caseInvestigationNote.findMany({ where: { caseId, tenantId }, select: { authorId: true, createdAt: true } }),
      this.prisma.caseEvidence.findMany({ where: { caseId, tenantId }, select: { createdBy: true, createdAt: true } }),
      this.prisma.caseTask.findMany({ where: { caseId, tenantId }, select: { assigneeId: true, createdBy: true, createdAt: true } }),
      this.prisma.caseActivity.findMany({ where: { caseId, tenantId, action: { notIn: historyActions } }, select: { actorId: true, createdAt: true } }),
      this.prisma.caseHandoff.findMany({ where: { caseId, tenantId }, select: { previousAssigneeId: true, newAssigneeId: true, actorId: true, createdAt: true } }),
      cycle > 1 ? this.prisma.caseReopen.findFirst({ where: { caseId, tenantId, toCycle: cycle }, select: { reopenedAt: true } }) : Promise.resolve(null),
    ]);
    const start = reopen?.reopenedAt?.getTime() ?? 0;
    const ids = new Set<string>([record.createdBy, requesterId ?? '', record.assigneeId ?? '']);
    for (const note of notes) if (note.createdAt.getTime() >= start) ids.add(note.authorId);
    for (const item of evidence) if (item.createdAt.getTime() >= start) ids.add(item.createdBy);
    for (const task of tasks) if (task.createdAt.getTime() >= start) { ids.add(task.createdBy); ids.add(task.assigneeId); }
    for (const activity of activities) if (activity.actorId && activity.createdAt.getTime() >= start) ids.add(activity.actorId);
    for (const handoff of handoffs) if (handoff.createdAt.getTime() >= start) { ids.add(handoff.actorId); ids.add(handoff.previousAssigneeId ?? ''); ids.add(handoff.newAssigneeId); }
    return ids;
  }

  async investigationSnapshot(tx: Prisma.TransactionClient, caseId: string, tenantId: string) {
    const [record, evidence, tasks, activityCount] = await Promise.all([
      tx.case.findUniqueOrThrow({ where: { id: caseId }, select: { title: true, description: true, status: true, assigneeId: true, investigationCycle: true } }),
      tx.caseEvidence.findMany({ where: { caseId, tenantId }, include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } }, orderBy: { id: 'asc' } }),
      tx.caseTask.findMany({ where: { caseId, tenantId }, select: { id: true, state: true, assigneeId: true }, orderBy: { id: 'asc' } }),
      tx.caseActivity.count({ where: { caseId, tenantId, action: { notIn: historyActions } } }),
    ]);
    const content = { record, evidence: evidence.map(item => ({ id: item.id, name: item.name, type: item.type, description: item.description, source: item.source, latestRevision: item.revisions[0]?.revision ?? 0 })), tasks };
    return { hash: createHash('sha256').update(JSON.stringify(content)).digest('hex'), activityCount, evidence: content.evidence, tasks };
  }
}
