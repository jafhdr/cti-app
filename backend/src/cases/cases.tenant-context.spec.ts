import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CasesService } from './cases.service';
import type { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';

describe('Cases tenant context', () => {
  const superAdmin: AuthUser = { sub: 'root', role: 'SUPER_ADMIN', tenantId: null };
  const admin: AuthUser = { sub: 'admin', role: 'ADMIN', tenantId: 'tenant-a' };
  const transaction = jest.fn().mockResolvedValue([[], 0]);
  const findMany = jest.fn();
  const count = jest.fn();
  const findFirst = jest.fn();
  const prisma = { case: { findMany, count, findFirst }, $transaction: transaction };
  const service = new CasesService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('requires an explicit tenant when SUPER_ADMIN lists Cases', async () => {
    await expect(service.list(superAdmin, {})).rejects.toThrow(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['tenant-a', 'tenant-b'])('scopes SUPER_ADMIN list to %s', async tenantId => {
    await service.list(superAdmin, { tenantId });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId }) }));
    expect(count).toHaveBeenCalledWith({ where: expect.objectContaining({ tenantId }) });
  });

  it('uses the session tenant for ADMIN even when a different tenant is supplied', async () => {
    await service.list(admin, { tenantId: 'tenant-b' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a' }) }));
  });

  it('returns 404 when SUPER_ADMIN selects a different tenant for Case detail', async () => {
    findFirst.mockResolvedValue({ id: 'case-a', tenantId: 'tenant-a' });
    await expect(service.getDetail(superAdmin, 'case-a', 'tenant-b')).rejects.toThrow(NotFoundException);
  });

  it('returns only selected tenant users for SUPER_ADMIN assignment', async () => {
    const userFindMany = jest.fn().mockResolvedValue([]);
    const scoped = new CasesService({ user: { findMany: userFindMany } } as unknown as PrismaService);
    await scoped.getAssignableUsers(superAdmin, 'tenant-b');
    expect(userFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-b' }) }));
  });
});
