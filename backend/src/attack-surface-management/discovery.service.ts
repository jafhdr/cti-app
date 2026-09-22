import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AssetStatus, AssetType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { DiscoveryClient } from './discovery.client';

const MAX_RESULTS_PER_PROVIDER = 500;

export interface DiscoverySummary {
  rootDomain: string;
  discovered: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  providers: string[];
  errors: string[];
}

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: DiscoveryClient,
  ) {}

  async runDiscovery(user: AuthUser, assetId: string, requestedTenantId?: string): Promise<DiscoverySummary> {
    const tenantId = await this.resolveTenant(user, requestedTenantId);

    // 1. Resolve and validate root asset
    const rootAsset = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId } });
    if (!rootAsset) throw new NotFoundException('Asset tidak ditemukan');
    if (rootAsset.type !== AssetType.DOMAIN) {
      throw new BadRequestException('Discovery hanya dapat dijalankan pada asset bertipe DOMAIN');
    }

    const rootDomain = rootAsset.value.toLowerCase().trim();
    const now = new Date();

    // 2. Audit: STARTED
    await this.audit(user, tenantId, 'ASSET_DISCOVERY_STARTED', assetId, { rootAssetId: assetId, rootDomain });
    this.logger.log(`asm.discovery.started tenantId=${tenantId} assetId=${assetId} domain=${rootDomain}`);

    // 3. Collect hostnames from all providers (failure-isolated)
    const rawHostnames = new Set<string>();
    const providerNames: string[] = [];
    const errors: string[] = [];

    const [dnsResult, ctResult] = await Promise.allSettled([
      this.client.discoverViaDns(rootDomain),
      this.client.discoverViaCertTransparency(rootDomain),
    ]);

    for (const result of [dnsResult, ctResult]) {
      if (result.status === 'fulfilled') {
        providerNames.push(result.value.provider);
        for (const h of result.value.hostnames.slice(0, MAX_RESULTS_PER_PROVIDER)) rawHostnames.add(h);
        if (result.value.error) errors.push(`[${result.value.provider}] ${result.value.error}`);
      } else {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(msg);
        this.logger.error(`asm.discovery.provider_failed: ${msg}`);
      }
    }

    // 4. Validate & deduplicate
    const validHostnames = [...rawHostnames].filter(
      (h) => this.client.isValidHostname(h) && this.client.isSubdomainOf(h, rootDomain),
    );

    // 5. Upsert into Asset table
    let created = 0, updated = 0, skipped = 0, failed = 0;

    for (const hostname of validHostnames) {
      try {
        const existing = await this.prisma.asset.findFirst({
          where: { tenantId, type: AssetType.SUBDOMAIN, value: hostname },
          select: { id: true },
        });
        if (existing) {
          await this.prisma.asset.update({ where: { id: existing.id }, data: { lastSeenAt: now, status: AssetStatus.ACTIVE } });
          updated++;
        } else {
          await this.prisma.asset.create({
            data: { tenantId, name: hostname, type: AssetType.SUBDOMAIN, value: hostname, status: AssetStatus.ACTIVE, firstSeenAt: now, lastSeenAt: now },
          });
          created++;
        }
      } catch (err) {
        if ((err as any)?.code === 'P2002') { skipped++; }
        else {
          failed++;
          this.logger.error(`asm.discovery.upsert_failed hostname=${hostname}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    const summary: DiscoverySummary = { rootDomain, discovered: validHostnames.length, created, updated, skipped, failed, providers: providerNames, errors };

    // 6. Audit: COMPLETED
    await this.audit(user, tenantId, 'ASSET_DISCOVERY_COMPLETED', assetId, { rootAssetId: assetId, rootDomain, discovered: summary.discovered, created, updated, skipped, failed, providers: providerNames });
    this.logger.log(`asm.discovery.completed tenantId=${tenantId} domain=${rootDomain} created=${created} updated=${updated}`);

    if (failed > 0 && created === 0 && updated === 0) {
      await this.audit(user, tenantId, 'ASSET_DISCOVERY_FAILED', assetId, { rootAssetId: assetId, rootDomain, errors });
    }

    return summary;
  }

  private async resolveTenant(user: AuthUser, requestedTenantId?: string): Promise<string> {
    if (user.role === 'SUPER_ADMIN') {
      if (!requestedTenantId) throw new BadRequestException('Tenant wajib');
      const tenant = await this.prisma.tenant.findUnique({ where: { id: requestedTenantId }, select: { id: true } });
      if (!tenant) throw new BadRequestException('Tenant tidak ditemukan');
      return requestedTenantId;
    }
    return this.tenantId(user);
  }

  private tenantId(user: AuthUser): string {
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib');
    return user.tenantId;
  }

  private audit(user: AuthUser, tenantId: string, action: string, assetId: string, metadata: Record<string, unknown>) {
    return this.prisma.auditLog.create({ data: { userId: user.sub, tenantId, action, metadata: { assetId, ...metadata } } });
  }
}
