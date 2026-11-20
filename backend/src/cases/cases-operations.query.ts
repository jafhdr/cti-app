import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const statuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
const origins = ['MANUAL', 'INDICATOR', 'ASM_ALERT', 'ASM_FINDING', 'APPSEC_FINDING', 'LEGACY_UNKNOWN'] as const;
const reviews = ['NONE', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type OperationsQuery = { tenantId?: string; from?: string; to?: string; assigneeId?: string; status?: string; origin?: string; review?: string; page?: string; limit?: string; queue?: string };
export type ParsedOperationsQuery = { from: Date | null; to: Date | null; assigneeId: string | null; status: string | null; origin: string | null; review: string | null; page: number; limit: number; queue: string };

export function parseOperationsQuery(input: OperationsQuery): ParsedOperationsQuery {
  const date = (value?: string): Date | null => {
    if (!value) return null;
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) throw new BadRequestException('Date filter must be UTC ISO-8601');
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Invalid date filter');
    return parsed;
  };
  const from = date(input.from);
  const to = date(input.to);
  if (from && to && from >= to) throw new BadRequestException('from must precede to');
  if (from && to && to.getTime() - from.getTime() > 366 * 86400000) throw new BadRequestException('Date range exceeds 366 days');
  if (input.status && !statuses.includes(input.status as typeof statuses[number])) throw new BadRequestException('Invalid status');
  if (input.origin && !origins.includes(input.origin as typeof origins[number])) throw new BadRequestException('Invalid origin');
  if (input.review && !reviews.includes(input.review as typeof reviews[number])) throw new BadRequestException('Invalid review');
  const queue = input.queue || 'ALL';
  if (!['ALL', 'OVERDUE', 'APPROACHING', 'REVIEW'].includes(queue)) throw new BadRequestException('Invalid queue');
  const page = input.page === undefined ? 1 : Number(input.page);
  const limit = input.limit === undefined ? 25 : Number(input.limit);
  if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('Invalid pagination');
  if (input.assigneeId && (input.assigneeId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(input.assigneeId))) throw new BadRequestException('Invalid assignee');
  return { from, to, assigneeId: input.assigneeId || null, status: input.status || null, origin: input.origin || null, review: input.review || null, page, limit, queue };
}

export function scopeSql(tenantId: string, q: ParsedOperationsQuery): Prisma.Sql {
  return Prisma.sql`WITH scoped AS (
    SELECT c.id, c."tenantId", c."caseNumber", c.title, c.status::text AS status, c.priority::text AS priority,
      c.severity::text AS severity, c."assigneeId", u.name AS "assigneeName", c."createdAt", c."dueAt", c."investigationCycle",
      COALESCE(o.kind::text, 'LEGACY_UNKNOWN') AS origin,
      CASE WHEN rr.id IS NULL THEN 'NONE' WHEN rd.id IS NULL THEN 'PENDING' ELSE rd.kind::text END AS review,
      (SELECT MIN(a."createdAt") FROM "CaseActivity" a WHERE a."tenantId" = c."tenantId" AND a."caseId" = c.id
        AND a.action = 'CASE_STATUS_CHANGED' AND a.metadata->>'toStatus' = 'RESOLVED') AS "firstResolvedAt",
      (SELECT MIN(cl."closedAt") FROM "CaseClosure" cl WHERE cl."tenantId" = c."tenantId" AND cl."caseId" = c.id AND cl.cycle = 1) AS "firstClosedAt",
      (SELECT COUNT(*)::integer FROM "CaseReopen" re WHERE re."tenantId" = c."tenantId" AND re."caseId" = c.id) AS "reopenCount",
      (SELECT COUNT(*)::integer FROM "CaseReviewDecision" d WHERE d."tenantId" = c."tenantId" AND d."caseId" = c.id AND d.kind = 'APPROVED') AS "approvedCount",
      (SELECT COUNT(*)::integer FROM "CaseReviewDecision" d WHERE d."tenantId" = c."tenantId" AND d."caseId" = c.id AND d.kind = 'REJECTED') AS "rejectedCount"
    FROM "Case" c
    LEFT JOIN "User" u ON u.id = c."assigneeId" AND u."tenantId" = c."tenantId"
    LEFT JOIN "CaseOrigin" o ON o."caseId" = c.id AND o."tenantId" = c."tenantId"
    LEFT JOIN LATERAL (SELECT r.id FROM "CaseReviewRequest" r WHERE r."caseId" = c.id AND r."tenantId" = c."tenantId" AND r.cycle = c."investigationCycle" ORDER BY r."createdAt" DESC, r.id DESC LIMIT 1) rr ON true
    LEFT JOIN "CaseReviewDecision" rd ON rd."reviewId" = rr.id AND rd."tenantId" = c."tenantId"
    WHERE c."tenantId" = ${tenantId}
      AND (${q.from}::timestamp IS NULL OR c."createdAt" >= ${q.from}::timestamp)
      AND (${q.to}::timestamp IS NULL OR c."createdAt" < ${q.to}::timestamp)
      AND (${q.assigneeId}::text IS NULL OR (${q.assigneeId} = 'unassigned' AND c."assigneeId" IS NULL) OR c."assigneeId" = ${q.assigneeId})
      AND (${q.status}::text IS NULL OR c.status::text = ${q.status})
      AND (${q.origin}::text IS NULL OR COALESCE(o.kind::text, 'LEGACY_UNKNOWN') = ${q.origin})
      AND (${q.review}::text IS NULL OR CASE WHEN rr.id IS NULL THEN 'NONE' WHEN rd.id IS NULL THEN 'PENDING' ELSE rd.kind::text END = ${q.review})
  )`;
}
