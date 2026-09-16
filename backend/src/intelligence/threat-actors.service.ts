import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IndicatorSeverity, IntelligenceEntityType, Prisma, ThreatActorStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { BatchThreatActorsDto, CreateThreatActorDto, ListThreatActorsQueryDto, StixThreatActorDto, UpdateThreatActorDto } from './threat-actors.dto';
import { mapStixThreatActor } from './stix-threat-actor.mapper';

type UpsertContext = {
  readonly user: AuthUser;
  readonly tenantId: string;
  readonly input: StixThreatActorDto;
};

const detailInclude = {
  malwareTools: { include: { malwareTool: true }, orderBy: { createdAt: 'asc' as const } },
  entity: { include: {
    indicators: { select: { id: true, value: true, type: true, severity: true, status: true }, orderBy: { createdAt: 'desc' as const }, take: 25 },
    outgoingRelationships: { include: { target: { select: { id: true, name: true, type: true, severity: true } } }, orderBy: { createdAt: 'desc' as const } },
    incomingRelationships: { include: { source: { select: { id: true, name: true, type: true, severity: true } } }, orderBy: { createdAt: 'desc' as const } },
  } },
} satisfies Prisma.ThreatActorInclude;

@Injectable()
export class ThreatActorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, query: ListThreatActorsQueryDto) {
    const tenantId = this.resolveTenant(user, query.tenantId);
    const search = query.search?.trim();
    const where: Prisma.ThreatActorWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.country?.trim() ? { country: { contains: query.country.trim(), mode: 'insensitive' } } : {}),
      ...(query.sector?.trim() ? { targetSectors: { has: query.sector.trim() } } : {}),
      ...(query.severity ? { entity: { severity: query.severity } } : {}),
      ...(search ? { OR: [
        { entity: { name: { contains: search, mode: 'insensitive' } } },
        { aliases: { has: search } }, { country: { contains: search, mode: 'insensitive' } },
        { region: { contains: search, mode: 'insensitive' } }, { motivation: { contains: search, mode: 'insensitive' } },
      ] } : {}),
    };
    const orderBy = this.orderBy(query.sortBy, query.sortOrder);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.threatActor.findMany({ where, include: { entity: { select: { id: true, name: true, description: true, externalId: true, confidence: true, severity: true, metadata: true, updatedAt: true, _count: { select: { outgoingRelationships: true, incomingRelationships: true, indicators: true } } } } }, orderBy, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.threatActor.count({ where }),
    ]);
    return { items, page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  }

  async get(user: AuthUser, id: string, requestedTenantId?: string) { return this.scopedActor(user, id, requestedTenantId); }

  async create(user: AuthUser, input: CreateThreatActorDto, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Nama threat actor wajib diisi');
    try {
      const actor = await this.prisma.$transaction(async tx => {
        const entity = await tx.intelligenceEntity.create({ data: { tenantId, type: IntelligenceEntityType.THREAT_ACTOR, name, description: input.description?.trim() || null, externalId: input.externalId?.trim() || null, confidence: input.confidence ?? 50, severity: input.severity ?? IndicatorSeverity.MEDIUM, metadata: input.referenceUrl ? { referenceUrl: input.referenceUrl } : undefined } });
        return tx.threatActor.create({ data: { tenantId, entityId: entity.id, aliases: this.values(input.aliases), motivation: input.motivation?.trim() || null, targetSectors: this.values(input.targetSectors), country: input.country?.trim() || null, region: input.region?.trim() || null, status: input.status ?? ThreatActorStatus.ACTIVE, createdBy: user.sub }, include: detailInclude });
      });
      await this.audit(user, tenantId, 'THREAT_ACTOR_CREATED', actor.id, { entityId: actor.entityId, name });
      return actor;
    } catch (error) { this.rethrowConflict(error); }
  }

  async upsert(user: AuthUser, input: StixThreatActorDto, requestedTenantId?: string) {
    const result = await this.persistUpsert({ user, tenantId: this.resolveTenant(user, requestedTenantId), input });
    return result.actor;
  }

  async batch(user: AuthUser, input: BatchThreatActorsDto, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const items = [];
    let created = 0;
    for (const threatActor of input.threatActors) {
      const result = await this.persistUpsert({ user, tenantId, input: threatActor });
      items.push(result.actor);
      if (result.created) created += 1;
    }
    return { items, created, updated: items.length - created };
  }

  async update(user: AuthUser, id: string, input: UpdateThreatActorDto, requestedTenantId?: string) {
    const existing = await this.scopedActor(user, id, requestedTenantId);
    const name = input.name?.trim();
    if (input.name !== undefined && !name) throw new BadRequestException('Nama threat actor wajib diisi');
    try {
      const actor = await this.prisma.$transaction(async tx => {
        await tx.intelligenceEntity.update({ where: { id: existing.entityId }, data: { ...(name ? { name } : {}), ...(input.description !== undefined ? { description: input.description.trim() || null } : {}), ...(input.externalId !== undefined ? { externalId: input.externalId.trim() || null } : {}), ...(input.confidence !== undefined ? { confidence: input.confidence } : {}), ...(input.severity !== undefined ? { severity: input.severity } : {}), ...(input.referenceUrl !== undefined ? { metadata: { referenceUrl: input.referenceUrl } } : {}) } });
        await tx.threatActor.update({ where: { id }, data: { ...(input.aliases !== undefined ? { aliases: this.values(input.aliases) } : {}), ...(input.motivation !== undefined ? { motivation: input.motivation.trim() || null } : {}), ...(input.targetSectors !== undefined ? { targetSectors: this.values(input.targetSectors) } : {}), ...(input.country !== undefined ? { country: input.country.trim() || null } : {}), ...(input.region !== undefined ? { region: input.region.trim() || null } : {}), ...(input.status !== undefined ? { status: input.status } : {}) } });
        return tx.threatActor.findUniqueOrThrow({ where: { id }, include: detailInclude });
      });
      await this.audit(user, existing.tenantId, 'THREAT_ACTOR_UPDATED', id, { entityId: actor.entityId, name: actor.entity.name });
      if (input.status === ThreatActorStatus.INACTIVE && existing.status !== ThreatActorStatus.INACTIVE) await this.audit(user, existing.tenantId, 'THREAT_ACTOR_DEACTIVATED', id, { from: existing.status, to: input.status });
      return actor;
    } catch (error) { this.rethrowConflict(error); }
  }

  async remove(user: AuthUser, id: string, requestedTenantId?: string) {
    const actor = await this.scopedActor(user, id, requestedTenantId);
    await this.prisma.intelligenceEntity.delete({ where: { id: actor.entityId } });
    await this.audit(user, actor.tenantId, 'THREAT_ACTOR_DELETED', id, { entityId: actor.entityId, name: actor.entity.name });
    return { deleted: true, id };
  }

  private resolveTenant(user: AuthUser, requestedTenantId?: string): string { if (user.role === 'SUPER_ADMIN') { if (!requestedTenantId) throw new BadRequestException('Tenant wajib dipilih'); return requestedTenantId; } return this.tenantId(user); }
  private tenantId(user: AuthUser): string { if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia'); return user.tenantId; }
  private async scopedActor(user: AuthUser, id: string, requestedTenantId?: string) { const actor = await this.prisma.threatActor.findFirst({ where: { id, tenantId: this.resolveTenant(user, requestedTenantId) }, include: detailInclude }); if (!actor) throw new NotFoundException('Threat actor tidak ditemukan'); return actor; }
  private values(input?: readonly string[]): string[] { return [...new Set((input ?? []).map(value => value.trim()).filter(Boolean))]; }
  private async persistUpsert(context: UpsertContext) {
    const mapped = mapStixThreatActor(context.input);
    try {
      const result = await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${context.tenantId} FOR UPDATE`;
        const existing = await tx.threatActor.findFirst({
          where: { tenantId: context.tenantId, entity: { type: IntelligenceEntityType.THREAT_ACTOR, externalId: mapped.externalId } },
        });
        if (existing) {
          await tx.intelligenceEntity.update({ where: { id: existing.entityId }, data: { name: mapped.name, description: mapped.description?.trim() || null, metadata: mapped.metadata } });
          await tx.threatActor.update({ where: { id: existing.id }, data: { aliases: this.values(mapped.aliases), motivation: mapped.motivation?.trim() || null, targetSectors: this.values(mapped.targetSectors), country: mapped.country?.trim() || null, region: mapped.region?.trim() || null } });
          return { actor: await tx.threatActor.findUniqueOrThrow({ where: { id: existing.id }, include: detailInclude }), created: false };
        }
        const entity = await tx.intelligenceEntity.create({ data: { tenantId: context.tenantId, type: IntelligenceEntityType.THREAT_ACTOR, name: mapped.name, description: mapped.description?.trim() || null, externalId: mapped.externalId, metadata: mapped.metadata } });
        const actor = await tx.threatActor.create({ data: { tenantId: context.tenantId, entityId: entity.id, aliases: this.values(mapped.aliases), motivation: mapped.motivation?.trim() || null, targetSectors: this.values(mapped.targetSectors), country: mapped.country?.trim() || null, region: mapped.region?.trim() || null, createdBy: context.user.sub }, include: detailInclude });
        return { actor, created: true };
      });
      await this.audit(context.user, context.tenantId, result.created ? 'THREAT_ACTOR_INGESTED' : 'THREAT_ACTOR_INGESTION_UPDATED', result.actor.id, { entityId: result.actor.entityId, name: result.actor.entity.name, externalId: mapped.externalId });
      return result;
    } catch (error) { this.rethrowConflict(error); }
  }
  private orderBy(field?: string, direction?: string): Prisma.ThreatActorOrderByWithRelationInput { const sortOrder: Prisma.SortOrder = direction === 'asc' ? 'asc' : 'desc'; if (field === 'name' || field === 'confidence' || field === 'severity') return { entity: { [field]: sortOrder } }; if (field === 'country' || field === 'status' || field === 'createdAt') return { [field]: sortOrder }; return { updatedAt: sortOrder }; }
  private rethrowConflict(error: unknown): never { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Threat actor dengan nama tersebut sudah ada pada tenant ini'); throw error; }
  private audit(actor: AuthUser, tenantId: string, action: string, threatActorId: string, metadata: Record<string, string>) { return this.prisma.auditLog.create({ data: { userId: actor.sub, tenantId, action, metadata: { threatActorId, ...metadata } } }); }
}
