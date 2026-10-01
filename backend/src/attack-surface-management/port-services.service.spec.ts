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
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { PortServicesController } from './port-services.controller';
import { PortServicesService } from './port-services.service';

const admin: AuthUser = { sub: 'admin-1', role: 'ADMIN', tenantId: 'tenant-1' };
const observedAt = new Date('2026-09-24T12:00:00.000Z');

function ipAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'ip-1', tenantId: 'tenant-1', name: '192.0.2.1', type: AssetType.IP_ADDRESS,
    value: '192.0.2.1', status: AssetStatus.ACTIVE, criticality: AssetCriticality.MEDIUM,
    description: null, owner: null, firstSeenAt: observedAt, lastSeenAt: observedAt,
    createdAt: observedAt, updatedAt: observedAt, ...overrides,
  };
}

function portService(overrides: Partial<AssetPortService> = {}): AssetPortService {
  return {
    id: 'port-1', tenantId: 'tenant-1', assetId: 'ip-1', port: 443,
    protocol: NetworkProtocol.TCP, service: 'https', product: null, version: null, banner: null, source: null, status: PortDiscoveryStatus.OPEN,
    firstSeenAt: observedAt, lastSeenAt: observedAt, createdAt: observedAt,
    updatedAt: observedAt, ...overrides,
  };
}

function auditLog(): AuditLog {
  return { id: 'audit-1', userId: admin.sub, tenantId: 'tenant-1', action: 'ASSET_PORT_SERVICE_RECORDED', metadata: null, createdAt: observedAt };
}

describe('PortServicesService', () => {
  let service: PortServicesService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortServicesService,
        {
          provide: PrismaService,
          useValue: {
            asset: { findFirst: jest.fn() },
            assetPortService: { findMany: jest.fn(), upsert: jest.fn() },
            tenant: { findUnique: jest.fn() },
            auditLog: { create: jest.fn() },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();
    service = module.get(PortServicesService);
    prisma = module.get(PrismaService);
    jest.spyOn(prisma, '$transaction').mockResolvedValue([portService(), auditLog()]);
  });

  it('records a port/service relation on an IP_ADDRESS asset', async () => {
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValue(ipAsset());
    jest.spyOn(prisma.assetPortService, 'upsert').mockResolvedValue(portService());
    jest.spyOn(prisma.auditLog, 'create').mockResolvedValue(auditLog());

    const result = await service.record(admin, 'ip-1', {
      port: 443, protocol: NetworkProtocol.TCP, service: 'https', status: PortDiscoveryStatus.OPEN,
    });

    expect(result.assetId).toBe('ip-1');
    expect(prisma.assetPortService.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ tenantId: 'tenant-1', assetId: 'ip-1' }),
    }));
  });

  it('scopes asset lookup and list query to the authenticated tenant', async () => {
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValue(ipAsset());
    jest.spyOn(prisma.assetPortService, 'findMany').mockResolvedValue([portService()]);

    await service.list(admin, 'ip-1', 'tenant-other');

    expect(prisma.asset.findFirst).toHaveBeenCalledWith({ where: { id: 'ip-1', tenantId: 'tenant-1' } });
    expect(prisma.assetPortService.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', assetId: 'ip-1' },
    }));
  });

  it('prevents duplicate rows through the tenant/asset/protocol/port upsert key', async () => {
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValue(ipAsset());
    jest.spyOn(prisma.assetPortService, 'upsert').mockResolvedValue(portService());
    jest.spyOn(prisma.auditLog, 'create').mockResolvedValue(auditLog());
    const input = { port: 443, protocol: NetworkProtocol.TCP, service: 'https', status: PortDiscoveryStatus.OPEN };

    await service.record(admin, 'ip-1', input);
    await service.record(admin, 'ip-1', input);

    expect(prisma.assetPortService.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.assetPortService.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { tenantId_assetId_protocol_port: { tenantId: 'tenant-1', assetId: 'ip-1', protocol: NetworkProtocol.TCP, port: 443 } },
    }));
  });

  it('sets both timestamps on create but only lastSeenAt on rediscovery', async () => {
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValue(ipAsset());
    jest.spyOn(prisma.assetPortService, 'upsert').mockResolvedValue(portService());
    jest.spyOn(prisma.auditLog, 'create').mockResolvedValue(auditLog());

    await service.record(admin, 'ip-1', {
      port: 53, protocol: NetworkProtocol.UDP, service: 'dns', status: PortDiscoveryStatus.OPEN,
    });

    const call = jest.mocked(prisma.assetPortService.upsert).mock.calls[0]?.[0];
    expect(call?.create.firstSeenAt).toBeInstanceOf(Date);
    expect(call?.create.lastSeenAt).toBe(call?.create.firstSeenAt);
    expect(call?.update).not.toHaveProperty('firstSeenAt');
    expect(call?.update.lastSeenAt).toBeInstanceOf(Date);
  });

  it('rejects a non-IP asset', async () => {
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValue(ipAsset({ type: AssetType.DOMAIN }));

    await expect(service.record(admin, 'ip-1', {
      port: 80, protocol: NetworkProtocol.TCP, status: PortDiscoveryStatus.OPEN,
    })).rejects.toThrow(BadRequestException);
  });

  it('does not reveal an asset from another tenant', async () => {
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValue(null);

    await expect(service.list(admin, 'foreign-ip')).rejects.toThrow(NotFoundException);
  });

  it('writes an audit event with the resolved tenant and observation metadata', async () => {
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValue(ipAsset());
    jest.spyOn(prisma.assetPortService, 'upsert').mockResolvedValue(portService());
    jest.spyOn(prisma.auditLog, 'create').mockResolvedValue(auditLog());

    await service.record(admin, 'ip-1', {
      port: 443, protocol: NetworkProtocol.TCP, service: 'https', status: PortDiscoveryStatus.OPEN,
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: 'admin-1', tenantId: 'tenant-1', action: 'ASSET_PORT_SERVICE_RECORDED',
      metadata: expect.objectContaining({ assetId: 'ip-1', port: 443 }),
    }) });
    expect(prisma.$transaction).toHaveBeenCalledWith([
      expect.anything(),
      expect.anything(),
    ]);
  });
});

describe('PortServicesController authorization', () => {
  it('allows read access to USER but restricts record access to ADMIN and SUPER_ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PortServicesController.prototype.list)).toEqual(['SUPER_ADMIN', 'ADMIN', 'USER']);
    expect(Reflect.getMetadata(ROLES_KEY, PortServicesController.prototype.record)).toEqual(['SUPER_ADMIN', 'ADMIN']);
  });
});
