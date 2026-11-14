import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type MonitoringFindingStatus, type MonitoringObservation } from '@prisma/client';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { ObservationInput, ReviewInput, SourceInput, WatchInput, WatchUpdate } from './monitoring.dto';
import { matchObservation, normalizeDomain, normalizeWatch, safeEvidenceRef } from './monitoring.logic';
import { identityDigest, identityVersion } from './monitoring-identity';

const tlpRank = { CLEAR: 0, GREEN: 1, AMBER: 2, AMBER_STRICT: 3, RED: 4 } as const;
const nextStatuses: Record<MonitoringFindingStatus, readonly MonitoringFindingStatus[]> = {
  NEW: ['UNDER_REVIEW', 'FALSE_POSITIVE'], UNDER_REVIEW: ['CONFIRMED', 'FALSE_POSITIVE'],
  CONFIRMED: ['RESOLVED', 'FALSE_POSITIVE'], FALSE_POSITIVE: [], RESOLVED: [],
};

export function monitoringTenant(user: AuthUser, requested?: string): string {
  if (user.role === 'SUPER_ADMIN') { if (!requested) throw new BadRequestException('Tenant required'); return requested; }
  if (!user.tenantId) throw new ForbiddenException('Tenant context required');
  if (requested && requested !== user.tenantId) throw new ForbiddenException('Tenant mismatch');
  return user.tenantId;
}

function sameObservation(row: MonitoringObservation, input: ObservationInput, domain: string | null, identityHash: string | null): boolean {
  return row.evidenceDigest === input.evidenceDigest && row.evidenceRef === input.evidenceRef
    && row.domain === domain && row.identityHash === identityHash && row.kind === input.kind
    && row.metadataCategory === input.metadataCategory && row.tlp === input.tlp
    && row.observedAt.getTime() === new Date(input.observedAt).getTime();
}

