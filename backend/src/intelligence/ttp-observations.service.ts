import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TlpLevel, type TtpObservationStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { CreateTtpObservation, ReviewTtpObservation } from './ttp-observations.dto';
import { classifyTemporalOrder } from './ttp-observation.logic';

const tlpRank = { CLEAR: 0, GREEN: 1, AMBER: 2, AMBER_STRICT: 3, RED: 4 } as const;
const detail = {
  mitreTechnique: { select: { id: true, externalId: true, name: true, tactic: true } },
  threatActor: { select: { id: true, entity: { select: { name: true } } } },
  campaign: { select: { id: true, name: true } },
  reviews: { select: { id: true, status: true, reason: true, createdAt: true, reviewer: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.TtpObservationInclude;

@Injectable()
export class TtpObservationsService {
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

  private visible(user: AuthUser): Prisma.TtpObservationWhereInput {
    return user.role === 'USER' ? { tlp: { not: 'RED' }, sirEvidence: { analysisReportEvidence: { none: { report: { tlp: 'RED' } } } } } : {};
  }

  private sameRequest(existing: { readonly sirEvidenceId: string; readonly mitreTechniqueId: string; readonly threatActorId: string | null; readonly campaignId: string | null; readonly attackVersion: string; readonly attributionBasis: string; readonly observedStartAt: Date; readonly observedEndAt: Date; readonly timePrecision: string; readonly tlp: string; readonly actorConfidence: number | null; readonly techniqueConfidence: number }, input: CreateTtpObservation, start: Date, end: Date): boolean {
    return existing.sirEvidenceId === input.sirEvidenceId && existing.mitreTechniqueId === input.mitreTechniqueId
      && existing.threatActorId === (input.threatActorId ?? null) && existing.campaignId === (input.campaignId ?? null)
      && existing.attackVersion === input.attackVersion && existing.attributionBasis === input.attributionBasis
      && existing.observedStartAt.getTime() === start.getTime() && existing.observedEndAt.getTime() === end.getTime()
      && existing.timePrecision === input.timePrecision && existing.tlp === input.tlp
      && existing.actorConfidence === (input.actorConfidence ?? null) && existing.techniqueConfidence === input.techniqueConfidence;
  }

  async timeline(user: AuthUser, scope: { readonly actorId?: string; readonly campaignId?: string; readonly tenantId?: string }) {
    const tenantId = this.tenant(user, scope.tenantId);
    if (Boolean(scope.actorId) === Boolean(scope.campaignId)) throw new BadRequestException('Select exactly one timeline scope');
    const target = scope.actorId
      ? await this.prisma.threatActor.findFirst({ where: { id: scope.actorId, tenantId }, select: { id: true } })
      : await this.prisma.campaign.findFirst({ where: { id: scope.campaignId, tenantId }, select: { id: true } });
    if (!target) throw new NotFoundException('Timeline scope not found');
    const rows = await this.prisma.ttpObservation.findMany({
      where: { tenantId, ...this.visible(user), ...(scope.actorId ? { OR: [{ threatActorId: scope.actorId }, { campaign: { threatActorId: scope.actorId } }] } : { campaignId: scope.campaignId }) },
      include: detail, orderBy: [{ observedStartAt: 'asc' }, { observedEndAt: 'asc' }, { id: 'asc' }], take: 100,
    });
    return rows.map((row, index) => {
      const previous = rows[index - 1];
      return { ...row, ordering: previous ? classifyTemporalOrder({ start: previous.observedStartAt.toISOString(), end: previous.observedEndAt.toISOString() }, { start: row.observedStartAt.toISOString(), end: row.observedEndAt.toISOString() }) : 'FIRST' };
    });
  }

  async evidenceOptions(user: AuthUser, scope: { readonly actorId?: string; readonly campaignId?: string; readonly tenantId?: string }) {
    const tenantId = this.tenant(user, scope.tenantId);
    if (Boolean(scope.actorId) === Boolean(scope.campaignId)) throw new BadRequestException('Select exactly one evidence scope');
    const rows = await this.prisma.sirEvidence.findMany({
      where: { tenantId, ...(scope.actorId ? { threatActorId: scope.actorId } : { campaignId: scope.campaignId }) },
      select: { id: true, relevanceNote: true, sir: { select: { reference: true, title: true } } },
      orderBy: { createdAt: 'desc' }, take: 50,
    });
    return rows.map(row => ({ id: row.id, label: `${row.sir.reference} · ${row.sir.title}`, relevanceNote: row.relevanceNote }));
  }

  async create(user: AuthUser, input: CreateTtpObservation, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const start = new Date(input.observedStartAt);
    const end = new Date(input.observedEndAt);
    if (end < start || (input.timePrecision === 'INSTANT' && end.getTime() !== start.getTime()) || (input.timePrecision !== 'INSTANT' && end.getTime() === start.getTime())) throw new BadRequestException('Invalid observed interval');
    const existing = await this.prisma.ttpObservation.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } }, include: detail });
    if (existing) {
      if (!this.sameRequest(existing, input, start, end)) throw new ConflictException('Idempotency key belongs to a different observation');
      return existing;
    }
    const [actor, campaign, technique, evidence] = await Promise.all([
      input.threatActorId ? this.prisma.threatActor.findFirst({ where: { id: input.threatActorId, tenantId }, select: { id: true } }) : Promise.resolve(null),
      input.campaignId ? this.prisma.campaign.findFirst({ where: { id: input.campaignId, tenantId }, select: { id: true, threatActorId: true } }) : Promise.resolve(null),
      this.prisma.mitreTechnique.findFirst({ where: { id: input.mitreTechniqueId, tenantId }, select: { id: true, externalId: true } }),
      this.prisma.sirEvidence.findFirst({ where: { id: input.sirEvidenceId, tenantId }, select: { id: true, threatActorId: true, campaignId: true, relevanceNote: true, sir: { select: { reference: true, title: true } }, indicator: { select: { intelligenceSource: { select: { reliability: true, tlp: true } } } }, analysisReportEvidence: { select: { report: { select: { tlp: true } } } }, credibilityAssessments: { select: { grade: true }, orderBy: { assessedAt: 'desc' }, take: 1 } } }),
    ]);
    if ((input.threatActorId && !actor) || (input.campaignId && !campaign) || !technique || !evidence) throw new NotFoundException('Observation reference not found');
    if (campaign && actor && campaign.threatActorId !== actor.id) throw new BadRequestException('Campaign actor mismatch');
    if (evidence.threatActorId !== input.threatActorId && evidence.campaignId !== input.campaignId) throw new BadRequestException('Evidence must be linked to the selected actor or campaign');
    const sourceTlps = [evidence.indicator?.intelligenceSource?.tlp, ...evidence.analysisReportEvidence.map(link => link.report.tlp)].filter((value): value is TlpLevel => Boolean(value));
    if (sourceTlps.some(value => tlpRank[input.tlp] < tlpRank[value])) throw new BadRequestException('Observation TLP cannot be lower than source TLP');
    const snapshot = `${evidence.sir.reference} · ${evidence.sir.title} · ${evidence.relevanceNote ?? ''}`;
    const digest = createHash('sha256').update(snapshot).digest('hex');
    try {
      return await this.prisma.$transaction(async tx => {
        const row = await tx.ttpObservation.create({ data: {
          tenantId, idempotencyKey: input.idempotencyKey, threatActorId: input.threatActorId, campaignId: input.campaignId,
          mitreTechniqueId: technique.id, attackVersion: input.attackVersion, sirEvidenceId: evidence.id,
          evidenceSnapshot: snapshot, evidenceDigest: digest, attributionBasis: input.attributionBasis,
          observedStartAt: start, observedEndAt: end, timePrecision: input.timePrecision, tlp: input.tlp as TlpLevel,
          sourceReliability: evidence.indicator?.intelligenceSource?.reliability ?? null,
          evidenceCredibility: evidence.credibilityAssessments[0]?.grade ?? null,
          actorConfidence: input.actorConfidence, techniqueConfidence: input.techniqueConfidence, createdById: user.sub,
        }, include: detail });
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'TTP_OBSERVATION_CREATED', metadata: { observationId: row.id, evidenceId: evidence.id, techniqueId: technique.id } } });
        return row;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const repeated = await this.prisma.ttpObservation.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } }, include: detail });
        if (repeated) {
          if (!this.sameRequest(repeated, input, start, end)) throw new ConflictException('Idempotency key belongs to a different observation');
          return repeated;
        }
      }
      throw error;
    }
  }

  async review(user: AuthUser, id: string, input: ReviewTtpObservation, requested?: string) {
    const tenantId = this.tenant(user, requested);
    return this.prisma.$transaction(async tx => {
      const current = await tx.ttpObservation.findFirst({ where: { id, tenantId }, select: { id: true, status: true, threatActorId: true, campaignId: true } });
      if (!current) throw new NotFoundException('Observation not found');
      if (current.status !== input.expectedStatus) throw new ConflictException('Observation status changed; reload before reviewing');
      if (current.status === input.status) throw new BadRequestException('Invalid review transition');
      if (input.status === 'CONFIRMED' && !current.threatActorId && !current.campaignId) throw new BadRequestException('Attribution required for confirmation');
      const updated = await tx.ttpObservation.updateMany({ where: { id, tenantId, status: input.expectedStatus as TtpObservationStatus }, data: { status: input.status } });
      if (updated.count !== 1) throw new ConflictException('Observation changed; reload before reviewing');
      const event = await tx.ttpObservationReview.create({ data: { tenantId, observationId: id, status: input.status, reason: input.reason, reviewerId: user.sub } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'TTP_OBSERVATION_REVIEWED', metadata: { observationId: id, reviewId: event.id, status: input.status } } });
      return tx.ttpObservation.findFirstOrThrow({ where: { id, tenantId }, include: detail });
    });
  }
}
