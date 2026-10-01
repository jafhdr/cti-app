import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import type { AuthUser } from '../users/users.types';

@Controller('attack-surface/reports')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('attack-surface-management')
@RequiresModuleFeature('asset-management')
export class AsmReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('changes') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  async changes(@Req() req: { user: AuthUser }, @Query('period') period = '7d', @Query('tenantId') tenantId?: string) {
    const report = await this.summary(req, period, tenantId);
    return { period: report.period, from: report.from, newAssets: report.newAssets, newPorts: report.newPorts, importantChanges: report.importantChanges };
  }

  @Get('findings') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  async findings(@Req() req: { user: AuthUser }, @Query('period') period = '7d', @Query('tenantId') tenantId?: string) {
    const report = await this.summary(req, period, tenantId);
    return { period: report.period, from: report.from, findings: report.findings, confirmedVulnerabilities: report.confirmedVulnerabilities };
  }

  @Get('alerts') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  async alerts(@Req() req: { user: AuthUser }, @Query('period') period = '7d', @Query('tenantId') tenantId?: string) {
    const report = await this.summary(req, period, tenantId);
    return { period: report.period, from: report.from, openAlerts: report.openAlerts, acknowledgedAlerts: report.acknowledgedAlerts, resolvedAlerts: report.resolvedAlerts, linkedCases: report.linkedCases };
  }

  @Get('risk-trend') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  async riskTrend(@Req() req: { user: AuthUser }, @Query('period') period = '7d', @Query('tenantId') tenantId?: string) {
    const report = await this.summary(req, period, tenantId);
    return { period: report.period, from: report.from, currentRiskScore: report.currentRiskScore, riskTrend: report.riskTrend };
  }

  @Get('summary') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  async summary(@Req() req: { user: AuthUser }, @Query('period') period = '7d', @Query('tenantId') requested?: string) {
    const tenantId = req.user.role === 'SUPER_ADMIN' ? requested : req.user.tenantId;
    if (!tenantId) throw new BadRequestException('Tenant wajib');
    const hours = period === '24h' ? 24 : period === '7d' ? 168 : period === '30d' ? 720 : null;
    if (!hours) throw new BadRequestException('Invalid report period');
    const from = new Date(Date.now() - hours * 3_600_000);
    const [assetCount, newAssets, newPorts, findings, correlations, openAlerts, acknowledgedAlerts, resolvedAlerts, linkedCases, changes, snapshots, currentSnapshots] = await Promise.all([
      this.prisma.asset.count({ where: { tenantId } }),
      this.prisma.asset.count({ where: { tenantId, createdAt: { gte: from } } }),
      this.prisma.asmExposureChange.count({ where: { tenantId, detectedAt: { gte: from }, type: 'PORT_OPENED' } }),
      this.prisma.assetFinding.groupBy({ by: ['severity'], where: { tenantId, firstSeenAt: { gte: from } }, _count: true }),
      this.prisma.assetVulnerabilityCorrelation.count({ where: { tenantId, status: 'ACTIVE', confidence: 'HIGH', firstSeenAt: { gte: from } } }),
      this.prisma.alert.count({ where: { tenantId, source: 'ASM', status: 'OPEN' } }),
      this.prisma.alert.count({ where: { tenantId, source: 'ASM', status: 'ACKNOWLEDGED' } }),
      this.prisma.alert.count({ where: { tenantId, source: 'ASM', status: 'CLOSED', resolvedAt: { gte: from } } }),
      this.prisma.alert.groupBy({ by: ['caseId'], where: { tenantId, source: 'ASM', caseId: { not: null } } }),
      this.prisma.asmExposureChange.findMany({ where: { tenantId, detectedAt: { gte: from }, type: { in: ['PORT_OPENED', 'VULNERABILITY_CONFIRMED', 'ASSET_DISCOVERED', 'SERVICE_CHANGED'] } }, orderBy: { detectedAt: 'desc' }, take: 20, select: { id: true, assetId: true, type: true, detectedAt: true, currentValue: true } }),
      this.prisma.asmRiskSnapshot.findMany({ where: { tenantId, evaluatedAt: { gte: from } }, orderBy: { evaluatedAt: 'desc' }, take: 100, select: { id: true, assetId: true, score: true, trend: true, evaluatedAt: true } }),
      this.prisma.asmRiskSnapshot.findMany({ where: { tenantId }, distinct: ['assetId'], orderBy: { evaluatedAt: 'desc' }, select: { assetId: true, score: true } }),
    ]);
    const latest = new Map<string, number>();
    for (const snapshot of currentSnapshots) latest.set(snapshot.assetId, snapshot.score);
    return { period, from, assetCount, newAssets, newPorts, findings: Object.fromEntries(findings.map(row => [row.severity, row._count])), confirmedVulnerabilities: correlations, openAlerts, acknowledgedAlerts, resolvedAlerts, linkedCases: linkedCases.length, currentRiskScore: [...latest.values()].reduce((sum, score) => sum + score, 0), riskTrend: snapshots.reverse(), importantChanges: changes };
  }
}
