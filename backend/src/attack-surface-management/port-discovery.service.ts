import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetType, NetworkProtocol, PortDiscoveryStatus } from '@prisma/client';
import { isIP } from 'node:net';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { PortDiscoveryClient, type PortProbeOutcome, type PortProbeResult } from './port-discovery.client';

const DEFAULT_TCP_PORTS = [
  21, 22, 25, 53, 80, 110, 143, 443, 445, 465, 587, 993, 995,
  1433, 1521, 2049, 3306, 3389, 5432, 5672, 6379, 8080, 8443, 9200, 27017,
] as const;
const CONNECTION_TIMEOUT_MS = 1_000;
const PROBE_CONCURRENCY = 5;
const SERVICE_NAMES: Readonly<Record<number, string>> = {
  21: 'ftp', 22: 'ssh', 25: 'smtp', 53: 'dns', 80: 'http', 110: 'pop3',
  143: 'imap', 443: 'https', 445: 'microsoft-ds', 465: 'smtps', 587: 'submission',
  993: 'imaps', 995: 'pop3s', 1433: 'ms-sql', 1521: 'oracle', 2049: 'nfs',
  3306: 'mysql', 3389: 'rdp', 5432: 'postgresql', 5672: 'amqp', 6379: 'redis',
  8080: 'http-alt', 8443: 'https-alt', 9200: 'elasticsearch', 27017: 'mongodb',
};

function persistenceStatus(outcome: PortProbeOutcome): PortDiscoveryStatus {
  switch (outcome) {
    case 'open':
      return PortDiscoveryStatus.OPEN;
    case 'closed':
      return PortDiscoveryStatus.CLOSED;
    case 'timeout':
      return PortDiscoveryStatus.FILTERED;
    case 'failed':
      return PortDiscoveryStatus.UNKNOWN;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

export type PortDiscoveryResult = {
  readonly port: number;
  readonly protocol: 'TCP';
  readonly service: string | null;
  readonly status: PortProbeOutcome;
  readonly error?: string;
};

export type PortDiscoverySummary = {
  readonly target: string;
  readonly scanned: number;
  readonly open: number;
  readonly closed: number;
  readonly timeout: number;
  readonly failed: number;
  readonly results: readonly PortDiscoveryResult[];
};

@Injectable()
export class PortDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PortDiscoveryClient,
  ) {}

  async discover(
    user: AuthUser,
    assetId: string,
    requestedTenantId?: string,
    ports: readonly number[] = DEFAULT_TCP_PORTS,
  ): Promise<PortDiscoverySummary> {
    const tenantId = await this.resolveTenant(user, requestedTenantId);
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId } });
    if (!asset) throw new NotFoundException('Asset tidak ditemukan');
    if (asset.type !== AssetType.IP_ADDRESS) {
      throw new BadRequestException('Port discovery hanya dapat dijalankan pada asset IP_ADDRESS');
    }
    const target = asset.value.trim();
    if (isIP(target) === 0) throw new BadRequestException('Nilai asset bukan alamat IPv4 atau IPv6 yang valid');

    await this.audit(user, tenantId, 'ASSET_PORT_DISCOVERY_STARTED', assetId, {
      target, scanned: ports.length,
    });

    const probes: PortProbeResult[] = [];
    for (let index = 0; index < ports.length; index += PROBE_CONCURRENCY) {
      const batch = ports.slice(index, index + PROBE_CONCURRENCY);
      probes.push(...await Promise.all(batch.map(
        (port) => this.client.probe(target, port, CONNECTION_TIMEOUT_MS),
      )));
    }

    const results: PortDiscoveryResult[] = [];
    for (const probe of probes) {
      const observedAt = new Date();
      const service = SERVICE_NAMES[probe.port] ?? null;
      const status = persistenceStatus(probe.outcome);
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.assetPortService.upsert({
            where: { tenantId_assetId_protocol_port: {
              tenantId, assetId, protocol: NetworkProtocol.TCP, port: probe.port,
            } },
            create: {
              tenantId, assetId, port: probe.port, protocol: NetworkProtocol.TCP,
              service, status,
              firstSeenAt: observedAt, lastSeenAt: observedAt,
            },
            update: { service, status, lastSeenAt: observedAt },
          });
          await tx.auditLog.create({
            data: {
              userId: user.sub, tenantId, action: 'ASSET_PORT_SERVICE_RECORDED',
              metadata: { assetId, port: probe.port, protocol: NetworkProtocol.TCP, status },
            },
          });
        });
        results.push(this.result(probe));
      } catch (error) {
        results.push({
          port: probe.port,
          protocol: 'TCP',
          service,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const summary = this.summary(target, results);
    await this.audit(user, tenantId, 'ASSET_PORT_DISCOVERY_COMPLETED', assetId, summary);
    if (summary.failed > 0) {
      await this.audit(user, tenantId, 'ASSET_PORT_DISCOVERY_FAILED', assetId, summary);
    }
    return summary;
  }

  private result(probe: PortProbeResult): PortDiscoveryResult {
    return {
      port: probe.port,
      protocol: 'TCP',
      service: SERVICE_NAMES[probe.port] ?? null,
      status: probe.outcome,
      ...(probe.error ? { error: probe.error } : {}),
    };
  }

  private summary(target: string, results: readonly PortDiscoveryResult[]): PortDiscoverySummary {
    const count = (status: PortProbeOutcome): number => results.filter((result) => result.status === status).length;
    return {
      target,
      scanned: results.length,
      open: count('open'),
      closed: count('closed'),
      timeout: count('timeout'),
      failed: count('failed'),
      results,
    };
  }

  private async resolveTenant(user: AuthUser, requestedTenantId?: string): Promise<string> {
    if (user.role === 'SUPER_ADMIN') {
      if (!requestedTenantId) throw new BadRequestException('Tenant wajib');
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: requestedTenantId }, select: { id: true },
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
    metadata: Readonly<Record<string, unknown>>,
  ) {
    return this.prisma.auditLog.create({
      data: { userId: user.sub, tenantId, action, metadata: { assetId, ...metadata } },
    });
  }
}
