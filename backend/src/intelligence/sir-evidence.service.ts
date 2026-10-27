import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import { operationalIndicatorWhere } from '../indicators/indicator-eligibility';
import type { AuthUser } from '../users/users.types';
import type { AttachSirEvidenceDto, EvidenceType, SearchSirEvidenceDto, UpdateSirEvidenceDto } from './sir-evidence.dto';
import { SirsService } from './sirs.service';

const include = {
  indicator: { select: { id: true, value: true, type: true, severity: true, status: true, source: true } },
  threatActor: { select: { id: true, status: true, entity: { select: { name: true, description: true, severity: true } } } },
  campaign: { select: { id: true, name: true, status: true, severity: true, threatActor: { select: { entity: { select: { name: true } } } } } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.SirEvidenceInclude;

type EvidenceRow = Prisma.SirEvidenceGetPayload<{ include: typeof include }>;

@Injectable()
export class SirEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sirs: SirsService,
    private readonly moduleAccess: ModuleAccessService,
  ) {}

  private async sir(user: AuthUser, sirId: string, tenantId?: string) {
    return this.sirs.get(user, sirId, tenantId);
  }

  private async indicatorAccess(user: AuthUser, tenantId: string) {
    const decision = await this.moduleAccess.evaluateForTenant(user, tenantId, 'threat-intelligence', ['indicator-management']);
    return decision.accessible;
  }

  private source(row: EvidenceRow) {
    if (row.indicator) return { type: 'INDICATOR' as const, id: row.indicator.id, name: row.indicator.value, context: `${row.indicator.type} · ${row.indicator.severity} · ${row.indicator.status}`, href: `/indicators?indicatorId=${encodeURIComponent(row.indicator.id)}` };
    if (row.threatActor) return { type: 'THREAT_ACTOR' as const, id: row.threatActor.id, name: row.threatActor.entity.name, context: `${row.threatActor.status} · ${row.threatActor.entity.severity}`, href: `/intelligence/threat-actors?actorId=${encodeURIComponent(row.threatActor.id)}` };
    if (row.campaign) return { type: 'CAMPAIGN' as const, id: row.campaign.id, name: row.campaign.name, context: `${row.campaign.status} · ${row.campaign.severity} · ${row.campaign.threatActor.entity.name}`, href: `/threat-intelligence/campaigns?campaignId=${encodeURIComponent(row.campaign.id)}` };
    throw new Error('Evidence source is missing');
  }

  private present(row: EvidenceRow) {
    return { id: row.id, source: this.source(row), relevanceNote: row.relevanceNote, createdBy: row.createdBy, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  async list(user: AuthUser, sirId: string, requested?: string) {
    const sir = await this.sir(user, sirId, requested);
    const canReadIndicators = await this.indicatorAccess(user, sir.tenantId);
    const rows = await this.prisma.sirEvidence.findMany({ where: { sirId, tenantId: sir.tenantId, ...(!canReadIndicators ? { indicatorId: null } : {}) }, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return rows.map(row => this.present(row));
  }

  async search(user: AuthUser, sirId: string, query: SearchSirEvidenceDto) {
    const sir = await this.sir(user, sirId, query.tenantId);
    if (query.type === 'INDICATOR' && !(await this.indicatorAccess(user, sir.tenantId))) throw new ForbiddenException('Indicator Management access required');
    const search = query.search?.trim();
    if (query.type === 'INDICATOR') {
      const rows = await this.prisma.indicator.findMany({ where: { ...operationalIndicatorWhere(sir.tenantId, new Date()), ...(search ? { value: { contains: search, mode: 'insensitive' } } : {}) }, select: { id: true, value: true, type: true, severity: true, status: true }, orderBy: { updatedAt: 'desc' }, take: 30 });
      return rows.map(row => ({ id: row.id, type: query.type, name: row.value, context: `${row.type} · ${row.severity} · ${row.status}` }));
    }
    if (query.type === 'THREAT_ACTOR') {
      const rows = await this.prisma.threatActor.findMany({ where: { tenantId: sir.tenantId, ...(search ? { entity: { name: { contains: search, mode: 'insensitive' } } } : {}) }, select: { id: true, status: true, entity: { select: { name: true, severity: true } } }, orderBy: { updatedAt: 'desc' }, take: 30 });
      return rows.map(row => ({ id: row.id, type: query.type, name: row.entity.name, context: `${row.status} · ${row.entity.severity}` }));
    }
    const rows = await this.prisma.campaign.findMany({ where: { tenantId: sir.tenantId, ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}) }, select: { id: true, name: true, status: true, severity: true }, orderBy: { updatedAt: 'desc' }, take: 30 });
    return rows.map(row => ({ id: row.id, type: query.type, name: row.name, context: `${row.status} · ${row.severity}` }));
  }

  async attach(user: AuthUser, sirId: string, body: AttachSirEvidenceDto, requested?: string) {
    const sir = await this.sir(user, sirId, requested);
    if (body.type === 'INDICATOR' && !(await this.indicatorAccess(user, sir.tenantId))) throw new ForbiddenException('Indicator Management access required');
    const sourceId = body.sourceId.trim();
    const source = body.type === 'INDICATOR' ? await this.prisma.indicator.findFirst({ where: { id: sourceId, ...operationalIndicatorWhere(sir.tenantId, new Date()) }, select: { id: true } })
      : body.type === 'THREAT_ACTOR' ? await this.prisma.threatActor.findFirst({ where: { id: sourceId, tenantId: sir.tenantId }, select: { id: true } })
      : await this.prisma.campaign.findFirst({ where: { id: sourceId, tenantId: sir.tenantId }, select: { id: true } });
    if (!source) throw new NotFoundException('Evidence source not found');
    const field = ({ INDICATOR: 'indicatorId', THREAT_ACTOR: 'threatActorId', CAMPAIGN: 'campaignId' } satisfies Record<EvidenceType, 'indicatorId' | 'threatActorId' | 'campaignId'>)[body.type];
    try {
      const row = await this.prisma.$transaction(async tx => {
        const created = await tx.sirEvidence.create({ data: { tenantId: sir.tenantId, sirId, [field]: sourceId, relevanceNote: body.relevanceNote?.trim() || null, createdById: user.sub }, include });
        await tx.auditLog.create({ data: { tenantId: sir.tenantId, userId: user.sub, action: 'SIR_EVIDENCE_ATTACHED', metadata: { sirId, evidenceId: created.id, type: body.type, sourceId } } });
        return created;
      });
      return this.present(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Evidence already linked to this SIR');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new NotFoundException('Evidence source not found');
      throw error;
    }
  }

  private async linked(user: AuthUser, sirId: string, evidenceId: string, requested?: string) {
    const sir = await this.sir(user, sirId, requested);
    const row = await this.prisma.sirEvidence.findFirst({ where: { id: evidenceId, sirId, tenantId: sir.tenantId }, include });
    if (!row) throw new NotFoundException('Evidence link not found');
    if (row.indicatorId && !(await this.indicatorAccess(user, sir.tenantId))) throw new ForbiddenException('Indicator Management access required');
    return row;
  }

  async update(user: AuthUser, sirId: string, evidenceId: string, body: UpdateSirEvidenceDto, requested?: string) {
    const existing = await this.linked(user, sirId, evidenceId, requested);
    return this.prisma.$transaction(async tx => {
      const row = await tx.sirEvidence.update({ where: { id: evidenceId, tenantId: existing.tenantId }, data: { relevanceNote: body.relevanceNote?.trim() || null }, include });
      await tx.auditLog.create({ data: { tenantId: existing.tenantId, userId: user.sub, action: 'SIR_EVIDENCE_NOTE_UPDATED', metadata: { sirId, evidenceId } } });
      return this.present(row);
    });
  }

  async detach(user: AuthUser, sirId: string, evidenceId: string, requested?: string) {
    const existing = await this.linked(user, sirId, evidenceId, requested);
    try {
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "SirEvidence" WHERE id = ${evidenceId} AND "tenantId" = ${existing.tenantId} FOR UPDATE`;
        if (await tx.intelligenceReportEvidence.count({ where: { evidenceId, tenantId: existing.tenantId } })) throw new ConflictException('Evidence is cited by an intelligence report and cannot be detached');
        if (await tx.collectionTaskEvidence.count({ where: { evidenceId, tenantId: existing.tenantId } })) throw new ConflictException('Evidence is linked to a collection task and cannot be detached');
        await tx.sirEvidence.delete({ where: { id: evidenceId, tenantId: existing.tenantId } });
        await tx.auditLog.create({ data: { tenantId: existing.tenantId, userId: user.sub, action: 'SIR_EVIDENCE_DETACHED', metadata: { sirId, evidenceId, source: this.source(existing) } } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2003' || error.code === 'P2014')) throw new ConflictException('Evidence is referenced by another intelligence record and cannot be detached');
      if (error instanceof Prisma.PrismaClientUnknownRequestError && /code: "23001"|foreign key constraint|violates RESTRICT setting/.test(error.message)) throw new ConflictException('Evidence is referenced by another intelligence record and cannot be detached');
      throw error;
    }
    const archived = await this.prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM "EvidenceCredibilityAssessment" WHERE "tenantId" = ${existing.tenantId} AND "originalEvidenceId" = ${evidenceId}`;
    return { detached: true, archivedAssessments: archived[0].total > 0 };
  }
}
