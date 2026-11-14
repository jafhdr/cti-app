import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, CaseTaskState, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { enqueueCaseAssignment } from '../notifications/case-assignment-event';
import type { AuthUser } from '../users/users.types';
import type { CreateCaseTaskInput, HandoffCaseInput, SetCaseDueDateInput, UpdateCaseTaskInput } from './case-workflow.types';
import { writeCaseV2Audit } from './case-v2-audit';

@Injectable()
export class CasesWorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(user: AuthUser, selected?: string): string {
    if (process.env.CASE_V2_WORKFLOW_ENABLED !== 'true') throw new ForbiddenException('Case V2 workflow belum aktif');
    if (user.role === 'SUPER_ADMIN') {
      if (!selected?.trim()) throw new BadRequestException('Tenant wajib dipilih');
      return selected;
    }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    if (selected && selected !== user.tenantId) throw new NotFoundException('Case tidak ditemukan');
    return user.tenantId;
  }

  private async record(caseId: string, tenantId: string) {
    const record = await this.prisma.case.findFirst({ where: { id: caseId, tenantId }, select: {
      id: true, tenantId: true, caseNumber: true, status: true, assigneeId: true, dueAt: true, revision: true,
      assignee: { select: { name: true } },
    } });
    if (!record) throw new NotFoundException('Case tidak ditemukan');
    return record;
  }

  private async assignee(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId, isActive: true }, select: { id: true, name: true } });
    if (!user) throw new NotFoundException('Assignee tidak ditemukan di tenant ini');
    return user;
  }

  private async bump(tx: Prisma.TransactionClient, caseId: string, tenantId: string, expectedRevision: number) {
    const result = await tx.case.updateMany({ where: { id: caseId, tenantId, revision: expectedRevision }, data: { revision: { increment: 1 } } });
    if (result.count !== 1) throw new ConflictException('Case berubah; muat ulang sebelum mengubahnya');
  }

  private async event(tx: Prisma.TransactionClient, user: AuthUser, tenantId: string, caseId: string, action: string, metadata: Prisma.InputJsonObject) {
    await writeCaseV2Audit(tx, { tenantId, caseId, actorId: user.sub, action, metadata });
  }

  async get(user: AuthUser, caseId: string, selected?: string) {
    const tenantId = this.scope(user, selected);
    const record = await this.record(caseId, tenantId);
    const [tasks, handoffs] = await Promise.all([
      this.prisma.caseTask.findMany({ where: { tenantId, caseId }, include: { assignee: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.caseHandoff.findMany({ where: { tenantId, caseId }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { revision: record.revision, dueAt: record.dueAt, slaPolicyKey: null,
      overdue: Boolean(record.dueAt && record.dueAt.getTime() < Date.now() && (record.status === CaseStatus.OPEN || record.status === CaseStatus.IN_PROGRESS)),
      status: record.status, assigneeId: record.assigneeId, canManage: user.role !== 'USER', currentUserId: user.sub, tasks, handoffs };
  }

  async createTask(user: AuthUser, caseId: string, selected: string | undefined, input: CreateCaseTaskInput) {
    const tenantId = this.scope(user, selected);
    await this.record(caseId, tenantId);
    const assignee = await this.assignee(tenantId, input.assigneeId);
    const title = input.title.trim();
    if (!title) throw new BadRequestException('Judul task wajib');
    return this.prisma.$transaction(async tx => {
      await this.bump(tx, caseId, tenantId, input.expectedRevision);
      const task = await tx.caseTask.create({ data: { tenantId, caseId, title, description: input.description?.trim() || null, assigneeId: assignee.id, createdBy: user.sub } });
      await this.event(tx, user, tenantId, caseId, 'CASE_TASK_CREATED', { taskId: task.id, assigneeId: assignee.id, title, fromState: null, toState: task.state });
      return task;
    });
  }

  async updateTask(user: AuthUser, caseId: string, taskId: string, selected: string | undefined, input: UpdateCaseTaskInput) {
    const tenantId = this.scope(user, selected);
    await this.record(caseId, tenantId);
    const task = await this.prisma.caseTask.findFirst({ where: { id: taskId, caseId, tenantId } });
    if (!task) throw new NotFoundException('Task tidak ditemukan');
    if (user.role === 'USER' && (task.assigneeId !== user.sub || input.assigneeId !== undefined)) throw new ForbiddenException('Task bukan milik Anda');
    if (input.assigneeId === undefined && input.state === undefined) throw new BadRequestException('Perubahan task wajib diisi');
    if (input.state !== undefined && input.state !== task.state) {
      const allowed = (task.state === CaseTaskState.TODO && (input.state === CaseTaskState.IN_PROGRESS || input.state === CaseTaskState.CANCELLED))
        || (task.state === CaseTaskState.IN_PROGRESS && (input.state === CaseTaskState.DONE || input.state === CaseTaskState.CANCELLED));
      if (!allowed || (user.role === 'USER' && input.state === CaseTaskState.CANCELLED)) throw new BadRequestException('Transisi task tidak valid');
    }
    if ((task.state === CaseTaskState.DONE || task.state === CaseTaskState.CANCELLED) && input.assigneeId !== undefined) throw new BadRequestException('Task terminal tidak dapat ditugaskan ulang');
    const nextAssignee = input.assigneeId === undefined ? null : await this.assignee(tenantId, input.assigneeId);
    if ((input.state === undefined || input.state === task.state) && (!nextAssignee || nextAssignee.id === task.assigneeId)) throw new BadRequestException('Task tidak berubah');
    return this.prisma.$transaction(async tx => {
      await this.bump(tx, caseId, tenantId, input.expectedRevision);
      const changed = await tx.caseTask.update({ where: { id: taskId, tenantId, caseId, state: task.state, assigneeId: task.assigneeId }, data: {
        state: input.state, assigneeId: nextAssignee?.id, completedAt: input.state === CaseTaskState.DONE ? new Date() : undefined,
      } });
      await this.event(tx, user, tenantId, caseId, 'CASE_TASK_UPDATED', { taskId, fromState: task.state, toState: changed.state, previousAssigneeId: task.assigneeId, assigneeId: changed.assigneeId });
      return changed;
    }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new ConflictException('Task berubah; muat ulang');
      throw error;
    });
  }

  async handoff(user: AuthUser, caseId: string, selected: string | undefined, input: HandoffCaseInput) {
    const tenantId = this.scope(user, selected);
    const record = await this.record(caseId, tenantId);
    const next = await this.assignee(tenantId, input.assigneeId);
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('Alasan handoff wajib');
    if (record.assigneeId === next.id) throw new BadRequestException('Assignee tidak berubah');
    return this.prisma.$transaction(async tx => {
      await this.bump(tx, caseId, tenantId, input.expectedRevision);
      await tx.case.update({ where: { id: caseId, tenantId }, data: { assigneeId: next.id } });
      const handoff = await tx.caseHandoff.create({ data: { tenantId, caseId, previousAssigneeId: record.assigneeId,
        previousAssigneeName: record.assignee?.name ?? null, newAssigneeId: next.id, newAssigneeName: next.name,
        actorId: user.sub, reason, caseRevision: input.expectedRevision + 1 } });
      const action = record.assigneeId ? 'CASE_REASSIGNED' : 'CASE_ASSIGNED';
      await this.event(tx, user, tenantId, caseId, 'CASE_HANDOFF', { handoffId: handoff.id, previousAssigneeId: record.assigneeId, newAssigneeId: next.id, reason });
      await enqueueCaseAssignment(tx, { tenantId, caseId, recipientId: next.id, actorId: user.sub, type: action });
      return handoff;
    });
  }

  async dueDate(user: AuthUser, caseId: string, selected: string | undefined, input: SetCaseDueDateInput) {
    const tenantId = this.scope(user, selected);
    const record = await this.record(caseId, tenantId);
    if (input.dueAt === undefined) throw new BadRequestException('dueAt wajib diisi');
    if (input.dueAt !== null && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(input.dueAt)) throw new BadRequestException('dueAt harus UTC ISO 8601');
    const dueAt = input.dueAt === null ? null : new Date(input.dueAt);
    return this.prisma.$transaction(async tx => {
      await this.bump(tx, caseId, tenantId, input.expectedRevision);
      await tx.case.update({ where: { id: caseId, tenantId }, data: { dueAt } });
      await this.event(tx, user, tenantId, caseId, 'CASE_DUE_DATE_CHANGED', { previousDueAt: record.dueAt?.toISOString() ?? null, dueAt: dueAt?.toISOString() ?? null });
      return { dueAt, revision: input.expectedRevision + 1 };
    });
  }

}
