import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AssetCriticality, AssetStatus, AssetType, Prisma, type Asset } from '@prisma/client';
import { DiscoveryClient, type DnsResolutionResult } from './discovery.client';
import { DiscoveryService } from './discovery.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';

const admin: AuthUser = { sub: 'user-1', role: 'ADMIN', tenantId: 'tenant-1' };
const observedAt = new Date('2026-09-23T05:00:00.000Z');

function asset(type: AssetType = AssetType.DOMAIN, tenantId = 'tenant-1'): Asset {
  return {
    id: 'asset-1', tenantId, name: 'api.example.com', type, value: 'api.example.com',
    status: AssetStatus.ACTIVE, criticality: AssetCriticality.MEDIUM,
    description: null, owner: null, firstSeenAt: observedAt, lastSeenAt: observedAt,
    createdAt: observedAt, updatedAt: observedAt,
  };
}

function resolution(overrides: Partial<DnsResolutionResult> = {}): DnsResolutionResult {
  return {
    provider: 'CLOUDFLARE_DOH', hostname: 'api.example.com',
    ipv4: [], ipv6: [], cnames: [], errors: [], ...overrides,
  };
}

describe('DiscoveryService DNS discovery', () => {
  let service: DiscoveryService;
  let prisma: PrismaService;
  let client: DiscoveryClient;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoveryService,
        {
          provide: PrismaService,
          useValue: {
            asset: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
            tenant: { findUnique: jest.fn() }, auditLog: { create: jest.fn() },
          },
        },
        {
          provide: DiscoveryClient,
          useValue: {
            discoverViaDns: jest.fn(), discoverViaCertTransparency: jest.fn(),
            resolveDns: jest.fn(), isSubdomainOf: jest.fn(), isValidHostname: jest.fn(),
          },
        },
      ],
    }).compile();
    service = module.get(DiscoveryService);
    prisma = module.get(PrismaService);
    client = module.get(DiscoveryClient);
    jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({
      id: 'audit-1', userId: admin.sub, tenantId: 'tenant-1', action: 'DISCOVERY',
      metadata: null, createdAt: observedAt,
    });
    jest.spyOn(client, 'discoverViaDns').mockResolvedValue({ provider: 'DNS', hostnames: [] });
    jest.spyOn(client, 'discoverViaCertTransparency').mockResolvedValue({ provider: 'CT', hostnames: [] });
    jest.spyOn(client, 'resolveDns').mockResolvedValue(resolution());
    jest.spyOn(client, 'isValidHostname').mockReturnValue(true);
    jest.spyOn(client, 'isSubdomainOf').mockReturnValue(true);
  });

  it.each([AssetType.DOMAIN, AssetType.SUBDOMAIN])('resolves a valid %s asset', async (type) => {
    // Given
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(asset(type));

    // When
    await service.runDiscovery(admin, 'asset-1');

    // Then
    expect(client.resolveDns).toHaveBeenCalledWith('api.example.com');
  });

  it('creates tenant-scoped IP assets for unique A and AAAA answers', async () => {
    // Given
    jest.spyOn(prisma.asset, 'findFirst')
      .mockResolvedValueOnce(asset(AssetType.SUBDOMAIN))
      .mockResolvedValue(null);
    jest.spyOn(client, 'resolveDns').mockResolvedValue(resolution({
      ipv4: ['203.0.113.10', '203.0.113.10'], ipv6: ['2001:db8::10'],
    }));
    const createSpy = jest.spyOn(prisma.asset, 'create').mockResolvedValue(asset(AssetType.IP_ADDRESS));

    // When
    const result = await service.runDiscovery(admin, 'asset-1');

    // Then
    expect(prisma.asset.create).toHaveBeenCalledTimes(2);
    expect(prisma.asset.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      tenantId: 'tenant-1', type: AssetType.IP_ADDRESS, value: '203.0.113.10',
    }) });
    expect(result.created).toBe(2);
  });

  it('updates an existing IP without changing firstSeenAt', async () => {
    // Given
    const firstSeenAt = new Date('2025-01-01T00:00:00.000Z');
    jest.spyOn(prisma.asset, 'findFirst')
      .mockResolvedValueOnce(asset(AssetType.SUBDOMAIN))
      .mockResolvedValueOnce({ ...asset(AssetType.IP_ADDRESS), id: 'ip-1', firstSeenAt });
    jest.spyOn(client, 'resolveDns').mockResolvedValue(resolution({ ipv4: ['203.0.113.10'] }));
    jest.spyOn(prisma.asset, 'update').mockResolvedValue(asset(AssetType.IP_ADDRESS));

    // When
    const result = await service.runDiscovery(admin, 'asset-1');

    // Then
    expect(prisma.asset.create).not.toHaveBeenCalled();
    expect(prisma.asset.update).toHaveBeenCalledWith({
      where: { id: 'ip-1' }, data: { lastSeenAt: expect.any(Date) },
    });
    expect(prisma.asset.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ firstSeenAt: expect.anything() }),
    }));
    expect(result.updated).toBe(1);
  });

  it('records an in-scope CNAME as a subdomain asset', async () => {
    // Given
    jest.spyOn(prisma.asset, 'findFirst')
      .mockResolvedValueOnce(asset(AssetType.SUBDOMAIN))
      .mockResolvedValueOnce(null);
    jest.spyOn(client, 'resolveDns').mockResolvedValue(resolution({ cnames: ['edge.example.com'] }));
    jest.spyOn(prisma.asset, 'create').mockResolvedValue(asset(AssetType.SUBDOMAIN));

    // When
    await service.runDiscovery(admin, 'asset-1');

    // Then
    expect(prisma.asset.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      type: AssetType.SUBDOMAIN, value: 'edge.example.com',
    }) });
  });

  it('rejects a CNAME target outside the requested domain boundary', async () => {
    // Given
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(asset(AssetType.DOMAIN));
    jest.spyOn(client, 'resolveDns').mockResolvedValue(resolution({ cnames: ['vendor.example.net'] }));
    jest.spyOn(client, 'isSubdomainOf').mockReturnValue(false);

    // When
    const result = await service.runDiscovery(admin, 'asset-1');

    // Then
    expect(result.discovered).toBe(0);
    expect(prisma.asset.create).not.toHaveBeenCalled();
  });

  it('uses the registrable domain when validating multi-label public suffixes', async () => {
    // Given
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce({
      ...asset(AssetType.DOMAIN), name: 'example.co.uk', value: 'example.co.uk',
    });
    jest.spyOn(client, 'resolveDns').mockResolvedValue(resolution({
      hostname: 'example.co.uk', cnames: ['evil.co.uk'],
    }));
    jest.spyOn(client, 'isSubdomainOf').mockImplementation(
      (hostname, domain) => hostname !== domain && hostname.endsWith(`.${domain}`),
    );

    // When
    const result = await service.runDiscovery(admin, 'asset-1');

    // Then
    expect(result.discovered).toBe(0);
    expect(client.isSubdomainOf).toHaveBeenCalledWith('evil.co.uk', 'example.co.uk');
  });

  it('preserves an existing analyst-managed status during rediscovery', async () => {
    // Given
    jest.spyOn(prisma.asset, 'findFirst')
      .mockResolvedValueOnce(asset(AssetType.SUBDOMAIN))
      .mockResolvedValueOnce(asset(AssetType.IP_ADDRESS));
    jest.spyOn(client, 'resolveDns').mockResolvedValue(resolution({ ipv4: ['203.0.113.10'] }));
    jest.spyOn(prisma.asset, 'update').mockResolvedValue(asset(AssetType.IP_ADDRESS));

    // When
    await service.runDiscovery(admin, 'asset-1');

    // Then
    expect(prisma.asset.update).toHaveBeenCalledWith({
      where: { id: 'asset-1' }, data: { lastSeenAt: expect.any(Date) },
    });
  });

  it('updates lastSeenAt after a concurrent create loses the uniqueness race', async () => {
    // Given
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002', clientVersion: '6.14.0',
    });
    jest.spyOn(prisma.asset, 'findFirst')
      .mockResolvedValueOnce(asset(AssetType.SUBDOMAIN))
      .mockResolvedValueOnce(null);
    jest.spyOn(client, 'resolveDns').mockResolvedValue(resolution({ ipv4: ['203.0.113.10'] }));
    jest.spyOn(prisma.asset, 'create').mockRejectedValueOnce(duplicate);
    jest.spyOn(prisma.asset, 'update').mockResolvedValue(asset(AssetType.IP_ADDRESS));

    // When
    const result = await service.runDiscovery(admin, 'asset-1');

    // Then
    expect(result.updated).toBe(1);
    expect(prisma.asset.update).toHaveBeenCalledWith({
      where: { tenantId_type_value: {
        tenantId: 'tenant-1', type: AssetType.IP_ADDRESS, value: '203.0.113.10',
      } },
      data: { lastSeenAt: expect.any(Date) },
    });
  });

  it('bounds DNS target concurrency and total persisted observations', async () => {
    // Given
    const hostnames = Array.from({ length: 100 }, (_, index) => `host-${index}.example.com`);
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(asset(AssetType.DOMAIN)).mockResolvedValue(null);
    jest.spyOn(client, 'discoverViaDns').mockResolvedValue({ provider: 'DNS', hostnames });
    let active = 0;
    let peak = 0;
    jest.spyOn(client, 'resolveDns').mockImplementation(async (hostname) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return resolution({ hostname, ipv4: Array.from({ length: 100 }, (_, index) => `203.0.${index}.${index}`) });
    });
    const createSpy = jest.spyOn(prisma.asset, 'create').mockResolvedValue(asset(AssetType.IP_ADDRESS));

    // When
    await service.runDiscovery(admin, 'asset-1');

    // Then
    expect(client.resolveDns).toHaveBeenCalledTimes(25);
    expect(peak).toBeLessThanOrEqual(5);
    expect(createSpy.mock.calls.length).toBeLessThanOrEqual(500);
  });

  it('does not expose or mutate a cross-tenant asset', async () => {
    // Given
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(null);

    // When / Then
    await expect(service.runDiscovery(admin, 'other-tenant-asset')).rejects.toThrow(NotFoundException);
    expect(client.resolveDns).not.toHaveBeenCalled();
  });

  it('rejects asset types other than DOMAIN and SUBDOMAIN', async () => {
    // Given
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(asset(AssetType.IP_ADDRESS));

    // When / Then
    await expect(service.runDiscovery(admin, 'asset-1')).rejects.toThrow(BadRequestException);
  });

  it('returns provider errors and audits a failed DNS resolution', async () => {
    // Given
    jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(asset(AssetType.SUBDOMAIN));
    jest.spyOn(client, 'resolveDns').mockRejectedValue(new Error('DNS unavailable'));

    // When
    const result = await service.runDiscovery(admin, 'asset-1');

    // Then
    expect(result.failed).toBe(1);
    expect(result.errors).toContain('DNS unavailable');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      tenantId: 'tenant-1', action: 'ASSET_DISCOVERY_FAILED',
    }) });
  });

  it('writes completion audit counts for DNS discoveries', async () => {
    // Given
    jest.spyOn(prisma.asset, 'findFirst')
      .mockResolvedValueOnce(asset(AssetType.SUBDOMAIN))
      .mockResolvedValueOnce(null);
    jest.spyOn(client, 'resolveDns').mockResolvedValue(resolution({ ipv4: ['203.0.113.10'] }));
    jest.spyOn(prisma.asset, 'create').mockResolvedValue(asset(AssetType.IP_ADDRESS));

    // When
    await service.runDiscovery(admin, 'asset-1');

    // Then
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      tenantId: 'tenant-1', action: 'ASSET_DISCOVERY_COMPLETED',
      metadata: expect.objectContaining({ rootAssetId: 'asset-1', discovered: 1, created: 1 }),
    }) });
  });
});
