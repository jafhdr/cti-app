import { Injectable } from '@nestjs/common';
import { AppSecFindingSeverity, AppSecFindingStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { AppSecTenantContext } from './tenant-context';

@Injectable()
export class PostureService {
  constructor(private readonly prisma: PrismaService, private readonly context: AppSecTenantContext) {}

  async get(user: AuthUser, requested?: string) {
    const tenantId = await this.context.resolve(user, requested);
    const [applicationsTotal, applicationsActive, findingGroups, applicationGroups] = await Promise.all([
      this.prisma.application.count({ where: { tenantId } }),
      this.prisma.application.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.appSecFinding.groupBy({ by: ['severity', 'status'], orderBy: [{ severity: 'asc' }, { status: 'asc' }], where: { tenantId }, _count: { _all: true } }),
      this.prisma.appSecFinding.groupBy({ by: ['applicationId', 'severity', 'status'], orderBy: [{ applicationId: 'asc' }, { severity: 'asc' }, { status: 'asc' }], where: { tenantId, status: { in: [AppSecFindingStatus.OPEN, AppSecFindingStatus.IN_PROGRESS] } }, _count: { _all: true } }),
    ]);
    const severity = { critical: 0, high: 0, medium: 0, low: 0 };
    const status = { open: 0, inProgress: 0, resolved: 0, acceptedRisk: 0, falsePositive: 0 };
    for (const group of findingGroups) {
      const count = group._count._all;
      switch (group.severity) {
        case AppSecFindingSeverity.CRITICAL: severity.critical += count; break;
        case AppSecFindingSeverity.HIGH: severity.high += count; break;
        case AppSecFindingSeverity.MEDIUM: severity.medium += count; break;
        case AppSecFindingSeverity.LOW: severity.low += count; break;
      }
      switch (group.status) {
        case AppSecFindingStatus.OPEN: status.open += count; break;
        case AppSecFindingStatus.IN_PROGRESS: status.inProgress += count; break;
        case AppSecFindingStatus.RESOLVED: status.resolved += count; break;
        case AppSecFindingStatus.ACCEPTED_RISK: status.acceptedRisk += count; break;
        case AppSecFindingStatus.FALSE_POSITIVE: status.falsePositive += count; break;
      }
    }
    const byApplication = new Map<string, { activeFindings: number; criticalFindings: number; highFindings: number }>();
    for (const group of applicationGroups) {
      const entry = byApplication.get(group.applicationId) ?? { activeFindings: 0, criticalFindings: 0, highFindings: 0 };
      entry.activeFindings += group._count._all;
      if (group.severity === AppSecFindingSeverity.CRITICAL) entry.criticalFindings += group._count._all;
      if (group.severity === AppSecFindingSeverity.HIGH) entry.highFindings += group._count._all;
      byApplication.set(group.applicationId, entry);
    }
    const applications = byApplication.size ? await this.prisma.application.findMany({
      where: { tenantId, id: { in: [...byApplication.keys()] } }, select: { id: true, name: true, criticality: true },
    }) : [];
    const topApplications = applications.map(application => ({
      applicationId: application.id, name: application.name, criticality: application.criticality,
      ...(byApplication.get(application.id) ?? { activeFindings: 0, criticalFindings: 0, highFindings: 0 }),
    })).sort((a, b) => b.criticalFindings - a.criticalFindings || b.highFindings - a.highFindings || b.activeFindings - a.activeFindings || a.name.localeCompare(b.name) || a.applicationId.localeCompare(b.applicationId)).slice(0, 10);
    const total = severity.critical + severity.high + severity.medium + severity.low;
    return {
      applications: { total: applicationsTotal, active: applicationsActive },
      findings: { total, active: status.open + status.inProgress, resolved: status.resolved + status.acceptedRisk + status.falsePositive },
      severity, status, applicationsWithActiveFindings: byApplication.size, topApplications,
    };
  }
}
