import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AppSecFindingSeverity, AppSecFindingSource, AppSecFindingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { enqueueAppSecFinding } from '../notifications/appsec-finding-event';
import type { AuthUser } from '../users/users.types';
import { CreateFindingDto, ListFindingsDto, UpdateFindingDto } from './appsec.dto';
import { canTransition, isTerminal } from './finding-lifecycle';
import { AppSecTenantContext } from './tenant-context';

@Injectable()
export class FindingsService {
  constructor(private readonly prisma: PrismaService, private readonly context: AppSecTenantContext) {}

  async applicationOptions(user: AuthUser, requested?: string) {
    const tenantId = await this.context.resolve(user, requested);
    return this.prisma.application.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  async list(user: AuthUser, query: ListFindingsDto) {
    const tenantId = await this.context.resolve(user, query.tenantId);
    const search = query.search?.trim();
    const where: Prisma.AppSecFindingWhereInput = {
      tenantId,
      ...(query.applicationId ? { applicationId: query.applicationId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.appSecFinding.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit, include: { application: { select: { id: true, name: true } } } }),
      this.prisma.appSecFinding.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async get(user: AuthUser, id: string, requested?: string) {
    const tenantId = await this.context.resolve(user, requested);
    const finding = await this.prisma.appSecFinding.findFirst({
      where: { id, tenantId },
      include: {
        application: { select: { id: true, name: true } },
        assignee: { select: { name: true, isActive: true } },
      },
    });
    if (!finding) throw new NotFoundException('Finding tidak ditemukan');
    const { assignee, ...record } = finding;
    return { ...record, assigneeName: assignee?.isActive && assignee.name.trim() ? assignee.name.trim() : null };
  }

  async create(user: AuthUser, input: CreateFindingDto, requested?: string) {
    const tenantId = await this.context.resolve(user, requested);
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('Judul wajib');
    const application = await this.prisma.application.findFirst({ where: { id: input.applicationId, tenantId }, select: { id: true } });
    if (!application) throw new NotFoundException('Application tidak ditemukan');
    try {
      return await this.prisma.$transaction(async tx => {
        const finding = await tx.appSecFinding.create({ data: {
          tenantId, applicationId: application.id, title,
          description: input.description?.trim() || null, severity: input.severity,
          status: AppSecFindingStatus.OPEN, source: AppSecFindingSource.MANUAL,
          sourceKey: input.sourceKey?.trim() || null, category: input.category?.trim() || null,
          cweId: input.cweId || null, location: input.location?.trim() || null,
          remediationNote: input.remediationNote?.trim() || null,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
        } });
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'APPSEC_FINDING_CREATED', metadata: { findingId: finding.id, applicationId: application.id } } });
        if (finding.severity === AppSecFindingSeverity.HIGH || finding.severity === AppSecFindingSeverity.CRITICAL) {
          await enqueueAppSecFinding(tx, { tenantId, findingId: finding.id, actorId: user.sub, type: 'APPSEC_FINDING_CREATED_HIGH_RISK' });
        }
        return finding;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Finding dari sumber ini sudah ada');
      throw error;
    }
  }

  async update(user: AuthUser, id: string, input: UpdateFindingDto, requested?: string) {
    const tenantId = await this.context.resolve(user, requested);
    const title = input.title?.trim();
    if (input.title !== undefined && !title) throw new BadRequestException('Judul wajib');
    const resolution = input.resolution?.trim();
    return this.prisma.$transaction(async tx => {
      const existing = await tx.appSecFinding.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Finding tidak ditemukan');
      if (existing.workflowVersion === 2) {
        const protectedFields = ['status', 'resolution', 'resolvedAt', 'validationState', 'verificationState', 'priority', 'priorityRationale', 'assigneeId', 'workflowVersion', 'revision', 'lifecycleCycle'] as const;
        if (protectedFields.some(field => Object.prototype.hasOwnProperty.call(input, field)))
          throw new ConflictException('Gunakan aksi lifecycle untuk mengubah workflow V2');
        if (input.expectedRevision === undefined || input.expectedRevision !== existing.revision)
          throw new ConflictException('Finding berubah; muat ulang');
      }
      if (process.env.APPSEC_V2_VERIFICATION_ENABLED === 'true' && existing.workflowVersion === 1
        && isTerminal(existing.status) && input.status === AppSecFindingStatus.OPEN)
        throw new ConflictException('Gunakan aksi reopen untuk mempertahankan riwayat keputusan');
      const next = input.status ?? existing.status;
      const changed = next !== existing.status;
      if (changed && !canTransition(existing.status, next)) throw new BadRequestException('Transisi status tidak diizinkan');
      if (changed && isTerminal(next) && !resolution) throw new BadRequestException('Resolution wajib untuk status terminal');
      if (!changed && isTerminal(existing.status) && input.resolution !== undefined && !resolution) throw new BadRequestException('Resolution wajib untuk status terminal');
      const data: Prisma.AppSecFindingUpdateManyMutationInput = {
        ...(title !== undefined ? { title } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
        ...(input.severity !== undefined ? { severity: input.severity } : {}),
        ...(input.category !== undefined ? { category: input.category.trim() || null } : {}),
        ...(input.cweId !== undefined ? { cweId: input.cweId || null } : {}),
        ...(input.location !== undefined ? { location: input.location.trim() || null } : {}),
        ...(input.remediationNote !== undefined ? { remediationNote: input.remediationNote.trim() || null } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(input.dueDate) : null } : {}),
        ...(changed ? { status: next, resolvedAt: isTerminal(next) ? new Date() : null, resolution: isTerminal(next) ? resolution : null } :
          input.resolution !== undefined ? { resolution: resolution || null } : {}),
      };
      const result = await tx.appSecFinding.updateMany({ where: { id, tenantId, status: existing.status, ...(existing.workflowVersion === 2 ? { revision: existing.revision } : {}) }, data: { ...data, ...(existing.workflowVersion === 2 ? { revision: { increment: 1 } } : {}) } });
      if (result.count !== 1) throw new ConflictException('Finding berubah; muat ulang dan coba lagi');
      const updated = await tx.appSecFinding.findFirstOrThrow({ where: { id, tenantId } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub,
        action: changed ? 'APPSEC_FINDING_STATUS_CHANGED' : 'APPSEC_FINDING_UPDATED',
        metadata: changed ? {
          findingId: id, applicationId: existing.applicationId, fromStatus: existing.status, toStatus: next,
          ...(existing.resolution ? { previousResolution: existing.resolution } : {}),
          ...(isTerminal(next) && resolution ? { resolution } : {}),
        } : {
          findingId: id, applicationId: existing.applicationId,
          ...(input.resolution !== undefined ? { previousResolution: existing.resolution ?? '', resolution: resolution ?? '' } : {}),
        },
      } });
      if (changed && isTerminal(existing.status) && !isTerminal(next)
        && (updated.severity === AppSecFindingSeverity.HIGH || updated.severity === AppSecFindingSeverity.CRITICAL)) {
        await enqueueAppSecFinding(tx, { tenantId, findingId: id, actorId: user.sub, type: 'APPSEC_FINDING_REOPENED' });
      }
      return updated;
    });
  }
}
