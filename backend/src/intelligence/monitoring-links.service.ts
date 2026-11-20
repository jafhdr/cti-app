import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ModuleAccessService } from '../auth/module-access.service';
import { CasesService } from '../cases/cases.service';
import type { AuthUser } from '../users/users.types';
import type { CaseLinkInput } from './monitoring.dto';
import { monitoringTenant } from './monitoring.service';

@Injectable()
export class MonitoringLinksService {
  constructor(private readonly prisma: PrismaService, private readonly cases: CasesService, private readonly access: ModuleAccessService) {}

  private async confirmed(user: AuthUser, id: string, requested?: string) {
    const tenantId = monitoringTenant(user, requested);
    const finding = await this.prisma.monitoringFinding.findFirst({ where: { id, tenantId, status: 'CONFIRMED', match: { observation: { expiresAt: { gt: new Date() } } } }, include: { match: { include: { observation: true, watchlist: true } } } });
    if (!finding) throw new NotFoundException('Confirmed finding not found');
    return finding;
  }

  async alert(user: AuthUser, id: string, requested?: string) {
    const finding = await this.confirmed(user, id, requested);
    if (finding.alertId) return this.prisma.alert.findFirstOrThrow({ where: { id: finding.alertId, tenantId: finding.tenantId } });
    return this.prisma.$transaction(async tx => {
      const alert = await tx.alert.upsert({ where: { tenantId_source_sourceKey: { tenantId: finding.tenantId, source: 'MONITORING', sourceKey: id } }, create: { tenantId: finding.tenantId, source: 'MONITORING', sourceKey: id, title: `Monitoring: ${finding.match.observation.kind}`, description: `Synthetic evidence for ${finding.match.watchlist.label}`, severity: finding.match.severity, assetId: finding.match.watchlist.assetId }, update: {} });
      await tx.monitoringFinding.update({ where: { id }, data: { alertId: alert.id, alertTenantId: finding.tenantId } });
      await tx.auditLog.create({ data: { tenantId: finding.tenantId, userId: user.sub, action: 'MONITORING_ALERT_LINKED', metadata: { findingId: id, alertId: alert.id } } });
      return alert;
    });
  }

  async case(user: AuthUser, id: string, input: CaseLinkInput, requested?: string) {
    const finding = await this.confirmed(user, id, requested);
    const decision = await this.access.evaluateForTenant(user, finding.tenantId, 'case-management', ['case-workflow']);
    if (!decision.accessible) throw new ForbiddenException('Case Management access required');
    return this.prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "MonitoringFinding" WHERE "id" = ${id} AND "tenantId" = ${finding.tenantId} FOR UPDATE`;
      if (locked.length !== 1) throw new NotFoundException('Confirmed finding not found');
      const current = await tx.monitoringFinding.findFirst({ where: { id, tenantId: finding.tenantId, status: 'CONFIRMED', match: { observation: { expiresAt: { gt: new Date() } } } } });
      if (!current) throw new NotFoundException('Confirmed finding not found');
      if (current.caseId) {
        if (input.caseId && input.caseId !== current.caseId) throw new ConflictException('Finding already linked to another case');
        return tx.case.findFirstOrThrow({ where: { id: current.caseId, tenantId: finding.tenantId } });
      }
      let linkedCaseId = input.caseId;
      if (linkedCaseId) {
        const existing = await tx.case.findFirst({ where: { id: linkedCaseId, tenantId: finding.tenantId }, select: { id: true } });
        if (!existing) throw new NotFoundException('Tenant case not found');
      } else {
        const created = await this.cases.create(user, { tenantId: finding.tenantId, title: `Monitoring investigation: ${finding.match.observation.kind}`, description: `Synthetic monitoring finding ${id}`, severity: finding.match.severity }, tx);
        linkedCaseId = created.id;
      }
      const changed = await tx.monitoringFinding.updateMany({ where: { id, tenantId: finding.tenantId, caseId: null, status: 'CONFIRMED' }, data: { caseId: linkedCaseId, caseTenantId: finding.tenantId } });
      if (changed.count !== 1) throw new ConflictException('Finding link changed');
      await tx.auditLog.create({ data: { tenantId: finding.tenantId, userId: user.sub, action: 'MONITORING_CASE_LINKED', metadata: { findingId: id, caseId: linkedCaseId } } });
      return tx.case.findFirstOrThrow({ where: { id: linkedCaseId, tenantId: finding.tenantId } });
    });
  }
}
