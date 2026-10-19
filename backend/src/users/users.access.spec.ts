import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';
import { ModuleAccessService } from '../auth/module-access.service';
import { UsersService } from './users.service';

const actor = { sub: 'admin', tenantId: 'tenant-a', role: 'ADMIN' } as const;
const target = { id: 'user', tenantId: 'tenant-a', role: 'USER' } as const;
const moduleState = {
  id: 'asm', features: [{ key: 'assets' }, { key: 'discovery' }], assigned: false,
  featureKeys: [] as string[], assignable: true, accessible: false, reason: null as string | null,
};

describe('UsersService assignment policy', () => {
  const prisma = {
    user: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    authSession: { updateMany: jest.fn() },
    tenant: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    appModule: { findMany: jest.fn(), findUnique: jest.fn() },
    userModuleAccess: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const policy = { listForUser: jest.fn(), listTenantPolicies: jest.fn() };
  let service: UsersService;

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.user.findUnique.mockResolvedValue(target);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-a' });
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({ id: 'tenant-a' });
    prisma.appModule.findMany.mockResolvedValue([moduleState]);
    prisma.userModuleAccess.findMany.mockResolvedValue([]);
    policy.listForUser.mockResolvedValue([moduleState]);
    policy.listTenantPolicies.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (operation: (tx: typeof prisma) => Promise<void>) => operation(prisma));
    const ref = await Test.createTestingModule({ providers: [UsersService,
      { provide: PrismaService, useValue: prisma }, { provide: ModuleAccessService, useValue: policy }],
    }).compile();
    service = ref.get(UsersService);
  });

  it.each(['Subscription tenant tidak aktif', 'Modul tidak termasuk dalam subscription tenant',
    'Modul ini sedang tidak aktif', 'Modul dinonaktifkan untuk tenant ini', 'Role tidak memiliki akses ke modul ini'])
  ('rejects new assignment when %s', async (reason) => {
    policy.listForUser.mockResolvedValue([{ ...moduleState, assignable: false, reason }]);
    await expect(service.updateModuleAccess(actor, 'user', [{ moduleId: 'asm' }])).rejects.toThrow(reason);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('uses the target role rather than the assigning administrator role', async () => {
    await service.getModuleAccess(actor, 'user');
    expect(policy.listForUser).toHaveBeenCalledWith({ sub: 'user', tenantId: 'tenant-a', role: 'USER' });
  });

  it('retains or reduces existing unavailable features but rejects new grants', async () => {
    policy.listForUser.mockResolvedValue([{ ...moduleState, assigned: true, assignable: false, featureKeys: ['assets'], reason: 'Unavailable' }]);
    await service.updateModuleAccess(actor, 'user', [{ moduleId: 'asm', featureKeys: [] }]);
    await expect(service.updateModuleAccess(actor, 'user', [{ moduleId: 'asm', featureKeys: ['discovery'] }])).rejects.toThrow('Unavailable');
  });

  it('allows complete revocation and records feature changes in the same transaction', async () => {
    policy.listForUser.mockResolvedValue([{ ...moduleState, assigned: true, assignable: false, featureKeys: ['assets'] }]);
    await service.updateModuleAccess(actor, 'user', []);
    expect(prisma.userModuleAccess.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user', tenantId: 'tenant-a' } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      metadata: expect.objectContaining({ before: [{ moduleId: 'asm', featureKeys: ['assets'] }], after: [] }),
    }) }));
  });

  it('keeps existing advanced-chart grants but rejects new legacy grants', async () => {
    const legacy = { ...moduleState, id: 'appsec', slug: 'appsec-posture', features: [{ key: 'advanced-chart' }, { key: 'finding-management' }], assigned: true, featureKeys: ['advanced-chart'] };
    policy.listForUser.mockResolvedValue([legacy]);
    await service.updateModuleAccess(actor, 'user', [{ moduleId: 'appsec', featureKeys: ['advanced-chart'] }]);
    policy.listForUser.mockResolvedValue([{ ...legacy, featureKeys: [] }]);
    await expect(service.updateModuleAccess(actor, 'user', [{ moduleId: 'appsec', featureKeys: ['advanced-chart'] }])).rejects.toThrow('legacy');
    await service.updateModuleAccess(actor, 'user', [{ moduleId: 'appsec', featureKeys: ['finding-management'] }]);
  });

  it.each([
    ['threat-intelligence', 'export'],
    ['case-management', 'alert-triage'],
  ])('keeps an existing %s catalog-only grant but rejects a new %s grant', async (slug, key) => {
    const catalogOnly = { ...moduleState, id: slug, slug, features: [{ key }, { key: 'implemented' }], assigned: true, featureKeys: [key] };
    policy.listForUser.mockResolvedValue([catalogOnly]);
    await service.updateModuleAccess(actor, 'user', [{ moduleId: slug, featureKeys: [key] }]);
    policy.listForUser.mockResolvedValue([{ ...catalogOnly, featureKeys: [] }]);
    await expect(service.updateModuleAccess(actor, 'user', [{ moduleId: slug, featureKeys: [key] }])).rejects.toThrow('catalog');
    await service.updateModuleAccess(actor, 'user', [{ moduleId: slug, featureKeys: ['implemented'] }]);
  });

  it('rejects invalid feature keys', async () => {
    await expect(service.updateModuleAccess(actor, 'user', [{ moduleId: 'asm', featureKeys: ['foreign'] }])).rejects.toThrow('Fitur assignment tidak valid');
  });

  it('rejects cross-tenant single writes', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...target, tenantId: 'tenant-b' });
    await expect(service.updateModuleAccess(actor, 'user', [])).rejects.toThrow('tenant sendiri');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('revokes every existing session in the admin password reset transaction', async () => {
    await service.resetPassword(actor, 'user', 'New-Password-123');
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user' }, data: expect.objectContaining({ sessionVersion: { increment: 1 } }),
    }));
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user', revokedAt: null }, data: { revokedAt: expect.any(Date) },
    }));
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('rejects cross-tenant bulk writes before mutation', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...target, tenantId: 'tenant-b' });
    await expect(service.bulkUpdateModuleAccess({ ...actor, role: 'SUPER_ADMIN' }, 'tenant-a', {
      assignments: [{ userId: 'user', access: [] }],
    })).rejects.toThrow('tenant yang dipilih');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lists effective state separately from stored assignments', async () => {
    prisma.user.findMany.mockResolvedValue([{ ...target, moduleAccess: [{ moduleId: 'asm', featureKeys: [] }] }]);
    const result = await service.listTenantUserModuleAccess(actor, 'tenant-a');
    expect(result.users[0].moduleAccess).toEqual([{ moduleId: 'asm', featureKeys: [] }]);
    expect(result.users[0].moduleAccessDetails).toEqual([moduleState]);
  });

  it('scopes module assignment readers to both relation and user tenant', async () => {
    prisma.appModule.findUnique.mockResolvedValue({ id: 'asm' });
    prisma.userModuleAccess.findMany.mockResolvedValue([{ featureKeys: [], user: target }]);
    const result = await service.listModuleUserAccess(actor, 'asm');
    expect(prisma.userModuleAccess.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', moduleId: 'asm', user: { tenantId: 'tenant-a', role: { not: 'SUPER_ADMIN' } } },
    }));
    expect(result.users[0]).toMatchObject({ assigned: true, accessible: false });
  });

  it('records bulk feature changes inside the write transaction', async () => {
    let insideTransaction = false;
    prisma.$transaction.mockImplementation(async (operation: (tx: typeof prisma) => Promise<void>) => {
      insideTransaction = true;
      await operation(prisma);
      insideTransaction = false;
    });
    prisma.auditLog.create.mockImplementation(async () => {
      expect(insideTransaction).toBe(true);
    });
    await service.bulkUpdateModuleAccess(actor, 'tenant-a', {
      assignments: [{ userId: 'user', access: [{ moduleId: 'asm', featureKeys: ['assets'] }] }],
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: 'USER_MODULE_ACCESS_BULK_REPLACED', metadata: expect.objectContaining({ changes: [{
        userId: 'user', before: [], after: [{ moduleId: 'asm', featureKeys: ['assets'] }],
      }] }),
    }) }));
  });

  it('validates all bulk assignments before mutation', async () => {
    policy.listForUser.mockResolvedValue([{ ...moduleState, assignable: false, reason: 'No entitlement' }]);
    await expect(service.bulkUpdateModuleAccess(actor, 'tenant-a', {
      assignments: [{ userId: 'user', access: [{ moduleId: 'asm' }] }],
    })).rejects.toThrow('No entitlement');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
