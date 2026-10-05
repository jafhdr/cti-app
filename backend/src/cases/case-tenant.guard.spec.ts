import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CaseTenantGuard } from './case-tenant.guard';
import type { PrismaService } from '../prisma.service';
import type { ExecutionContext } from '@nestjs/common';
import { CasesController } from './cases.controller';

describe('Case workspace tenant guard', () => {
  const findFirst = jest.fn();
  const guard = new CaseTenantGuard({ case: { findFirst } } as unknown as PrismaService);
  const context = (role: string, tenantId: string | undefined, caseId = 'case-a') => ({
    switchToHttp: () => ({ getRequest: () => ({ user: { role, tenantId: role === 'SUPER_ADMIN' ? null : 'tenant-a' }, params: { id: caseId }, query: tenantId ? { tenantId } : {} }) }),
  }) as unknown as ExecutionContext;

  beforeEach(() => jest.clearAllMocks());

  it('rejects SUPER_ADMIN mutation without selected tenant', async () => {
    await expect(guard.canActivate(context('SUPER_ADMIN', undefined))).rejects.toThrow(BadRequestException);
  });

  it('permits SUPER_ADMIN Case A in selected tenant A', async () => {
    findFirst.mockResolvedValue({ id: 'case-a' });
    await expect(guard.canActivate(context('SUPER_ADMIN', 'tenant-a'))).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'case-a', tenantId: 'tenant-a' }, select: { id: true } });
  });

  it('returns 404 for Case B while tenant A is selected', async () => {
    findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(context('SUPER_ADMIN', 'tenant-a', 'case-b'))).rejects.toThrow(NotFoundException);
  });

  it('permits Case B after switching to tenant B', async () => {
    findFirst.mockResolvedValue({ id: 'case-b' });
    await expect(guard.canActivate(context('SUPER_ADMIN', 'tenant-b', 'case-b'))).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'case-b', tenantId: 'tenant-b' }, select: { id: true } });
  });

  it('ignores client tenant override for ADMIN', async () => {
    await expect(guard.canActivate(context('ADMIN', 'tenant-b', 'case-b'))).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('protects every Case route while mutation roles still exclude USER', () => {
    const guards = Reflect.getMetadata('__guards__', CasesController) as readonly { name: string }[];
    expect(guards.map(entry => entry.name)).toContain('CaseTenantGuard');
    for (const method of ['update', 'delete', 'assign', 'linkIndicator', 'unlinkIndicator', 'linkThreatActor', 'unlinkThreatActor', 'linkCampaign', 'unlinkCampaign', 'linkAsmAlert'] as const) {
      expect(Reflect.getMetadata('roles', CasesController.prototype[method])).not.toContain('USER');
    }
  });
});
