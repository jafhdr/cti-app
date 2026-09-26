import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ModulesService } from './modules.service';
import { ModuleAccessService } from '../auth/module-access.service';

const superAdmin = { sub: 'super-1', tenantId: null, role: 'SUPER_ADMIN' } as const;
const tenantAdmin = { sub: 'admin-1', tenantId: 'tenant-own', role: 'ADMIN' } as const;

describe('ModulesService', () => {
  const prisma = {
    appModule: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    tenantModule: { upsert: jest.fn() },
    moduleRoleAccess: { upsert: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: ModulesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ModulesService, { provide: PrismaService, useValue: prisma }, { provide: ModuleAccessService, useValue: { evaluate: jest.fn().mockResolvedValue({ accessible: true }) } }],
    }).compile();
    service = moduleRef.get(ModulesService);
  });

  it('returns official features in tenant configuration without crossing tenant boundaries', async () => {
    prisma.appModule.findMany.mockResolvedValue([{
      id: 'asm', slug: 'attack-surface-management', name: 'Attack Surface Management', description: 'ASM',
      category: 'APPSEC', isActive: true,
      features: [{ id: 'feature-1', key: 'asset-management', name: 'Asset Management', description: 'Kelola aset.' }],
      settings: [{ isEnabled: true, access: [{ role: Role.ADMIN, isAllowed: true }, { role: Role.USER, isAllowed: false }] }],
    }]);

    await expect(service.listConfiguration(tenantAdmin, 'tenant-foreign')).resolves.toEqual([expect.objectContaining({
      slug: 'attack-surface-management', tenantEnabled: true,
      access: { ADMIN: true, USER: false },
      features: [{ id: 'feature-1', key: 'asset-management', name: 'Asset Management', description: 'Kelola aset.' }],
    })]);
    expect(prisma.appModule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        features: expect.any(Object),
        settings: expect.objectContaining({ where: { tenantId: 'tenant-own' } }),
      }),
    }));
  });

  it('returns features with the module catalog', async () => {
    prisma.appModule.findMany.mockResolvedValue([]);
    await service.listAvailable(superAdmin);
    expect(prisma.appModule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: { features: expect.any(Object) },
    }));
  });

  it('reports the shared access decision for each catalog module', async () => {
    prisma.appModule.findMany.mockResolvedValue([
      { id: 'asm', slug: 'attack-surface-management', features: [] },
      { id: 'ti', slug: 'threat-intelligence', features: [] },
    ]);
    const evaluate = jest.fn()
      .mockResolvedValueOnce({ accessible: true })
      .mockResolvedValueOnce({ accessible: false, reason: 'Modul belum diberikan kepada user ini' });
    const moduleRef = await Test.createTestingModule({
      providers: [ModulesService, { provide: PrismaService, useValue: prisma }, { provide: ModuleAccessService, useValue: { evaluate } }],
    }).compile();

    const result = await moduleRef.get(ModulesService).listAvailable(tenantAdmin);

    expect(result.map((entry) => entry.accessible)).toEqual([true, false]);
    expect(evaluate).toHaveBeenNthCalledWith(1, tenantAdmin, 'attack-surface-management');
    expect(evaluate).toHaveBeenNthCalledWith(2, tenantAdmin, 'threat-intelligence');
  });

  it('returns a clear conflict for a duplicate slug', async () => {
    prisma.appModule.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002', clientVersion: '6.14.0', meta: { target: ['slug'] },
    }));
    await expect(service.create(superAdmin, {
      name: 'Duplicate', slug: 'attack-surface-management', description: 'Duplicate', category: 'APPSEC',
    })).rejects.toThrow(ConflictException);
  });

  it('updates tenant and role access atomically through unique upserts', async () => {
    prisma.appModule.findUnique.mockResolvedValue({ id: 'asm' });
    prisma.tenantModule.upsert.mockResolvedValue({ id: 'tenant-module-1' });
    prisma.moduleRoleAccess.upsert.mockResolvedValue({ id: 'role-access-1' });
    prisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    prisma.$transaction.mockImplementation(async (operation: (transaction: typeof prisma) => Promise<void>) => operation(prisma));
    prisma.appModule.findMany.mockResolvedValue([]);

    await service.updateTenantAccess(tenantAdmin, 'asm', {
      tenantId: 'tenant-foreign', isEnabled: true, access: { USER: true },
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.tenantModule.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_moduleId: { tenantId: 'tenant-own', moduleId: 'asm' } },
    }));
    expect(prisma.moduleRoleAccess.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantModuleId_role: { tenantModuleId: 'tenant-module-1', role: Role.USER } },
    }));
  });
});
