import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, CaseStatus, CasePriority } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthUser } from '../users/users.types';
import { CreateCaseInput, CreateEvidenceInput, CreateInvestigationNoteInput, UpdateCaseInput, ListCaseQuery } from './cases.types';

@Injectable()
export class CasesService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantId(user: AuthUser): string {
    if (user.role !== 'SUPER_ADMIN' && !user.tenantId) {
      throw new ForbiddenException('Tenant context wajib tersedia');
    }
    return user.tenantId || '';
  }

  private async scopedCase(user: AuthUser, caseId: string) {
    const tenantId = user.role === 'SUPER_ADMIN' ? undefined : this.tenantId(user);
    const caseRecord = await this.prisma.case.findFirst({
      where: { id: caseId, ...(tenantId ? { tenantId } : {}) },
    });
    if (!caseRecord) throw new NotFoundException('Case tidak ditemukan');
    return caseRecord;
  }

  private async generateCaseNumber(tenantId: string): Promise<string> {
    const count = await this.prisma.case.count({ where: { tenantId } });
    const year = new Date().getFullYear();
    return `CASE-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async list(user: AuthUser, query: ListCaseQuery) {
    const page = Math.max(query.page || 1, 1);
    const limit = Math.min(Math.max(query.limit || 25, 1), 100);
    const tenantId = user.role === 'SUPER_ADMIN' ? undefined : this.tenantId(user);

    const where: Prisma.CaseWhereInput = {
      ...(tenantId ? { tenantId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.search?.trim()
        ? {
            OR: [
              { title: { contains: query.search.trim(), mode: 'insensitive' } },
              { description: { contains: query.search.trim(), mode: 'insensitive' } },
              { caseNumber: { contains: query.search.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.case.findMany({
        where,
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          creator: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.case.count({ where }),
    ]);

    return { items, page, limit, total };
  }

  async getAssignableUsers(user: AuthUser, tenantId?: string) {
    const targetTenantId = user.role === 'SUPER_ADMIN' ? tenantId : this.tenantId(user);
    
    if (!targetTenantId) {
      throw new BadRequestException('Tenant tidak valid');
    }

    const users = await this.prisma.user.findMany({
      where: {
        tenantId: targetTenantId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    return users;
  }

  async getDetail(user: AuthUser, caseId: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    const detail = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        creator: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
        entities: {
          include: {
            entity: { select: { id: true, name: true, type: true, severity: true } },
          },
        },
      },
    });
    return detail;
  }

  async getNotes(user: AuthUser, caseId: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    return this.prisma.caseInvestigationNote.findMany({
      where: { caseId, tenantId: caseRecord.tenantId },
      include: { author: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addNote(user: AuthUser, caseId: string, input: CreateInvestigationNoteInput) {
    const caseRecord = await this.scopedCase(user, caseId);
    const content = input.content.trim();
    if (!content) throw new BadRequestException('Catatan investigasi wajib diisi');

    return this.prisma.$transaction(async (tx) => {
      const note = await tx.caseInvestigationNote.create({
        data: { caseId, tenantId: caseRecord.tenantId, content, authorId: user.sub },
        include: { author: { select: { id: true, name: true, email: true } } },
      });
      await tx.caseActivity.create({
        data: { caseId, tenantId: caseRecord.tenantId, actorId: user.sub, action: 'NOTE_ADDED', metadata: { noteId: note.id } },
      });
      await tx.auditLog.create({
        data: { userId: user.sub, tenantId: caseRecord.tenantId, action: 'CASE_NOTE_ADDED', metadata: { caseId, noteId: note.id } },
      });
      return note;
    });
  }

  async getEvidence(user: AuthUser, caseId: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    return this.prisma.caseEvidence.findMany({
      where: { caseId, tenantId: caseRecord.tenantId },
      include: { creator: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addEvidence(user: AuthUser, caseId: string, input: CreateEvidenceInput) {
    const caseRecord = await this.scopedCase(user, caseId);
    const name = input.name.trim();
    const type = input.type.trim();
    if (!name || !type) throw new BadRequestException('Nama dan tipe evidence wajib diisi');

    return this.prisma.$transaction(async (tx) => {
      const evidence = await tx.caseEvidence.create({
        data: {
          caseId,
          tenantId: caseRecord.tenantId,
          name,
          type,
          description: input.description?.trim() || null,
          source: input.source?.trim() || null,
          createdBy: user.sub,
        },
        include: { creator: { select: { id: true, name: true, email: true } } },
      });
      await tx.caseActivity.create({
        data: { caseId, tenantId: caseRecord.tenantId, actorId: user.sub, action: 'EVIDENCE_ADDED', metadata: { evidenceId: evidence.id, name } },
      });
      await tx.auditLog.create({
        data: { userId: user.sub, tenantId: caseRecord.tenantId, action: 'CASE_EVIDENCE_ADDED', metadata: { caseId, evidenceId: evidence.id, name } },
      });
      return evidence;
    });
  }

  async getActivity(user: AuthUser, caseId: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    return this.prisma.caseActivity.findMany({
      where: { caseId, tenantId: caseRecord.tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(user: AuthUser, input: CreateCaseInput) {
    const tenantId = user.role === 'SUPER_ADMIN' ? input.tenantId : this.tenantId(user);
    if (!tenantId) throw new BadRequestException('Tenant wajib dipilih');

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant tidak ditemukan');

    if (input.assigneeId) {
      const assignee = await this.prisma.user.findUnique({ where: { id: input.assigneeId } });
      if (!assignee || assignee.tenantId !== tenantId) {
        throw new NotFoundException('Assignee tidak ditemukan di tenant ini');
      }
    }

    const caseNumber = await this.generateCaseNumber(tenantId);

    try {
      const newCase = await this.prisma.case.create({
        data: {
          tenantId,
          caseNumber,
          title: input.title,
          description: input.description,
          status: input.status || CaseStatus.OPEN,
          priority: input.priority || CasePriority.MEDIUM,
          severity: input.severity,
          assigneeId: input.assigneeId,
          createdBy: user.sub,
        },
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          creator: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
        },
      });

      await this.audit(user, tenantId, 'CASE_CREATED', {
        caseId: newCase.id,
        caseNumber: newCase.caseNumber,
        title: newCase.title,
      });
      await this.activity(user, tenantId, newCase.id, 'CASE_CREATED', { caseNumber: newCase.caseNumber });

      return newCase;
    } catch (error) {
      throw error;
    }
  }

  async update(user: AuthUser, caseId: string, input: UpdateCaseInput) {
    const caseRecord = await this.scopedCase(user, caseId);

    if (input.assigneeId) {
      const assignee = await this.prisma.user.findUnique({ where: { id: input.assigneeId } });
      if (!assignee || assignee.tenantId !== caseRecord.tenantId) {
        throw new NotFoundException('Assignee tidak ditemukan di tenant ini');
      }
    }

    const updated = await this.prisma.case.update({
      where: { id: caseId },
      data: {
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        severity: input.severity,
        assigneeId: input.assigneeId,
      },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        creator: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
      },
    });

    await this.audit(user, caseRecord.tenantId, 'CASE_UPDATED', {
      caseId: caseId,
      caseNumber: updated.caseNumber,
      title: updated.title,
    });
    await this.activity(user, caseRecord.tenantId, caseId, 'CASE_UPDATED', { caseNumber: updated.caseNumber });

    return updated;
  }

  async delete(user: AuthUser, caseId: string) {
    const caseRecord = await this.scopedCase(user, caseId);

    await this.prisma.case.delete({ where: { id: caseId } });

    await this.audit(user, caseRecord.tenantId, 'CASE_DELETED', {
      caseId: caseId,
      caseNumber: caseRecord.caseNumber,
      title: caseRecord.title,
    });

    return { success: true, message: 'Case berhasil dihapus' };
  }

  async assign(user: AuthUser, caseId: string, assigneeId: string) {
    const caseRecord = await this.scopedCase(user, caseId);

    // Validate assignee exists and belongs to same tenant
    const assignee = await this.prisma.user.findUnique({
      where: { id: assigneeId },
    });

    if (!assignee) {
      throw new NotFoundException('Assignee tidak ditemukan');
    }

    if (assignee.tenantId !== caseRecord.tenantId) {
      throw new ForbiddenException('Assignee harus dari tenant yang sama');
    }

    // Check if this is a reassignment
    const wasAssigned = caseRecord.assigneeId !== null;
    const isReassignment = wasAssigned && caseRecord.assigneeId !== assigneeId;

    // Update assignment
    const updated = await this.prisma.case.update({
      where: { id: caseId },
      data: { assigneeId },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        creator: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
      },
    });

    // Audit log with specific action
    const action = isReassignment ? 'CASE_REASSIGNED' : 'CASE_ASSIGNED';
    await this.audit(user, caseRecord.tenantId, action, {
      caseId: caseId,
      caseNumber: updated.caseNumber,
      title: updated.title,
      previousAssigneeId: caseRecord.assigneeId,
      newAssigneeId: assigneeId,
      assigneeName: assignee.name,
      assigneeEmail: assignee.email,
    });
    await this.activity(user, caseRecord.tenantId, caseId, action, {
      previousAssigneeId: caseRecord.assigneeId,
      newAssigneeId: assigneeId,
      assigneeName: assignee.name,
    });

    return updated;
  }

  private async audit(user: AuthUser, tenantId: string, action: string, metadata: Prisma.InputJsonObject) {
    await this.prisma.auditLog.create({
      data: {
        userId: user.sub,
        tenantId,
        action,
        metadata,
      },
    });
  }

  private async activity(user: AuthUser, tenantId: string, caseId: string, action: string, metadata: Prisma.InputJsonObject) {
    await this.prisma.caseActivity.create({
      data: { actorId: user.sub, tenantId, caseId, action, metadata },
    });
  }
}
