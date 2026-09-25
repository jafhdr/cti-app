import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  AssetCriticality,
  AssetStatus,
  AssetType,
  NetworkProtocol,
  PortDiscoveryStatus,
  type Asset,
  type AssetPortService,
  type AuditLog,
} from '@prisma/client';
import { ROLES_KEY } from '../auth/roles.decorator';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { PortDiscoveryClient, type PortProbeResult } from './port-discovery.client';
import { PortDiscoveryService } from './port-discovery.service';
import { PortServicesController } from './port-services.controller';

const admin: AuthUser = { sub: 'admin-1', role: 'ADMIN', tenantId: 'tenant-1' };
const observedAt = new Date('2026-09-24T12:00:00.000Z');

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'ip-1', tenantId: 'tenant-1', name: 'test-ip', type: AssetType.IP_ADDRESS,
    value: '192.0.2.10', status: AssetStatus.ACTIVE, criticality: AssetCriticality.MEDIUM,
    description: null, owner: null, firstSeenAt: observedAt, lastSeenAt: observedAt,
    createdAt: observedAt, updatedAt: observedAt, ...overrides,
  };
}

function storedPort(port: number): AssetPortService {
  return {
    id: `port-${port}`, tenantId: 'tenant-1', assetId: 'ip-1', port,
    protocol: NetworkProtocol.TCP, service: port === 443 ? 'https' : null,
    status: PortDiscoveryStatus.OPEN, firstSeenAt: observedAt, lastSeenAt: observedAt,
    createdAt: observedAt, updatedAt: observedAt,
  };
}

function audit(action: string): AuditLog {
  return { id: `audit-${action}`, userId: admin.sub, tenantId: 'tenant-1', action, metadata: null, createdAt: observedAt };
}

function probe(port: number, outcome: PortProbeResult['outcome']): PortProbeResult {
  return { port, outcome };
}

