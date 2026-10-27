import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PirStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { AnswerSirDto, CreateSirDto, ListSirsQueryDto, UpdateSirDto } from './sirs.dto';
import { StakeholdersService } from './stakeholders.service';

const detailInclude = {
  pir: { select: { id: true, reference: true, title: true, status: true, stakeholderId: true } },
  responsibleUser: { select: { id: true, name: true, email: true } },
} satisfies Prisma.SirInclude;
const nextStatuses: Record<PirStatus, readonly PirStatus[]> = {
  OPEN: ['IN_COLLECTION', 'EXPIRED'],
  IN_COLLECTION: ['IN_ANALYSIS', 'EXPIRED'],
  IN_ANALYSIS: ['ANSWERED', 'EXPIRED'],
  ANSWERED: ['OPEN'],
  EXPIRED: ['OPEN'],
};
const terminal = (status: PirStatus) => status === 'ANSWERED' || status === 'EXPIRED';

@Injectable()
export class SirsService {
  constructor(private readonly prisma: PrismaService, private readonly stakeholders: StakeholdersService) {}
  private tenant(user: AuthUser, requested?: string) {
    if (user.role === 'SUPER_ADMIN') { if (!requested) throw new BadRequestException('Tenant wajib dipilih'); return requested; }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }
  private required(value: string | undefined, label: string) {
    const trimmed = value?.trim();
    if (!trimmed) throw new BadRequestException(`${label} wajib diisi`);
    return trimmed;
  }
  private async parent(tx: Prisma.TransactionClient, tenantId: string, id: string, actionable: boolean) {
    const row = await tx.pir.findFirst({ where: { id, tenantId }, select: { id: true, status: true } });
    if (!row) throw new NotFoundException('PIR tidak ditemukan');
    if (actionable && terminal(row.status)) throw new BadRequestException('PIR harus dibuka kembali sebelum SIR aktif dibuat atau dilanjutkan');
    return row;
  }
  private async responsible(user: AuthUser, tenantId: string, id?: string | null) {
    if (!id) return;
    const eligible = await this.stakeholders.users(user, tenantId);
    if (!eligible.some(row => row.id === id)) throw new BadRequestException('Penanggung jawab harus pengguna SICTI aktif pada tenant yang sama');
  }
  private conflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Referensi SIR sudah digunakan pada tenant ini');
    throw error;
  }
  async list(user: AuthUser, query: ListSirsQueryDto) {
    const tenantId = this.tenant(user, query.tenantId);
    const search = query.search?.trim();
    const where: Prisma.SirWhereInput = { tenantId, ...(query.pirId ? { pirId: query.pirId } : {}), ...(query.priority ? { priority: query.priority } : {}), ...(query.status ? { status: query.status } : {}), ...(search ? { OR: [{ reference: { contains: search, mode: 'insensitive' } }, { title: { contains: search, mode: 'insensitive' } }, { question: { contains: search, mode: 'insensitive' } }] } : {}) };
    const sortBy = query.sortBy ?? 'updatedAt';
    const orderBy: Prisma.SirOrderByWithRelationInput = { [sortBy]: query.sortOrder };
    const [items, total] = await this.prisma.$transaction([this.prisma.sir.findMany({ where, include: detailInclude, orderBy: [orderBy, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }), this.prisma.sir.count({ where })]);
    const groups = await this.prisma.sir.groupBy({ by: ['status'], where: { tenantId, ...(query.pirId ? { pirId: query.pirId } : {}) }, _count: { _all: true }, orderBy: { status: 'asc' } });
    return { items, total, statusCounts: Object.fromEntries(groups.map(group => [group.status, group._count._all])), page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) };
  }
  async get(user: AuthUser, id: string, requested?: string) {
    const row = await this.prisma.sir.findFirst({ where: { id, tenantId: this.tenant(user, requested) }, include: detailInclude });
    if (!row) throw new NotFoundException('SIR tidak ditemukan');
    return row;
  }
  async create(user: AuthUser, input: CreateSirDto, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const reference = this.required(input.reference, 'Referensi').toUpperCase();
    const title = this.required(input.title, 'Judul');
    const question = this.required(input.question, 'Pertanyaan');
    await this.responsible(user, tenantId, input.responsibleUserId);
    try {
      return await this.prisma.$transaction(async tx => {
        await this.parent(tx, tenantId, input.pirId, true);
        const row = await tx.sir.create({ data: { tenantId, pirId: input.pirId, reference, title, question, description: input.description?.trim() || null, intelligenceContext: input.intelligenceContext?.trim() || null, knowledgeGaps: input.knowledgeGaps?.trim() || null, collectionGuidance: input.collectionGuidance?.trim() || null, priority: input.priority ?? 'MEDIUM', responsibleUserId: input.responsibleUserId || null, dueDate: input.dueDate ? new Date(input.dueDate) : null, expectedAnswerCriteria: input.expectedAnswerCriteria?.trim() || null, createdById: user.sub, updatedById: user.sub }, include: detailInclude });
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'SIR_CREATED', metadata: { sirId: row.id, pirId: row.pirId, reference } } });
        return row;
      });
    } catch (error) { this.conflict(error); }
  }
  async update(user: AuthUser, id: string, input: UpdateSirDto, requested?: string) {
    const existing = await this.get(user, id, requested);
    if (input.responsibleUserId !== undefined) await this.responsible(user, existing.tenantId, input.responsibleUserId);
    const data: Prisma.SirUncheckedUpdateInput = { updatedById: user.sub };
    if (input.reference !== undefined) data.reference = this.required(input.reference, 'Referensi').toUpperCase();
    if (input.title !== undefined) data.title = this.required(input.title, 'Judul');
    if (input.question !== undefined) data.question = this.required(input.question, 'Pertanyaan');
    for (const key of ['description', 'intelligenceContext', 'knowledgeGaps', 'collectionGuidance', 'expectedAnswerCriteria'] as const) if (input[key] !== undefined) data[key] = input[key]?.trim() || null;
    if (input.pirId !== undefined) data.pirId = input.pirId;
    if (input.responsibleUserId !== undefined) data.responsibleUserId = input.responsibleUserId || null;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    try {
      return await this.prisma.$transaction(async tx => {
        if (input.pirId) await this.parent(tx, existing.tenantId, input.pirId, !terminal(existing.status));
        const row = await tx.sir.update({ where: { id, tenantId: existing.tenantId }, data, include: detailInclude });
        await tx.auditLog.create({ data: { tenantId: existing.tenantId, userId: user.sub, action: 'SIR_UPDATED', metadata: { sirId: id, pirId: row.pirId, reference: row.reference } } });
        return row;
      });
    } catch (error) { this.conflict(error); }
  }
  async answer(user: AuthUser, id: string, input: AnswerSirDto, requested?: string) {
    const existing = await this.get(user, id, requested);
    const analystAnswer = this.required(input.analystAnswer, 'Jawaban analis');
    if (existing.status !== 'IN_ANALYSIS' && existing.status !== 'ANSWERED') throw new BadRequestException('Jawaban hanya dapat dicatat pada SIR dalam analisis atau sudah dijawab');
    return this.prisma.$transaction(async tx => {
      const row = await tx.sir.update({ where: { id, tenantId: existing.tenantId }, data: { analystAnswer, evidenceNotes: input.evidenceNotes?.trim() || null, updatedById: user.sub }, include: detailInclude });
      await tx.auditLog.create({ data: { tenantId: existing.tenantId, userId: user.sub, action: 'SIR_ANSWER_RECORDED', metadata: { sirId: id, pirId: row.pirId } } });
      return row;
    });
  }
  async changeStatus(user: AuthUser, id: string, status: PirStatus, requested?: string) {
    const existing = await this.get(user, id, requested);
    if (!nextStatuses[existing.status].includes(status)) throw new BadRequestException(`Transisi ${existing.status} ke ${status} tidak diizinkan`);
    if (status === 'ANSWERED' && !existing.analystAnswer?.trim()) throw new BadRequestException('Jawaban analis wajib dicatat sebelum SIR dijawab');
    return this.prisma.$transaction(async tx => {
      if (!terminal(status)) await this.parent(tx, existing.tenantId, existing.pirId, true);
      const changed = await tx.sir.updateMany({ where: { id, tenantId: existing.tenantId, status: existing.status }, data: { status, updatedById: user.sub } });
      if (changed.count !== 1) throw new ConflictException('Status SIR telah berubah. Muat ulang dan coba lagi.');
      await tx.auditLog.create({ data: { tenantId: existing.tenantId, userId: user.sub, action: 'SIR_STATUS_CHANGED', metadata: { sirId: id, pirId: existing.pirId, from: existing.status, to: status } } });
      return tx.sir.findUniqueOrThrow({ where: { id }, include: detailInclude });
    });
  }
}
