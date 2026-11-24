import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { DashboardNotificationQuery } from './dashboard-discovery.dto';

const itemSchema = z.object({ id: z.string(), title: z.string(), preview: z.string(), severity: z.string().nullable(),
  sourceModule: z.enum(['ASM', 'Case', 'AppSec', 'TI']), type: z.string(), createdAt: z.string(), eventAt: z.string(),
  timestampProvenance: z.enum(['UTC_VERIFIED', 'LEGACY_UNKNOWN']), readAt: z.string().nullable(), route: z.string().nullable() });
type Aggregate = { readonly items: Prisma.JsonValue; readonly total: number; readonly unreadCount: number };
type Permissions = { readonly asm: boolean; readonly cases: boolean; readonly appsec: boolean; readonly ti: boolean };

@Injectable()
export class DashboardNotificationsService {
  constructor(private readonly prisma: PrismaService, private readonly access: ModuleAccessService) {}

  private async scope(user: AuthUser, requested?: string) {
    const account = await this.prisma.user.findFirst({ where: { id: user.sub, isActive: true }, select: { role: true, tenantId: true } });
    if (!account || account.role !== user.role || account.tenantId !== user.tenantId) throw new ForbiddenException('Akses notifikasi ditolak');
    if (user.role === 'SUPER_ADMIN' && !requested?.trim()) throw new BadRequestException('Tenant wajib dipilih');
    if (user.role !== 'SUPER_ADMIN' && requested && requested !== account.tenantId) throw new ForbiddenException('Tenant tidak diizinkan');
    const tenantId = user.role === 'SUPER_ADMIN' ? requested : account.tenantId;
    if (!tenantId || !await this.prisma.tenant.findFirst({ where: { id: tenantId, isActive: true }, select: { id: true } })) throw new NotFoundException('Tenant tidak ditemukan');
    const allow = async (slug: string, feature: string) => (user.role === 'SUPER_ADMIN'
      ? await this.access.evaluateForTenant(user, tenantId, slug, [feature])
      : await this.access.evaluate(user, slug, [feature])).accessible;
    const [asm, cases, appsec, ti] = await Promise.all([
      allow('attack-surface-management', 'asset-management'), allow('case-management', 'case-workflow'),
      allow('appsec-posture', 'finding-management'), allow('threat-intelligence', 'indicator-management'),
    ]);
    if (!asm && !cases && !appsec && !ti) throw new ForbiddenException('Akses notifikasi ditolak');
    return { tenantId, permissions: { asm, cases, appsec, ti } };
  }

