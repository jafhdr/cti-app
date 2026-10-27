import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { AssessmentHistoryQueryDto, EvidenceAssessmentDto, SourceAssessmentDto } from './assessments.dto';

type Assessor = { readonly id: string; readonly name: string };
type SourceAssessment = { readonly id: string; readonly sourceId: string | null; readonly originalSourceId: string; readonly sourceName: string; readonly sourceType: string; readonly grade: string; readonly rationale: string; readonly consistency: string | null; readonly accuracy: string | null; readonly timeliness: string | null; readonly trackRecord: string | null; readonly assessedAt: Date; readonly reviewAt: Date | null; readonly assessedBy: Assessor };
type EvidenceAssessment = { readonly id: string; readonly evidenceId: string | null; readonly originalEvidenceId: string; readonly originalSirId: string; readonly evidenceType: string; readonly originalRecordId: string; readonly grade: string; readonly rationale: string; readonly supportingInformation: string | null; readonly conflictingInformation: string | null; readonly assessedAt: Date; readonly assessedBy: Assessor };

@Injectable()
export class AssessmentsService {
  constructor(private readonly prisma: PrismaService, private readonly access: ModuleAccessService) {}

  private tenant(user: AuthUser, requested?: string): string {
    if (user.role === 'SUPER_ADMIN') { if (!requested) throw new BadRequestException('Tenant wajib dipilih'); return requested; }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }

  private async source(user: AuthUser, id: string, tenantId: string) {
    const row = await this.prisma.intelligenceSource.findFirst({ where: { id, tenantId }, select: { id: true, tenantId: true, name: true, sourceType: true, reliability: true } });
    if (!row) throw new NotFoundException('Intelligence source not found');
    return row;
  }

  private async evidence(user: AuthUser, sirId: string, id: string, tenantId: string) {
    const row = await this.prisma.sirEvidence.findFirst({ where: { id, sirId, tenantId }, select: { id: true, tenantId: true, sirId: true, indicatorId: true, threatActorId: true, campaignId: true } });
    if (!row) throw new NotFoundException('SIR evidence not found');
    if (row.indicatorId && !(await this.indicators(user, tenantId))) throw new NotFoundException('SIR evidence not found');
    if (!row.indicatorId && !row.threatActorId && !row.campaignId) throw new BadRequestException('Evidence has no eligible linked record');
    return row;
  }

  private async indicators(user: AuthUser, tenantId: string) {
    return (await this.access.evaluateForTenant(user, tenantId, 'threat-intelligence', ['indicator-management'])).accessible;
  }

