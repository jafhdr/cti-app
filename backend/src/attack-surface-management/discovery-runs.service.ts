import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AsmChangeType, AsmDiscoveryRunStatus, AssetRelationshipType, AssetType, PortDiscoveryStatus } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { detectChanges, type ExposureSnapshot } from './change-detector';
import { DiscoveryService, type DiscoverySummary } from './discovery.service';
import { PortDiscoveryService, type PortDiscoverySummary } from './port-discovery.service';
import { VulnerabilityCorrelationsService } from './vulnerability-correlations.service';
import { RiskPostureService } from './risk-posture.service';

const snapshotSchema = z.object({
  assets: z.array(z.object({ id: z.string(), type: z.enum(['SUBDOMAIN', 'IP_ADDRESS']), value: z.string() })),
  dns: z.array(z.object({ source: z.string(), target: z.string() })),
  ports: z.array(z.object({ assetId: z.string(), protocol: z.string(), port: z.number(), service: z.string().nullable(), product: z.string().nullable(), version: z.string().nullable() })),
  vulnerabilities: z.array(z.object({ assetId: z.string(), serviceId: z.string(), vulnerabilityId: z.string(), cveId: z.string() })),
});
const blank = (): ExposureSnapshot => ({ assets: [], dns: [], ports: [], vulnerabilities: [] });
const MAX_IP_TARGETS = 25;
const LOCK_MINUTES = 30;

