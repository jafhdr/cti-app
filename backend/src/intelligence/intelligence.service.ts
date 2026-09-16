import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AlertStatus, CaseStatus, IndicatorSeverity, IntelligenceEntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { type AuthUser } from '../users/users.types';
import { type AlertInput, type AlertStatusInput, type CaseInput, type CaseStatusInput, type EntityInput, type RelationshipInput } from './intelligence.types';

const entityTypes = Object.values(IntelligenceEntityType);
const severities = Object.values(IndicatorSeverity);
const caseStatuses = Object.values(CaseStatus);
const alertStatuses = Object.values(AlertStatus);

@Injectable()
export class IntelligenceService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(user: AuthUser, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const [entities, relationships, cases, alerts] = await this.prisma.$transaction([
      this.prisma.intelligenceEntity.findMany({ where: { tenantId }, include: { indicators: { select: { id: true, value: true, type: true, severity: true, status: true }, orderBy: { createdAt: 'desc' }, take: 20 } }, orderBy: { updatedAt: 'desc' }, take: 100 }),
      this.prisma.intelligenceRelationship.findMany({ where: { tenantId }, include: { source: { select: { id: true, name: true, type: true } }, target: { select: { id: true, name: true, type: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.case.findMany({ where: { tenantId }, include: { entities: { include: { entity: { select: { id: true, name: true, type: true } } } }, _count: { select: { alerts: true } } }, orderBy: { updatedAt: 'desc' }, take: 100 }),
      this.prisma.alert.findMany({ where: { tenantId }, include: { case: { select: { id: true, title: true } }, entities: { include: { entity: { select: { id: true, name: true, type: true } } } } }, orderBy: { updatedAt: 'desc' }, take: 100 }),
    ]);
    return { entities, relationships, cases, alerts };
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

  async createCase(user: AuthUser, input: CaseInput) {
    const tenantId = this.resolveTenant(user, input.tenantId);
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('Judul case wajib diisi');
    const entityIds = this.uniqueIds(input.entityIds);
    await this.assertEntitiesInTenant(tenantId, entityIds);
    
    // Generate case number
    const count = await this.prisma.case.count({ where: { tenantId } });
    const year = new Date().getFullYear();
    const caseNumber = `CASE-${year}-${String(count + 1).padStart(5, '0')}`;
    
    const caseItem = await this.prisma.case.create({
      data: {
        tenantId,
        caseNumber,
        title,
        description: input.description?.trim() || null,
        severity: this.severity(input.severity),
        createdBy: user.sub,
      },
    });
    
    if (entityIds.length > 0) {
      await this.prisma.caseEntity.createMany({
        data: entityIds.map((entityId) => ({ caseId: caseItem.id, entityId })),
      });
    }
    
    const result = await this.prisma.case.findUnique({
      where: { id: caseItem.id },
      include: {
        entities: { include: { entity: { select: { id: true, name: true, type: true } } } },
        _count: { select: { alerts: true } },
      },
    });
    
    await this.audit(user, tenantId, 'CASE_CREATED', { caseId: caseItem.id, title });
    return result;
  }

  async updateCaseStatus(user: AuthUser, caseId: string, input: CaseStatusInput) {
    const tenantId = this.resolveTenant(user, input.tenantId);
    if (!input.status || !caseStatuses.includes(input.status)) throw new BadRequestException('Status case tidak valid');
    await this.scopedCase(tenantId, caseId);
    const caseItem = await this.prisma.case.update({ where: { id: caseId }, data: { status: input.status } });
    await this.audit(user, tenantId, 'CASE_STATUS_UPDATED', { caseId, status: input.status });
    return caseItem;
  }

  async createAlert(user: AuthUser, input: AlertInput) {
    const tenantId = this.resolveTenant(user, input.tenantId);
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('Judul alert wajib diisi');
    const entityIds = this.uniqueIds(input.entityIds);
    await this.assertEntitiesInTenant(tenantId, entityIds);
    if (input.caseId) await this.scopedCase(tenantId, input.caseId);
    const alert = await this.prisma.alert.create({ data: { tenantId, title, description: input.description?.trim() || null, severity: this.severity(input.severity), caseId: input.caseId || null, entities: { create: entityIds.map((entityId) => ({ entityId })) } }, include: { case: { select: { id: true, title: true } }, entities: { include: { entity: { select: { id: true, name: true, type: true } } } } } });
    await this.audit(user, tenantId, 'ALERT_CREATED', { alertId: alert.id, title });
    return alert;
  }

  async updateAlertStatus(user: AuthUser, alertId: string, input: AlertStatusInput) {
    const tenantId = this.resolveTenant(user, input.tenantId);
    if (!input.status || !alertStatuses.includes(input.status)) throw new BadRequestException('Status alert tidak valid');
    const alert = await this.prisma.alert.findFirst({ where: { id: alertId, tenantId } });
    if (!alert) throw new NotFoundException('Alert tidak ditemukan');
    const updated = await this.prisma.alert.update({ where: { id: alertId }, data: { status: input.status } });
    await this.audit(user, tenantId, 'ALERT_STATUS_UPDATED', { alertId, status: input.status });
    return updated;
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
  private uniqueIds(ids?: readonly string[]) { return [...new Set((ids ?? []).filter(Boolean))]; }
  private async assertEntitiesInTenant(tenantId: string, ids: readonly string[]) {
    if (ids.length === 0) return;
    const count = await this.prisma.intelligenceEntity.count({ where: { tenantId, id: { in: [...ids] } } });
    if (count !== ids.length) throw new BadRequestException('Satu atau lebih entitas tidak ditemukan pada tenant ini');
  }
  private async scopedCase(tenantId: string, caseId: string) {
    const caseItem = await this.prisma.case.findFirst({ where: { id: caseId, tenantId } });
    if (!caseItem) throw new NotFoundException('Case tidak ditemukan');
    return caseItem;
  }
  private audit(actor: AuthUser, tenantId: string, action: string, metadata: Record<string, string>) {
    return this.prisma.auditLog.create({ data: { userId: actor.sub, tenantId, action, metadata: metadata as Prisma.InputJsonValue } });
  }
}
