import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TlpLevel } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { CreateNextStepRun, ReviewNextStep } from './next-step.dto';
import { ENGINE_VERSION, RULE_VERSION, evaluateNextStep, type HypothesisInput } from './next-step.logic';

const tlpRank = { CLEAR: 0, GREEN: 1, AMBER: 2, AMBER_STRICT: 3, RED: 4 } as const;
const runDetail = { candidates: { include: { reviews: { include: { reviewer: { select: { name: true } } }, orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] } }, orderBy: { rank: 'asc' as const } } } satisfies Prisma.NextStepRunInclude;
const snapshotObservations = (value: Prisma.JsonValue): readonly Prisma.JsonValue[] => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('observations' in value) || !Array.isArray(value.observations)) return [];
  return value.observations;
};

@Injectable()
export class NextStepService {
  constructor(private readonly prisma: PrismaService) {}

  private tenant(user: AuthUser, requested?: string): string {
    if (user.role === 'SUPER_ADMIN') {
      if (!requested) throw new BadRequestException('Tenant required');
      return requested;
    }
    if (!user.tenantId) throw new ForbiddenException('Tenant context required');
    if (requested && requested !== user.tenantId) throw new ForbiddenException('Tenant mismatch');
    return user.tenantId;
  }

  private async visibleRuns(user: AuthUser, tenantId: string, rows: readonly Prisma.NextStepRunGetPayload<{ include: typeof runDetail }>[]) {
    if (user.role !== 'USER') return rows;
    const eligible = rows.filter(row => row.maxTlp !== 'RED');
    const ids = eligible.flatMap(row => [...snapshotObservations(row.inputSnapshot).filter((item): item is { id: string } => typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string').map(item => item.id), ...row.candidates.flatMap(candidate => candidate.reviews.map(review => review.outcomeObservationId).filter((id): id is string => Boolean(id)))]);
    const hidden = await this.prisma.ttpObservation.findMany({ where: { tenantId, id: { in: ids }, OR: [{ tlp: 'RED' }, { sirEvidence: { analysisReportEvidence: { some: { report: { tlp: 'RED' } } } } }] }, select: { id: true } });
    const hiddenIds = new Set(hidden.map(row => row.id));
    return eligible.filter(row => !snapshotObservations(row.inputSnapshot).some(item => typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string' && hiddenIds.has(item.id)) && !row.candidates.some(candidate => candidate.reviews.some(review => review.outcomeObservationId && hiddenIds.has(review.outcomeObservationId))));
  }

  async list(user: AuthUser, scope: { readonly actorId?: string; readonly campaignId?: string; readonly tenantId?: string }) {
    const tenantId = this.tenant(user, scope.tenantId);
    if (Boolean(scope.actorId) === Boolean(scope.campaignId)) throw new BadRequestException('Select exactly one scope');
    const target = scope.actorId ? await this.prisma.threatActor.findFirst({ where: { id: scope.actorId, tenantId }, select: { id: true } }) : await this.prisma.campaign.findFirst({ where: { id: scope.campaignId, tenantId }, select: { id: true } });
    if (!target) throw new NotFoundException('Scope unavailable');
    const rows = await this.prisma.nextStepRun.findMany({ where: { tenantId, ...(scope.actorId ? { threatActorId: scope.actorId } : { campaignId: scope.campaignId }) }, include: runDetail, orderBy: { createdAt: 'desc' }, take: 50 });
    return this.visibleRuns(user, tenantId, rows);
  }

  async create(user: AuthUser, input: CreateNextStepRun, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const asOf = new Date(input.asOf);
    if (asOf.getTime() > Date.now()) throw new BadRequestException('As-of cutoff cannot be in the future');
    const prior = await this.prisma.nextStepRun.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } }, include: runDetail });
    if (prior) {
      if (prior.threatActorId !== (input.threatActorId ?? null) || prior.campaignId !== (input.campaignId ?? null) || prior.asOf.getTime() !== asOf.getTime() || prior.horizonDays !== input.horizonDays) throw new ConflictException('Idempotency key belongs to another run');
      return prior;
    }
    const target = input.threatActorId ? await this.prisma.threatActor.findFirst({ where: { id: input.threatActorId, tenantId }, select: { id: true } }) : await this.prisma.campaign.findFirst({ where: { id: input.campaignId, tenantId }, select: { id: true } });
    if (!target) throw new NotFoundException('Scope unavailable');
    const rows = await this.prisma.ttpObservation.findMany({ where: { tenantId, createdAt: { lte: asOf }, ingestedAt: { lte: asOf }, observedEndAt: { lte: asOf }, ...(input.threatActorId ? { OR: [{ threatActorId: input.threatActorId }, { campaign: { threatActorId: input.threatActorId } }] } : { campaignId: input.campaignId }) }, include: { mitreTechnique: { select: { externalId: true, updatedAt: true } }, sirEvidence: { select: { sirId: true } }, reviews: { where: { createdAt: { lte: asOf } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }, orderBy: [{ observedStartAt: 'desc' }, { id: 'desc' }], take: 200 });
    const catalogDrift = rows.some(row => row.mitreTechnique.updatedAt > asOf);
    const snapshot: HypothesisInput[] = rows.filter(row => row.mitreTechnique.updatedAt <= asOf).map(row => ({ id: row.id, techniqueId: row.mitreTechniqueId, campaignId: row.campaignId, sourceLineageId: row.sirEvidence.sirId, externalId: row.mitreTechnique.externalId, attackVersion: row.attackVersion, observedStartAt: row.observedStartAt.toISOString(), observedEndAt: row.observedEndAt.toISOString(), actorConfidence: row.actorConfidence, techniqueConfidence: row.techniqueConfidence, status: row.reviews[row.reviews.length - 1]?.status ?? 'CANDIDATE', tlp: row.tlp })).sort((a, b) => a.observedStartAt.localeCompare(b.observedStartAt) || a.observedEndAt.localeCompare(b.observedEndAt) || a.id.localeCompare(b.id));
    const catalog = await this.prisma.mitreTechnique.findMany({ where: { tenantId, createdAt: { lte: asOf }, updatedAt: { lte: asOf } }, select: { id: true, externalId: true, name: true, tactic: true }, orderBy: { externalId: 'asc' } });
    const result = catalogDrift ? { status: 'ABSTAINED' as const, abstentionReason: 'ATT&CK catalog changed after cutoff; historical mapping is unavailable.', candidates: [] } : evaluateNextStep(snapshot, catalog);
    const inputSnapshot = { engineVersion: ENGINE_VERSION, ruleVersion: RULE_VERSION, asOf: asOf.toISOString(), horizonDays: input.horizonDays, scope: input.threatActorId ?? input.campaignId, observations: snapshot, catalog };
    const canonical = JSON.stringify(inputSnapshot);
    const inputDigest = createHash('sha256').update(canonical).digest('hex');
    const maxTlp = rows.reduce<TlpLevel>((current, row) => tlpRank[row.tlp] > tlpRank[current] ? row.tlp : current, 'CLEAR');
    try {
      return await this.prisma.$transaction(async tx => {
        const run = await tx.nextStepRun.create({ data: { tenantId, idempotencyKey: input.idempotencyKey, threatActorId: input.threatActorId, campaignId: input.campaignId, asOf, horizonDays: input.horizonDays, engineVersion: ENGINE_VERSION, ruleVersion: RULE_VERSION, inputSnapshot: inputSnapshot as Prisma.InputJsonValue, inputDigest, maxTlp, status: result.status, abstentionReason: result.abstentionReason, createdById: user.sub } });
        if (result.candidates.length) await tx.nextStepCandidate.createMany({ data: result.candidates.map((item, rank) => ({ tenantId, runId: run.id, mitreTechniqueId: item.techniqueId, techniqueExternalId: item.externalId, techniqueName: item.name, techniqueTactic: item.tactic, rank: rank + 1, supportScore: item.supportScore, supportingObservationIds: [...item.supportingObservationIds], contradictingObservationIds: [...item.contradictingObservationIds], ruleTrace: item.ruleTrace, investigationSteps: [...item.investigationSteps] })) });
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'NEXT_STEP_RUN_CREATED', metadata: { runId: run.id, status: run.status, inputDigest } } });
        return tx.nextStepRun.findUniqueOrThrow({ where: { id: run.id }, include: runDetail });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const repeated = await this.prisma.nextStepRun.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } }, include: runDetail });
        if (repeated && repeated.inputDigest === inputDigest) return repeated;
        throw new ConflictException('Idempotency key belongs to another run');
      }
      throw error;
    }
  }

  async review(user: AuthUser, candidateId: string, input: ReviewNextStep, requested?: string) {
    const tenantId = this.tenant(user, requested);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "NextStepCandidate" WHERE "id" = ${candidateId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const candidate = await tx.nextStepCandidate.findFirst({ where: { id: candidateId, tenantId }, include: { run: true, reviews: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } } });
      if (!candidate) throw new NotFoundException('Hypothesis unavailable');
      if ((candidate.reviews[0]?.id ?? null) !== input.expectedReviewId) throw new ConflictException('Review history changed; reload');
      if (input.kind === 'OUTCOME' && input.outcome === 'VERIFIED') {
        if (!input.outcomeObservationId) throw new BadRequestException('Verified outcome requires a confirmed observation');
        const observed = await tx.ttpObservation.findFirst({ where: { id: input.outcomeObservationId, tenantId, mitreTechniqueId: candidate.mitreTechniqueId, status: 'CONFIRMED', ingestedAt: { gt: candidate.run.asOf }, observedStartAt: { gt: candidate.run.asOf, lte: new Date(Math.min(Date.now(), candidate.run.asOf.getTime() + candidate.run.horizonDays * 86400000)) }, ...(candidate.run.threatActorId ? { threatActorId: candidate.run.threatActorId } : { campaignId: candidate.run.campaignId }) }, select: { id: true, sirEvidence: { select: { sirId: true } } } });
        const lineages = snapshotObservations(candidate.run.inputSnapshot).filter((item): item is { sourceLineageId: string } => typeof item === 'object' && item !== null && 'sourceLineageId' in item && typeof item.sourceLineageId === 'string').map(item => item.sourceLineageId);
        if (!observed || lineages.includes(observed.sirEvidence.sirId) || (Array.isArray(candidate.supportingObservationIds) && candidate.supportingObservationIds.includes(observed.id))) throw new BadRequestException('Independent later confirmed outcome required');
      }
      if (input.kind === 'OUTCOME' && input.outcome !== 'VERIFIED' && input.outcomeObservationId) throw new BadRequestException('Only verified outcomes link an observation');
      const row = await tx.nextStepReview.create({ data: { tenantId, candidateId, kind: input.kind, disposition: input.kind === 'DISPOSITION' ? input.disposition : null, outcome: input.kind === 'OUTCOME' ? input.outcome : null, outcomeObservationId: input.kind === 'OUTCOME' ? input.outcomeObservationId : null, reason: input.reason, reviewerId: user.sub } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'NEXT_STEP_REVIEW_RECORDED', metadata: { runId: candidate.runId, candidateId, reviewId: row.id, kind: row.kind } } });
      return row;
    });
  }
}