@Injectable()
export class DiscoveryRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: DiscoveryService,
    private readonly ports: PortDiscoveryService,
    private readonly correlations: VulnerabilityCorrelationsService,
    private readonly riskPosture: RiskPostureService,
  ) {}

  private async asset(user: AuthUser, assetId: string, requested?: string) {
    let tenantId = user.tenantId;
    if (user.role === 'SUPER_ADMIN') {
      if (!requested) throw new BadRequestException('Tenant wajib');
      tenantId = requested;
    }
    if (!tenantId) throw new ForbiddenException('Tenant context wajib');
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId } });
    if (!asset) throw new NotFoundException('Asset tidak ditemukan');
    return asset;
  }

  async schedule(user: AuthUser, assetId: string, requested?: string) {
    const asset = await this.asset(user, assetId, requested);
    const schedule = await this.prisma.asmDiscoverySchedule.findUnique({ where: { assetId } });
    return schedule ?? { assetId, tenantId: asset.tenantId, enabled: false, intervalMinutes: 1440, lastRunAt: null, nextRunAt: null };
  }

  async updateSchedule(user: AuthUser, assetId: string, enabled: boolean, intervalMinutes: number, requested?: string) {
    const asset = await this.asset(user, assetId, requested);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 60 || intervalMinutes > 43_200) throw new BadRequestException('Interval harus 60–43200 menit');
    if (asset.type !== AssetType.DOMAIN && asset.type !== AssetType.SUBDOMAIN && asset.type !== AssetType.IP_ADDRESS) throw new BadRequestException('Jenis asset tidak dapat dijadwalkan');
    const nextRunAt = enabled ? new Date(Date.now() + intervalMinutes * 60_000) : null;
    return this.prisma.asmDiscoverySchedule.upsert({ where: { assetId }, create: { tenantId: asset.tenantId, assetId, enabled, intervalMinutes, nextRunAt }, update: { enabled, intervalMinutes, nextRunAt } });
  }

  async runs(user: AuthUser, assetId: string, requested?: string) {
    const asset = await this.asset(user, assetId, requested);
    return this.prisma.asmDiscoveryRun.findMany({ where: { tenantId: asset.tenantId, assetId }, orderBy: { startedAt: 'desc' }, take: 50, select: { id: true, status: true, source: true, startedAt: true, completedAt: true, discovered: true, created: true, updated: true, failed: true, error: true, providers: true } });
  }

  async detail(user: AuthUser, assetId: string, runId: string, requested?: string) {
    const asset = await this.asset(user, assetId, requested);
    const run = await this.prisma.asmDiscoveryRun.findFirst({ where: { id: runId, tenantId: asset.tenantId, assetId }, include: { changes: { orderBy: { detectedAt: 'asc' } } } });
    if (!run) throw new NotFoundException('Discovery run tidak ditemukan');
    return run;
  }

  async changes(user: AuthUser, assetId: string, requested?: string) {
    const asset = await this.asset(user, assetId, requested);
    return this.prisma.asmExposureChange.findMany({ where: { tenantId: asset.tenantId, assetId }, include: { run: { select: { source: true, status: true, startedAt: true } } }, orderBy: { detectedAt: 'desc' }, take: 100 });
  }

  async run(user: AuthUser, assetId: string, requested?: string, source = 'MANUAL', scanPorts = true) {
    const asset = await this.asset(user, assetId, requested);
    if (asset.type !== AssetType.DOMAIN && asset.type !== AssetType.SUBDOMAIN && asset.type !== AssetType.IP_ADDRESS) throw new BadRequestException('Jenis asset tidak dapat ditemukan');
    const now = new Date();
    await this.prisma.asmDiscoverySchedule.upsert({ where: { assetId }, create: { tenantId: asset.tenantId, assetId }, update: {} });
    const leaseUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000);
    const claimed = await this.prisma.asmDiscoverySchedule.updateMany({
      where: { assetId, tenantId: asset.tenantId, ...(source === 'SCHEDULED' ? { enabled: true, nextRunAt: { lte: now } } : {}), OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { lockedUntil: leaseUntil },
    });
    if (claimed.count !== 1) throw new ConflictException('Discovery untuk asset ini sedang berjalan');
    let runId: string | undefined;
    try {
      const previous = await this.prisma.asmDiscoveryRun.findFirst({ where: { tenantId: asset.tenantId, assetId, status: { in: [AsmDiscoveryRunStatus.COMPLETED, AsmDiscoveryRunStatus.PARTIAL] } }, orderBy: { startedAt: 'desc' }, select: { snapshot: true } });
      const before = previous?.snapshot ? snapshotSchema.parse(previous.snapshot) : null;
      const run = await this.prisma.asmDiscoveryRun.create({ data: { tenantId: asset.tenantId, assetId, source } });
      runId = run.id;
      let observed = blank();
      let legacySummary: DiscoverySummary | PortDiscoverySummary | null = null;
      const errors: string[] = [];
      const providers = new Set<string>();
      let discovered = 0; let created = 0; let updated = 0; let failed = 0;
      const ipIds: string[] = [];
      if (asset.type === AssetType.IP_ADDRESS) {
        ipIds.push(asset.id);
      } else {
        const summary = await this.discovery.runDiscovery(user, assetId, requested);
        legacySummary = summary;
        discovered += summary.discovered; created += summary.created; updated += summary.updated; failed += summary.failed;
        errors.push(...summary.errors); summary.providers.forEach(provider => providers.add(provider));
        const links = await this.prisma.assetRelationship.findMany({ where: { tenantId: asset.tenantId, rootAssetId: assetId, lastSeenAt: { gte: run.startedAt } }, include: { sourceAsset: true, targetAsset: true } });
        const found = new Map<string, ExposureSnapshot['assets'][number]>();
        const dns = new Map<string, ExposureSnapshot['dns'][number]>();
        for (const link of links) {
          const target = link.targetAsset;
          if (target.type === AssetType.SUBDOMAIN || target.type === AssetType.IP_ADDRESS) found.set(target.id, { id: target.id, type: target.type, value: target.value });
          if (link.type === AssetRelationshipType.RESOLVES_TO) dns.set(`${link.sourceAsset.value}:${target.value}`, { source: link.sourceAsset.value, target: target.value });
        }
        observed = { ...observed, assets: [...found.values()], dns: [...dns.values()] };
        const ips = observed.assets.filter(item => item.type === 'IP_ADDRESS');
        if (ips.length > MAX_IP_TARGETS) { failed += ips.length - MAX_IP_TARGETS; errors.push('IP discovery target limit reached'); }
        ipIds.push(...ips.slice(0, MAX_IP_TARGETS).map(item => item.id));
      }
      if (scanPorts) for (const ipId of ipIds) {
        const scanStartedAt = new Date();
        try {
          const summary = await this.ports.discover(user, ipId, requested);
          if (asset.type === AssetType.IP_ADDRESS) legacySummary = summary;
          providers.add('TCP_CONNECT'); discovered += summary.scanned; failed += summary.failed + summary.timeout;
          if (summary.failed || summary.timeout) errors.push(`Port scan partial for ${ipId}`);
          const open = await this.prisma.assetPortService.findMany({ where: { tenantId: asset.tenantId, assetId: ipId, status: PortDiscoveryStatus.OPEN, lastSeenAt: { gte: scanStartedAt } } });
          observed = { ...observed, ports: [...observed.ports, ...open.map(item => ({ assetId: ipId, protocol: item.protocol, port: item.port, service: item.service, product: item.product, version: item.version }))] };
          if (!summary.failed && !summary.timeout) {
            const closedKeys = summary.results.filter(result => result.status === 'closed').map(result => `${result.protocol}:${result.port}`);
            if (closedKeys.length) await this.prisma.assetFinding.updateMany({ where: { tenantId: asset.tenantId, assetId: ipId, source: 'PORT_DISCOVERY', sourceKey: { in: closedKeys }, status: { in: ['OPEN', 'IN_PROGRESS'] } }, data: { status: 'RESOLVED' } });
            await this.correlations.refresh(user, ipId, requested, run.id);
            const hits = await this.prisma.assetVulnerabilityCorrelation.findMany({ where: { tenantId: asset.tenantId, assetId: ipId, confidence: 'HIGH', status: 'ACTIVE' }, include: { vulnerability: { select: { cveId: true } } } });
            observed = { ...observed, vulnerabilities: [...observed.vulnerabilities, ...hits.map(item => ({ assetId: ipId, serviceId: item.serviceId, vulnerabilityId: item.vulnerabilityId, cveId: item.vulnerability.cveId }))] };
          }
        } catch (error) {
          failed += 1; errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      const complete = failed === 0 && scanPorts;
      const changes = detectChanges(before, observed, complete);
      const merged = complete || !before ? observed : {
        assets: [...new Map([...before.assets, ...observed.assets].map(item => [item.id, item])).values()],
        dns: [...new Map([...before.dns, ...observed.dns].map(item => [`${item.source}:${item.target}`, item])).values()],
        ports: [...new Map([...before.ports, ...observed.ports].map(item => [`${item.assetId}:${item.protocol}:${item.port}`, item])).values()],
        vulnerabilities: [...new Map([...before.vulnerabilities, ...observed.vulnerabilities].map(item => [`${item.serviceId}:${item.vulnerabilityId}`, item])).values()],
      };
      await this.prisma.$transaction(async tx => {
        await tx.asmExposureChange.createMany({ data: changes.map(change => ({ tenantId: asset.tenantId, assetId, runId: run.id, ...change })), skipDuplicates: true });
        await tx.asmDiscoveryRun.update({ where: { id: run.id }, data: { status: complete ? 'COMPLETED' : 'PARTIAL', completedAt: new Date(), discovered, created, updated, failed, error: errors.join('; ') || null, providers: [...providers], snapshot: JSON.parse(JSON.stringify(merged)) } });
        const evaluatedAt = new Date();
        for (const postureAssetId of new Set([asset.id, ...ipIds])) {
          await this.riskPosture.capture(tx, asset.tenantId, postureAssetId, run.id, evaluatedAt);
        }
      }, { timeout: 30_000 });
      const actionableChanges = await this.prisma.asmExposureChange.findMany({ where: { runId: run.id, tenantId: asset.tenantId, type: { in: [AsmChangeType.PORT_OPENED, AsmChangeType.VULNERABILITY_CONFIRMED] } } });
      for (const change of actionableChanges) {
        const sourceKey = change.type === AsmChangeType.PORT_OPENED ? `port:${change.entityKey}` : `vulnerability:${change.entityKey}`;
        await this.prisma.alert.updateMany({ where: { tenantId: asset.tenantId, source: 'ASM', sourceKey, changeEventId: null }, data: { changeEventId: change.id } });
      }
      return { ...await this.detail(user, assetId, run.id, requested), legacySummary };
    } catch (error) {
      if (runId) await this.prisma.asmDiscoveryRun.update({ where: { id: runId }, data: { status: 'FAILED', completedAt: new Date(), error: error instanceof Error ? error.message : String(error) } });
      throw error;
    } finally {
      const schedule = await this.prisma.asmDiscoverySchedule.findUnique({ where: { assetId } });
      if (schedule) await this.prisma.asmDiscoverySchedule.updateMany({ where: { id: schedule.id, lockedUntil: leaseUntil }, data: { lockedUntil: null, lastRunAt: new Date(), nextRunAt: schedule.enabled ? new Date(Date.now() + schedule.intervalMinutes * 60_000) : null } });
    }
  }
}
