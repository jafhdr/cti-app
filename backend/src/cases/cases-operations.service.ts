import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { parseOperationsQuery, scopeSql } from './cases-operations.query';
import type { OperationsQuery } from './cases-operations.query';

type MetricRow = { total: bigint; open: bigint; inProgress: bigint; resolved: bigint; closed: bigint; active: bigint; overdue: bigint; approaching: bigint; missingDue: bigint; pending: bigint; approved: bigint; rejected: bigint; reopenedCases: bigint; reopenEvents: bigint; cycles: bigint; missingResolution: bigint; missingClosure: bigint; origins: Record<string, number>; openAging: { samples: number; medianHours: number | null; p90Hours: number | null }; closedAging: { samples: number; medianHours: number | null; p90Hours: number | null }; resolution: { samples: number; medianHours: number | null; p90Hours: number | null } };
type WorkloadRow = { assigneeId: string | null; assigneeName: string | null; count: bigint };
type TaskRow = { state: string; count: bigint };
type QueueRow = { id: string; caseNumber: string; title: string; status: string; priority: string; severity: string; assigneeId: string | null; assigneeName: string | null; createdAt: Date; dueAt: Date | null; origin: string; review: string; investigationCycle: number; reopenCount: number };

@Injectable()
export class CasesOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  private tenant(user: AuthUser, selected?: string): string {
    if (process.env.CASE_V2_REPORTING_ENABLED !== 'true') throw new ForbiddenException('Case V2 reporting belum aktif');
    if (user.role === 'SUPER_ADMIN') {
      if (!selected?.trim()) throw new BadRequestException('Tenant wajib dipilih');
      return selected;
    }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    if (selected && selected !== user.tenantId) throw new NotFoundException('Case tidak ditemukan');
    return user.tenantId;
  }

  private async snapshot<T>(run: (tx: Prisma.TransactionClient, asOf: Date) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const clock = await tx.$queryRaw<{ asOf: Date }[]>`SELECT transaction_timestamp() AS "asOf"`;
      return run(tx, clock[0].asOf);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
  }

  async summary(user: AuthUser, input: OperationsQuery) {
    const tenantId = this.tenant(user, input.tenantId);
    const q = parseOperationsQuery(input);
    const scope = scopeSql(tenantId, q);
    return this.snapshot(async (tx, asOf) => {
      const metrics = await tx.$queryRaw<MetricRow[]>(Prisma.sql`${scope}, aggregate AS (
        SELECT COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status='OPEN') AS open,
          COUNT(*) FILTER (WHERE status='IN_PROGRESS') AS "inProgress",
          COUNT(*) FILTER (WHERE status='RESOLVED') AS resolved,
          COUNT(*) FILTER (WHERE status='CLOSED') AS closed,
          COUNT(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS')) AS active,
          COUNT(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS') AND "dueAt" < ${asOf}) AS overdue,
          COUNT(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS') AND "dueAt" >= ${asOf} AND "dueAt" < ${new Date(asOf.getTime()+7*86400000)}) AS approaching,
          COUNT(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS') AND "dueAt" IS NULL) AS "missingDue",
          COUNT(*) FILTER (WHERE review='PENDING') AS pending,
          COALESCE(SUM("approvedCount"),0)::bigint AS approved,
          COALESCE(SUM("rejectedCount"),0)::bigint AS rejected,
          COUNT(*) FILTER (WHERE "reopenCount">0) AS "reopenedCases",
          COALESCE(SUM("reopenCount"),0)::bigint AS "reopenEvents",
          COALESCE(SUM("investigationCycle"),0)::bigint AS cycles,
          COUNT(*) FILTER (WHERE status IN ('RESOLVED','CLOSED') AND "firstResolvedAt" IS NULL) AS "missingResolution",
          COUNT(*) FILTER (WHERE status='CLOSED' AND "firstClosedAt" IS NULL) AS "missingClosure"
        FROM scoped
      ) SELECT a.*,
        (SELECT COALESCE(jsonb_object_agg(origin,n), '{}'::jsonb) FROM (SELECT origin, COUNT(*)::integer n FROM scoped GROUP BY origin) o) origins,
        (SELECT jsonb_build_object('samples',COUNT(*)::integer,'medianHours',CASE WHEN COUNT(*)>=5 THEN ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours))::numeric,2) ELSE NULL END,'p90Hours',CASE WHEN COUNT(*)>=10 THEN ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY hours))::numeric,2) ELSE NULL END) FROM (SELECT EXTRACT(EPOCH FROM (${asOf}-"createdAt"))/3600 hours FROM scoped WHERE status IN ('OPEN','IN_PROGRESS')) x) "openAging",
        (SELECT jsonb_build_object('samples',COUNT(*)::integer,'medianHours',CASE WHEN COUNT(*)>=5 THEN ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours))::numeric,2) ELSE NULL END,'p90Hours',CASE WHEN COUNT(*)>=10 THEN ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY hours))::numeric,2) ELSE NULL END) FROM (SELECT EXTRACT(EPOCH FROM ("firstClosedAt"-"createdAt"))/3600 hours FROM scoped WHERE "firstClosedAt" IS NOT NULL) x) "closedAging",
        (SELECT jsonb_build_object('samples',COUNT(*)::integer,'medianHours',CASE WHEN COUNT(*)>=5 THEN ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours))::numeric,2) ELSE NULL END,'p90Hours',CASE WHEN COUNT(*)>=10 THEN ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY hours))::numeric,2) ELSE NULL END) FROM (SELECT EXTRACT(EPOCH FROM ("firstResolvedAt"-"createdAt"))/3600 hours FROM scoped WHERE "firstResolvedAt" IS NOT NULL) x) resolution
      FROM aggregate a`);
      const workload = await tx.$queryRaw<WorkloadRow[]>(Prisma.sql`${scope} SELECT "assigneeId", "assigneeName", COUNT(*) AS count FROM scoped WHERE status IN ('OPEN','IN_PROGRESS') GROUP BY "assigneeId","assigneeName" ORDER BY count DESC, "assigneeName" ASC NULLS LAST, "assigneeId" ASC NULLS LAST`);
      const tasks = await tx.$queryRaw<TaskRow[]>(Prisma.sql`${scope} SELECT t.state::text AS state, COUNT(*) AS count FROM "CaseTask" t JOIN scoped c ON c.id=t."caseId" AND c."tenantId"=t."tenantId" GROUP BY t.state`);
      const m = metrics[0];
      const n = (value: bigint) => Number(value);
      return { asOf, tenantId, filters: q, counts: { total: n(m.total), OPEN: n(m.open), IN_PROGRESS: n(m.inProgress), RESOLVED: n(m.resolved), CLOSED: n(m.closed) }, workload: { active: n(m.active), byAssignee: workload.map(w => ({ assigneeId: w.assigneeId, assigneeName: w.assigneeName || 'Unassigned', count: n(w.count) })), tasks: Object.fromEntries(['TODO','IN_PROGRESS','DONE','CANCELLED'].map(state => [state, n(tasks.find(task => task.state === state)?.count || 0n)])) }, overdue: { count: n(m.overdue), approachingSevenDays: n(m.approaching), missingDue: n(m.missingDue) }, aging: { open: m.openAging, firstClosure: m.closedAging }, resolution: { first: m.resolution, missingHistoricalEvents: n(m.missingResolution) }, origins: Object.fromEntries(['MANUAL','INDICATOR','ASM_ALERT','ASM_FINDING','APPSEC_FINDING','LEGACY_UNKNOWN'].map(kind => [kind, m.origins[kind] || 0])), reviewQueue: { pending: n(m.pending), approvedDecisions: n(m.approved), rejectedDecisions: n(m.rejected) }, reopening: { cases: n(m.reopenedCases), events: n(m.reopenEvents), totalCycles: n(m.cycles) }, limitations: { missingFirstClosure: n(m.missingClosure), notes: ['Legacy cases without origin remain LEGACY_UNKNOWN.', 'First resolution and first closure require recorded history; missing events are excluded from timing distributions.', 'Median requires five samples and p90 requires ten.', 'Due date counts describe current open workload; historical SLA rates are unavailable.', 'Date filters apply to case creation in UTC, from inclusive and to exclusive.'] } };
    });
  }

  async queue(user: AuthUser, input: OperationsQuery) {
    const tenantId = this.tenant(user, input.tenantId);
    const q = parseOperationsQuery(input);
    const scope = scopeSql(tenantId, q);
    return this.snapshot(async (tx, asOf) => {
      const where = Prisma.sql`WHERE (${q.queue}='ALL' OR (${q.queue}='OVERDUE' AND status IN ('OPEN','IN_PROGRESS') AND "dueAt" < ${asOf}) OR (${q.queue}='APPROACHING' AND status IN ('OPEN','IN_PROGRESS') AND "dueAt" >= ${asOf} AND "dueAt" < ${new Date(asOf.getTime()+7*86400000)}) OR (${q.queue}='REVIEW' AND review='PENDING'))`;
      const totals = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`${scope} SELECT COUNT(*) AS count FROM scoped ${where}`);
      const items = await tx.$queryRaw<QueueRow[]>(Prisma.sql`${scope} SELECT id,"caseNumber",title,status,priority,severity,"assigneeId","assigneeName","createdAt","dueAt",origin,review,"investigationCycle","reopenCount" FROM scoped ${where} ORDER BY "dueAt" ASC NULLS LAST,"createdAt" ASC,id ASC LIMIT ${q.limit} OFFSET ${(q.page-1)*q.limit}`);
      return { asOf, tenantId, page: q.page, limit: q.limit, total: Number(totals[0].count), items: items.map(item => ({ ...item, overdue: item.status !== 'CLOSED' && item.status !== 'RESOLVED' && item.dueAt !== null && item.dueAt < asOf, approaching: item.status !== 'CLOSED' && item.status !== 'RESOLVED' && item.dueAt !== null && item.dueAt >= asOf && item.dueAt < new Date(asOf.getTime()+7*86400000) })) };
    });
  }
}
