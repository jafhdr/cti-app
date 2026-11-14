import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, CaseStatus, CasePriority } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { enqueueCaseAssignment } from '../notifications/case-assignment-event';
import { AuthUser } from '../users/users.types';
import { CreateCaseInput, CreateEvidenceInput, CreateInvestigationNoteInput, UpdateCaseInput, ListCaseQuery } from './cases.types';
import { operationalIndicatorWhere } from '../indicators/indicator-eligibility';

@Injectable()
export class CasesService {
  constructor(private readonly prisma: PrismaService) {}

  private validTransition(from: CaseStatus, to: CaseStatus): boolean {
    return (from === CaseStatus.OPEN && to === CaseStatus.IN_PROGRESS)
      || (from === CaseStatus.IN_PROGRESS && to === CaseStatus.RESOLVED)
      || (from === CaseStatus.RESOLVED && (to === CaseStatus.IN_PROGRESS || to === CaseStatus.CLOSED));
  }

  private async tenantIntegrityEnabled(tenantId: string): Promise<boolean> {
    if (process.env.CASE_V2_INTEGRITY_ENABLED !== 'true') return false;
    const assignment = await this.prisma.userModuleAccess.findFirst({ where: { tenantId, module: { slug: 'case-management' }, featureKeys: { has: 'case-v2-integrity' } }, select: { userId: true } });
    return assignment !== null;
  }

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

