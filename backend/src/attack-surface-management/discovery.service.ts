import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AssetDiscoverySource, AssetRelationshipType, AssetStatus, AssetType, Prisma } from '@prisma/client';
import { getDomain } from 'tldts';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { DiscoveryClient } from './discovery.client';

const MAX_RESULTS_PER_PROVIDER = 500;
const MAX_DNS_TARGETS = 25;
const MAX_OBSERVATIONS = 500;
const DNS_CONCURRENCY = 5;

type AssetObservation = {
  readonly type: Extract<AssetType, 'IP_ADDRESS' | 'SUBDOMAIN'>;
  readonly value: string;
  readonly observedAt: Date;
  readonly links: readonly { sourceValue: string; source: AssetDiscoverySource; type: AssetRelationshipType }[];
};

type PersistOutcome = 'created' | 'updated' | 'skipped' | 'failed';

export interface DiscoverySummary {
  readonly rootDomain: string;
  readonly discovered: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly providers: readonly string[];
  readonly errors: readonly string[];
}

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: DiscoveryClient,
  ) {}

  async runDiscovery(
    user: AuthUser,
    assetId: string,
    requestedTenantId?: string,
  ): Promise<DiscoverySummary> {
    const tenantId = await this.resolveTenant(user, requestedTenantId);
    const rootAsset = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId } });
    if (!rootAsset) throw new NotFoundException('Asset tidak ditemukan');
    if (rootAsset.type !== AssetType.DOMAIN && rootAsset.type !== AssetType.SUBDOMAIN) {
      throw new BadRequestException('Discovery hanya dapat dijalankan pada asset DOMAIN atau SUBDOMAIN');
    }

    const rootDomain = rootAsset.value.toLowerCase().trim();
    const cnameBoundary = getDomain(rootDomain, { allowPrivateDomains: true }) ?? rootDomain;
    const observedAt = new Date();
    await this.audit(user, tenantId, 'ASSET_DISCOVERY_STARTED', assetId, {
      rootAssetId: assetId,
      rootDomain,
    });

    const hostnames = new Set<string>();
    const hostnameSources = new Map<string, Set<AssetDiscoverySource>>();
    const providers = new Set<string>();
    const errors: string[] = [];
    let providerFailures = 0;
    if (rootAsset.type === AssetType.DOMAIN) {
      const discoveryResults = await Promise.allSettled([
        this.client.discoverViaDns(rootDomain),
        this.client.discoverViaCertTransparency(rootDomain),
      ]);
      for (const result of discoveryResults) {
        if (result.status === 'rejected') {
          providerFailures += 1;
          errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
          continue;
        }
        providers.add(result.value.provider);
        if (result.value.error) {
          providerFailures += 1;
          errors.push(`[${result.value.provider}] ${result.value.error}`);
        }
        for (const hostname of result.value.hostnames.slice(0, MAX_RESULTS_PER_PROVIDER)) {
          const normalized = hostname.toLowerCase().trim();
          if (hostnames.size >= MAX_DNS_TARGETS - 1 && !hostnames.has(normalized)) continue;
          if (this.client.isValidHostname(normalized) && this.client.isSubdomainOf(normalized, rootDomain)) {
            hostnames.add(normalized);
            const source = result.value.provider === 'CRTSH' ? AssetDiscoverySource.CRT_SH : AssetDiscoverySource.CLOUDFLARE_DOH;
            const sources = hostnameSources.get(normalized) ?? new Set<AssetDiscoverySource>();
            sources.add(source);
            hostnameSources.set(normalized, sources);
          }
        }
      }
    }

    const observations = new Map<string, AssetObservation>();
    const addObservation = (observation: AssetObservation): void => {
      if (observations.size < MAX_OBSERVATIONS || observations.has(`${observation.type}:${observation.value}`)) {
        const key = `${observation.type}:${observation.value}`;
        const previous = observations.get(key);
        observations.set(key, previous ? { ...previous, links: [...previous.links, ...observation.links] } : observation);
      }
    };
    for (const hostname of hostnames) {
      addObservation({
        type: AssetType.SUBDOMAIN,
        value: hostname,
        observedAt,
        links: [...(hostnameSources.get(hostname) ?? [])].map(source => ({ sourceValue: rootDomain, source, type: AssetRelationshipType.DISCOVERED_SUBDOMAIN })),
      });
    }

    const resolutionTargets = [rootDomain, ...hostnames];
    const resolutions: PromiseSettledResult<Awaited<ReturnType<DiscoveryClient['resolveDns']>>>[] = [];
    for (let index = 0; index < resolutionTargets.length; index += DNS_CONCURRENCY) {
      const batch = resolutionTargets.slice(index, index + DNS_CONCURRENCY);
      resolutions.push(...await Promise.allSettled(
        batch.map((hostname) => this.client.resolveDns(hostname)),
      ));
    }
    for (const result of resolutions) {
      if (result.status === 'rejected') {
        providerFailures += 1;
        errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
        continue;
      }
      providers.add(result.value.provider);
      providerFailures += result.value.errors.length;
      errors.push(...result.value.errors);
      for (const value of [...result.value.ipv4, ...result.value.ipv6]) {
        addObservation({
          type: AssetType.IP_ADDRESS,
          value,
          observedAt,
          links: [{ sourceValue: result.value.hostname, source: AssetDiscoverySource.DNS_RESOLUTION, type: AssetRelationshipType.RESOLVES_TO }],
        });
      }
      for (const value of result.value.cnames) {
        if (
          value !== rootDomain
          && this.client.isValidHostname(value)
          && this.client.isSubdomainOf(value, cnameBoundary)
        ) {
          addObservation({
            type: AssetType.SUBDOMAIN,
            value,
            observedAt,
            links: [{ sourceValue: result.value.hostname, source: AssetDiscoverySource.DNS_RESOLUTION, type: AssetRelationshipType.DISCOVERED_SUBDOMAIN }],
          });
        }
      }
    }

    const counts: Record<PersistOutcome, number> = { created: 0, updated: 0, skipped: 0, failed: 0 };
    for (const observation of observations.values()) {
      const outcome = await this.persistObservation(tenantId, observation);
      counts[outcome.status] += 1;
      if (outcome.id) {
        for (const link of observation.links) {
          const parent = link.sourceValue === rootDomain ? rootAsset : await this.prisma.asset.findFirst({
            where: { tenantId, value: link.sourceValue, type: AssetType.SUBDOMAIN }, select: { id: true },
          });
          if (!parent || parent.id === outcome.id) continue;
          await this.prisma.assetRelationship.upsert({
            where: { tenantId_sourceAssetId_targetAssetId_type_source: { tenantId, sourceAssetId: parent.id, targetAssetId: outcome.id, type: link.type, source: link.source } },
            create: { tenantId, rootAssetId: rootAsset.id, sourceAssetId: parent.id, targetAssetId: outcome.id, type: link.type, source: link.source, firstSeenAt: observation.observedAt, lastSeenAt: observation.observedAt },
            update: { lastSeenAt: observation.observedAt },
          });
        }
      }
    }
    counts.failed += providerFailures;

    const summary: DiscoverySummary = {
      rootDomain,
      discovered: observations.size,
      created: counts.created,
      updated: counts.updated,
      skipped: counts.skipped,
      failed: counts.failed,
      providers: [...providers],
      errors,
    };
    await this.audit(user, tenantId, 'ASSET_DISCOVERY_COMPLETED', assetId, {
      rootAssetId: assetId,
      rootDomain,
      discovered: summary.discovered,
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped,
      failed: summary.failed,
      providers: summary.providers,
    });
    if (summary.failed > 0 && summary.created === 0 && summary.updated === 0) {
      await this.audit(user, tenantId, 'ASSET_DISCOVERY_FAILED', assetId, {
        rootAssetId: assetId,
        rootDomain,
        errors,
      });
    }
    return summary;
  }

  private async persistObservation(tenantId: string, observation: AssetObservation): Promise<{ status: PersistOutcome; id?: string }> {
    const existing = await this.prisma.asset.findFirst({
      where: { tenantId, type: observation.type, value: observation.value },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.asset.update({
        where: { id: existing.id },
        data: { lastSeenAt: observation.observedAt },
      });
      return { status: 'updated', id: existing.id };
    }
    try {
      const created = await this.prisma.asset.create({
        data: {
          tenantId,
          name: observation.value,
          type: observation.type,
          value: observation.value,
          status: AssetStatus.ACTIVE,
          firstSeenAt: observation.observedAt,
          lastSeenAt: observation.observedAt,
        },
      });
      return { status: 'created', id: created.id };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.asset.update({
          where: {
            tenantId_type_value: {
              tenantId,
              type: observation.type,
              value: observation.value,
            },
          },
          data: { lastSeenAt: observation.observedAt },
        });
        return { status: 'updated', id: raced.id };
      }
      this.logger.error(
        `asm.discovery.persist_failed type=${observation.type} value=${observation.value}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { status: 'failed' };
    }
  }

  private async resolveTenant(user: AuthUser, requestedTenantId?: string): Promise<string> {
    if (user.role === 'SUPER_ADMIN') {
      if (!requestedTenantId) throw new BadRequestException('Tenant wajib');
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: requestedTenantId },
        select: { id: true },
      });
      if (!tenant) throw new BadRequestException('Tenant tidak ditemukan');
      return requestedTenantId;
    }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib');
    return user.tenantId;
  }

  private audit(
    user: AuthUser,
    tenantId: string,
    action: string,
    assetId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.prisma.auditLog.create({
      data: { userId: user.sub, tenantId, action, metadata: { assetId, ...metadata } },
    });
  }
}