  async sourceHistory(user: AuthUser, id: string, query: AssessmentHistoryQueryDto) {
    const tenantId = this.tenant(user, query.tenantId);
    const source = await this.prisma.intelligenceSource.findFirst({ where: { id, tenantId }, select: { id: true, name: true, sourceType: true, reliability: true } });
    const [history, latest, totals] = await Promise.all([
      this.sourceRows(tenantId, id, query.limit, (query.page - 1) * query.limit),
      this.sourceRows(tenantId, id, 1, 0),
      this.prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM "SourceReliabilityAssessment" WHERE "tenantId" = ${tenantId} AND "originalSourceId" = ${id}`,
    ]);
    if (!source && !latest.length) throw new NotFoundException('Source assessment history not found');
    return { subject: { id, name: source?.name ?? latest[0].sourceName, type: source?.sourceType ?? latest[0].sourceType, archived: !source }, current: latest[0] ?? null, history, state: latest.length ? 'ASSESSED' : 'UNASSESSED', legacyRegistryGrade: source?.reliability ?? null, page: query.page, limit: query.limit, total: totals[0].total, totalPages: Math.ceil(totals[0].total / query.limit), note: 'The legacy registry grade is separate from an analyst assessment. Feed sync and outages do not change this assessment.' };
  }

  private sourceRows(tenantId: string, id: string, limit: number, offset: number) {
    return this.prisma.$queryRaw<SourceAssessment[]>`
      SELECT a.id, a."sourceId", a."originalSourceId", a."sourceName", a."sourceType", a.grade, a.rationale, a.consistency, a.accuracy, a.timeliness, a."trackRecord", a."assessedAt", a."reviewAt",
        json_build_object('id', u.id, 'name', u.name) AS "assessedBy"
      FROM "SourceReliabilityAssessment" a JOIN "User" u ON u.id = a."assessedById"
      WHERE a."tenantId" = ${tenantId} AND a."originalSourceId" = ${id}
      ORDER BY a."assessedAt" DESC, a.id DESC LIMIT ${limit} OFFSET ${offset}`;
  }

  async assessSource(user: AuthUser, id: string, body: SourceAssessmentDto, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const row = await this.source(user, id, tenantId);
    const rationale = body.rationale.trim();
    if (!rationale) throw new BadRequestException('Assessment rationale is required');
    const reviewAt = body.reviewAt ? new Date(body.reviewAt) : null;
    if (reviewAt && reviewAt <= new Date()) throw new BadRequestException('Review time must be in the future');
    const assessmentId = randomUUID();
    try {
      await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`INSERT INTO "SourceReliabilityAssessment" (id, "tenantId", "sourceId", "liveSourceTenantId", "originalSourceId", "sourceName", "sourceType", grade, rationale, consistency, accuracy, timeliness, "trackRecord", "assessedById", "reviewAt")
          VALUES (${assessmentId}, ${tenantId}, ${id}, ${tenantId}, ${id}, ${row.name}, ${row.sourceType}::"IntelligenceSourceType", ${body.grade}::"IntelligenceSourceReliability", ${rationale}, ${body.consistency?.trim() || null}, ${body.accuracy?.trim() || null}, ${body.timeliness?.trim() || null}, ${body.trackRecord?.trim() || null}, ${user.sub}, ${reviewAt})`;
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'SOURCE_RELIABILITY_ASSESSED', metadata: { sourceId: id, assessmentId, grade: body.grade } } });
      });
    } catch (error) { this.rethrowTargetConflict(error); }
    return this.sourceHistory(user, id, { page: 1, limit: 10, tenantId });
  }

  async evidenceHistory(user: AuthUser, sirId: string, id: string, query: AssessmentHistoryQueryDto) {
    const tenantId = this.tenant(user, query.tenantId);
    const [live, history, latest, totals] = await Promise.all([
      this.prisma.sirEvidence.findFirst({ where: { id, sirId, tenantId }, select: { id: true, sirId: true, indicatorId: true, threatActorId: true, campaignId: true } }),
      this.evidenceRows(tenantId, sirId, id, query.limit, (query.page - 1) * query.limit),
      this.evidenceRows(tenantId, sirId, id, 1, 0),
      this.prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM "EvidenceCredibilityAssessment" WHERE "tenantId" = ${tenantId} AND "originalSirId" = ${sirId} AND "originalEvidenceId" = ${id}`,
    ]);
    if (!live && !latest.length) throw new NotFoundException('SIR evidence assessment history not found');
    const type = live?.indicatorId ? 'INDICATOR' : live?.threatActorId ? 'THREAT_ACTOR' : live?.campaignId ? 'CAMPAIGN' : latest[0]?.evidenceType;
    if (type === 'INDICATOR' && !(await this.indicators(user, tenantId))) throw new NotFoundException('SIR evidence assessment history not found');
    return { subject: { id, sirId, type, recordId: live?.indicatorId ?? live?.threatActorId ?? live?.campaignId ?? latest[0]?.originalRecordId, archived: !live }, current: latest[0] ?? null, history, state: latest.length ? 'ASSESSED' : 'UNASSESSED', page: query.page, limit: query.limit, total: totals[0].total, totalPages: Math.ceil(totals[0].total / query.limit), note: 'Credibility applies only to this evidence. It does not inherit source reliability or change report confidence.' };
  }

  private evidenceRows(tenantId: string, sirId: string, id: string, limit: number, offset: number) {
    return this.prisma.$queryRaw<EvidenceAssessment[]>`
      SELECT a.id, a."evidenceId", a."originalEvidenceId", a."originalSirId", a."evidenceType", a."originalRecordId", a.grade, a.rationale, a."supportingInformation", a."conflictingInformation", a."assessedAt",
        json_build_object('id', u.id, 'name', u.name) AS "assessedBy"
      FROM "EvidenceCredibilityAssessment" a JOIN "User" u ON u.id = a."assessedById"
      WHERE a."tenantId" = ${tenantId} AND a."originalSirId" = ${sirId} AND a."originalEvidenceId" = ${id}
      ORDER BY a."assessedAt" DESC, a.id DESC LIMIT ${limit} OFFSET ${offset}`;
  }

  async assessEvidence(user: AuthUser, sirId: string, id: string, body: EvidenceAssessmentDto, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const row = await this.evidence(user, sirId, id, tenantId);
    const rationale = body.rationale.trim();
    if (!rationale) throw new BadRequestException('Assessment rationale is required');
    const type = row.indicatorId ? 'INDICATOR' : row.threatActorId ? 'THREAT_ACTOR' : 'CAMPAIGN';
    const recordId = row.indicatorId ?? row.threatActorId ?? row.campaignId;
    if (!recordId) throw new BadRequestException('Evidence has no eligible linked record');
    const assessmentId = randomUUID();
    try {
      await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`INSERT INTO "EvidenceCredibilityAssessment" (id, "tenantId", "evidenceId", "liveEvidenceTenantId", "originalEvidenceId", "originalSirId", "evidenceType", "originalRecordId", grade, rationale, "supportingInformation", "conflictingInformation", "assessedById")
          VALUES (${assessmentId}, ${tenantId}, ${id}, ${tenantId}, ${id}, ${sirId}, ${type}, ${recordId}, ${body.grade}, ${rationale}, ${body.supportingInformation?.trim() || null}, ${body.conflictingInformation?.trim() || null}, ${user.sub})`;
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'EVIDENCE_CREDIBILITY_ASSESSED', metadata: { sirId, evidenceId: id, assessmentId, grade: body.grade } } });
      });
    } catch (error) { this.rethrowTargetConflict(error); }
    return this.evidenceHistory(user, sirId, id, { page: 1, limit: 10, tenantId });
  }

  private rethrowTargetConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new ConflictException('Assessment target changed; reload and try again');
    throw error;
  }
}
