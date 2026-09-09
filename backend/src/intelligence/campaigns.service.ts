import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CampaignStatus, IndicatorSeverity, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { CreateCampaignDto, ListCampaignsQueryDto, UpdateCampaignDto } from './campaigns.dto';

const detailInclude = {
  threatActor: { select: { id: true, entity: { select: { id: true, name: true, externalId: true } } } },
  indicators: { include: { indicator: { select: { id: true, value: true, type: true, severity: true, status: true } } }, orderBy: { createdAt: 'asc' as const } },
  mitreTechniques: { include: { mitreTechnique: true }, orderBy: { createdAt: 'asc' as const } },
  malwareTools: { include: { malwareTool: true }, orderBy: { createdAt: 'asc' as const } },
  _count: { select: { indicators: true, mitreTechniques: true, malwareTools: true } },
} satisfies Prisma.CampaignInclude;

@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, query: ListCampaignsQueryDto) {
    const tenantId = this.resolveTenant(user, query.tenantId);
    const search = query.search?.trim();
    const where: Prisma.CampaignWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.threatActorId ? { threatActorId: query.threatActorId } : {}),
      ...(search ? { OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { objective: { contains: search, mode: 'insensitive' } },
        { externalId: { contains: search, mode: 'insensitive' } },
      ] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({ where, include: detailInclude, orderBy: this.orderBy(query.sortBy, query.sortOrder), skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.campaign.count({ where }),
    ]);
    return { items, page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  }

  async relations(user: AuthUser, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const [threatActors, indicators, mitreTechniques] = await this.prisma.$transaction([
      this.prisma.threatActor.findMany({ where: { tenantId }, select: { id: true, entity: { select: { name: true } } }, orderBy: { entity: { name: 'asc' } } }),
      this.prisma.indicator.findMany({ where: { tenantId }, select: { id: true, value: true, type: true, severity: true, status: true }, orderBy: { value: 'asc' } }),
      this.prisma.mitreTechnique.findMany({ where: { tenantId }, orderBy: { externalId: 'asc' } }),
    ]);
    return { threatActors, indicators, mitreTechniques };
  }

  async get(user: AuthUser, id: string, requestedTenantId?: string) { return this.scopedCampaign(user, id, requestedTenantId); }

  async create(user: AuthUser, input: CreateCampaignDto, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Nama campaign wajib diisi');
    const indicatorIds = this.ids(input.indicatorIds);
    const mitreTechniqueIds = this.ids(input.mitreTechniqueIds);
    await this.assertRelations(tenantId, input.threatActorId, indicatorIds, mitreTechniqueIds);
    const dates = this.dates(input.startDate, input.endDate);
    try {
      const campaign = await this.prisma.campaign.create({
        data: {
          tenantId, name, description: input.description?.trim() || null, objective: input.objective?.trim() || null,
          status: input.status ?? CampaignStatus.PLANNED, severity: input.severity ?? IndicatorSeverity.MEDIUM,
          confidence: input.confidence ?? 50, ...dates, externalId: input.externalId?.trim() || null,
          referenceUrl: input.referenceUrl?.trim() || null, threatActorId: input.threatActorId, createdBy: user.sub,
          indicators: { create: indicatorIds.map(indicatorId => ({ tenantId, indicatorId })) },
          mitreTechniques: { create: mitreTechniqueIds.map(mitreTechniqueId => ({ tenantId, mitreTechniqueId })) },
        },
        include: detailInclude,
      });
      await this.audit(user, tenantId, 'CAMPAIGN_CREATED', campaign.id, campaign.name);
      return campaign;
    } catch (error) { this.rethrowConflict(error); }
  }

  async update(user: AuthUser, id: string, input: UpdateCampaignDto, requestedTenantId?: string) {
    const existing = await this.scopedCampaign(user, id, requestedTenantId);
    const name = input.name?.trim();
    if (input.name !== undefined && !name) throw new BadRequestException('Nama campaign wajib diisi');
    const threatActorId = input.threatActorId ?? existing.threatActorId;
    const indicatorIds = input.indicatorIds === undefined ? undefined : this.ids(input.indicatorIds);
    const mitreTechniqueIds = input.mitreTechniqueIds === undefined ? undefined : this.ids(input.mitreTechniqueIds);
    await this.assertRelations(existing.tenantId, threatActorId, indicatorIds ?? existing.indicators.map(link => link.indicatorId), mitreTechniqueIds ?? existing.mitreTechniques.map(link => link.mitreTechniqueId));
    const dates = this.dates(input.startDate, input.endDate, existing.startDate, existing.endDate);
    try {
      const campaign = await this.prisma.$transaction(async transaction => {
        await transaction.campaign.update({ where: { id }, data: {
          ...(name ? { name } : {}),
          ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
          ...(input.objective !== undefined ? { objective: input.objective.trim() || null } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}), ...(input.severity !== undefined ? { severity: input.severity } : {}),
          ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
          ...(input.startDate !== undefined ? { startDate: dates.startDate } : {}), ...(input.endDate !== undefined ? { endDate: dates.endDate } : {}),
          ...(input.externalId !== undefined ? { externalId: input.externalId.trim() || null } : {}),
          ...(input.referenceUrl !== undefined ? { referenceUrl: input.referenceUrl.trim() || null } : {}),
          ...(input.threatActorId !== undefined ? { threatActorId } : {}),
        } });
        if (indicatorIds !== undefined) {
          await transaction.campaignIndicator.deleteMany({ where: { campaignId: id } });
          if (indicatorIds.length > 0) await transaction.campaignIndicator.createMany({ data: indicatorIds.map(indicatorId => ({ campaignId: id, indicatorId, tenantId: existing.tenantId })) });
        }
        if (mitreTechniqueIds !== undefined) {
          await transaction.campaignMitreTechnique.deleteMany({ where: { campaignId: id } });
          if (mitreTechniqueIds.length > 0) await transaction.campaignMitreTechnique.createMany({ data: mitreTechniqueIds.map(mitreTechniqueId => ({ campaignId: id, mitreTechniqueId, tenantId: existing.tenantId })) });
        }
        return transaction.campaign.findUniqueOrThrow({ where: { id }, include: detailInclude });
      });
      await this.audit(user, existing.tenantId, 'CAMPAIGN_UPDATED', id, campaign.name);
      return campaign;
    } catch (error) { this.rethrowConflict(error); }
  }

  async remove(user: AuthUser, id: string, requestedTenantId?: string) {
    const campaign = await this.scopedCampaign(user, id, requestedTenantId);
    await this.prisma.campaign.delete({ where: { id } });
    await this.audit(user, campaign.tenantId, 'CAMPAIGN_DELETED', id, campaign.name);
    return { deleted: true, id };
  }

  private resolveTenant(user: AuthUser, requestedTenantId?: string): string {
    if (user.role === 'SUPER_ADMIN') { if (!requestedTenantId) throw new BadRequestException('Tenant wajib dipilih'); return requestedTenantId; }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }
  private async scopedCampaign(user: AuthUser, id: string, requestedTenantId?: string) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, tenantId: this.resolveTenant(user, requestedTenantId) }, include: detailInclude });
    if (!campaign) throw new NotFoundException('Campaign tidak ditemukan');
    return campaign;
  }
  private ids(values?: readonly string[]): string[] { return [...new Set((values ?? []).map(value => value.trim()).filter(Boolean))]; }
  private dates(start?: string, end?: string, currentStart: Date | null = null, currentEnd: Date | null = null) {
    const startDate = start === undefined ? currentStart : start ? new Date(start) : null;
    const endDate = end === undefined ? currentEnd : end ? new Date(end) : null;
    if (startDate && endDate && endDate < startDate) throw new BadRequestException('Tanggal selesai tidak boleh sebelum tanggal mulai');
    return { startDate, endDate };
  }
  private async assertRelations(tenantId: string, threatActorId: string, indicatorIds: readonly string[], mitreTechniqueIds: readonly string[]) {
    const [actor, indicatorCount, mitreTechniqueCount] = await this.prisma.$transaction([
      this.prisma.threatActor.findFirst({ where: { id: threatActorId, tenantId }, select: { id: true } }),
      this.prisma.indicator.count({ where: { id: { in: [...indicatorIds] }, tenantId } }),
      this.prisma.mitreTechnique.count({ where: { id: { in: [...mitreTechniqueIds] }, tenantId } }),
    ]);
    if (!actor) throw new BadRequestException('Threat actor tidak ditemukan pada tenant ini');
    if (indicatorCount !== indicatorIds.length) throw new BadRequestException('Satu atau lebih indicator tidak ditemukan pada tenant ini');
    if (mitreTechniqueCount !== mitreTechniqueIds.length) throw new BadRequestException('Satu atau lebih MITRE technique tidak ditemukan pada tenant ini');
  }
  private orderBy(field?: string, direction?: string): Prisma.CampaignOrderByWithRelationInput {
    const order: Prisma.SortOrder = direction === 'asc' ? 'asc' : 'desc';
    if (field === 'name' || field === 'status' || field === 'severity' || field === 'confidence' || field === 'startDate' || field === 'updatedAt') return { [field]: order };
    return { updatedAt: 'desc' };
  }
  private rethrowConflict(error: unknown): never { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Campaign dengan nama tersebut sudah ada pada tenant ini'); throw error; }
  private audit(actor: AuthUser, tenantId: string, action: string, campaignId: string, name: string) { return this.prisma.auditLog.create({ data: { userId: actor.sub, tenantId, action, metadata: { campaignId, name } } }); }
}
