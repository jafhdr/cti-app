import { NotFoundException } from '@nestjs/common';
import { AssetFindingSeverity, AssetFindingStatus } from '@prisma/client';
import { FindingsService } from './findings.service';
import type { AuthUser } from '../users/users.types';
import { PrismaService } from '../prisma.service';
import { AsmAlertsService } from './alerts.service';

const admin: AuthUser = { sub: 'u1', role: 'ADMIN', tenantId: 'tenant-1' };
const observed = new Date('2026-09-30T00:00:00.000Z');
const finding = { id: 'f1', tenantId: 'tenant-1', assetId: 'a1', title: 'Exposed service', description: 'Observed open', type: 'EXPOSED_SERVICE', severity: AssetFindingSeverity.MEDIUM, status: AssetFindingStatus.OPEN, source: 'PORT_DISCOVERY', sourceKey: 'TCP:3389', evidence: null, firstSeenAt: observed, lastSeenAt: observed, createdAt: observed, updatedAt: observed };

describe('FindingsService', () => {
  const prisma = {
    asset: { findFirst: jest.fn() },
    assetFinding: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
    tenant: { findUnique: jest.fn() },
  };
  const alerts = { observe: jest.fn() };
  const service = new FindingsService(prisma as never as PrismaService, alerts as never as AsmAlertsService);
  beforeEach(() => { jest.clearAllMocks(); prisma.asset.findFirst.mockResolvedValue({ id: 'a1', tenantId: 'tenant-1' }); prisma.auditLog.create.mockResolvedValue({}); });

  it('returns 404 before querying findings for a foreign asset', async () => {
    prisma.asset.findFirst.mockResolvedValue(null);
    await expect(service.list(admin, 'foreign')).rejects.toThrow(NotFoundException);
    expect(prisma.assetFinding.findMany).not.toHaveBeenCalled();
  });

  it('creates a manual finding only under the scoped asset tenant', async () => {
    prisma.assetFinding.create.mockResolvedValue(finding);
    await service.create(admin, 'a1', { title: ' Review ', description: 'Observed', type: 'EXPOSURE', severity: AssetFindingSeverity.MEDIUM });
    expect(prisma.assetFinding.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 'tenant-1', assetId: 'a1', title: 'Review', source: 'MANUAL' }) });
  });

  it('creates one actionable alert for a new HIGH finding', async () => {
    prisma.assetFinding.create.mockResolvedValue({ ...finding, severity: AssetFindingSeverity.HIGH });
    await service.create(admin, 'a1', { title: 'Review', description: 'Observed', type: 'EXPOSURE', severity: AssetFindingSeverity.HIGH });
    expect(alerts.observe).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', assetId: 'a1', findingId: 'f1', sourceKey: 'finding:f1', severity: 'HIGH' }));
  });

  it('scopes detail and status update to the same asset', async () => {
    prisma.assetFinding.findFirst.mockResolvedValue(finding);
    prisma.assetFinding.update.mockResolvedValue({ ...finding, status: AssetFindingStatus.RESOLVED });
    await service.update(admin, 'a1', 'f1', { status: AssetFindingStatus.RESOLVED });
    expect(prisma.assetFinding.findFirst).toHaveBeenCalledWith({ where: { id: 'f1', assetId: 'a1', tenantId: 'tenant-1' } });
    expect(prisma.assetFinding.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { severity: undefined, status: AssetFindingStatus.RESOLVED } });
  });

  it('counts active findings by severity without assigning a speculative score', async () => {
    prisma.assetFinding.findMany.mockResolvedValue([finding, { ...finding, id: 'f2', severity: AssetFindingSeverity.HIGH }, { ...finding, id: 'f3', status: AssetFindingStatus.RESOLVED }]);
    await expect(service.risk(admin, 'a1')).resolves.toEqual({ total: 3, critical: 0, high: 1, medium: 1, low: 0, open: 2 });
  });
});
