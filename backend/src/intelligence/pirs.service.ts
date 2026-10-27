import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PirStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { CreatePirDto, ListPirsQueryDto, UpdatePirDto } from './pirs.dto';
import { StakeholdersService } from './stakeholders.service';

const detailInclude = {
  stakeholder: { select: { id: true, name: true, scope: true, category: true, isActive: true, intelligenceInterests: true, reportingFormat: true, reportingFrequency: true, distributionChannel: true, classificationPreference: true } },
  responsibleUser: { select: { id: true, name: true, email: true } },
} satisfies Prisma.PirInclude;

const nextStatuses: Record<PirStatus, readonly PirStatus[]> = {
  OPEN: ['IN_COLLECTION', 'EXPIRED'],
  IN_COLLECTION: ['IN_ANALYSIS', 'EXPIRED'],
  IN_ANALYSIS: ['ANSWERED', 'EXPIRED'],
  ANSWERED: ['OPEN'],
  EXPIRED: ['OPEN'],
};

@Injectable()
export class PirsService {
  constructor(private readonly prisma: PrismaService, private readonly stakeholdersService: StakeholdersService) {}

  private tenant(user: AuthUser, requested?: string): string {
    if (user.role === 'SUPER_ADMIN') { if (!requested) throw new BadRequestException('Tenant wajib dipilih'); return requested; }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }
  private required(value: string | undefined, label: string): string {
    const trimmed = value?.trim();
    if (!trimmed) throw new BadRequestException(`${label} wajib diisi`);
    return trimmed;
  }
  private async stakeholder(tenantId: string, id: string) {
    const row = await this.prisma.stakeholder.findFirst({ where: { id, tenantId, isActive: true }, select: { id: true } });
    if (!row) throw new BadRequestException('Stakeholder aktif pada tenant yang sama wajib dipilih');
  }
  private async responsible(user: AuthUser, tenantId: string, id?: string | null) {
    if (!id) return;
    const eligible = await this.stakeholdersService.users(user, tenantId);
    if (!eligible.some(row => row.id === id)) throw new BadRequestException('Penanggung jawab harus pengguna SICTI aktif pada tenant yang sama');
  }
  private conflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Referensi PIR sudah digunakan pada tenant ini');
    throw error;
  }
  async list(user: AuthUser, query: ListPirsQueryDto) {
    const tenantId = this.tenant(user, query.tenantId);
    const search = query.search?.trim();
    const where: Prisma.PirWhereInput = { tenantId, ...(query.priority ? { priority: query.priority } : {}), ...(query.status ? { status: query.status } : {}), ...(query.stakeholderId ? { stakeholderId: query.stakeholderId } : {}), ...(search ? { OR: [{ reference: { contains: search, mode: 'insensitive' } }, { title: { contains: search, mode: 'insensitive' } }, { question: { contains: search, mode: 'insensitive' } }] } : {}) };
    const sortBy = query.sortBy ?? 'updatedAt';
    const orderBy: Prisma.PirOrderByWithRelationInput = sortBy === 'dueDate' ? { dueDate: query.sortOrder } : sortBy === 'priority' ? { priority: query.sortOrder } : sortBy === 'reference' ? { reference: query.sortOrder } : { updatedAt: query.sortOrder };
    const [items, total] = await this.prisma.$transaction([this.prisma.pir.findMany({ where, include: detailInclude, orderBy: [orderBy, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }), this.prisma.pir.count({ where })]);
    return { items, total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) };
  }
  async get(user: AuthUser, id: string, requested?: string) {
    const row = await this.prisma.pir.findFirst({ where: { id, tenantId: this.tenant(user, requested) }, include: detailInclude });
    if (!row) throw new NotFoundException('PIR tidak ditemukan');
    return row;
  }
  async stakeholders(user: AuthUser, requested?: string) {
    return this.prisma.stakeholder.findMany({ where: { tenantId: this.tenant(user, requested), isActive: true }, select: { id: true, name: true, category: true, intelligenceInterests: true }, orderBy: { name: 'asc' } });
  }
  users(user: AuthUser, requested?: string) { return this.stakeholdersService.users(user, this.tenant(user, requested)); }
  async create(user: AuthUser, input: CreatePirDto, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const reference = this.required(input.reference, 'Referensi').toUpperCase();
    const title = this.required(input.title, 'Judul');
    const question = this.required(input.question, 'Pertanyaan');
    await this.stakeholder(tenantId, input.stakeholderId);
    await this.responsible(user, tenantId, input.responsibleUserId);
    try {
      return await this.prisma.$transaction(async tx => {
        const row = await tx.pir.create({ data: { tenantId, reference, title, question, stakeholderId: input.stakeholderId, description: input.description?.trim() || null, strategicContext: input.strategicContext?.trim() || null, priority: input.priority ?? 'MEDIUM', responsibleUserId: input.responsibleUserId || null, timeHorizon: input.timeHorizon?.trim() || null, dueDate: input.dueDate ? new Date(input.dueDate) : null, expectedOutcome: input.expectedOutcome?.trim() || null, createdById: user.sub, updatedById: user.sub }, include: detailInclude });
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'PIR_CREATED', metadata: { pirId: row.id, reference } } });
        return row;
      });
    } catch (error) { this.conflict(error); }
  }
  async update(user: AuthUser, id: string, input: UpdatePirDto, requested?: string) {
    const existing = await this.get(user, id, requested);
    if (input.stakeholderId !== undefined && input.stakeholderId !== existing.stakeholderId) await this.stakeholder(existing.tenantId, input.stakeholderId);
    if (input.responsibleUserId !== undefined) await this.responsible(user, existing.tenantId, input.responsibleUserId);
    const data: Prisma.PirUncheckedUpdateInput = { updatedById: user.sub };
    if (input.reference !== undefined) data.reference = this.required(input.reference, 'Referensi').toUpperCase();
    if (input.title !== undefined) data.title = this.required(input.title, 'Judul');
    if (input.question !== undefined) data.question = this.required(input.question, 'Pertanyaan');
    for (const key of ['description', 'strategicContext', 'timeHorizon', 'expectedOutcome'] as const) if (input[key] !== undefined) data[key] = input[key]?.trim() || null;
    if (input.stakeholderId !== undefined) data.stakeholderId = input.stakeholderId;
    if (input.responsibleUserId !== undefined) data.responsibleUserId = input.responsibleUserId || null;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    try {
      return await this.prisma.$transaction(async tx => {
        const row = await tx.pir.update({ where: { id }, data, include: detailInclude });
        await tx.auditLog.create({ data: { tenantId: existing.tenantId, userId: user.sub, action: 'PIR_UPDATED', metadata: { pirId: id, reference: row.reference } } });
        return row;
      });
    } catch (error) { this.conflict(error); }
  }
  async changeStatus(user: AuthUser, id: string, status: PirStatus, requested?: string) {
    const existing = await this.get(user, id, requested);
    if (!nextStatuses[existing.status].includes(status)) throw new BadRequestException(`Transisi ${existing.status} ke ${status} tidak diizinkan`);
    return this.prisma.$transaction(async tx => {
      const changed = await tx.pir.updateMany({ where: { id, tenantId: existing.tenantId, status: existing.status }, data: { status, updatedById: user.sub } });
      if (changed.count !== 1) throw new ConflictException('Status PIR telah berubah. Muat ulang dan coba lagi.');
      await tx.auditLog.create({ data: { tenantId: existing.tenantId, userId: user.sub, action: 'PIR_STATUS_CHANGED', metadata: { pirId: id, from: existing.status, to: status } } });
      return tx.pir.findUniqueOrThrow({ where: { id }, include: detailInclude });
    });
  }
}
