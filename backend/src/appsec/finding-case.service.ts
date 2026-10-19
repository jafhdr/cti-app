import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CasePriority, CaseStatus, Prisma } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { AppSecTenantContext } from './tenant-context';

@Injectable()
export class FindingCaseService {
  constructor(private readonly prisma: PrismaService, private readonly context: AppSecTenantContext, private readonly access: ModuleAccessService) {}

  private async scope(user: AuthUser, requested?: string) {
    const tenantId = await this.context.resolve(user, requested);
    const allowed = await this.access.evaluateForTenant(user, tenantId, 'case-management', ['case-workflow']);
    if (!allowed.accessible) throw new ForbiddenException(allowed.reason);
    return tenantId;
  }

  async get(user: AuthUser, id: string, requested?: string) {
    const tenantId = await this.scope(user, requested);
    const finding = await this.prisma.appSecFinding.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!finding) throw new NotFoundException('Finding tidak ditemukan');
    const link = await this.prisma.appSecFindingCase.findFirst({ where: { findingId: id, tenantId }, select: { case: { select: { id: true, caseNumber: true, title: true, status: true } } } });
    return link?.case ?? null;
  }

  async create(user: AuthUser, id: string, requested?: string) {
    const tenantId = await this.scope(user, requested);
    const finding = await this.prisma.appSecFinding.findFirst({ where: { id, tenantId }, include: { application: { select: { name: true } }, caseLink: { include: { case: true } } } });
    if (!finding) throw new NotFoundException('Finding tidak ditemukan');
    if (finding.caseLink) return this.reused(user, finding.id, finding.applicationId, tenantId, finding.caseLink.case);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
        const prefix = `CASE-${new Date().getFullYear()}-`;
        const pattern = `${prefix}%`;
        const sequence = await tx.$queryRaw<Array<{ number: number }>>`
          SELECT COALESCE(MAX(SUBSTRING("caseNumber" FROM LENGTH(${prefix}) + 1)::integer), 0)::integer AS number
          FROM "Case" WHERE "tenantId" = ${tenantId} AND "caseNumber" LIKE ${pattern}
          AND SUBSTRING("caseNumber" FROM LENGTH(${prefix}) + 1) ~ '^[0-9]+$'`;
        const caseNumber = `${prefix}${String((sequence[0]?.number ?? 0) + 1).padStart(5, '0')}`;
        const created = await tx.case.create({ data: {
          tenantId, caseNumber, title: `AppSec: ${finding.title}`.slice(0, 255),
          description: `Finding: ${finding.title}\nApplication: ${finding.application.name}\nSeverity: ${finding.severity}\nSource: ${finding.source}${finding.cweId ? `\nCWE: ${finding.cweId}` : ''}`,
          status: CaseStatus.OPEN, priority: finding.severity === 'CRITICAL' || finding.severity === 'HIGH' ? CasePriority.HIGH : CasePriority.MEDIUM,
          severity: finding.severity, createdBy: user.sub,
        } });
        await tx.appSecFindingCase.create({ data: { findingId: id, tenantId, caseId: created.id } });
        await tx.caseActivity.create({ data: { tenantId, caseId: created.id, actorId: user.sub, action: 'APPSEC_FINDING_CASE_CREATED', metadata: { findingId: id } } });
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'APPSEC_FINDING_CASE_CREATED', metadata: { findingId: id, applicationId: finding.applicationId, caseId: created.id } } });
        return created;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
          const link = await this.prisma.appSecFindingCase.findFirst({ where: { findingId: id, tenantId }, include: { case: true } });
          if (link) return this.reused(user, id, finding.applicationId, tenantId, link.case);
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Nomor Case sedang dialokasikan, coba lagi');
  }

  private async reused(user: AuthUser, findingId: string, applicationId: string, tenantId: string, existing: { id: string }) {
    await this.prisma.auditLog.create({ data: { tenantId, userId: user.sub, action: 'APPSEC_FINDING_CASE_REUSED', metadata: { findingId, applicationId, caseId: existing.id } } });
    return existing;
  }
}
