import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { CasesService } from '../cases/cases.service';
import { effectiveIndicatorEligibility } from '../indicators/indicator-eligibility';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';

@Injectable()
export class CorrelationCaseService {
  constructor(private readonly prisma: PrismaService, private readonly access: ModuleAccessService, private readonly cases: CasesService) {}

  private async tenant(user: AuthUser, requested?: string): Promise<string> {
    const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/disabled').pathname.slice(1);
    if (process.env.THREAT_CORRELATION_PILOT_ENABLED !== 'true' || process.env.SICTI_ISOLATED_QA !== 'true' || !/^cti_corr_qa_[a-z0-9_]+$/.test(database)) throw new NotFoundException('Correlation pilot unavailable');
    const tenantId = user.role === 'SUPER_ADMIN' ? requested : user.tenantId;
    if (!tenantId || (requested && requested !== tenantId)) throw new ForbiddenException('Tenant context denied');
    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, isActive: true }, select: { id: true } });
    if (!tenant) throw new NotFoundException('Tenant unavailable');
    const decision = await this.access.evaluateForTenant(user, tenantId, 'case-management', ['case-workflow']);
    if (!decision.accessible) throw new ForbiddenException(decision.reason);
    return tenantId;
  }

  private async correlation(tx: Prisma.TransactionClient, tenantId: string, alertId: string) {
    const row = await tx.threatCorrelation.findFirst({ where: { tenantId, alertId }, include: { alert: true, event: true, indicator: true } });
    if (!row || row.alert.source !== 'CORRELATION') throw new NotFoundException('Correlation alert unavailable');
    return row;
  }

  async get(user: AuthUser, alertId: string, requested?: string) {
    const tenantId = await this.tenant(user, requested);
    const row = await this.prisma.threatCorrelation.findFirst({ where: { tenantId, alertId, ...(user.role === 'USER' ? { event: { tlp: { not: 'RED' as const } } } : {}) }, include: { alert: { include: { case: { select: { id: true, caseNumber: true, title: true, status: true } } } } } });
    if (!row) throw new NotFoundException('Correlation alert unavailable');
    return { alertId, case: row.alert.case };
  }

  async link(user: AuthUser, alertId: string, input: { caseId?: string; createCase?: true }, requested?: string) {
    const tenantId = await this.tenant(user, requested);
    if ((input.createCase === true) === (typeof input.caseId === 'string' && input.caseId.length > 0)) throw new BadRequestException('Provide exactly one of caseId or createCase');
    return this.prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Alert" WHERE "id" = ${alertId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      if (locked.length !== 1) throw new NotFoundException('Correlation alert unavailable');
      const row = await this.correlation(tx, tenantId, alertId);
      if (row.alert.caseId) {
        if (input.caseId && input.caseId !== row.alert.caseId) throw new ConflictException('Correlation alert already belongs to another case');
        const linked = await tx.case.findFirst({ where: { id: row.alert.caseId, tenantId }, select: { id: true, caseNumber: true, title: true, status: true } });
        if (!linked) throw new NotFoundException('Linked case unavailable');
        return { alertId, case: linked, created: false, repeated: true };
      }
      if (row.alert.status === 'CLOSED' || row.event.observableType !== 'DOMAIN' || row.indicator.type !== 'DOMAIN' || row.event.observableValue !== row.indicator.value || !effectiveIndicatorEligibility(row.indicator, new Date()).eligible) throw new ConflictException('Correlation alert is no longer eligible');
      const target = input.caseId
        ? await tx.case.findFirst({ where: { id: input.caseId, tenantId }, select: { id: true, caseNumber: true, title: true, status: true } })
        : await this.cases.create(user, { tenantId, title: `Threat correlation: ${row.event.observableValue}`, description: `Correlation alert ${alertId}; indicator ${row.indicatorId}`, severity: row.alert.severity }, tx);
      if (!target) throw new NotFoundException('Case unavailable');
      if (target.status === 'RESOLVED' || target.status === 'CLOSED') throw new ConflictException('Case is not active');
      await tx.alert.update({ where: { id: alertId }, data: { caseId: target.id } });
      const metadata = { alertId, correlationId: row.id, caseId: target.id, createdCase: input.createCase === true };
      await tx.caseActivity.create({ data: { tenantId, caseId: target.id, actorId: user.sub, action: 'CORRELATION_ALERT_LINKED', metadata } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'CORRELATION_ALERT_CASE_LINKED', metadata } });
      return { alertId, case: target, created: input.createCase === true, repeated: false };
    });
  }
}