  private async generateCaseNumber(
    tenantId: string,
    client: Pick<Prisma.TransactionClient, 'case'> = this.prisma,
  ): Promise<string> {
    const count = await client.case.count({ where: { tenantId } });
    const year = new Date().getFullYear();
    return `CASE-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async list(user: AuthUser, query: ListCaseQuery) {
    const page = Math.max(query.page || 1, 1);
    const limit = Math.min(Math.max(query.limit || 25, 1), 100);
    const tenantId = user.role === 'SUPER_ADMIN' ? query.tenantId : this.tenantId(user);
    if (!tenantId) throw new BadRequestException('Tenant wajib dipilih');

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

  async getDetail(user: AuthUser, caseId: string, selectedTenantId?: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    if (user.role === 'SUPER_ADMIN' && selectedTenantId !== caseRecord.tenantId) throw new NotFoundException('Case tidak ditemukan');
    const detail = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        alerts: { where: { source: 'ASM' }, orderBy: { firstSeenAt: 'desc' }, include: { asset: { select: { id: true, value: true } }, finding: { select: { id: true, title: true } }, changeEvent: { select: { id: true, type: true, detectedAt: true } }, vulnerabilityCorrelation: { include: { vulnerability: { select: { cveId: true, name: true } } } } } },
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
    const integrityEnabled = await this.tenantIntegrityEnabled(caseRecord.tenantId);

    try {
      return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.caseInvestigationNote.findUnique({
        where: { id: input.requestId },
        include: { author: { select: { id: true, name: true, email: true } } },
      });
      if (existing) {
        if (existing.caseId !== caseId || existing.tenantId !== caseRecord.tenantId || existing.authorId !== user.sub) {
          throw new ConflictException('Request ID catatan sudah digunakan');
        }
        return existing;
      }
      const note = await tx.caseInvestigationNote.create({
        data: { id: input.requestId, caseId, tenantId: caseRecord.tenantId, content, authorId: user.sub },
        include: { author: { select: { id: true, name: true, email: true } } },
      });
      await tx.caseActivity.create({
        data: { caseId, tenantId: caseRecord.tenantId, actorId: user.sub, action: 'NOTE_ADDED', metadata: { noteId: note.id } },
      });
      await tx.auditLog.create({
        data: { userId: user.sub, tenantId: caseRecord.tenantId, action: 'CASE_NOTE_ADDED', metadata: { caseId, noteId: note.id } },
      });
      if (integrityEnabled) await tx.case.update({ where: { id: caseId }, data: { revision: { increment: 1 } } });
        return note;
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const existing = await this.prisma.caseInvestigationNote.findUnique({
        where: { id: input.requestId },
        include: { author: { select: { id: true, name: true, email: true } } },
      });
      if (!existing || existing.caseId !== caseId || existing.tenantId !== caseRecord.tenantId || existing.authorId !== user.sub) {
        throw new ConflictException('Request ID catatan sudah digunakan');
      }
      return existing;
    }
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
    const integrityEnabled = await this.tenantIntegrityEnabled(caseRecord.tenantId);

    try {
      return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.caseEvidence.findUnique({
        where: { id: input.requestId },
        include: { creator: { select: { id: true, name: true, email: true } } },
      });
      if (existing) {
        if (existing.caseId !== caseId || existing.tenantId !== caseRecord.tenantId || existing.createdBy !== user.sub) {
          throw new ConflictException('Request ID evidence sudah digunakan');
        }
        return existing;
      }
      const evidence = await tx.caseEvidence.create({
        data: {
          id: input.requestId,
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
      if (integrityEnabled) {
        await tx.caseEvidenceRevision.create({ data: { tenantId: caseRecord.tenantId, caseId, evidenceId: evidence.id, revision: 1,
          name: evidence.name, type: evidence.type, description: evidence.description, source: evidence.source, authorId: user.sub } });
        await tx.case.update({ where: { id: caseId }, data: { revision: { increment: 1 } } });
      }
        return evidence;
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const existing = await this.prisma.caseEvidence.findUnique({
        where: { id: input.requestId },
        include: { creator: { select: { id: true, name: true, email: true } } },
      });
      if (!existing || existing.caseId !== caseId || existing.tenantId !== caseRecord.tenantId || existing.createdBy !== user.sub) {
        throw new ConflictException('Request ID evidence sudah digunakan');
      }
      return existing;
    }
  }

  async getActivity(user: AuthUser, caseId: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    return this.prisma.caseActivity.findMany({
      where: { caseId, tenantId: caseRecord.tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async getIndicators(user: AuthUser, caseId: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    const links = await this.prisma.caseIndicator.findMany({
      where: { caseId, tenantId: caseRecord.tenantId },
      include: { indicator: { include: { sourceObservations: { orderBy: { firstSeenAt: 'asc' } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return links.map((link) => link.indicator);
  }

  async getAvailableIndicators(user: AuthUser, caseId: string, search?: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    const value = search?.trim();
    return this.prisma.indicator.findMany({
      where: {
        ...operationalIndicatorWhere(caseRecord.tenantId, new Date()),
        cases: { none: { caseId } },
        ...(value ? {
          OR: [
            { value: { contains: value, mode: 'insensitive' } },
            { source: { contains: value, mode: 'insensitive' } },
            { tags: { has: value.toLowerCase() } },
          ],
        } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async linkIndicator(user: AuthUser, caseId: string, indicatorId: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    const indicator = await this.prisma.indicator.findFirst({
      where: { id: indicatorId, ...operationalIndicatorWhere(caseRecord.tenantId, new Date()) },
    });
    if (!indicator) throw new NotFoundException('Indicator tidak ditemukan');
    const existing = await this.prisma.caseIndicator.findUnique({
      where: { caseId_indicatorId: { caseId, indicatorId } },
    });
    if (existing) throw new ConflictException('Indicator sudah terhubung ke Case');

    try {
      return await this.prisma.$transaction(async (tx) => {
      const link = await tx.caseIndicator.create({
        data: { tenantId: caseRecord.tenantId, caseId, indicatorId, createdBy: user.sub },
        include: { indicator: true },
      });
      const metadata = { indicatorId, value: indicator.value, type: indicator.type };
      await tx.caseActivity.create({
        data: { caseId, tenantId: caseRecord.tenantId, actorId: user.sub, action: 'INDICATOR_LINKED', metadata },
      });
      await tx.auditLog.create({
        data: { userId: user.sub, tenantId: caseRecord.tenantId, action: 'CASE_INDICATOR_LINKED', metadata: { caseId, ...metadata } },
      });
        return link.indicator;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Indicator sudah terhubung ke Case');
      }
      throw error;
    }
  }

  async unlinkIndicator(user: AuthUser, caseId: string, indicatorId: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    const link = await this.prisma.caseIndicator.findUnique({
      where: { caseId_indicatorId: { caseId, indicatorId } },
      include: { indicator: true },
    });
    if (!link || link.tenantId !== caseRecord.tenantId) throw new NotFoundException('Indicator tidak terhubung ke Case');

    return this.prisma.$transaction(async (tx) => {
      await tx.caseIndicator.delete({ where: { caseId_indicatorId: { caseId, indicatorId } } });
      const metadata = { indicatorId, value: link.indicator.value, type: link.indicator.type };
      await tx.caseActivity.create({
        data: { caseId, tenantId: caseRecord.tenantId, actorId: user.sub, action: 'INDICATOR_UNLINKED', metadata },
      });
      await tx.auditLog.create({
        data: { userId: user.sub, tenantId: caseRecord.tenantId, action: 'CASE_INDICATOR_UNLINKED', metadata: { caseId, ...metadata } },
      });
      return { success: true };
    });
  }

  async getThreatActors(user: AuthUser, caseId: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    const links = await this.prisma.caseThreatActor.findMany({
      where: { caseId, tenantId: caseRecord.tenantId },
      include: { threatActor: { include: { entity: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return links.map((link) => link.threatActor);
  }

  async getAvailableThreatActors(user: AuthUser, caseId: string, search?: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    const value = search?.trim();
    return this.prisma.threatActor.findMany({
      where: {
        tenantId: caseRecord.tenantId,
        cases: { none: { caseId } },
        ...(value ? {
          OR: [
            { entity: { name: { contains: value, mode: 'insensitive' } } },
            { aliases: { has: value } },
            { motivation: { contains: value, mode: 'insensitive' } },
            { country: { contains: value, mode: 'insensitive' } },
          ],
        } : {}),
      },
      include: { entity: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  async linkThreatActor(user: AuthUser, caseId: string, threatActorId: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    const threatActor = await this.prisma.threatActor.findFirst({
      where: { id: threatActorId, tenantId: caseRecord.tenantId },
      include: { entity: true },
    });
    if (!threatActor) throw new NotFoundException('Threat Actor tidak ditemukan');
    const existing = await this.prisma.caseThreatActor.findUnique({
      where: { caseId_threatActorId: { caseId, threatActorId } },
    });
    if (existing) throw new ConflictException('Threat Actor sudah terhubung ke Case');

    return this.prisma.$transaction(async (tx) => {
      const link = await tx.caseThreatActor.create({
        data: { tenantId: caseRecord.tenantId, caseId, threatActorId, createdBy: user.sub },
        include: { threatActor: { include: { entity: true } } },
      });
      const metadata = { threatActorId, name: threatActor.entity.name };
      await tx.caseActivity.create({
        data: { caseId, tenantId: caseRecord.tenantId, actorId: user.sub, action: 'THREAT_ACTOR_LINKED', metadata },
      });
      await tx.auditLog.create({
        data: { userId: user.sub, tenantId: caseRecord.tenantId, action: 'CASE_THREAT_ACTOR_LINKED', metadata: { caseId, ...metadata } },
      });
      return link.threatActor;
    });
  }

  async unlinkThreatActor(user: AuthUser, caseId: string, threatActorId: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    const link = await this.prisma.caseThreatActor.findUnique({
      where: { caseId_threatActorId: { caseId, threatActorId } },
      include: { threatActor: { include: { entity: true } } },
    });
    if (!link || link.tenantId !== caseRecord.tenantId) throw new NotFoundException('Threat Actor tidak terhubung ke Case');

    return this.prisma.$transaction(async (tx) => {
      await tx.caseThreatActor.delete({ where: { caseId_threatActorId: { caseId, threatActorId } } });
      const metadata = { threatActorId, name: link.threatActor.entity.name };
      await tx.caseActivity.create({
        data: { caseId, tenantId: caseRecord.tenantId, actorId: user.sub, action: 'THREAT_ACTOR_UNLINKED', metadata },
      });
      await tx.auditLog.create({
        data: { userId: user.sub, tenantId: caseRecord.tenantId, action: 'CASE_THREAT_ACTOR_UNLINKED', metadata: { caseId, ...metadata } },
      });
      return { success: true };
    });
  }

  async getCampaigns(user: AuthUser, caseId: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    const links = await this.prisma.caseCampaign.findMany({
      where: { caseId, tenantId: caseRecord.tenantId },
      include: { campaign: { include: { threatActor: { include: { entity: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return links.map((link) => link.campaign);
  }

  async getAvailableCampaigns(user: AuthUser, caseId: string, search?: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    const value = search?.trim();
    return this.prisma.campaign.findMany({
      where: {
        tenantId: caseRecord.tenantId,
        cases: { none: { caseId } },
        ...(value ? {
          OR: [
            { name: { contains: value, mode: 'insensitive' } },
            { description: { contains: value, mode: 'insensitive' } },
            { objective: { contains: value, mode: 'insensitive' } },
            { externalId: { contains: value, mode: 'insensitive' } },
          ],
        } : {}),
      },
      include: { threatActor: { include: { entity: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  async linkCampaign(user: AuthUser, caseId: string, campaignId: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, tenantId: caseRecord.tenantId },
      include: { threatActor: { include: { entity: true } } },
    });
    if (!campaign) throw new NotFoundException('Campaign tidak ditemukan');
    const existing = await this.prisma.caseCampaign.findUnique({ where: { caseId_campaignId: { caseId, campaignId } } });
    if (existing) throw new ConflictException('Campaign sudah terhubung ke Case');

    return this.prisma.$transaction(async (tx) => {
      const link = await tx.caseCampaign.create({
        data: { tenantId: caseRecord.tenantId, caseId, campaignId, createdBy: user.sub },
        include: { campaign: { include: { threatActor: { include: { entity: true } } } } },
      });
      const metadata = { campaignId, name: campaign.name };
      await tx.caseActivity.create({ data: { caseId, tenantId: caseRecord.tenantId, actorId: user.sub, action: 'CAMPAIGN_LINKED', metadata } });
      await tx.auditLog.create({ data: { userId: user.sub, tenantId: caseRecord.tenantId, action: 'CASE_CAMPAIGN_LINKED', metadata: { caseId, ...metadata } } });
      return link.campaign;
    });
  }

  async unlinkCampaign(user: AuthUser, caseId: string, campaignId: string) {
    const caseRecord = await this.scopedCase(user, caseId);
    const link = await this.prisma.caseCampaign.findUnique({
      where: { caseId_campaignId: { caseId, campaignId } },
      include: { campaign: true },
    });
    if (!link || link.tenantId !== caseRecord.tenantId) throw new NotFoundException('Campaign tidak terhubung ke Case');

    return this.prisma.$transaction(async (tx) => {
      await tx.caseCampaign.delete({ where: { caseId_campaignId: { caseId, campaignId } } });
      const metadata = { campaignId, name: link.campaign.name };
      await tx.caseActivity.create({ data: { caseId, tenantId: caseRecord.tenantId, actorId: user.sub, action: 'CAMPAIGN_UNLINKED', metadata } });
      await tx.auditLog.create({ data: { userId: user.sub, tenantId: caseRecord.tenantId, action: 'CASE_CAMPAIGN_UNLINKED', metadata: { caseId, ...metadata } } });
      return { success: true };
    });
  }

  async create(user: AuthUser, input: CreateCaseInput) {
    const tenantId = user.role === 'SUPER_ADMIN' ? input.tenantId : this.tenantId(user);
    if (!tenantId) throw new BadRequestException('Tenant wajib dipilih');

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant tidak ditemukan');

    if (input.assigneeId) {
      const assignee = await this.prisma.user.findUnique({ where: { id: input.assigneeId } });
      if (!assignee || assignee.tenantId !== tenantId || !assignee.isActive) {
        throw new NotFoundException('Assignee tidak ditemukan di tenant ini');
      }
    }

    const caseNumber = await this.generateCaseNumber(tenantId);

    return this.prisma.$transaction(async tx => {
      const newCase = await tx.case.create({
        data: {
          tenantId,
          caseNumber,
          title: input.title,
          description: input.description,
          status: CaseStatus.OPEN,
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

      await tx.auditLog.create({ data: { userId: user.sub, tenantId, action: 'CASE_CREATED', metadata: {
        caseId: newCase.id,
        caseNumber: newCase.caseNumber,
        title: newCase.title,
      } } });
      await tx.caseActivity.create({ data: { tenantId, caseId: newCase.id, actorId: user.sub, action: 'CASE_CREATED', metadata: { caseNumber: newCase.caseNumber } } });
      if (input.assigneeId) await enqueueCaseAssignment(tx, { tenantId, caseId: newCase.id, recipientId: input.assigneeId, actorId: user.sub, type: 'CASE_ASSIGNED' });

      return newCase;
    });
  }

  async update(user: AuthUser, caseId: string, input: UpdateCaseInput) {
    const caseRecord = await this.scopedCase(user, caseId);

    if (input.status === CaseStatus.CLOSED && await this.tenantIntegrityEnabled(caseRecord.tenantId)) {
      throw new ForbiddenException('Gunakan closure V2 untuk tenant ini');
    }

    if (input.status && input.status !== caseRecord.status && !this.validTransition(caseRecord.status, input.status)) {
      throw new BadRequestException('Transisi status Case tidak valid');
    }

    if (input.assigneeId) {
      const assignee = await this.prisma.user.findUnique({ where: { id: input.assigneeId } });
      if (!assignee || assignee.tenantId !== caseRecord.tenantId || !assignee.isActive) {
        throw new NotFoundException('Assignee tidak ditemukan di tenant ini');
      }
    }

    const otherFieldsChanged = (input.title !== undefined && input.title !== caseRecord.title)
      || (input.description !== undefined && input.description !== caseRecord.description)
      || (input.priority !== undefined && input.priority !== caseRecord.priority)
      || (input.severity !== undefined && input.severity !== caseRecord.severity)
      || (input.assigneeId !== undefined && input.assigneeId !== caseRecord.assigneeId);
    const statusChanged = Boolean(input.status && input.status !== caseRecord.status);
    return this.prisma.$transaction(async tx => {
    const updated = await tx.case.update({
      where: { id: caseId, status: caseRecord.status, assigneeId: caseRecord.assigneeId },
      data: {
        revision: { increment: 1 },
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

    await tx.auditLog.create({ data: { userId: user.sub, tenantId: caseRecord.tenantId, action: 'CASE_UPDATED', metadata: {
      caseId, caseNumber: updated.caseNumber, title: updated.title,
    } } });
    if (otherFieldsChanged) {
      await tx.caseActivity.create({ data: { actorId: user.sub, tenantId: caseRecord.tenantId, caseId, action: 'CASE_UPDATED', metadata: { caseNumber: updated.caseNumber } } });
    }
    if (statusChanged) {
      await tx.caseActivity.create({ data: { actorId: user.sub, tenantId: caseRecord.tenantId, caseId, action: 'CASE_STATUS_CHANGED', metadata: {
        fromStatus: caseRecord.status,
        toStatus: updated.status,
      } } });
    }

    if (input.assigneeId && input.assigneeId !== caseRecord.assigneeId) {
      const action = caseRecord.assigneeId ? 'CASE_REASSIGNED' : 'CASE_ASSIGNED';
      await tx.auditLog.create({ data: { userId: user.sub, tenantId: caseRecord.tenantId, action,
        metadata: { caseId, previousAssigneeId: caseRecord.assigneeId, newAssigneeId: input.assigneeId } } });
      await tx.caseActivity.create({ data: { actorId: user.sub, tenantId: caseRecord.tenantId, caseId, action,
        metadata: { previousAssigneeId: caseRecord.assigneeId, newAssigneeId: input.assigneeId } } });
      await enqueueCaseAssignment(tx, { tenantId: caseRecord.tenantId, caseId, recipientId: input.assigneeId, actorId: user.sub, type: action });
    }
    return updated;
    }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('Status Case berubah; muat ulang sebelum mengubahnya');
      }
      throw error;
    });
  }

  async delete(user: AuthUser, caseId: string) {
    const caseRecord = await this.scopedCase(user, caseId);

    const origin = await this.prisma.caseOrigin.findUnique({ where: { caseId } });
    if (origin) throw new ConflictException('Case dengan provenance V2 tidak dapat dihapus');
    if (await this.prisma.caseEvidenceRevision.count({ where: { caseId, tenantId: caseRecord.tenantId } })
      || await this.prisma.caseReviewRequest.count({ where: { caseId, tenantId: caseRecord.tenantId } })) {
      throw new ConflictException('Case dengan riwayat V2 tidak dapat dihapus');
    }

    await this.prisma.case.delete({ where: { id: caseId } }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('Case dengan riwayat V2 tidak dapat dihapus');
      }
      throw error;
    });

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
    if (!assignee.isActive) {
      throw new ForbiddenException('Assignee harus aktif');
    }

    if (caseRecord.assigneeId === assigneeId) return this.prisma.case.findUniqueOrThrow({ where: { id: caseId }, include: {
      tenant: { select: { id: true, name: true, slug: true } }, creator: { select: { id: true, name: true, email: true } }, assignee: { select: { id: true, name: true, email: true } },
    } });
    const action = caseRecord.assigneeId ? 'CASE_REASSIGNED' : 'CASE_ASSIGNED';
    return this.prisma.$transaction(async tx => {
      const updated = await tx.case.update({
        where: { id: caseId, tenantId: caseRecord.tenantId, assigneeId: caseRecord.assigneeId }, data: { assigneeId, revision: { increment: 1 } },
        include: { tenant: { select: { id: true, name: true, slug: true } }, creator: { select: { id: true, name: true, email: true } }, assignee: { select: { id: true, name: true, email: true } } },
      });
      await tx.auditLog.create({ data: { userId: user.sub, tenantId: caseRecord.tenantId, action, metadata: {
        caseId, caseNumber: updated.caseNumber, title: updated.title, previousAssigneeId: caseRecord.assigneeId,
        newAssigneeId: assigneeId, assigneeName: assignee.name, assigneeEmail: assignee.email,
      } } });
      await tx.caseActivity.create({ data: { actorId: user.sub, tenantId: caseRecord.tenantId, caseId, action,
        metadata: { previousAssigneeId: caseRecord.assigneeId, newAssigneeId: assigneeId, assigneeName: assignee.name } } });
      await enqueueCaseAssignment(tx, { tenantId: caseRecord.tenantId, caseId, recipientId: assigneeId, actorId: user.sub, type: action });
      return updated;
    }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new ConflictException('Assignee Case berubah; muat ulang');
      throw error;
    });
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

  async createFromIndicator(user: AuthUser, indicatorId: string, input: CreateCaseInput) {
    const tenantId = user.role === 'SUPER_ADMIN' ? input.tenantId : this.tenantId(user);
    if (!tenantId) throw new BadRequestException('Tenant wajib dipilih');
    const indicator = await this.prisma.indicator.findFirst({
      where: { id: indicatorId, ...operationalIndicatorWhere(tenantId, new Date()) },
    });
    if (!indicator) throw new NotFoundException('Indicator tidak ditemukan');

    const title = input.title.trim();
    if (!title) throw new BadRequestException('Judul Case wajib diisi');

    if (input.assigneeId) {
      const assignee = await this.prisma.user.findUnique({ where: { id: input.assigneeId } });
      if (!assignee || assignee.tenantId !== indicator.tenantId || !assignee.isActive) {
        throw new NotFoundException('Assignee tidak ditemukan di tenant ini');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const caseNumber = await this.generateCaseNumber(indicator.tenantId, tx);
      const newCase = await tx.case.create({
        data: {
          tenantId: indicator.tenantId,
          caseNumber,
          title,
          description: input.description?.trim() || null,
          status: CaseStatus.OPEN,
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

      const existingLink = await tx.caseIndicator.findUnique({
        where: { caseId_indicatorId: { caseId: newCase.id, indicatorId } },
      });
      if (existingLink) throw new ConflictException('Case sudah terhubung ke Indicator');

      await tx.caseIndicator.create({
        data: { tenantId: indicator.tenantId, caseId: newCase.id, indicatorId, createdBy: user.sub },
      });
      await tx.caseActivity.create({
        data: { caseId: newCase.id, tenantId: indicator.tenantId, actorId: user.sub, action: 'CASE_CREATED', metadata: { caseNumber } },
      });
      await tx.caseActivity.create({
        data: {
          caseId: newCase.id,
          tenantId: indicator.tenantId,
          actorId: user.sub,
          action: 'INDICATOR_LINKED',
          metadata: { indicatorId, value: indicator.value, type: indicator.type },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.sub,
          tenantId: indicator.tenantId,
          action: 'CASE_CREATED',
          metadata: { caseId: newCase.id, caseNumber, title, sourceIndicatorId: indicatorId },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.sub,
          tenantId: indicator.tenantId,
          action: 'INDICATOR_CASE_LINKED',
          metadata: { caseId: newCase.id, caseNumber, indicatorId, value: indicator.value, type: indicator.type },
        },
      });

      if (input.assigneeId) await enqueueCaseAssignment(tx, { tenantId: indicator.tenantId, caseId: newCase.id, recipientId: input.assigneeId, actorId: user.sub, type: 'CASE_ASSIGNED' });
      return newCase;
    });
  }

  async createFromAsmAlert(user: AuthUser, alertId: string, input: CreateCaseInput) {
    const tenantId = user.role === 'SUPER_ADMIN' ? input.tenantId : this.tenantId(user);
    if (!tenantId) throw new BadRequestException('Tenant wajib');
    const alert = await this.prisma.alert.findFirst({ where: { id: alertId, tenantId, source: 'ASM' } });
    if (!alert) throw new NotFoundException('Alert tidak ditemukan');
    if (alert.caseId) return this.prisma.case.findFirst({ where: { id: alert.caseId, tenantId } });
    return this.prisma.$transaction(async tx => {
      const caseNumber = await this.generateCaseNumber(tenantId, tx);
      const created = await tx.case.create({ data: { tenantId, caseNumber, title: input.title?.trim() || alert.title, description: input.description?.trim() || alert.description, severity: alert.severity, priority: alert.severity === 'CRITICAL' || alert.severity === 'HIGH' ? CasePriority.HIGH : CasePriority.MEDIUM, createdBy: user.sub } });
      const linked = await tx.alert.updateMany({ where: { id: alertId, tenantId, caseId: null }, data: { caseId: created.id } });
      if (linked.count !== 1) throw new ConflictException('Alert sudah terhubung ke Case');
      const metadata = { alertId, assetId: alert.assetId, findingId: alert.findingId, changeEventId: alert.changeEventId, vulnerabilityCorrelationId: alert.vulnerabilityCorrelationId, detectedAt: alert.firstSeenAt.toISOString() };
      await tx.caseActivity.create({ data: { tenantId, caseId: created.id, actorId: user.sub, action: 'ASM_ALERT_LINKED', metadata } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'ASM_CASE_CREATED', metadata: { caseId: created.id, ...metadata } } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'ASM_ALERT_CASE_LINKED', metadata: { caseId: created.id, alertId } } });
      return created;
    });
  }

  async createFromAsmFinding(user: AuthUser, findingId: string, input: CreateCaseInput) {
    const tenantId = user.role === 'SUPER_ADMIN' ? input.tenantId : this.tenantId(user);
    if (!tenantId) throw new BadRequestException('Tenant wajib');
    const finding = await this.prisma.assetFinding.findFirst({ where: { id: findingId, tenantId } });
    if (!finding) throw new NotFoundException('Finding tidak ditemukan');
    const sourceKey = `finding:${finding.id}`;
    const existing = await this.prisma.alert.findUnique({ where: { tenantId_source_sourceKey: { tenantId, source: 'ASM', sourceKey } } });
    const alert = await this.prisma.alert.upsert({ where: { tenantId_source_sourceKey: { tenantId, source: 'ASM', sourceKey } }, create: { tenantId, assetId: finding.assetId, findingId, source: 'ASM', sourceKey, title: finding.title, description: finding.description, severity: finding.severity, firstSeenAt: finding.firstSeenAt, lastSeenAt: finding.lastSeenAt }, update: { lastSeenAt: new Date() } });
    if (!existing) await this.prisma.auditLog.create({ data: { tenantId, userId: user.sub, action: 'ASM_ALERT_CREATED', metadata: { alertId: alert.id, assetId: finding.assetId, findingId } } });
    return this.createFromAsmAlert(user, alert.id, input);
  }

  async linkAsmAlert(user: AuthUser, caseId: string, alertId: string, requestedTenantId?: string) {
    if (user.role === 'SUPER_ADMIN' && !requestedTenantId) throw new BadRequestException('Tenant wajib');
    const caseRecord = await this.scopedCase(user, caseId);
    if (user.role === 'SUPER_ADMIN' && caseRecord.tenantId !== requestedTenantId) throw new NotFoundException('Case tidak ditemukan');
    const alert = await this.prisma.alert.findFirst({ where: { id: alertId, tenantId: caseRecord.tenantId, source: 'ASM' } });
    if (!alert) throw new NotFoundException('Alert tidak ditemukan');
    if (alert.caseId === caseId) return caseRecord;
    if (alert.caseId) throw new ConflictException('Alert sudah terhubung ke Case');
    return this.prisma.$transaction(async tx => {
      const linked = await tx.alert.updateMany({ where: { id: alertId, tenantId: caseRecord.tenantId, caseId: null }, data: { caseId } });
      if (linked.count !== 1) throw new ConflictException('Alert sudah terhubung ke Case');
      await tx.caseActivity.create({ data: { tenantId: caseRecord.tenantId, caseId, actorId: user.sub, action: 'ASM_ALERT_LINKED', metadata: { alertId, assetId: alert.assetId, findingId: alert.findingId } } });
      await tx.auditLog.create({ data: { tenantId: caseRecord.tenantId, userId: user.sub, action: 'ASM_ALERT_CASE_LINKED', metadata: { caseId, alertId } } });
      return caseRecord;
    });
  }

  private async activity(user: AuthUser, tenantId: string, caseId: string, action: string, metadata: Prisma.InputJsonObject) {
    await this.prisma.caseActivity.create({
      data: { actorId: user.sub, tenantId, caseId, action, metadata },
    });
  }
}