  private feed(user: AuthUser, tenantId: string, p: Permissions, snapshotAt?: string): Prisma.Sql {
    const context = user.role === 'SUPER_ADMIN' ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
    const assetContext = user.role === 'SUPER_ADMIN' ? `&tenantId=${encodeURIComponent(tenantId)}` : '';
    const cutoff = snapshotAt ? new Date(snapshotAt) : new Date();
    const sources: Prisma.Sql[] = [];
    if (p.asm) sources.push(Prisma.sql`
      SELECT a.id, al.title, al.title AS preview, al.severity::text AS severity, 'ASM'::text AS "sourceModule",
        'ASM_ALERT'::text AS type, COALESCE(a."utcCreatedAt", a."createdAt") AT TIME ZONE 'UTC' AS "createdAt",
        COALESCE(a."utcCreatedAt", a."createdAt") AT TIME ZONE 'UTC' AS "eventAt",
        CASE WHEN a."utcCreatedAt" IS NULL THEN 'LEGACY_UNKNOWN' ELSE 'UTC_VERIFIED' END AS "timestampProvenance",
        r."readAt" AT TIME ZONE 'UTC' AS "readAt",
        CASE WHEN asset.id IS NOT NULL THEN '/attack-surface/assets?assetId=' || asset.id || ${assetContext} ELSE NULL END AS route
      FROM "AsmNotification" a JOIN "Alert" al ON al.id = a."alertId" AND al."tenantId" = a."tenantId"
      LEFT JOIN "Asset" asset ON asset.id = al."assetId" AND asset."tenantId" = a."tenantId"
      LEFT JOIN "AsmNotificationRead" r ON r."notificationId" = a.id AND r."userId" = ${user.sub}
      WHERE a."tenantId" = ${tenantId} AND COALESCE(a."utcCreatedAt", a."createdAt") <= (${cutoff}::timestamptz AT TIME ZONE 'UTC')`);
    const shared = [
      { enabled: p.cases, module: 'CASE', label: 'Case', kind: 'CASE', title: 'Case notification', types: ['CASE_ASSIGNED','CASE_REASSIGNED'],
        route: Prisma.sql`'/cases/' || n."resourceId" || ${context}`, resource: Prisma.sql`EXISTS (SELECT 1 FROM "Case" c WHERE c.id = n."resourceId" AND c."tenantId" = n."tenantId")` },
      { enabled: p.appsec, module: 'APPSEC', label: 'AppSec', kind: 'APPSEC_FINDING', title: 'Finding notification', types: ['APPSEC_FINDING_CREATED_HIGH_RISK','APPSEC_FINDING_REOPENED'],
        route: Prisma.sql`'/appsec/findings/' || n."resourceId" || ${context}`, resource: Prisma.sql`EXISTS (SELECT 1 FROM "AppSecFinding" f WHERE f.id = n."resourceId" AND f."tenantId" = n."tenantId")` },
      { enabled: p.ti, module: 'THREAT_INTELLIGENCE', label: 'TI', kind: 'INDICATOR', title: 'Threat intelligence notification', types: ['INDICATOR_ENRICHMENT_COMPLETED','INDICATOR_ENRICHMENT_FAILED','INDICATOR_RISK_CHANGED','THREAT_CORRELATION_DETECTED'],
        route: Prisma.sql`CASE WHEN n.type = 'THREAT_CORRELATION_DETECTED' THEN '/threat-intelligence/correlations' WHEN n.type = 'INDICATOR_RISK_CHANGED' THEN '/indicators?indicatorId=' || n."resourceId" ELSE '/indicators' END`,
        resource: Prisma.sql`EXISTS (SELECT 1 FROM "Indicator" i WHERE i.id = n."resourceId" AND i."tenantId" = n."tenantId")` },
      { enabled: p.ti, module: 'THREAT_INTELLIGENCE', label: 'TI', kind: 'TENANT', title: 'Synchronization notification', types: ['TI_SYNC_COMPLETED','TI_SYNC_FAILED'],
        route: Prisma.sql`CASE WHEN n.route = '/threat-intelligence/mitre-attack' THEN '/threat-intelligence/mitre-attack' ELSE '/threat-intelligence/feeds' END`,
        resource: Prisma.sql`EXISTS (SELECT 1 FROM "Tenant" t WHERE t.id = n."resourceId" AND t.id = n."tenantId" AND t."isActive" = true)` },
      { enabled: p.ti, module: 'THREAT_INTELLIGENCE', label: 'TI', kind: 'TENANT', title: 'IOC Candidates Ready for Review', types: ['IOC_CANDIDATES_PENDING_REVIEW'],
        route: Prisma.sql`'/threat-intelligence/ioc-candidates'`,
        resource: Prisma.sql`EXISTS (SELECT 1 FROM "Tenant" t WHERE t.id = n."resourceId" AND t.id = n."tenantId" AND t."isActive" = true)` },
    ];
    for (const source of shared) if (source.enabled) sources.push(Prisma.sql`
      SELECT 'shared:' || n.id AS id, CASE WHEN n.type = 'THREAT_CORRELATION_DETECTED' THEN 'Threat Correlation Detected' WHEN n.type = 'INDICATOR_RISK_CHANGED' THEN 'Indicator Risk Increased'
        WHEN n.type = 'TI_SYNC_COMPLETED' THEN 'Threat Intelligence Synced'
        WHEN n.type = 'TI_SYNC_FAILED' THEN 'Threat Intelligence Sync Needs Attention' ELSE ${source.title} END::text AS title, n.preview, n.priority AS severity,
        ${source.label}::text AS "sourceModule", n.type, n."eventAt" AT TIME ZONE 'UTC' AS "createdAt", n."eventAt" AT TIME ZONE 'UTC' AS "eventAt", 'UTC_VERIFIED'::text AS "timestampProvenance", r."readAt" AT TIME ZONE 'UTC' AS "readAt", ${source.route} AS route
      FROM "Notification" n JOIN "NotificationRecipient" r ON r."notificationId" = n.id AND r."tenantId" = n."tenantId" AND r."userId" = ${user.sub}
      WHERE n."tenantId" = ${tenantId} AND (n."expiresAt" IS NULL OR n."expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
        AND n."sourceModule" = ${source.module} AND n."resourceKind" = ${source.kind} AND n.type IN (${Prisma.join(source.types)})
        AND n."createdAt" <= (${cutoff}::timestamptz AT TIME ZONE 'UTC')
        AND n."resourceId" ~ '^[A-Za-z0-9_-]+$' AND ${source.resource}`);
    return Prisma.join(sources, ' UNION ALL ');
  }

