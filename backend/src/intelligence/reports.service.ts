import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { CreateReportDto, ListReportsQueryDto, UpdateReportDto } from './reports.dto';

export type ReportRelationKind = 'threat-actors' | 'campaigns' | 'indicators' | 'malware-tools' | 'vulnerabilities' | 'sources';
const detailInclude = {
  threatActors: { include: { threatActor: { select: { id: true, entity: { select: { name: true } } } } } },
  campaigns: { include: { campaign: { select: { id: true, name: true } } } },
  indicators: { include: { indicator: { select: { id: true, value: true, type: true } } } },
  malwareTools: { include: { malwareTool: { select: { id: true, name: true, type: true } } } },
  vulnerabilities: { include: { vulnerability: { select: { id: true, cveId: true, name: true } } } },
  sources: { include: { source: { select: { id: true, name: true, sourceType: true } } } },
  _count: { select: { threatActors: true, campaigns: true, indicators: true, malwareTools: true, vulnerabilities: true, sources: true } },
} satisfies Prisma.IntelligenceReportInclude;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(user: AuthUser, query: ListReportsQueryDto) {
    const tenantId = this.resolveTenant(user, query.tenantId); const search = query.search?.trim();
    const where: Prisma.IntelligenceReportWhereInput = { tenantId, pirId: null, ...(query.status ? { status: query.status } : {}), ...(query.reportType ? { reportType: query.reportType } : {}), ...(search ? { OR: [{ title: { contains: search, mode: 'insensitive' } }, { summary: { contains: search, mode: 'insensitive' } }, { content: { contains: search, mode: 'insensitive' } }] } : {}) };
    const [items, total] = await this.prisma.$transaction([this.prisma.intelligenceReport.findMany({ where, include: detailInclude, orderBy: this.orderBy(query.sortBy, query.sortOrder), skip: (query.page - 1) * query.limit, take: query.limit }), this.prisma.intelligenceReport.count({ where })]);
    return { items, page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  }
  async relations(user: AuthUser, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const [threatActors, campaigns, indicators, malwareTools, vulnerabilities, sources] = await this.prisma.$transaction([
      this.prisma.threatActor.findMany({ where: { tenantId }, select: { id: true, entity: { select: { name: true } } } }),
      this.prisma.campaign.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      this.prisma.indicator.findMany({ where: { tenantId }, select: { id: true, value: true, type: true } }),
      this.prisma.malwareTool.findMany({ where: { tenantId }, select: { id: true, name: true, type: true } }),
      this.prisma.vulnerability.findMany({ where: { tenantId }, select: { id: true, cveId: true, name: true } }),
      this.prisma.intelligenceSource.findMany({ where: { tenantId }, select: { id: true, name: true, sourceType: true } }),
    ]); return { threatActors, campaigns, indicators, malwareTools, vulnerabilities, sources };
  }
  async get(user: AuthUser, id: string, tenantId?: string) { return this.scoped(user, id, tenantId); }
  async create(user: AuthUser, input: CreateReportDto, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId); const title = input.title.trim();
    if (!title || !input.summary.trim() || !input.content.trim()) throw new BadRequestException('Title, summary, dan content wajib diisi');
    try { const item = await this.prisma.intelligenceReport.create({ data: { tenantId, title, summary: input.summary.trim(), content: input.content.trim(), reportType: input.reportType, tlp: input.tlp, status: input.status, publishedAt: this.publishedAt(input.status, input.publishedAt) }, include: detailInclude }); await this.audit(user, tenantId, 'INTELLIGENCE_REPORT_CREATED', item.id, item.title); return item; } catch (error) { this.rethrowConflict(error); }
  }
  async update(user: AuthUser, id: string, input: UpdateReportDto, requestedTenantId?: string) {
    const existing = await this.scoped(user, id, requestedTenantId); this.ensureLegacy(existing); const title = input.title?.trim(); const summary = input.summary?.trim(); const content = input.content?.trim();
    if ((input.title !== undefined && !title) || (input.summary !== undefined && !summary) || (input.content !== undefined && !content)) throw new BadRequestException('Title, summary, dan content tidak boleh kosong');
    try { const item = await this.prisma.intelligenceReport.update({ where: { id }, data: { ...(title ? { title } : {}), ...(summary ? { summary } : {}), ...(content ? { content } : {}), ...(input.reportType ? { reportType: input.reportType } : {}), ...(input.tlp ? { tlp: input.tlp } : {}), ...(input.status ? { status: input.status, publishedAt: this.publishedAt(input.status, input.publishedAt, existing.publishedAt) } : input.publishedAt ? { publishedAt: new Date(input.publishedAt) } : {}) }, include: detailInclude }); await this.audit(user, existing.tenantId, 'INTELLIGENCE_REPORT_UPDATED', id, item.title); return item; } catch (error) { this.rethrowConflict(error); }
  }
  async remove(user: AuthUser, id: string, tenantId?: string) { const item = await this.scoped(user, id, tenantId); this.ensureLegacy(item); await this.prisma.intelligenceReport.delete({ where: { id } }); await this.audit(user, item.tenantId, 'INTELLIGENCE_REPORT_DELETED', id, item.title); return { deleted: true, id }; }
  async setRelation(user: AuthUser, id: string, kind: ReportRelationKind, relatedId: string, attach: boolean, requestedTenantId?: string) {
    const report = await this.scoped(user, id, requestedTenantId); this.ensureLegacy(report); const tenantId = report.tenantId;
    if (kind === 'threat-actors') {
      if (!await this.prisma.threatActor.findFirst({ where: { id: relatedId, tenantId } })) throw new BadRequestException('Entitas terkait tidak ditemukan pada tenant ini');
      if (attach) await this.prisma.intelligenceReportThreatActor.create({ data: { reportId: id, threatActorId: relatedId, tenantId } }); else await this.prisma.intelligenceReportThreatActor.deleteMany({ where: { reportId: id, threatActorId: relatedId, tenantId } });
    } else if (kind === 'campaigns') {
      if (!await this.prisma.campaign.findFirst({ where: { id: relatedId, tenantId } })) throw new BadRequestException('Entitas terkait tidak ditemukan pada tenant ini');
      if (attach) await this.prisma.intelligenceReportCampaign.create({ data: { reportId: id, campaignId: relatedId, tenantId } }); else await this.prisma.intelligenceReportCampaign.deleteMany({ where: { reportId: id, campaignId: relatedId, tenantId } });
    } else if (kind === 'indicators') {
      if (!await this.prisma.indicator.findFirst({ where: { id: relatedId, tenantId } })) throw new BadRequestException('Entitas terkait tidak ditemukan pada tenant ini');
      if (attach) await this.prisma.intelligenceReportIndicator.create({ data: { reportId: id, indicatorId: relatedId, tenantId } }); else await this.prisma.intelligenceReportIndicator.deleteMany({ where: { reportId: id, indicatorId: relatedId, tenantId } });
    } else if (kind === 'malware-tools') {
      if (!await this.prisma.malwareTool.findFirst({ where: { id: relatedId, tenantId } })) throw new BadRequestException('Entitas terkait tidak ditemukan pada tenant ini');
      if (attach) await this.prisma.intelligenceReportMalwareTool.create({ data: { reportId: id, malwareToolId: relatedId, tenantId } }); else await this.prisma.intelligenceReportMalwareTool.deleteMany({ where: { reportId: id, malwareToolId: relatedId, tenantId } });
    } else if (kind === 'vulnerabilities') {
      if (!await this.prisma.vulnerability.findFirst({ where: { id: relatedId, tenantId } })) throw new BadRequestException('Entitas terkait tidak ditemukan pada tenant ini');
      if (attach) await this.prisma.intelligenceReportVulnerability.create({ data: { reportId: id, vulnerabilityId: relatedId, tenantId } }); else await this.prisma.intelligenceReportVulnerability.deleteMany({ where: { reportId: id, vulnerabilityId: relatedId, tenantId } });
    } else if (kind === 'sources') {
      if (!await this.prisma.intelligenceSource.findFirst({ where: { id: relatedId, tenantId } })) throw new BadRequestException('Entitas terkait tidak ditemukan pada tenant ini');
      if (attach) await this.prisma.intelligenceReportSource.create({ data: { reportId: id, sourceId: relatedId, tenantId } }); else await this.prisma.intelligenceReportSource.deleteMany({ where: { reportId: id, sourceId: relatedId, tenantId } });
    } else throw new BadRequestException('Jenis relasi tidak valid');
    await this.audit(user, tenantId, attach ? 'INTELLIGENCE_REPORT_RELATION_ATTACHED' : 'INTELLIGENCE_REPORT_RELATION_DETACHED', id, kind);
    return this.scoped(user, id, requestedTenantId);
  }
  private ensureLegacy(report: { pirId: string | null }) { if (report.pirId) throw new ConflictException('Analysis reports use the protected analysis workflow'); }
  private resolveTenant(user: AuthUser, requestedTenantId?: string) { if (user.role === 'SUPER_ADMIN') { if (!requestedTenantId) throw new BadRequestException('Tenant wajib dipilih'); return requestedTenantId; } if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia'); return user.tenantId; }
  private async scoped(user: AuthUser, id: string, tenantId?: string) { const item = await this.prisma.intelligenceReport.findFirst({ where: { id, tenantId: this.resolveTenant(user, tenantId), pirId: null }, include: detailInclude }); if (!item) throw new NotFoundException('Intelligence report tidak ditemukan'); return item; }
  private publishedAt(status: string, value?: string, current: Date | null = null) { if (value) return new Date(value); return status === 'PUBLISHED' ? current ?? new Date() : null; }
  private orderBy(field?: string, direction?: string): Prisma.IntelligenceReportOrderByWithRelationInput { const order: Prisma.SortOrder = direction === 'asc' ? 'asc' : 'desc'; if (field === 'title' || field === 'reportType' || field === 'status' || field === 'publishedAt' || field === 'createdAt' || field === 'updatedAt') return { [field]: order }; return { updatedAt: 'desc' }; }
  private rethrowConflict(error: unknown): never { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Report dengan judul tersebut sudah ada pada tenant ini'); throw error; }
  private audit(actor: AuthUser, tenantId: string, action: string, reportId: string, value: string) { return this.prisma.auditLog.create({ data: { userId: actor.sub, tenantId, action, metadata: { reportId, value } } }); }
}
