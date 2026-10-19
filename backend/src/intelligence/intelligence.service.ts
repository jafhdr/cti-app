import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { IndicatorSeverity, IntelligenceEntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { type AuthUser } from '../users/users.types';
import { type EntityInput, type RelationshipInput } from './intelligence.types';

const entityTypes = Object.values(IntelligenceEntityType);
const severities = Object.values(IndicatorSeverity);

@Injectable()
export class IntelligenceService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(user: AuthUser, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const [entities, relationships] = await this.prisma.$transaction([
      this.prisma.intelligenceEntity.findMany({ where: { tenantId }, include: { indicators: { select: { id: true, value: true, type: true, severity: true, status: true }, orderBy: { createdAt: 'desc' }, take: 20 } }, orderBy: { updatedAt: 'desc' }, take: 100 }),
      this.prisma.intelligenceRelationship.findMany({ where: { tenantId }, include: { source: { select: { id: true, name: true, type: true } }, target: { select: { id: true, name: true, type: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    return { entities, relationships, cases: [], alerts: [] };
  }

  async createEntity(user: AuthUser, input: EntityInput) {
    const tenantId = this.resolveTenant(user, input.tenantId);
    const type = input.type;
    const name = input.name?.trim();
    if (!type || !entityTypes.includes(type) || !name) throw new BadRequestException('Type dan nama entitas wajib valid');
    const confidence = this.confidence(input.confidence);
    const severity = this.severity(input.severity);
    try {
      const entity = await this.prisma.intelligenceEntity.create({ data: { tenantId, type, name, description: input.description?.trim() || null, externalId: input.externalId?.trim() || null, confidence, severity } });
      await this.audit(user, tenantId, 'INTELLIGENCE_ENTITY_CREATED', { entityId: entity.id, type, name });
      return entity;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Entitas dengan jenis dan nama tersebut sudah ada pada tenant ini');
      throw error;
    }
  }

  async createRelationship(user: AuthUser, input: RelationshipInput) {
    const tenantId = this.resolveTenant(user, input.tenantId);
    const relationshipType = input.relationshipType?.trim();
    if (!input.sourceId || !input.targetId || input.sourceId === input.targetId || !relationshipType) throw new BadRequestException('Sumber, target, dan tipe relasi wajib valid');
    await this.assertEntitiesInTenant(tenantId, [input.sourceId, input.targetId]);
    try {
      const relationship = await this.prisma.intelligenceRelationship.create({ data: { tenantId, sourceId: input.sourceId, targetId: input.targetId, relationshipType, description: input.description?.trim() || null }, include: { source: { select: { id: true, name: true, type: true } }, target: { select: { id: true, name: true, type: true } } } });
      await this.audit(user, tenantId, 'INTELLIGENCE_RELATIONSHIP_CREATED', { relationshipId: relationship.id, relationshipType });
      return relationship;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Relasi tersebut sudah ada');
      throw error;
    }
  }

  private resolveTenant(user: AuthUser, requestedTenantId?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!requestedTenantId) throw new BadRequestException('Tenant wajib dipilih');
      return requestedTenantId;
    }
    return this.tenantId(user);
  }
  private tenantId(user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }
  private confidence(value?: number) {
    const confidence = value ?? 50;
    if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) throw new BadRequestException('Confidence harus bernilai 0 sampai 100');
    return confidence;
  }
  private severity(value?: IndicatorSeverity) {
    const severity = value ?? IndicatorSeverity.MEDIUM;
    if (!severities.includes(severity)) throw new BadRequestException('Severity tidak valid');
    return severity;
  }
  private async assertEntitiesInTenant(tenantId: string, ids: readonly string[]) {
    const count = await this.prisma.intelligenceEntity.count({ where: { tenantId, id: { in: [...ids] } } });
    if (count !== ids.length) throw new BadRequestException('Satu atau lebih entitas tidak ditemukan pada tenant ini');
  }
  private audit(actor: AuthUser, tenantId: string, action: string, metadata: Record<string, string>) {
    return this.prisma.auditLog.create({ data: { userId: actor.sub, tenantId, action, metadata: metadata as Prisma.InputJsonValue } });
  }
}