  private async aggregate(user: AuthUser, tenantId: string, permissions: Permissions, query: DashboardNotificationQuery) {
    const [result] = await this.prisma.$queryRaw<Aggregate[]>(Prisma.sql`
      WITH feed AS (${this.feed(user, tenantId, permissions, query.snapshotAt)})
      SELECT (SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page."createdAt" DESC, page.id DESC), '[]'::jsonb)
        FROM (SELECT * FROM feed ORDER BY "createdAt" DESC, id DESC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}) page) AS items,
        (SELECT COUNT(*)::int FROM feed) AS total,
        (SELECT COUNT(*)::int FROM feed WHERE "readAt" IS NULL) AS "unreadCount"`);
    return result;
  }

  async list(user: AuthUser, query: DashboardNotificationQuery) {
    const { tenantId, permissions } = await this.scope(user, query.tenantId);
    const [clock] = query.snapshotAt ? [] : await this.prisma.$queryRaw<{ readonly now: Date }[]>(Prisma.sql`SELECT clock_timestamp() AS now`);
    const snapshotAt = query.snapshotAt ?? clock.now.toISOString();
    const pageQuery = { ...query, snapshotAt };
    const partialFailures: string[] = [];
    let result: Aggregate;
    try { result = await this.aggregate(user, tenantId, permissions, pageQuery); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
      const entries = [{ key: 'asm', label: 'ASM' }, { key: 'cases', label: 'Case' }, { key: 'appsec', label: 'AppSec' }, { key: 'ti', label: 'TI' }] as const;
      const checks = await Promise.allSettled(entries.map(source => permissions[source.key]
        ? this.aggregate(user, tenantId, { asm: false, cases: false, appsec: false, ti: false, [source.key]: true }, { ...pageQuery, page: 1, limit: 1 })
        : Promise.resolve(null)));
      const available = { asm: false, cases: false, appsec: false, ti: false };
      checks.forEach((check, index) => {
        if (check.status === 'fulfilled' && check.value) available[entries[index].key] = true;
        else if (check.status === 'rejected') partialFailures.push(entries[index].label);
      });
      if (!Object.values(available).some(Boolean)) throw error;
      result = await this.aggregate(user, tenantId, available, pageQuery);
    }
    const items = z.array(itemSchema).parse(result.items);
    return { items, total: result.total, unreadCount: result.unreadCount, page: query.page, limit: query.limit,
      hasMore: query.page * query.limit < result.total, snapshotAt, partialFailures, countsPartial: partialFailures.length > 0 };
  }

  async markRead(user: AuthUser, id: string, requested?: string) {
    const { tenantId, permissions } = await this.scope(user, requested);
    const shared = id.startsWith('shared:');
    const notificationId = shared ? id.slice(7) : id;
    if (!/^[A-Za-z0-9_-]+$/.test(notificationId)) throw new NotFoundException('Notification tidak ditemukan');
    return this.prisma.$transaction(async tx => {
      const source = shared ? await tx.notification.findFirst({
        where: { id: notificationId, tenantId, recipients: { some: { tenantId, userId: user.sub } } },
        select: { sourceModule: true },
      }) : null;
      const selected: Permissions = {
        asm: !shared && permissions.asm,
        cases: source?.sourceModule === 'CASE' && permissions.cases,
        appsec: source?.sourceModule === 'APPSEC' && permissions.appsec,
        ti: source?.sourceModule === 'THREAT_INTELLIGENCE' && permissions.ti,
      };
      if (!Object.values(selected).some(Boolean)) throw new NotFoundException('Notification tidak ditemukan');
      const rows = await tx.$queryRaw<{ readonly id: string; readonly route: string | null }[]>(Prisma.sql`WITH feed AS (${this.feed(user, tenantId, selected)}) SELECT id, route FROM feed WHERE id = ${id} LIMIT 1`);
      if (rows.length !== 1) throw new NotFoundException('Notification tidak ditemukan');
      if (shared) {
        const key = { notificationId, userId: user.sub };
        const current = await tx.notificationRecipient.findUniqueOrThrow({ where: { notificationId_userId: key } });
        if (current.readAt) return { id, readAt: current.readAt, route: rows[0].route };
        await tx.notificationRecipient.updateMany({ where: { ...key, tenantId, readAt: null }, data: { readAt: new Date() } });
        const read = await tx.notificationRecipient.findUniqueOrThrow({ where: { notificationId_userId: key } });
        return { id, readAt: read.readAt, route: rows[0].route };
      }
      const read = await tx.asmNotificationRead.upsert({ where: { notificationId_userId: { notificationId: id, userId: user.sub } },
        create: { notificationId: id, userId: user.sub }, update: {} });
      return { id, readAt: read.readAt, route: rows[0].route };
    });
  }
}
