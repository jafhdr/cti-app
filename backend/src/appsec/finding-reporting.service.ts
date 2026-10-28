import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AppSecFindingStatus, AppSecVerificationState, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ModuleAccessService } from '../auth/module-access.service';
import type { AuthUser } from '../users/users.types';
import { OperationalPeriodDto, OperationalQueueDto } from './appsec.dto';
import { AppSecTenantContext } from './tenant-context';

const dayMs = 86_400_000;
const openStatuses = [AppSecFindingStatus.OPEN, AppSecFindingStatus.IN_PROGRESS] as const;

@Injectable()
export class FindingReportingService {
  constructor(private readonly prisma: PrismaService, private readonly context: AppSecTenantContext, private readonly access: ModuleAccessService) {}

  private async tenant(user: AuthUser, requested?: string): Promise<string> {
    const tenantId = await this.context.resolve(user, requested);
    const grant = await this.access.evaluateForTenant(user, tenantId, 'appsec-posture', ['finding-management']);
    if (!grant.accessible) throw new ForbiddenException(grant.reason);
    return tenantId;
  }

  private period(query: OperationalPeriodDto, asOf: Date) {
    const to = query.to ? new Date(query.to) : asOf;
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * dayMs);
    const span = to.getTime() - from.getTime();
    if (!Number.isFinite(span) || span <= 0 || span > 366 * dayMs || to > asOf)
      throw new BadRequestException('Reporting period must be positive, at most 366 days, and end no later than asOf');
    return { from, to };
  }

  private cohort(tenantId: string, query: OperationalPeriodDto, from: Date, to: Date): Prisma.AppSecFindingWhereInput {
    return { tenantId, createdAt: { gte: from, lt: to },
      ...(query.ownerId ? { assigneeId: query.ownerId === 'unassigned' ? null : query.ownerId } : {}) };
  }

  async queue(user: AuthUser, query: OperationalQueueDto) {
    const tenantId = await this.tenant(user, query.tenantId);
    const asOf = new Date();
    const { from, to } = this.period(query, asOf);
    const where: Prisma.AppSecFindingWhereInput = { ...this.cohort(tenantId, query, from, to),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.verificationState ? { verificationState: query.verificationState } : {}),
      ...(query.overdue === 'true' ? { AND: [{ status: { in: [...openStatuses] } }, { dueDate: { lt: asOf } }] } : {}),
      ...(query.overdue === 'false' ? { NOT: { AND: [{ status: { in: [...openStatuses] } }, { dueDate: { lt: asOf } }] } } : {}),
    };
    const [items, total] = await this.prisma.$transaction(async tx => Promise.all([
      tx.appSecFinding.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit, take: query.limit,
        include: { application: { select: { id: true, name: true } }, assignee: { select: { name: true, isActive: true } } } }),
      tx.appSecFinding.count({ where }),
    ]), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { asOf: asOf.toISOString(), from: from.toISOString(), to: to.toISOString(),
      filters: { ownerId: query.ownerId ?? null, status: query.status ?? null, priority: query.priority ?? null,
        verificationState: query.verificationState ?? null, overdue: query.overdue ?? null },
      items: items.map(({ assignee, ...finding }) => ({ ...finding,
        assigneeName: assignee?.isActive && assignee.name.trim() ? assignee.name.trim() : null })),
      total, page: query.page, limit: query.limit };
  }

  async metrics(user: AuthUser, query: OperationalPeriodDto) {
    const tenantId = await this.tenant(user, query.tenantId);
    const asOf = new Date();
    const { from, to } = this.period(query, asOf);
    const records = await this.prisma.$transaction(tx => tx.appSecFinding.findMany({
      where: this.cohort(tenantId, query, from, to),
      select: { status: true, workflowVersion: true, verificationState: true, assigneeId: true,
        dueDate: true, firstSeenAt: true, assignee: { select: { name: true, isActive: true } } },
    }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const totals = { open: 0, assigned: 0, unassigned: 0, overdue: 0, awaitingVerification: 0,
      rework: 0, resolved: 0, acceptedRisk: 0, falsePositive: 0 };
    const aging = [
      { bucket: '0-7', count: 0 }, { bucket: '8-30', count: 0 },
      { bucket: '31-90', count: 0 }, { bucket: '>90', count: 0 },
    ];
    const owners = new Map<string, { assigneeId: string | null; name: string | null; open: number; overdue: number; awaitingVerification: number }>();
    const filterOwners = new Map<string, { assigneeId: string; name: string | null }>();
    for (const record of records) {
      if (record.assigneeId) filterOwners.set(record.assigneeId, { assigneeId: record.assigneeId,
        name: record.assignee?.isActive && record.assignee.name.trim() ? record.assignee.name.trim() : null });
      switch (record.status) {
        case AppSecFindingStatus.RESOLVED: totals.resolved += 1; continue;
        case AppSecFindingStatus.ACCEPTED_RISK: totals.acceptedRisk += 1; continue;
        case AppSecFindingStatus.FALSE_POSITIVE: totals.falsePositive += 1; continue;
        case AppSecFindingStatus.OPEN:
        case AppSecFindingStatus.IN_PROGRESS: break;
      }
      totals.open += 1;
      if (record.assigneeId) totals.assigned += 1; else totals.unassigned += 1;
      const overdue = record.dueDate !== null && record.dueDate < asOf;
      const awaiting = record.workflowVersion === 2 && record.verificationState === AppSecVerificationState.REQUESTED;
      if (overdue) totals.overdue += 1;
      if (awaiting) totals.awaitingVerification += 1;
      if (record.workflowVersion === 2 && record.verificationState === AppSecVerificationState.REJECTED) totals.rework += 1;
      const days = Math.max(0, Math.floor((asOf.getTime() - record.firstSeenAt.getTime()) / dayMs));
      aging[days <= 7 ? 0 : days <= 30 ? 1 : days <= 90 ? 2 : 3].count += 1;
      const key = record.assigneeId ?? 'unassigned';
      const current = owners.get(key) ?? { assigneeId: record.assigneeId,
        name: record.assignee?.isActive && record.assignee.name.trim() ? record.assignee.name.trim() : null,
        open: 0, overdue: 0, awaitingVerification: 0 };
      current.open += 1;
      if (overdue) current.overdue += 1;
      if (awaiting) current.awaitingVerification += 1;
      owners.set(key, current);
    }
    return { asOf: asOf.toISOString(), from: from.toISOString(), to: to.toISOString(),
      filters: { ownerId: query.ownerId ?? null }, totals, aging,
      filterOwners: [...filterOwners.values()].sort((a, b) => (a.name ?? a.assigneeId).localeCompare(b.name ?? b.assigneeId)),
      owners: [...owners.values()].sort((a, b) => b.open - a.open || (a.name ?? a.assigneeId ?? '').localeCompare(b.name ?? b.assigneeId ?? '')) };
  }
}
