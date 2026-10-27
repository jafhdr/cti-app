import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IntelligenceSourceReliability, IntelligenceSourceStatus, Prisma, TlpLevel } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { CreateSourceDto, ListSourcesQueryDto, UpdateSourceDto } from './sources.dto';

const sortableFields = ['name', 'provider', 'sourceType', 'reliability', 'confidence', 'tlp', 'status', 'lastSyncAt', 'createdAt', 'updatedAt'] as const;
type SortableField = typeof sortableFields[number];

@Injectable()
export class SourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, query: ListSourcesQueryDto) {
    const tenantId = this.resolveTenant(user, query.tenantId);
    const search = query.search?.trim();
    const where: Prisma.IntelligenceSourceWhereInput = {
      tenantId,
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.tlp ? { tlp: query.tlp } : {}),
      ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { provider: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] } : {}),
    };
    const sortBy = this.sortField(query.sortBy);
    const sortOrder: Prisma.SortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const [items, total] = await this.prisma.$transaction([
      this.prisma.intelligenceSource.findMany({ where, orderBy: { [sortBy]: sortOrder }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.intelligenceSource.count({ where }),
    ]);
    return { items, page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  }

  async get(user: AuthUser, id: string, requestedTenantId?: string) {
    return this.scopedSource(user, id, requestedTenantId);
  }

  async create(user: AuthUser, input: CreateSourceDto, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Nama source wajib diisi');
    const lastSyncAt = this.date(input.lastSyncAt);
    try {
      const source = await this.prisma.intelligenceSource.create({ data: {
        tenantId, name, description: input.description?.trim() || null, sourceType: input.sourceType,
        provider: input.provider?.trim() || null, url: input.url?.trim() || null,
        reliability: input.reliability ?? IntelligenceSourceReliability.C, confidence: input.confidence ?? 50,
        tlp: input.tlp ?? TlpLevel.AMBER, status: input.status ?? IntelligenceSourceStatus.ACTIVE,
        lastSyncAt, createdBy: user.sub,
        telegramChatId: input.telegramChatId?.trim() || null,
      } });
      await this.audit(user, tenantId, 'SOURCE_CREATED', source.id, { name: source.name });
      return source;
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async update(user: AuthUser, id: string, input: UpdateSourceDto, requestedTenantId?: string) {
    const existing = await this.scopedSource(user, id, requestedTenantId);
    const name = input.name?.trim();
    if (input.name !== undefined && !name) throw new BadRequestException('Nama source wajib diisi');
    const data: Prisma.IntelligenceSourceUpdateInput = {
      ...(name !== undefined ? { name } : {}), ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
      ...(input.sourceType !== undefined ? { sourceType: input.sourceType } : {}), ...(input.provider !== undefined ? { provider: input.provider.trim() || null } : {}),
      ...(input.url !== undefined ? { url: input.url.trim() || null } : {}), ...(input.reliability !== undefined ? { reliability: input.reliability } : {}),
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}), ...(input.tlp !== undefined ? { tlp: input.tlp } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}), ...(input.lastSyncAt !== undefined ? { lastSyncAt: this.date(input.lastSyncAt) } : {}),
      ...(input.telegramChatId !== undefined ? { telegramChatId: input.telegramChatId.trim() || null } : {}),
    };
    try {
      const source = await this.prisma.intelligenceSource.update({ where: { id }, data });
      await this.audit(user, existing.tenantId, 'SOURCE_UPDATED', id, { name: source.name });
      if (input.status !== undefined && input.status !== existing.status) await this.audit(user, existing.tenantId, 'SOURCE_STATUS_CHANGED', id, { from: existing.status, to: input.status });
      return source;
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async remove(user: AuthUser, id: string, requestedTenantId?: string) {
    const source = await this.scopedSource(user, id, requestedTenantId);
    try {
      await this.prisma.$transaction(async tx => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "IntelligenceSource" WHERE id = ${id} AND "tenantId" = ${source.tenantId} FOR UPDATE`;
        if (!locked.length) throw new NotFoundException('Intelligence source tidak ditemukan');
        if (await tx.collectionTask.count({ where: { tenantId: source.tenantId, sourceId: id } })) throw new ConflictException('Source is linked to a collection task and cannot be deleted');
        if (await tx.intelligenceReportSource.count({ where: { tenantId: source.tenantId, sourceId: id } })) throw new ConflictException('Source is cited by an intelligence report and cannot be deleted');
        if (await tx.telegramStagingMessage.count({ where: { tenantId: source.tenantId, intelligenceSourceId: id } })) throw new ConflictException('Source has Telegram ingestion history and cannot be deleted');
        if (await tx.iocCandidate.count({ where: { tenantId: source.tenantId, intelligenceSourceId: id } })) throw new ConflictException('Source has IOC candidates and cannot be deleted');
        if (await tx.telegramPollingState.count({ where: { tenantId: source.tenantId, intelligenceSourceId: id } })) throw new ConflictException('Source has Telegram polling state and cannot be deleted');
        await tx.intelligenceSource.delete({ where: { id } });
        await tx.auditLog.create({ data: { userId: user.sub, tenantId: source.tenantId, action: 'SOURCE_DELETED', metadata: { sourceId: id, name: source.name } } });
      });
      const archived = await this.prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM "SourceReliabilityAssessment" WHERE "tenantId" = ${source.tenantId} AND "originalSourceId" = ${id}`;
      return { deleted: true, id, archivedAssessments: archived[0].total > 0 };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2003' || error.code === 'P2014')) throw new ConflictException('Source is referenced by collection, reports, ingestion, or other intelligence records');
      if (error instanceof Prisma.PrismaClientUnknownRequestError && /code: "23001"|foreign key constraint|violates RESTRICT setting/.test(error.message)) throw new ConflictException('Source is referenced by another intelligence record and cannot be deleted');
      throw error;
    }
  }

  private resolveTenant(user: AuthUser, requestedTenantId?: string): string {
    if (user.role === 'SUPER_ADMIN') {
      if (!requestedTenantId) throw new BadRequestException('Tenant wajib dipilih');
      return requestedTenantId;
    }
    return this.tenantId(user);
  }

  private tenantId(user: AuthUser): string {
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }

  private async scopedSource(user: AuthUser, id: string, requestedTenantId?: string) {
    const source = await this.prisma.intelligenceSource.findFirst({ where: { id, tenantId: this.resolveTenant(user, requestedTenantId) } });
    if (!source) throw new NotFoundException('Intelligence source tidak ditemukan');
    return source;
  }

  private sortField(value?: string): SortableField { return sortableFields.find(field => field === value) ?? 'updatedAt'; }
  private date(value?: string): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Tanggal sinkronisasi tidak valid');
    return parsed;
  }
  private rethrowConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Source dengan nama tersebut sudah ada pada tenant ini');
    throw error;
  }
  private audit(actor: AuthUser, tenantId: string, action: string, sourceId: string, metadata: Record<string, string>) {
    return this.prisma.auditLog.create({ data: { userId: actor.sub, tenantId, action, metadata: { sourceId, ...metadata } } });
  }
}
