import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { IndicatorType, Prisma } from '@prisma/client';
import { isIP } from 'node:net';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';

const MINIMUM_CONFIDENCE = 60;
const MAXIMUM_CANDIDATES = 100;

type EvidenceKind = 'CAMPAIGN' | 'INTELLIGENCE_REPORT' | 'INDICATOR_VALUE' | 'INDICATOR_TAG' | 'SOURCE' | 'PROVIDER' | 'ENRICHMENT_CONTEXT' | 'EXISTING_RELATION';
type MatchedEvidence = {
  readonly kind: EvidenceKind;
  readonly value: string;
  readonly weight: number;
};
type StructuredIndicator = { readonly type: IndicatorType; readonly value: string };

type Candidate = {
  readonly id: string;
  readonly entityId: string;
  readonly name: string;
  readonly confidence: number;
  readonly matchedEvidence: readonly MatchedEvidence[];
};

@Injectable()
export class ThreatActorAttributionService {
  constructor(private readonly prisma: PrismaService) {}

  async attribute(currentUser: AuthUser, indicatorId: string) {
    const indicator = await this.prisma.indicator.findUnique({
      where: { id: indicatorId },
      include: { intelligenceSource: { select: { name: true, provider: true } } },
    });
    if (!indicator) throw new NotFoundException('Indicator tidak ditemukan');
    if (currentUser.role !== 'SUPER_ADMIN' && indicator.tenantId !== currentUser.tenantId) {
      throw new ForbiddenException('Indicator berada di tenant lain');
    }

    if (indicator.intelligenceEntityId) {
      const linked = await this.prisma.threatActor.findFirst({
        where: { tenantId: indicator.tenantId, entityId: indicator.intelligenceEntityId, entity: { tenantId: indicator.tenantId } },
        select: { id: true, entityId: true, entity: { select: { name: true } } },
      });
      if (linked) return {
        status: 'MATCH' as const,
        indicatorId,
        candidate: { id: linked.id, name: linked.entity.name },
        confidence: 100,
        matchedEvidence: [{ kind: 'EXISTING_RELATION' as const, value: linked.entityId, weight: 100 }],
        created: false,
      };
      return { status: 'NO_MATCH' as const, indicatorId, confidence: 0, matchedEvidence: [], candidates: [] };
    }

    const [enrichments, actors] = await Promise.all([
      this.prisma.indicatorEnrichment.findMany({
        where: { tenantId: indicator.tenantId, indicatorId, status: 'SUCCESS' },
        select: { provider: true, data: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.threatActor.findMany({
        where: {
          tenantId: indicator.tenantId,
          status: 'ACTIVE',
          entity: { tenantId: indicator.tenantId },
          OR: [
            { campaigns: { some: { tenantId: indicator.tenantId, indicators: { some: { indicatorId } } } } },
            { intelligenceReports: { some: { tenantId: indicator.tenantId, report: { indicators: { some: { indicatorId } } } } } },
            { entity: { tenantId: indicator.tenantId, indicators: { some: { tenantId: indicator.tenantId } } } },
          ],
        },
        select: {
          id: true, entityId: true, aliases: true, targetSectors: true,
          entity: { select: { tenantId: true, name: true, externalId: true, metadata: true, indicators: { where: { tenantId: indicator.tenantId }, select: { type: true, value: true }, take: 100 } } },
          campaigns: { where: { tenantId: indicator.tenantId, indicators: { some: { indicatorId } } }, select: { id: true }, take: 1 },
          intelligenceReports: { where: { tenantId: indicator.tenantId, report: { indicators: { some: { indicatorId } } } }, select: { reportId: true }, take: 1 },
        },
        take: MAXIMUM_CANDIDATES + 1,
      }),
    ]);

    if (actors.length > MAXIMUM_CANDIDATES) return { status: 'AMBIGUOUS' as const, indicatorId, confidence: 0, matchedEvidence: [], candidates: [] };
    const candidates = actors.filter(actor => actor.entity.tenantId === indicator.tenantId).map(actor => this.score(actor, indicator, enrichments)).sort((left, right) => right.confidence - left.confidence);
    const qualified = candidates.filter(candidate => candidate.confidence >= MINIMUM_CONFIDENCE && candidate.matchedEvidence.some(evidence => this.isStrong(evidence.kind)));
    if (qualified.length > 1) return {
      status: 'AMBIGUOUS' as const,
      indicatorId,
      confidence: qualified[0]?.confidence ?? 0,
      matchedEvidence: qualified[0]?.matchedEvidence ?? [],
      candidates: qualified.map(candidate => ({ id: candidate.id, name: candidate.name, confidence: candidate.confidence, matchedEvidence: candidate.matchedEvidence })),
    };
    const candidate = qualified[0];
    if (!candidate) {
      const best = candidates[0];
      return { status: 'NO_MATCH' as const, indicatorId, confidence: best?.confidence ?? 0, matchedEvidence: best?.matchedEvidence ?? [], candidates: [] };
    }

    await this.prisma.$transaction(async transaction => {
      const confirmed = await transaction.threatActor.findFirst({ where: { id: candidate.id, tenantId: indicator.tenantId, status: 'ACTIVE', entity: { tenantId: indicator.tenantId } }, select: { entityId: true } });
      if (!confirmed || confirmed.entityId !== candidate.entityId) throw new ConflictException('Kandidat threat actor berubah; jalankan attribution kembali');
      await transaction.indicator.update({ where: { id_tenantId: { id: indicatorId, tenantId: indicator.tenantId } }, data: { intelligenceEntityId: candidate.entityId } });
      await transaction.auditLog.create({ data: { userId: currentUser.sub, tenantId: indicator.tenantId, action: 'INDICATOR_THREAT_ACTOR_ATTRIBUTED', metadata: { indicatorId, threatActorId: candidate.id, confidence: String(candidate.confidence) } } });
    });
    return {
      status: 'MATCH' as const,
      indicatorId,
      candidate: { id: candidate.id, name: candidate.name },
      confidence: candidate.confidence,
      matchedEvidence: candidate.matchedEvidence,
      created: true,
    };
  }

  private score(actor: {
    readonly id: string; readonly entityId: string; readonly aliases: readonly string[]; readonly targetSectors: readonly string[];
    readonly entity: { readonly tenantId: string; readonly name: string; readonly externalId: string | null; readonly metadata: Prisma.JsonValue; readonly indicators: readonly StructuredIndicator[] };
    readonly campaigns: readonly { readonly id: string }[]; readonly intelligenceReports: readonly { readonly reportId: string }[];
  }, indicator: StructuredIndicator & { readonly tags: readonly string[]; readonly source: string | null; readonly intelligenceSource: { readonly name: string; readonly provider: string | null } | null }, enrichments: readonly { readonly provider: string; readonly data: Prisma.JsonValue }[]): Candidate {
    const evidence = new Map<string, MatchedEvidence>();
    const add = (key: string, item: MatchedEvidence): void => { const current = evidence.get(key); if (!current || current.weight < item.weight) evidence.set(key, item); };
    const structuredTokens = new Set([actor.entity.externalId, ...actor.aliases, ...actor.targetSectors, ...this.jsonStrings(actor.entity.metadata)].filter((value): value is string => Boolean(value)).map(value => value.trim().toLowerCase()).filter(Boolean));

    const campaign = actor.campaigns[0];
    if (campaign) add(`campaign:${campaign.id}`, { kind: 'CAMPAIGN', value: campaign.id, weight: 70 });
    const report = actor.intelligenceReports[0];
    if (report) add(`report:${report.reportId}`, { kind: 'INTELLIGENCE_REPORT', value: report.reportId, weight: 65 });
    const indicatorKey = this.normalizeIndicator(indicator);
    if (indicatorKey && actor.entity.indicators.some(item => this.normalizeIndicator(item) === indicatorKey)) add(indicatorKey, { kind: 'INDICATOR_VALUE', value: indicator.value, weight: 70 });

    for (const tag of indicator.tags) {
      const normalized = tag.trim().toLowerCase();
      if (normalized && structuredTokens.has(normalized)) add(this.evidenceKey(tag), { kind: 'INDICATOR_TAG', value: tag, weight: 20 });
    }
    const sources = [indicator.source, indicator.intelligenceSource?.name, indicator.intelligenceSource?.provider].filter((value): value is string => Boolean(value));
    for (const source of sources) {
      const normalized = source.trim().toLowerCase();
      if (normalized && structuredTokens.has(normalized)) add(this.evidenceKey(source), { kind: 'SOURCE', value: source, weight: 15 });
    }
    for (const enrichment of enrichments) {
      const provider = enrichment.provider.trim().toLowerCase();
      if (provider && structuredTokens.has(provider)) add(this.evidenceKey(enrichment.provider), { kind: 'PROVIDER', value: enrichment.provider, weight: 15 });
      for (const value of this.jsonStrings(enrichment.data)) {
        const normalizedToken = value.trim().toLowerCase();
        if (normalizedToken && structuredTokens.has(normalizedToken)) add(this.evidenceKey(value), { kind: 'ENRICHMENT_CONTEXT', value, weight: 10 });
        for (const actorIndicator of actor.entity.indicators) {
          const normalized = this.normalizeIndicator({ type: actorIndicator.type, value });
          if (normalized && normalized === this.normalizeIndicator(actorIndicator)) add(normalized, { kind: 'ENRICHMENT_CONTEXT', value, weight: 30 });
        }
      }
    }
    const matchedEvidence = [...evidence.values()];
    return { id: actor.id, entityId: actor.entityId, name: actor.entity.name, confidence: Math.min(matchedEvidence.reduce((total, item) => total + item.weight, 0), 100), matchedEvidence };
  }

  private normalizeIndicator(indicator: StructuredIndicator): string | null {
    const value = indicator.value.trim();
    switch (indicator.type) {
      case 'IP_ADDRESS': return isIP(value) ? `ioc:ip:${value.toLowerCase()}` : null;
      case 'FILE_HASH': return /^[a-fA-F0-9]{16,128}$/.test(value) ? `ioc:hash:${value.toLowerCase()}` : null;
      case 'DOMAIN': return this.normalizeDomain(value);
      case 'URL': return this.normalizeUrl(value);
      case 'EMAIL': {
        const separator = value.lastIndexOf('@');
        if (separator < 1 || separator === value.length - 1 || value.indexOf('@') !== separator) return null;
        const domain = this.normalizeDomain(value.slice(separator + 1));
        return domain ? `ioc:email:${value.slice(0, separator).toLowerCase()}@${domain.slice('ioc:domain:'.length)}` : null;
      }
      default: return this.assertNever(indicator.type);
    }
  }

  private normalizeDomain(value: string): string | null {
    try {
      const parsed = new URL(`http://${value.replace(/\.$/, '')}`);
      return parsed.hostname && parsed.pathname === '/' && !parsed.search && !parsed.username && !parsed.password && !parsed.port ? `ioc:domain:${parsed.hostname.toLowerCase()}` : null;
    } catch (error) {
      if (error instanceof TypeError) return null;
      throw error;
    }
  }

  private normalizeUrl(value: string): string | null {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      parsed.hash = '';
      return `ioc:url:${parsed.toString().replace(/\/$/, '')}`;
    } catch (error) {
      if (error instanceof TypeError) return null;
      throw error;
    }
  }

  private evidenceKey(value: string): string {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) return this.normalizeUrl(trimmed) ?? `token:${trimmed.toLowerCase()}`;
    if (trimmed.includes('@')) return this.normalizeIndicator({ type: 'EMAIL', value: trimmed }) ?? `token:${trimmed.toLowerCase()}`;
    if (isIP(trimmed)) return this.normalizeIndicator({ type: 'IP_ADDRESS', value: trimmed }) ?? `token:${trimmed.toLowerCase()}`;
    if (/^[a-fA-F0-9]{16,128}$/.test(trimmed)) return this.normalizeIndicator({ type: 'FILE_HASH', value: trimmed }) ?? `token:${trimmed.toLowerCase()}`;
    if (trimmed.includes('.')) return this.normalizeDomain(trimmed) ?? `token:${trimmed.toLowerCase()}`;
    return `token:${trimmed.toLowerCase()}`;
  }

  private isStrong(kind: EvidenceKind): boolean { return kind === 'CAMPAIGN' || kind === 'INTELLIGENCE_REPORT' || kind === 'INDICATOR_VALUE'; }

  private jsonStrings(value: Prisma.JsonValue): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(item => this.jsonStrings(item));
    if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(item => item === null || item === undefined ? [] : this.jsonStrings(item));
    return [];
  }
  private assertNever(value: never): never { throw new ConflictException(`Tipe indicator tidak didukung: ${value}`); }
}