describe('PortDiscoveryService', () => {
  let service: PortDiscoveryService;
  let prisma: PrismaService;
  let client: PortDiscoveryClient;

  beforeEach(async () => {
    const transactionClient = {
      assetPortService: { upsert: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortDiscoveryService,
        {
          provide: PrismaService,
          useValue: {
            asset: { findFirst: jest.fn() },
            assetPortService: transactionClient.assetPortService,
            tenant: { findUnique: jest.fn() },
            auditLog: transactionClient.auditLog,
            $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) => callback(transactionClient)),
          },
        },
        { provide: PortDiscoveryClient, useValue: { probe: jest.fn() } },
      ],
    }).compile();
    service = module.get(PortDiscoveryService);
    prisma = module.get(PrismaService);
    client = module.get(PortDiscoveryClient);
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValue(asset());
    jest.spyOn(prisma.assetPortService, 'upsert').mockResolvedValue(storedPort(443));
    jest.spyOn(prisma.auditLog, 'create').mockResolvedValue(audit('ASSET_PORT_DISCOVERY_STARTED'));
    jest.spyOn(client, 'probe').mockImplementation(async (_target, port) => probe(port, 'closed'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(['192.0.2.10', '2001:db8::10'])('scans a stored valid IP target: %s', async (value) => {
    // Given
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValue(asset({ value }));

    // When
    const result = await service.discover(admin, 'ip-1');

    // Then
    expect(result.target).toBe(value);
    expect(client.probe).toHaveBeenCalledWith(value, expect.any(Number), expect.any(Number));
  });

  it.each([AssetType.DOMAIN, AssetType.SUBDOMAIN])('rejects a %s asset', async (type) => {
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValue(asset({ type }));

    await expect(service.discover(admin, 'ip-1')).rejects.toThrow(BadRequestException);
    expect(client.probe).not.toHaveBeenCalled();
  });

  it('rejects an invalid stored IP value', async () => {
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValue(asset({ value: 'localhost' }));

    await expect(service.discover(admin, 'ip-1')).rejects.toThrow(BadRequestException);
    expect(client.probe).not.toHaveBeenCalled();
  });

  it('returns 404 without probing a cross-tenant asset', async () => {
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValue(null);

    await expect(service.discover(admin, 'foreign-ip')).rejects.toThrow(NotFoundException);
    expect(prisma.asset.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign-ip', tenantId: 'tenant-1' } });
    expect(client.probe).not.toHaveBeenCalled();
  });

  it.each([
    ['open', { open: 1, closed: 0, timeout: 0, failed: 0 }],
    ['closed', { open: 0, closed: 1, timeout: 0, failed: 0 }],
    ['timeout', { open: 0, closed: 0, timeout: 1, failed: 0 }],
    ['failed', { open: 0, closed: 0, timeout: 0, failed: 1 }],
  ] satisfies readonly (readonly [PortProbeResult['outcome'], Readonly<Record<'open' | 'closed' | 'timeout' | 'failed', number>>])[])(
    'summarizes a %s probe without failing the discovery',
    async (outcome, expected) => {
      jest.spyOn(client, 'probe').mockImplementation(async (_target, port) => probe(port, outcome));

      const result = await service.discover(admin, 'ip-1', undefined, [443]);

      expect(result).toMatchObject({ target: '192.0.2.10', scanned: 1, ...expected });
      expect(result.results).toHaveLength(1);
    },
  );

  it.each([
    ['open', PortDiscoveryStatus.OPEN],
    ['closed', PortDiscoveryStatus.CLOSED],
    ['timeout', PortDiscoveryStatus.FILTERED],
    ['failed', PortDiscoveryStatus.UNKNOWN],
  ] satisfies readonly (readonly [PortProbeResult['outcome'], PortDiscoveryStatus])[])(
    'persists a %s TCP outcome as %s',
    async (outcome, status) => {
      jest.spyOn(client, 'probe').mockResolvedValue(probe(443, outcome));

      const result = await service.discover(admin, 'ip-1', undefined, [443]);

      expect(prisma.assetPortService.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { tenantId_assetId_protocol_port: {
          tenantId: 'tenant-1', assetId: 'ip-1', protocol: NetworkProtocol.TCP, port: 443,
        } },
        create: expect.objectContaining({ service: 'https', status }),
        update: expect.objectContaining({ service: 'https', status }),
      }));
      expect(result.results[0]).toMatchObject({ port: 443, protocol: 'TCP', service: 'https', status: outcome });
    },
  );

  it.each([
    ['closed', PortDiscoveryStatus.CLOSED],
    ['timeout', PortDiscoveryStatus.FILTERED],
    ['failed', PortDiscoveryStatus.UNKNOWN],
  ] satisfies readonly (readonly [PortProbeResult['outcome'], PortDiscoveryStatus])[])(
    'updates the same OPEN record to %s without changing firstSeenAt',
    async (nextOutcome, nextStatus) => {
      // Given
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
      jest.spyOn(client, 'probe')
        .mockResolvedValueOnce(probe(443, 'open'))
        .mockResolvedValueOnce(probe(443, nextOutcome));

      // When
      await service.discover(admin, 'ip-1', undefined, [443]);
      jest.setSystemTime(new Date('2026-09-24T12:05:00.000Z'));
      await service.discover(admin, 'ip-1', undefined, [443]);

      // Then
      const calls = jest.mocked(prisma.assetPortService.upsert).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0]?.[0].where).toEqual(calls[1]?.[0].where);
      expect(calls[0]?.[0].create.firstSeenAt).toEqual(new Date('2026-09-24T12:00:00.000Z'));
      expect(calls[1]?.[0].update).not.toHaveProperty('firstSeenAt');
      expect(calls[1]?.[0].update).toMatchObject({
        status: nextStatus,
        lastSeenAt: new Date('2026-09-24T12:05:00.000Z'),
      });
    },
  );

  it('uses upsert and preserves firstSeenAt during rediscovery', async () => {
    jest.spyOn(client, 'probe').mockResolvedValue(probe(22, 'open'));

    await service.discover(admin, 'ip-1', undefined, [22]);
    await service.discover(admin, 'ip-1', undefined, [22]);

    expect(prisma.assetPortService.upsert).toHaveBeenCalledTimes(2);
    const call = jest.mocked(prisma.assetPortService.upsert).mock.calls[0]?.[0];
    expect(call?.create.firstSeenAt).toBeInstanceOf(Date);
    expect(call?.create.lastSeenAt).toBe(call?.create.firstSeenAt);
    expect(call?.update).not.toHaveProperty('firstSeenAt');
    expect(call?.update.lastSeenAt).toBeInstanceOf(Date);
  });

  it('limits concurrent TCP probes', async () => {
    let active = 0;
    let peak = 0;
    jest.spyOn(client, 'probe').mockImplementation(async (_target, port) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return probe(port, 'closed');
    });

    await service.discover(admin, 'ip-1', undefined, Array.from({ length: 20 }, (_, index) => 1000 + index));

    expect(peak).toBeLessThanOrEqual(5);
  });

  it('writes STARTED and COMPLETED audit events with the summary', async () => {
    jest.spyOn(client, 'probe').mockResolvedValue(probe(443, 'open'));

    await service.discover(admin, 'ip-1', undefined, [443]);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'ASSET_PORT_DISCOVERY_STARTED', tenantId: 'tenant-1',
    }) });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'ASSET_PORT_DISCOVERY_COMPLETED',
      metadata: expect.objectContaining({ assetId: 'ip-1', target: '192.0.2.10', scanned: 1, open: 1 }),
    }) });
  });

  it('audits each persisted discovery result with the authenticated actor and tenant', async () => {
    jest.spyOn(client, 'probe').mockImplementation(async (_target, port) => probe(port, 'open'));

    await service.discover(admin, 'ip-1', 'tenant-foreign', [22, 443]);

    const recorded = jest.mocked(prisma.auditLog.create).mock.calls
      .map(([input]) => input.data)
      .filter((data) => data.action === 'ASSET_PORT_SERVICE_RECORDED');
    expect(recorded).toEqual([
      expect.objectContaining({ userId: 'admin-1', tenantId: 'tenant-1', metadata: { assetId: 'ip-1', port: 22, protocol: 'TCP', status: 'OPEN' } }),
      expect.objectContaining({ userId: 'admin-1', tenantId: 'tenant-1', metadata: { assetId: 'ip-1', port: 443, protocol: 'TCP', status: 'OPEN' } }),
    ]);
  });

  it('rolls back the port record when its audit fails', async () => {
    // Given: a transaction fake stages the port record until the callback succeeds.
    let stored = false;
    jest.mocked(prisma.auditLog.create)
      .mockResolvedValueOnce(audit('ASSET_PORT_DISCOVERY_STARTED'))
      .mockRejectedValueOnce(new Error('audit unavailable'));
    const transaction = jest.mocked(prisma.$transaction);
    transaction.mockImplementation(async (callback) => {
      const previous = stored;
      try {
        const result = await callback(prisma);
        stored = true;
        return result;
      } catch (error) {
        stored = previous;
        throw error;
      }
    });

    // When
    const result = await service.discover(admin, 'ip-1', undefined, [443]);

    // Then
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ failed: 1, open: 0 });
    expect(stored).toBe(false);
  });

  it('writes FAILED when discovery cannot complete', async () => {
    jest.spyOn(client, 'probe').mockResolvedValue(probe(443, 'open'));
    jest.spyOn(prisma.assetPortService, 'upsert').mockRejectedValue(new Error('database unavailable'));

    await expect(service.discover(admin, 'ip-1', undefined, [443])).resolves.toMatchObject({ failed: 1, open: 0 });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'ASSET_PORT_DISCOVERY_FAILED',
    }) });
  });
});

describe('PortServicesController discovery authorization', () => {
  it('allows only ADMIN and SUPER_ADMIN roles', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PortServicesController.prototype.discover)).toEqual([
      'SUPER_ADMIN', 'ADMIN',
    ]);
  });

  it('retains authentication, role, and module-access guards', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PortServicesController)).toEqual([
      AuthGuard, RolesGuard, ModuleAccessGuard,
    ]);
  });
});
