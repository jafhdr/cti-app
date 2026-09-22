import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AssetsService } from './assets.service';
import { AuthUser } from '../users/users.types';
import { AssetType, AssetStatus } from '@prisma/client';

function mockAsset(overrides: Record<string, any> = {}) {
  return {
    id: 'a1', tenantId: 'tenant-123', name: 'domain.com',
    type: AssetType.DOMAIN, value: 'domain.com',
    status: AssetStatus.UNKNOWN, criticality: 'MEDIUM' as any,
    description: null, owner: null, firstSeenAt: null, lastSeenAt: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

describe('AssetsService', () => {
  let service: AssetsService;
  let prisma: PrismaService;

  const adminUser: AuthUser = { sub: 'user-123', role: 'ADMIN', tenantId: 'tenant-123' };
  const superAdmin: AuthUser = { sub: 'superadmin-123', role: 'SUPER_ADMIN', tenantId: null };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetsService,
        {
          provide: PrismaService,
          useValue: {
            asset: {
              create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(),
              update: jest.fn(), delete: jest.fn(), count: jest.fn(),
            },
            tenant: { findUnique: jest.fn() },
            auditLog: { create: jest.fn() },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();
    service = module.get<AssetsService>(AssetsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  // ─── Basic Operations ───────────────────────────────────────────────────────
  describe('Basic Operations', () => {
    it('should create asset with valid data', async () => {
      const dto = { name: 'example.com', type: AssetType.DOMAIN, value: 'example.com' };
      jest.spyOn(prisma.asset, 'create').mockResolvedValueOnce(mockAsset({ id: 'a1' }));
      jest.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({} as any);
      const result = await service.create(adminUser, dto);
      expect(result.id).toBe('a1');
    });

    it('should throw BadRequestException on empty name', async () => {
      await expect(service.create(adminUser, { name: '   ', type: AssetType.DOMAIN, value: 'x' }))
        .rejects.toThrow(BadRequestException);
    });

    it('should list assets for authenticated tenant', async () => {
      jest.spyOn(prisma, '$transaction').mockResolvedValueOnce([[mockAsset()], 1]);
      const result = await service.list(adminUser, { page: 1, limit: 25 });
      expect(result.total).toBe(1);
    });

    it('should get asset scoped to authenticated tenant', async () => {
      jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(mockAsset());
      const result = await service.get(adminUser, 'a1');
      expect(result.tenantId).toBe('tenant-123');
    });

    it('should delete asset and emit audit log', async () => {
      jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(mockAsset());
      jest.spyOn(prisma.asset, 'delete').mockResolvedValueOnce(mockAsset());
      jest.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({} as any);
      const result = await service.remove(adminUser, 'a1');
      expect(result.deleted).toBe(true);
    });

    it('SUPER_ADMIN with tenantId should create asset for that tenant', async () => {
      const dto = { name: 'example.com', type: AssetType.DOMAIN, value: 'example.com' };
      jest.spyOn(prisma.tenant, 'findUnique').mockResolvedValueOnce({ id: 'tenant-999' } as any);
      jest.spyOn(prisma.asset, 'create').mockResolvedValueOnce(mockAsset({ tenantId: 'tenant-999' }));
      jest.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({} as any);
      const result = await service.create(superAdmin, dto, 'tenant-999');
      expect(result.tenantId).toBe('tenant-999');
    });
  });

  // ─── QA4: 1. Tenant Resolution Audit ───────────────────────────────────────
  describe('QA4: 1. Tenant Resolution — USER/ADMIN cannot override tenant', () => {
    it('ADMIN: requestedTenantId is ignored — asset created under authenticated tenant', async () => {
      const dto = { name: 'domain.com', type: AssetType.DOMAIN, value: 'domain.com' };
      jest.spyOn(prisma.asset, 'create').mockResolvedValueOnce(mockAsset({ tenantId: 'tenant-123' }));
      jest.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({} as any);
      const result = await service.create(adminUser, dto, 'tenant-999');
      expect(result.tenantId).toBe('tenant-123');
    });

    it('USER: requestedTenantId is ignored — asset created under authenticated tenant', async () => {
      const userUser: AuthUser = { sub: 'user-1', role: 'USER', tenantId: 'tenant-123' };
      const dto = { name: 'domain.com', type: AssetType.DOMAIN, value: 'domain.com' };
      jest.spyOn(prisma.asset, 'create').mockResolvedValueOnce(mockAsset({ tenantId: 'tenant-123' }));
      jest.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({} as any);
      const result = await service.create(userUser, dto, 'tenant-999');
      expect(result.tenantId).toBe('tenant-123');
    });

    it('ADMIN: cannot GET asset from different tenant', async () => {
      const adminA: AuthUser = { sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' };
      jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(null);
      await expect(service.get(adminA, 'asset-b', 'tenant-b')).rejects.toThrow(NotFoundException);
    });

    it('ADMIN: cannot PATCH asset from different tenant', async () => {
      const adminA: AuthUser = { sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' };
      jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(null);
      await expect(service.update(adminA, 'asset-b', { name: 'hacked' }, 'tenant-b')).rejects.toThrow(NotFoundException);
    });

    it('ADMIN: cannot DELETE asset from different tenant', async () => {
      const adminA: AuthUser = { sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' };
      jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(null);
      await expect(service.remove(adminA, 'asset-b', 'tenant-b')).rejects.toThrow(NotFoundException);
    });

    it('List: tenantId query param is ignored for ADMIN — authenticated tenant is used', async () => {
      jest.spyOn(prisma, '$transaction').mockResolvedValueOnce([[mockAsset({ tenantId: 'tenant-123' })], 1]);
      const result = await service.list(adminUser, { page: 1, limit: 25, tenantId: 'tenant-999' });
      expect(result.items[0].tenantId).toBe('tenant-123');
    });
  });

  // ─── QA4: 2. SUPER_ADMIN Tenant Selection ──────────────────────────────────
  describe('QA4: 2. SUPER_ADMIN must always provide tenantId', () => {
    it('SUPER_ADMIN without tenantId on create throws BadRequestException', async () => {
      await expect(service.create(superAdmin, { name: 'x', type: AssetType.DOMAIN, value: 'x' }))
        .rejects.toThrow(BadRequestException);
    });

    it('SUPER_ADMIN without tenantId on list throws BadRequestException', async () => {
      await expect(service.list(superAdmin, { page: 1, limit: 25 })).rejects.toThrow(BadRequestException);
    });

    it('SUPER_ADMIN without tenantId on get throws BadRequestException', async () => {
      await expect(service.get(superAdmin, 'any-id')).rejects.toThrow(BadRequestException);
    });

    it('SUPER_ADMIN without tenantId on update throws BadRequestException', async () => {
      await expect(service.update(superAdmin, 'any-id', { name: 'x' })).rejects.toThrow(BadRequestException);
    });

    it('SUPER_ADMIN without tenantId on remove throws BadRequestException', async () => {
      await expect(service.remove(superAdmin, 'any-id')).rejects.toThrow(BadRequestException);
    });

    it('SUPER_ADMIN with tenantId on list scopes query to that tenant', async () => {
      jest.spyOn(prisma.tenant, 'findUnique').mockResolvedValueOnce({ id: 'tenant-999' } as any);
      jest.spyOn(prisma, '$transaction').mockResolvedValueOnce([[mockAsset({ tenantId: 'tenant-999' })], 1]);
      const result = await service.list(superAdmin, { page: 1, limit: 25, tenantId: 'tenant-999' });
      expect(result.total).toBe(1);
      expect(result.items[0].tenantId).toBe('tenant-999');
    });

    it('SUPER_ADMIN with non-existent tenantId throws BadRequestException', async () => {
      jest.spyOn(prisma.tenant, 'findUnique').mockResolvedValueOnce(null);
      await expect(service.list(superAdmin, { page: 1, limit: 25, tenantId: 'tenant-does-not-exist' }))
        .rejects.toThrow(BadRequestException);
    });
  });


  // ─── QA4: 3. Cross-Tenant Isolation ────────────────────────────────────────
  describe('QA4: 3. Cross-Tenant Isolation', () => {
    const tenantA: AuthUser = { sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' };
    const tenantB: AuthUser = { sub: 'admin-b', role: 'ADMIN', tenantId: 'tenant-b' };

    it('Tenant A creates Asset A under tenant-a', async () => {
      jest.spyOn(prisma.asset, 'create').mockResolvedValueOnce(mockAsset({ tenantId: 'tenant-a', name: 'asset-a.com' }));
      jest.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({} as any);
      const result = await service.create(tenantA, { name: 'asset-a.com', type: AssetType.DOMAIN, value: 'asset-a.com' });
      expect(result.tenantId).toBe('tenant-a');
    });

    it('Tenant B cannot GET Asset A', async () => {
      jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(null);
      await expect(service.get(tenantB, 'asset-a-id')).rejects.toThrow(NotFoundException);
    });

    it('Tenant B cannot PATCH Asset A', async () => {
      jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(null);
      await expect(service.update(tenantB, 'asset-a-id', { name: 'pwned' })).rejects.toThrow(NotFoundException);
    });

    it('Tenant B cannot DELETE Asset A', async () => {
      jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(null);
      await expect(service.remove(tenantB, 'asset-a-id')).rejects.toThrow(NotFoundException);
    });

    it('Tenant B cannot discover Asset A through list/search', async () => {
      jest.spyOn(prisma, '$transaction').mockResolvedValueOnce([[], 0]);
      const result = await service.list(tenantB, { page: 1, limit: 25, search: 'asset-a' });
      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it('USER cannot change tenant with query parameter', async () => {
      const userA: AuthUser = { sub: 'user-a', role: 'USER', tenantId: 'tenant-a' };
      jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(null);
      await expect(service.get(userA, 'asset-b-id', 'tenant-b')).rejects.toThrow(NotFoundException);
    });

    it('ADMIN cannot change tenant with query parameter', async () => {
      jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(null);
      await expect(service.get(tenantA, 'asset-b-id', 'tenant-b')).rejects.toThrow(NotFoundException);
    });

    it('SUPER_ADMIN can access specific tenant through tenantId mechanism', async () => {
      jest.spyOn(prisma.tenant, 'findUnique').mockResolvedValueOnce({ id: 'tenant-a' } as any);
      jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(mockAsset({ tenantId: 'tenant-a', id: 'asset-a-id' }));
      const result = await service.get(superAdmin, 'asset-a-id', 'tenant-a');
      expect(result.tenantId).toBe('tenant-a');
    });
  });


  // ─── QA4: 4. Tenant Context Validation ─────────────────────────────────────
  describe('QA4: 4. Tenant Context Validation', () => {
    it('USER without tenantId throws ForbiddenException on create', async () => {
      const noTenant: AuthUser = { sub: 'u1', role: 'USER', tenantId: null };
      await expect(service.create(noTenant, { name: 'x', type: AssetType.DOMAIN, value: 'x' }))
        .rejects.toThrow(ForbiddenException);
    });

    it('ADMIN without tenantId throws ForbiddenException on create', async () => {
      const noTenant: AuthUser = { sub: 'a1', role: 'ADMIN', tenantId: null };
      await expect(service.create(noTenant, { name: 'x', type: AssetType.DOMAIN, value: 'x' }))
        .rejects.toThrow(ForbiddenException);
    });

    it('USER without tenantId throws ForbiddenException on list', async () => {
      const noTenant: AuthUser = { sub: 'u1', role: 'USER', tenantId: null };
      await expect(service.list(noTenant, { page: 1, limit: 25 })).rejects.toThrow(ForbiddenException);
    });

    it('ADMIN without tenantId throws ForbiddenException on get', async () => {
      const noTenant: AuthUser = { sub: 'a1', role: 'ADMIN', tenantId: null };
      await expect(service.get(noTenant, 'some-id')).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── QA4: 5. Audit Log Tenant Context ──────────────────────────────────────
  describe('QA4: 5. Audit Log Tenant Context', () => {
    it('ASSET_CREATED audit records the authenticated tenant', async () => {
      const dto = { name: 'domain.com', type: AssetType.DOMAIN, value: 'domain.com' };
      jest.spyOn(prisma.asset, 'create').mockResolvedValueOnce(mockAsset({ tenantId: 'tenant-123' }));
      const auditSpy = jest.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({} as any);
      await service.create(adminUser, dto);
      expect(auditSpy).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-123', tenantId: 'tenant-123', action: 'ASSET_CREATED' }),
      });
    });

    it('ASSET_UPDATED audit uses tenantId from existing asset', async () => {
      const existing = mockAsset({ id: 'a1', tenantId: 'tenant-123', name: 'old.com' });
      jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(existing);
      jest.spyOn(prisma.asset, 'update').mockResolvedValueOnce({ ...existing, name: 'new.com' });
      const auditSpy = jest.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({} as any);
      await service.update(adminUser, 'a1', { name: 'new.com' });
      expect(auditSpy).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-123', tenantId: 'tenant-123', action: 'ASSET_UPDATED' }),
      });
    });

    it('ASSET_DELETED audit uses tenantId from existing asset', async () => {
      const asset = mockAsset({ id: 'a1', tenantId: 'tenant-123' });
      jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(asset);
      jest.spyOn(prisma.asset, 'delete').mockResolvedValueOnce(asset);
      const auditSpy = jest.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({} as any);
      await service.remove(adminUser, 'a1');
      expect(auditSpy).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-123', tenantId: 'tenant-123', action: 'ASSET_DELETED' }),
      });
    });

    it('Audit log tenantId must equal the asset tenantId — not a different tenant', async () => {
      const asset = mockAsset({ id: 'a1', tenantId: 'tenant-123' });
      jest.spyOn(prisma.asset, 'findFirst').mockResolvedValueOnce(asset);
      jest.spyOn(prisma.asset, 'delete').mockResolvedValueOnce(asset);
      const auditSpy = jest.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({} as any);
      await service.remove(adminUser, 'a1');
      const callArg = auditSpy.mock.calls[0][0] as any;
      expect(callArg.data.tenantId).toBe('tenant-123');
      expect(callArg.data.tenantId).not.toBe('tenant-OTHER');
    });
  });

});