@Injectable()
export class MonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  private qa(): void {
    if (process.env.SICTI_MONITORING_QA_ENABLED !== 'true' || process.env.SICTI_ISOLATED_QA !== 'true'
      || !/^\/cti_phase4a_qa_[a-z0-9]+$/.test(new URL(process.env.DATABASE_URL || 'postgresql://invalid@localhost/invalid').pathname)) {
      throw new ForbiddenException('Monitoring ingestion is available only in isolated Phase 4A QA');
    }
  }

  @Interval(3_600_000)
  async scrubExpired(): Promise<number> {
    if (process.env.SICTI_MONITORING_QA_ENABLED !== 'true' || process.env.SICTI_ISOLATED_QA !== 'true') return 0;
    this.qa();
    const expired = await this.prisma.monitoringObservation.findMany({ where: { expiresAt: { lte: new Date() }, evidenceRef: { not: 'qa://expired/redacted' } }, select: { id: true, tenantId: true }, orderBy: { expiresAt: 'asc' }, take: 100 });
    for (const row of expired) {
      await this.prisma.$transaction(async tx => {
        const changed = await tx.monitoringObservation.updateMany({ where: { id: row.id, tenantId: row.tenantId, expiresAt: { lte: new Date() }, evidenceRef: { not: 'qa://expired/redacted' } }, data: { domain: null, identityHash: null, evidenceRef: 'qa://expired/redacted' } });
        if (changed.count) await tx.auditLog.create({ data: { tenantId: row.tenantId, action: 'MONITORING_EVIDENCE_REDACTED', metadata: { observationId: row.id } } });
      });
    }
    return expired.length;
  }

  async watchlists(user: AuthUser, requested?: string) {
    return this.prisma.monitoringWatchlist.findMany({ where: { tenantId: monitoringTenant(user, requested) }, select: { id: true, kind: true, label: true, active: true, expiresAt: true, assetId: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async redact(user: AuthUser, id: string, reason: string, requested?: string) {
    const tenantId = monitoringTenant(user, requested);
    const observation = await this.prisma.monitoringObservation.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!observation) throw new NotFoundException('Observation not found');
    return this.prisma.$transaction(async tx => {
      const changed = await tx.monitoringObservation.updateMany({ where: { id, tenantId, evidenceRef: { not: 'qa://expired/redacted' } }, data: { domain: null, identityHash: null, evidenceRef: 'qa://expired/redacted', expiresAt: new Date() } });
      if (changed.count) await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'MONITORING_EVIDENCE_OPERATOR_REDACTED', metadata: { observationId: id, reason } } });
      return { redacted: true };
    });
  }

  async addWatchlist(user: AuthUser, input: WatchInput, requested?: string) {
    const tenantId = monitoringTenant(user, requested);
    let normalized: ReturnType<typeof normalizeWatch>;
    try { normalized = input.kind === 'IDENTITY_HASH'
      ? { value: identityDigest(tenantId, input.value).digest, label: identityDigest(tenantId, input.value).label }
      : normalizeWatch(input.kind, input.value); } catch { throw new BadRequestException('Invalid watchlist value or identity key'); }
    if (input.expiresAt && new Date(input.expiresAt) <= new Date()) throw new BadRequestException('Watchlist expiry must be future');
    if (input.assetId) {
      if (input.kind !== 'DOMAIN') throw new BadRequestException('Only domain watchlists can link ASM assets');
      const asset = await this.prisma.asset.findFirst({ where: { id: input.assetId, tenantId, type: { in: ['DOMAIN', 'SUBDOMAIN'] } }, select: { value: true } });
      if (!asset || normalizeDomain(asset.value) !== normalized.value) throw new NotFoundException('Matching tenant ASM domain not found');
    }
    if (input.kind === 'IDENTITY_HASH') {
      const domain = normalized.label.slice(4);
      const corporate = await this.prisma.monitoringWatchlist.findFirst({ where: { tenantId, kind: 'DOMAIN', value: domain, active: true }, select: { id: true } });
      const asset = await this.prisma.asset.findFirst({ where: { tenantId, type: { in: ['DOMAIN', 'SUBDOMAIN'] }, value: domain }, select: { id: true } });
      if (!corporate && !asset) throw new BadRequestException('Identity domain must be an authorized corporate domain');
    }
    return this.prisma.$transaction(async tx => {
      const watch = await tx.monitoringWatchlist.create({ data: { tenantId, kind: input.kind, ...normalized, identityKeyVersion: input.kind === 'IDENTITY_HASH' ? identityVersion() : null, assetId: input.assetId, assetTenantId: input.assetId ? tenantId : null, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, createdById: user.sub } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'MONITORING_WATCH_CREATED', metadata: { watchlistId: watch.id, kind: watch.kind, label: watch.label } } });
      return { id: watch.id, kind: watch.kind, label: watch.label, active: watch.active, expiresAt: watch.expiresAt, assetId: watch.assetId };
    }).catch(error => { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Watchlist already exists'); throw error; });
  }

  async updateWatchlist(user: AuthUser, id: string, input: WatchUpdate, requested?: string) {
    const tenantId = monitoringTenant(user, requested);
    const watch = await this.prisma.monitoringWatchlist.findFirst({ where: { id, tenantId } });
    if (!watch) throw new NotFoundException('Watchlist not found');
    if (watch.kind === 'IDENTITY_HASH' && !watch.identityKeyVersion && input.active) throw new BadRequestException('Legacy identity watch must be re-enrolled with a keyed digest');
    if (input.expiresAt && new Date(input.expiresAt) <= new Date()) throw new BadRequestException('Watchlist expiry must be future');
    return this.prisma.$transaction(async tx => {
      const updated = await tx.monitoringWatchlist.update({ where: { id }, data: { active: input.active, expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt ? new Date(input.expiresAt) : null } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'MONITORING_WATCH_UPDATED', metadata: { watchlistId: id, active: updated.active, expiresAt: updated.expiresAt } } });
      return { id: updated.id, kind: updated.kind, label: updated.label, active: updated.active, expiresAt: updated.expiresAt, assetId: updated.assetId };
    });
  }

  async sources(user: AuthUser, requested?: string) {
    const rows = await this.prisma.monitoringSource.findMany({ where: { tenantId: monitoringTenant(user, requested) }, select: { id: true, providerKey: true, authorized: true, qaOnly: true, retentionDays: true, connectorVersion: true, collectionEnabled: true, collectionIntervalMinutes: true, nextCollectionAt: true, lastSuccessAt: true, lastFailureReason: true, coverageLabel: true, catalogName: true, catalogTlp: true, catalogSource: { select: { name: true, status: true, tlp: true } } }, take: 50 });
    return rows.map(row => ({ ...row, catalogSource: row.catalogSource ?? { name: row.catalogName, status: 'INACTIVE', tlp: row.catalogTlp } }));
  }

  async addSource(user: AuthUser, input: SourceInput, requested?: string) {
    this.qa();
    const tenantId = monitoringTenant(user, requested);
    const catalog = await this.prisma.intelligenceSource.findFirst({ where: { id: input.catalogSourceId, tenantId, status: 'ACTIVE' }, select: { id: true, name: true, tlp: true, url: true, telegramChatId: true } });
    if (!catalog || catalog.url || catalog.telegramChatId) throw new BadRequestException('Use an active local-only intelligence source');
    return this.prisma.$transaction(async tx => {
      const source = await tx.monitoringSource.create({ data: { tenantId, catalogSourceId: catalog.id, catalogTenantId: tenantId, catalogName: catalog.name, catalogTlp: catalog.tlp, providerKey: input.providerKey, authorized: true, qaOnly: true, retentionDays: input.retentionDays } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'MONITORING_QA_SOURCE_AUTHORIZED', metadata: { sourceId: source.id, catalogSourceId: catalog.id } } });
      return source;
    }).catch(error => { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('QA provider key already authorized'); throw error; });
  }

  async ingest(user: AuthUser, input: ObservationInput, requested?: string) {
    this.qa();
    const tenantId = monitoringTenant(user, requested);
    let domain: string | null = null;
    try { domain = input.domain ? normalizeDomain(input.domain) : null; safeEvidenceRef(input.evidenceRef); } catch { throw new BadRequestException('Unsafe observation domain or evidence reference'); }
    if (!domain && !input.identity) throw new BadRequestException('Domain or identity required');
    let keyedIdentity: ReturnType<typeof identityDigest> | null = null;
    try { keyedIdentity = input.identity ? identityDigest(tenantId, input.identity) : null; } catch { throw new BadRequestException('Invalid identity or key'); }
    const expectedCategory = { CREDENTIAL_EXPOSURE: 'ACCOUNT_PRESENT', CORPORATE_DATA_EXPOSURE: 'DATASET_MENTION', BRAND_IMPERSONATION: 'LOOKALIKE_DOMAIN', PHISHING_DOMAIN: 'PHISHING_SIGNAL' } as const;
    if (input.metadataCategory !== expectedCategory[input.kind]) throw new BadRequestException('Observation category mismatch');
    const source = await this.prisma.monitoringSource.findFirst({ where: { id: input.sourceId, tenantId, authorized: true, qaOnly: true, catalogSource: { status: 'ACTIVE' } }, include: { catalogSource: { select: { tlp: true } } } });
    if (!source) throw new NotFoundException('Authorized QA source not found');
    if (tlpRank[input.tlp] < tlpRank[source.catalogTlp]) throw new BadRequestException('Observation TLP below source TLP');
    const observedAt = new Date(input.observedAt);
    if (observedAt.getTime() > Date.now() + 300_000 || observedAt.getTime() < Date.now() - 30 * 86_400_000) throw new BadRequestException('Observation outside QA window');
    const existing = await this.prisma.monitoringObservation.findUnique({ where: { tenantId_sourceId_providerEventKey: { tenantId, sourceId: source.id, providerEventKey: input.providerEventKey } }, include: { matches: { include: { finding: true } } } });
    if (existing) {
      const replayDigest = input.identity && existing.identityKeyVersion ? identityDigest(tenantId, input.identity, existing.identityKeyVersion).digest : keyedIdentity?.digest ?? null;
      if (!sameObservation(existing, input, domain, replayDigest)) throw new ConflictException('Provider event key replay changed content');
      return existing;
    }
    const watches = await this.prisma.monitoringWatchlist.findMany({ where: { tenantId, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true, kind: true, value: true, identityKeyVersion: true } });
    const matched = watches.flatMap(watch => {
      let digest: string | null = null;
      if (input.identity && watch.kind === 'IDENTITY_HASH' && watch.identityKeyVersion) {
        try { digest = identityDigest(tenantId, input.identity, watch.identityKeyVersion).digest; }
        catch { return []; }
      }
      const result = matchObservation(input.kind, domain, digest, watch);
      return result ? [{ watchlistId: watch.id, ...result }] : [];
    });
    try {
      return await this.prisma.$transaction(async tx => {
        const observation = await tx.monitoringObservation.create({ data: { tenantId, sourceId: source.id, providerEventKey: input.providerEventKey, kind: input.kind, domain, identityHash: keyedIdentity?.digest, identityKeyVersion: keyedIdentity?.version, metadataCategory: input.metadataCategory, evidenceRef: input.evidenceRef, evidenceDigest: input.evidenceDigest, observedAt, expiresAt: new Date(observedAt.getTime() + source.retentionDays * 86_400_000), tlp: input.tlp } });
        for (const result of matched) {
          const match = await tx.monitoringMatch.create({ data: { tenantId, observationId: observation.id, ...result } });
          await tx.monitoringFinding.create({ data: { tenantId, matchId: match.id } });
        }
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'MONITORING_QA_OBSERVATION_INGESTED', metadata: { observationId: observation.id, matchCount: matched.length, sourceId: source.id } } });
        return tx.monitoringObservation.findUniqueOrThrow({ where: { id: observation.id }, include: { matches: { include: { finding: true } } } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.prisma.monitoringObservation.findUnique({ where: { tenantId_sourceId_providerEventKey: { tenantId, sourceId: source.id, providerEventKey: input.providerEventKey } }, include: { matches: { include: { finding: true } } } });
        const replayDigest = replay && input.identity && replay.identityKeyVersion ? identityDigest(tenantId, input.identity, replay.identityKeyVersion).digest : keyedIdentity?.digest ?? null;
        if (replay && sameObservation(replay, input, domain, replayDigest)) return replay;
        throw new ConflictException('Provider event key replay changed content');
      }
      throw error;
    }
  }

  async findings(user: AuthUser, requested?: string, status?: MonitoringFindingStatus) {
    const tenantId = monitoringTenant(user, requested);
    return this.prisma.monitoringFinding.findMany({ where: { tenantId, ...(status ? { status } : {}), match: { observation: { expiresAt: { gt: new Date() }, ...(user.role === 'USER' ? { tlp: { not: 'RED' } } : {}) } } }, include: { match: { include: { observation: { select: { id: true, kind: true, domain: true, metadataCategory: true, tlp: true, observedAt: true, expiresAt: true, source: { select: { providerKey: true } } } }, watchlist: { select: { label: true, kind: true, assetId: true } } } }, reviews: { select: { id: true, fromStatus: true, toStatus: true, reason: true, createdAt: true, actor: { select: { name: true } } }, orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async detail(user: AuthUser, id: string, requested?: string) {
    const tenantId = monitoringTenant(user, requested);
    const finding = await this.prisma.monitoringFinding.findFirst({ where: { id, tenantId, match: { observation: { expiresAt: { gt: new Date() }, ...(user.role === 'USER' ? { tlp: { not: 'RED' } } : {}) } } }, include: { match: { include: { observation: { include: { source: { include: { catalogSource: { select: { name: true, reliability: true } } } } } }, watchlist: { select: { label: true, kind: true, assetId: true } } } }, reviews: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'asc' } } } });
    if (!finding) throw new NotFoundException('Finding not found');
    const { identityHash: _identityHash, ...safeObservation } = finding.match.observation;
    return { ...finding, match: { ...finding.match, observation: safeObservation } };
  }

  async review(user: AuthUser, id: string, input: ReviewInput, requested?: string) {
    const tenantId = monitoringTenant(user, requested);
    const finding = await this.detail(user, id, requested);
    if (finding.status !== input.expectedStatus || !nextStatuses[finding.status].includes(input.status)) throw new ConflictException('Invalid or stale finding transition');
    return this.prisma.$transaction(async tx => {
      const changed = await tx.monitoringFinding.updateMany({ where: { id, tenantId, status: input.expectedStatus }, data: { status: input.status } });
      if (changed.count !== 1) throw new ConflictException('Finding changed');
      await tx.monitoringReview.create({ data: { tenantId, findingId: id, actorId: user.sub, fromStatus: input.expectedStatus, toStatus: input.status, reason: input.reason } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'MONITORING_FINDING_REVIEWED', metadata: { findingId: id, from: input.expectedStatus, to: input.status } } });
      return tx.monitoringFinding.findUniqueOrThrow({ where: { id } });
    });
  }
}
