import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IndicatorStatus, IndicatorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthUser } from '../users/users.types';
import { IndicatorInput } from './indicators.types';

@Injectable()
export class IndicatorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(currentUser: AuthUser, query: Record<string, string | undefined>) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
    const where: Prisma.IndicatorWhereInput = {
      ...(currentUser.role === 'SUPER_ADMIN' ? {} : { tenantId: this.tenantId(currentUser) }),
      ...(this.isType(query.type) ? { type: query.type } : {}),
      ...(this.isSeverity(query.severity) ? { severity: query.severity } : {}),
      ...(this.isStatus(query.status) ? { status: query.status } : {}),
      ...(query.search?.trim() ? {
        OR: [
          { value: { contains: query.search.trim(), mode: 'insensitive' } },
          { source: { contains: query.search.trim(), mode: 'insensitive' } },
          { tags: { has: query.search.trim().toLowerCase() } },
        ],
      } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.indicator.findMany({ where, include: { tenant: { select: { id: true, name: true, slug: true } }, intelligenceEntity: { select: { id: true, name: true, type: true } }, intelligenceSource: { select: { id: true, name: true, provider: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.indicator.count({ where }),
    ]);
    return { items, page, limit, total };
  }

  async create(currentUser: AuthUser, input: IndicatorInput) {
    const tenantId = currentUser.role === 'SUPER_ADMIN' ? input.tenantId : this.tenantId(currentUser);
    if (!tenantId) throw new BadRequestException('Tenant wajib dipilih');
    await this.assertTenant(tenantId);
    await this.assertIntelligenceEntity(tenantId, input.intelligenceEntityId);
    await this.assertIntelligenceSource(tenantId, input.intelligenceSourceId);
    const data = this.validateInput(input);
    try {
      const indicator = await this.prisma.indicator.create({
        data: { ...data, tenantId, createdById: currentUser.sub },
        include: { tenant: { select: { id: true, name: true, slug: true } }, intelligenceEntity: { select: { id: true, name: true, type: true } }, intelligenceSource: { select: { id: true, name: true, provider: true } } },
      });
      await this.audit(currentUser, tenantId, 'INDICATOR_CREATED', { indicatorId: indicator.id, type: indicator.type, value: indicator.value });
      return indicator;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Indicator dengan type dan value tersebut sudah ada pada tenant ini');
      throw error;
    }
  }

  async update(currentUser: AuthUser, id: string, input: IndicatorInput) {
    const indicator = await this.scopedIndicator(currentUser, id);
    await this.assertIntelligenceEntity(indicator.tenantId, input.intelligenceEntityId);
    await this.assertIntelligenceSource(indicator.tenantId, input.intelligenceSourceId);
    const data = this.validateInput(input);
    try {
      const updated = await this.prisma.indicator.update({ where: { id }, data, include: { tenant: { select: { id: true, name: true, slug: true } }, intelligenceEntity: { select: { id: true, name: true, type: true } }, intelligenceSource: { select: { id: true, name: true, provider: true } } } });
      await this.audit(currentUser, indicator.tenantId, 'INDICATOR_UPDATED', { indicatorId: id, type: updated.type, value: updated.value });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Indicator dengan type dan value tersebut sudah ada pada tenant ini');
      throw error;
    }
  }

  async deactivate(currentUser: AuthUser, id: string) {
    const indicator = await this.scopedIndicator(currentUser, id);
    const updated = await this.prisma.indicator.update({ where: { id }, data: { status: IndicatorStatus.INACTIVE } });
    await this.audit(currentUser, indicator.tenantId, 'INDICATOR_DEACTIVATED', { indicatorId: id, value: indicator.value });
    return updated;
  }

  async getCases(currentUser: AuthUser, indicatorId: string) {
    const indicator = await this.scopedIndicator(currentUser, indicatorId);
    const links = await this.prisma.caseIndicator.findMany({
      where: { indicatorId, tenantId: indicator.tenantId },
      include: { case: true },
      orderBy: { createdAt: 'desc' },
    });
    return links.map((link) => link.case);
  }

  async getAvailableCases(currentUser: AuthUser, indicatorId: string, search?: string) {
    const indicator = await this.scopedIndicator(currentUser, indicatorId);
    const value = search?.trim();
    return this.prisma.case.findMany({
      where: {
        tenantId: indicator.tenantId,
        indicators: { none: { indicatorId } },
        ...(value ? {
          OR: [
            { caseNumber: { contains: value, mode: 'insensitive' } },
            { title: { contains: value, mode: 'insensitive' } },
            { description: { contains: value, mode: 'insensitive' } },
          ],
        } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  async linkCase(currentUser: AuthUser, indicatorId: string, caseId: string) {
    const indicator = await this.scopedIndicator(currentUser, indicatorId);
    const caseRecord = await this.prisma.case.findFirst({
      where: { id: caseId, tenantId: indicator.tenantId },
    });
    if (!caseRecord) throw new NotFoundException('Case tidak ditemukan');
    const existing = await this.prisma.caseIndicator.findUnique({
      where: { caseId_indicatorId: { caseId, indicatorId } },
    });
    if (existing) throw new ConflictException('Case sudah terhubung ke Indicator');

    try {
      return await this.prisma.$transaction(async (tx) => {
      const link = await tx.caseIndicator.create({
        data: { tenantId: indicator.tenantId, caseId, indicatorId, createdBy: currentUser.sub },
        include: { case: true },
      });
      const metadata = { indicatorId, value: indicator.value, type: indicator.type };
      await tx.caseActivity.create({
        data: { caseId, tenantId: indicator.tenantId, actorId: currentUser.sub, action: 'INDICATOR_LINKED', metadata },
      });
      await tx.auditLog.create({
        data: {
          userId: currentUser.sub,
          tenantId: indicator.tenantId,
          action: 'INDICATOR_CASE_LINKED',
          metadata: { caseId, caseNumber: caseRecord.caseNumber, ...metadata },
        },
      });
        return link.case;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Case sudah terhubung ke Indicator');
      }
      throw error;
    }
  }

  async unlinkCase(currentUser: AuthUser, indicatorId: string, caseId: string) {
    const indicator = await this.scopedIndicator(currentUser, indicatorId);
    const link = await this.prisma.caseIndicator.findUnique({
      where: { caseId_indicatorId: { caseId, indicatorId } },
      include: { case: true },
    });
    if (!link || link.tenantId !== indicator.tenantId) throw new NotFoundException('Case tidak terhubung ke Indicator');

    return this.prisma.$transaction(async (tx) => {
      await tx.caseIndicator.delete({ where: { caseId_indicatorId: { caseId, indicatorId } } });
      const metadata = { indicatorId, value: indicator.value, type: indicator.type };
      await tx.caseActivity.create({
        data: { caseId, tenantId: indicator.tenantId, actorId: currentUser.sub, action: 'INDICATOR_UNLINKED', metadata },
      });
      await tx.auditLog.create({
        data: {
          userId: currentUser.sub,
          tenantId: indicator.tenantId,
          action: 'INDICATOR_CASE_UNLINKED',
          metadata: { caseId, caseNumber: link.case.caseNumber, ...metadata },
        },
      });
      return { success: true };
    });
  }

  async correlateThreatActor(currentUser: AuthUser, id: string) {
    const indicator = await this.scopedIndicator(currentUser, id);
    if (indicator.intelligenceEntityId) {
      const existingActor = await this.prisma.threatActor.findFirst({
        where: { tenantId: indicator.tenantId, entityId: indicator.intelligenceEntityId },
        select: { id: true, entity: { select: { name: true } } },
      });
      if (existingActor) return {
        status: 'matched' as const,
        indicatorId: id,
        threatActor: { id: existingActor.id, name: existingActor.entity.name },
        basis: ['existing_link'] as const,
        created: false,
      };
      return { status: 'no_match' as const, indicatorId: id, reason: 'INDICATOR_ALREADY_LINKED' as const };
    }

    const candidates = await this.prisma.threatActor.findMany({
      where: {
        tenantId: indicator.tenantId,
        status: 'ACTIVE',
        OR: [
          { campaigns: { some: { tenantId: indicator.tenantId, indicators: { some: { indicatorId: id } } } } },
          { intelligenceReports: { some: { tenantId: indicator.tenantId, report: { indicators: { some: { indicatorId: id } } } } } },
        ],
      },
      select: {
        id: true,
        entityId: true,
        entity: { select: { name: true } },
        campaigns: { where: { tenantId: indicator.tenantId, indicators: { some: { indicatorId: id } } }, select: { id: true }, take: 1 },
        intelligenceReports: { where: { tenantId: indicator.tenantId, report: { indicators: { some: { indicatorId: id } } } }, select: { reportId: true }, take: 1 },
      },
      take: 2,
    });
    if (candidates.length === 0) return { status: 'no_match' as const, indicatorId: id, reason: 'NO_VALID_CANDIDATE' as const };
    if (candidates.length > 1) return { status: 'no_match' as const, indicatorId: id, reason: 'AMBIGUOUS_CANDIDATES' as const };

    const actor = candidates[0];
    if (!actor) return { status: 'no_match' as const, indicatorId: id, reason: 'NO_VALID_CANDIDATE' as const };
    const basis = [
      ...(actor.campaigns.length > 0 ? ['campaign' as const] : []),
      ...(actor.intelligenceReports.length > 0 ? ['intelligence_report' as const] : []),
    ];
    await this.prisma.indicator.update({ where: { id }, data: { intelligenceEntityId: actor.entityId } });
    await this.audit(currentUser, indicator.tenantId, 'INDICATOR_THREAT_ACTOR_CORRELATED', {
      indicatorId: id,
      threatActorId: actor.id,
      basis: basis.join(','),
    });
    return {
      status: 'matched' as const,
      indicatorId: id,
      threatActor: { id: actor.id, name: actor.entity.name },
      basis,
      created: true,
    };
  }

  private validateInput(input: IndicatorInput) {
    const value = input.value?.trim();
    if (!value || !this.isType(input.type) || !this.isSeverity(input.severity)) throw new BadRequestException('Value, type, dan severity wajib valid');
    const confidence = Number(input.confidence);
    if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) throw new BadRequestException('Confidence harus berupa angka 0 sampai 100');
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new BadRequestException('Tanggal kadaluarsa tidak valid');
    return {
      value, type: input.type, severity: input.severity, confidence,
      status: this.isStatus(input.status) ? input.status : IndicatorStatus.ACTIVE,
      tags: [...new Set((input.tags || []).map(tag => tag.trim().toLowerCase()).filter(Boolean))],
      source: input.source?.trim() || null,
      description: input.description?.trim() || null,
      expiresAt,
      intelligenceEntityId: input.intelligenceEntityId || null,
      intelligenceSourceId: input.intelligenceSourceId || null,
    };
  }

  private async scopedIndicator(currentUser: AuthUser, id: string) {
    const indicator = await this.prisma.indicator.findUnique({ where: { id } });
    if (!indicator) throw new NotFoundException('Indicator tidak ditemukan');
    if (currentUser.role !== 'SUPER_ADMIN' && indicator.tenantId !== this.tenantId(currentUser)) throw new NotFoundException('Indicator tidak ditemukan');
    return indicator;
  }

  private async assertTenant(id: string) {
    if (!await this.prisma.tenant.findUnique({ where: { id } })) throw new NotFoundException('Tenant tidak ditemukan');
  }
  private async assertIntelligenceEntity(tenantId: string, entityId?: string | null) {
    if (!entityId) return;
    const entity = await this.prisma.intelligenceEntity.findFirst({ where: { id: entityId, tenantId }, select: { id: true } });
    if (!entity) throw new BadRequestException('Entitas CTI tidak ditemukan pada tenant ini');
  }
  private async assertIntelligenceSource(tenantId: string, sourceId?: string | null) {
    if (!sourceId) return;
    const source = await this.prisma.intelligenceSource.findFirst({ where: { id: sourceId, tenantId }, select: { id: true } });
    if (!source) throw new BadRequestException('Intelligence source tidak ditemukan pada tenant ini');
  }
  private tenantId(user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }
  private audit(actor: AuthUser, tenantId: string, action: string, metadata: Record<string, string>) {
    return this.prisma.auditLog.create({ data: { userId: actor.sub, tenantId, action, metadata: metadata as Prisma.InputJsonValue } });
  }
  private isType(value?: string): value is IndicatorType { return ['IP_ADDRESS', 'DOMAIN', 'URL', 'FILE_HASH', 'EMAIL'].includes(value || ''); }
  private isSeverity(value?: string): value is 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' { return ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(value || ''); }
  private isStatus(value?: string): value is 'ACTIVE' | 'INACTIVE' | 'EXPIRED' { return ['ACTIVE', 'INACTIVE', 'EXPIRED'].includes(value || ''); }
}
