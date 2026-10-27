import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CollectionMethod, CollectionResultKind, CollectionTaskStatus, Prisma } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { CreateCollectionTaskDto, ListCollectionTasksDto, ResultCollectionTaskDto, UpdateCollectionTaskDto } from './collection-tasks.dto';

const include = {
  sir: { select: { id: true, reference: true, title: true, status: true, pirId: true, pir: { select: { status: true } } } },
  source: { select: { id: true, name: true, provider: true } },
  responsibleUser: { select: { id: true, name: true, email: true } },
  evidence: { include: { evidence: { select: { id: true, sirId: true, indicatorId: true, threatActorId: true, campaignId: true, relevanceNote: true } } } },
} satisfies Prisma.CollectionTaskInclude;
type TaskDetail = Prisma.CollectionTaskGetPayload<{ include: typeof include }>;
const next: Record<CollectionTaskStatus, readonly CollectionTaskStatus[]> = {
  PLANNED: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['BLOCKED', 'COMPLETED', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'CANCELLED'], COMPLETED: [], CANCELLED: [],
};
const needsIndicator = (method: CollectionMethod) => method === 'INTELLIGENCE_FEED' || method === 'TELEGRAM_IOC' || method === 'INDICATOR_ENRICHMENT';

@Injectable()
export class CollectionTasksService {
  constructor(private readonly prisma: PrismaService, private readonly access: ModuleAccessService) {}
  private tenant(user: AuthUser, requested?: string) {
    if (user.role === 'SUPER_ADMIN') { if (!requested) throw new BadRequestException('Tenant wajib dipilih'); return requested; }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }
  private required(value: string | undefined, label: string) {
    const trimmed = value?.trim(); if (!trimmed) throw new BadRequestException(`${label} wajib diisi`); return trimmed;
  }
  private async sir(tx: Prisma.TransactionClient, tenantId: string, sirId: string, actionable: boolean) {
    const sir = await tx.sir.findFirst({ where: { id: sirId, tenantId }, select: { id: true, status: true, pir: { select: { status: true } } } });
    if (!sir) throw new NotFoundException('SIR tidak ditemukan');
    if (actionable && (['ANSWERED', 'EXPIRED'].includes(sir.status) || ['ANSWERED', 'EXPIRED'].includes(sir.pir.status))) throw new BadRequestException('SIR dan PIR harus dibuka kembali sebelum koleksi dilanjutkan');
    return sir;
  }
  private async source(tenantId: string, method: CollectionMethod, id?: string | null) {
    if (!id) return;
    if (method !== 'INTELLIGENCE_FEED' && method !== 'TELEGRAM_IOC') throw new BadRequestException('Metode ini tidak mendukung tautan Intelligence Source');
    const row = await this.prisma.intelligenceSource.findFirst({ where: { id, tenantId, status: 'ACTIVE' }, select: { provider: true, telegramChatId: true } });
    if (!row || (method === 'TELEGRAM_IOC' ? !row.telegramChatId : !['URLhaus', 'MalwareBazaar', 'AbuseIPDB'].includes(row.provider ?? ''))) throw new BadRequestException('Intelligence Source tidak aktif atau tidak sesuai metode');
  }
  private async responsible(tenantId: string, id: string | null | undefined, method: CollectionMethod) {
    if (!id) return;
    const row = await this.prisma.user.findFirst({ where: { id, tenantId, isActive: true }, select: { id: true, role: true, tenantId: true } });
    if (!row || row.role === 'SUPER_ADMIN') throw new BadRequestException('Penanggung jawab harus pengguna aktif pada tenant yang sama');
    const candidate: AuthUser = { sub: row.id, role: row.role, tenantId: row.tenantId };
    const features = needsIndicator(method) ? ['intelligence-hub', 'indicator-management'] : ['intelligence-hub'];
    const decision = await this.access.evaluate(candidate, 'threat-intelligence', features);
    if (!decision.accessible) throw new BadRequestException(`Penanggung jawab tidak memiliki akses yang diperlukan: ${decision.reason}`);
  }
  private conflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Referensi atau asosiasi evidence sudah digunakan');
    throw error;
  }
  private async active(user: AuthUser, id: string, requested?: string) {
    const task = await this.get(user, id, requested);
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') throw new BadRequestException('Tugas selesai atau dibatalkan tidak dapat diubah');
    return task;
  }
  async sources(user: AuthUser, requested?: string) {
    const rows = await this.prisma.intelligenceSource.findMany({ where: { tenantId: this.tenant(user, requested), status: 'ACTIVE', OR: [{ provider: { in: ['URLhaus', 'MalwareBazaar', 'AbuseIPDB'] } }, { telegramChatId: { not: null } }] }, select: { id: true, name: true, provider: true, telegramChatId: true }, orderBy: { name: 'asc' }, take: 100 });
    return rows.map(({ telegramChatId, ...row }) => ({ ...row, telegramEnabled: telegramChatId !== null }));
  }
  private async lockTask(tx: Prisma.TransactionClient, id: string, tenantId: string) {
    const rows = await tx.$queryRaw<Array<{ status: CollectionTaskStatus; resultKind: CollectionResultKind | null }>>(Prisma.sql`SELECT status, \"resultKind\" FROM \"CollectionTask\" WHERE id = ${id} AND \"tenantId\" = ${tenantId} FOR UPDATE`);
    if (!rows[0]) throw new NotFoundException('Collection Task tidak ditemukan');
    if (rows[0].status === 'COMPLETED' || rows[0].status === 'CANCELLED') throw new BadRequestException('Tugas selesai atau dibatalkan tidak dapat diubah');
    return rows[0];
  }
  private async visibleEvidence(user: AuthUser, tenantId: string) {
    const decision = await this.access.evaluateForTenant(user, tenantId, 'threat-intelligence', ['indicator-management']);
    return decision.accessible;
  }
  private async visibleTask(user: AuthUser, row: TaskDetail) {
    if (await this.visibleEvidence(user, row.tenantId)) return row;
    return { ...row, evidence: row.evidence.filter(link => !link.evidence.indicatorId) };
  }
  async list(user: AuthUser, query: ListCollectionTasksDto) {
    const tenantId = this.tenant(user, query.tenantId); const search = query.search?.trim();
    const where: Prisma.CollectionTaskWhereInput = { tenantId, ...(query.sirId ? { sirId: query.sirId } : {}), ...(query.status ? { status: query.status } : {}), ...(query.priority ? { priority: query.priority } : {}), ...(query.method ? { method: query.method } : {}), ...(query.sourceId ? { sourceId: query.sourceId } : {}), ...(query.responsibleUserId ? { responsibleUserId: query.responsibleUserId } : {}), ...(search ? { OR: [{ reference: { contains: search, mode: 'insensitive' } }, { title: { contains: search, mode: 'insensitive' } }, { objective: { contains: search, mode: 'insensitive' } }] } : {}) };
    const [items, total] = await this.prisma.$transaction([this.prisma.collectionTask.findMany({ where, include, orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }), this.prisma.collectionTask.count({ where })]);
    return { items: await Promise.all(items.map(item => this.visibleTask(user, item))), total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) };
  }
  async get(user: AuthUser, id: string, requested?: string) {
    const row = await this.prisma.collectionTask.findFirst({ where: { id, tenantId: this.tenant(user, requested) }, include });
    if (!row) throw new NotFoundException('Collection Task tidak ditemukan');
    return this.visibleTask(user, row);
  }
  async progress(user: AuthUser, sirId: string, requested?: string) {
    const tenantId = this.tenant(user, requested); await this.sir(this.prisma, tenantId, sirId, false);
    const [groups, withEvidence] = await Promise.all([
      this.prisma.collectionTask.groupBy({ by: ['status'], where: { tenantId, sirId }, _count: { _all: true } }),
      this.prisma.collectionTask.count({ where: { tenantId, sirId, evidence: { some: (await this.visibleEvidence(user, tenantId)) ? {} : { evidence: { indicatorId: null } } } } }),
    ]);
    const counts = Object.fromEntries(groups.map(group => [group.status, group._count._all]));
    return { sirId, total: groups.reduce((sum, group) => sum + group._count._all, 0), planned: counts.PLANNED ?? 0, inProgress: counts.IN_PROGRESS ?? 0, blocked: counts.BLOCKED ?? 0, completed: counts.COMPLETED ?? 0, cancelled: counts.CANCELLED ?? 0, withEvidence };
  }
  async create(user: AuthUser, input: CreateCollectionTaskDto, requested?: string) {
    const tenantId = this.tenant(user, requested); const reference = this.required(input.reference, 'Referensi').toUpperCase();
    const title = this.required(input.title, 'Judul'); const objective = this.required(input.objective, 'Tujuan koleksi'); const informationRequired = this.required(input.informationRequired, 'Informasi yang diperlukan');
    await this.source(tenantId, input.method, input.sourceId); await this.responsible(tenantId, input.responsibleUserId, input.method);
    try { return await this.prisma.$transaction(async tx => {
      await this.sir(tx, tenantId, input.sirId, true);
      const row = await tx.collectionTask.create({ data: { tenantId, sirId: input.sirId, reference, title, objective, informationRequired, method: input.method, sourceId: input.sourceId || null, guidance: input.guidance?.trim() || null, priority: input.priority ?? 'MEDIUM', responsibleUserId: input.responsibleUserId || null, dueDate: input.dueDate ? new Date(input.dueDate) : null, createdById: user.sub, updatedById: user.sub }, include });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'COLLECTION_TASK_CREATED', metadata: { taskId: row.id, sirId: row.sirId, reference } } }); return this.visibleTask(user, row);
    }); } catch (error) { this.conflict(error); }
  }
  async update(user: AuthUser, id: string, input: UpdateCollectionTaskDto, requested?: string) {
    const task = await this.active(user, id, requested); const method = input.method ?? task.method;
    if (input.sirId && input.sirId !== task.sirId) throw new BadRequestException('SIR tugas tidak dapat diubah');
    await this.source(task.tenantId, method, input.sourceId === undefined ? task.sourceId : input.sourceId);
    if (input.responsibleUserId !== undefined) await this.responsible(task.tenantId, input.responsibleUserId, method);
    else if (task.responsibleUserId) await this.responsible(task.tenantId, task.responsibleUserId, method);
    const data: Prisma.CollectionTaskUncheckedUpdateInput = { updatedById: user.sub };
    if (input.reference !== undefined) data.reference = this.required(input.reference, 'Referensi').toUpperCase();
    if (input.title !== undefined) data.title = this.required(input.title, 'Judul');
    if (input.objective !== undefined) data.objective = this.required(input.objective, 'Tujuan koleksi');
    if (input.informationRequired !== undefined) data.informationRequired = this.required(input.informationRequired, 'Informasi yang diperlukan');
    if (input.method !== undefined) data.method = method;
    if (input.sourceId !== undefined) data.sourceId = input.sourceId || null;
    if (input.guidance !== undefined) data.guidance = input.guidance?.trim() || null;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.responsibleUserId !== undefined) data.responsibleUserId = input.responsibleUserId || null;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    try { return await this.prisma.$transaction(async tx => { await this.sir(tx, task.tenantId, task.sirId, true); const row = await tx.collectionTask.update({ where: { id, tenantId: task.tenantId }, data, include }); await tx.auditLog.create({ data: { tenantId: task.tenantId, userId: user.sub, action: 'COLLECTION_TASK_UPDATED', metadata: { taskId: id, sirId: task.sirId } } }); return this.visibleTask(user, row); }); } catch (error) { this.conflict(error); }
  }
  async assign(user: AuthUser, id: string, responsibleUserId: string | null, requested?: string) {
    const task = await this.active(user, id, requested); await this.responsible(task.tenantId, responsibleUserId, task.method);
    return this.prisma.$transaction(async tx => { await this.sir(tx, task.tenantId, task.sirId, true); const row = await tx.collectionTask.update({ where: { id, tenantId: task.tenantId }, data: { responsibleUserId: responsibleUserId || null, updatedById: user.sub }, include }); await tx.auditLog.create({ data: { tenantId: task.tenantId, userId: user.sub, action: 'COLLECTION_TASK_ASSIGNED', metadata: { taskId: id, responsibleUserId: responsibleUserId || null } } }); return this.visibleTask(user, row); });
  }
  async status(user: AuthUser, id: string, status: CollectionTaskStatus, requested?: string) {
    const task = await this.active(user, id, requested);
    if (!next[task.status].includes(status)) throw new BadRequestException(`Transisi ${task.status} ke ${status} tidak diizinkan`);
    if (status === 'COMPLETED' && (!task.resultKind || !task.resultSummary?.trim())) throw new BadRequestException('Hasil koleksi wajib dicatat sebelum tugas diselesaikan');
    return this.prisma.$transaction(async tx => { await this.sir(tx, task.tenantId, task.sirId, true); const changed = await tx.collectionTask.updateMany({ where: { id, tenantId: task.tenantId, status: task.status }, data: { status, completedAt: status === 'COMPLETED' ? new Date() : null, updatedById: user.sub } }); if (changed.count !== 1) throw new ConflictException('Status tugas telah berubah'); await tx.auditLog.create({ data: { tenantId: task.tenantId, userId: user.sub, action: 'COLLECTION_TASK_STATUS_CHANGED', metadata: { taskId: id, from: task.status, to: status } } }); return this.visibleTask(user, await tx.collectionTask.findUniqueOrThrow({ where: { id }, include })); });
  }
  async result(user: AuthUser, id: string, input: ResultCollectionTaskDto, requested?: string) {
    const task = await this.active(user, id, requested); const resultSummary = this.required(input.resultSummary, 'Ringkasan hasil');
    if (task.status !== 'IN_PROGRESS' && task.status !== 'BLOCKED') throw new BadRequestException('Hasil hanya dapat dicatat saat koleksi berjalan atau terhalang');
    return this.prisma.$transaction(async tx => {
      await this.lockTask(tx, id, task.tenantId);
      if (input.resultKind === 'NO_FINDINGS' && await tx.collectionTaskEvidence.count({ where: { taskId: id } })) throw new BadRequestException('Hasil tanpa temuan tidak sesuai dengan evidence yang terkait');
      await this.sir(tx, task.tenantId, task.sirId, true); const row = await tx.collectionTask.update({ where: { id, tenantId: task.tenantId }, data: { resultKind: input.resultKind, resultSummary, informationGaps: input.informationGaps?.trim() || null, updatedById: user.sub }, include }); await tx.auditLog.create({ data: { tenantId: task.tenantId, userId: user.sub, action: 'COLLECTION_TASK_RESULT_RECORDED', metadata: { taskId: id, resultKind: input.resultKind } } }); return this.visibleTask(user, row); });
  }
  async linkEvidence(user: AuthUser, id: string, evidenceId: string, requested?: string) {
    const task = await this.active(user, id, requested);
    try { return await this.prisma.$transaction(async tx => {
      const locked = await this.lockTask(tx, id, task.tenantId);
      if (locked.resultKind === 'NO_FINDINGS') throw new BadRequestException('Tugas tanpa temuan tidak dapat mengaitkan evidence');
      await this.sir(tx, task.tenantId, task.sirId, true); const evidence = await tx.sirEvidence.findFirst({ where: { id: evidenceId, tenantId: task.tenantId, sirId: task.sirId }, select: { id: true, indicatorId: true } }); if (!evidence) throw new NotFoundException('Evidence SIR tidak ditemukan'); if (evidence.indicatorId && !await this.visibleEvidence(user, task.tenantId)) throw new ForbiddenException('Akses indicator-management diperlukan'); await tx.collectionTaskEvidence.create({ data: { taskId: id, evidenceId, tenantId: task.tenantId, sirId: task.sirId } }); await tx.auditLog.create({ data: { tenantId: task.tenantId, userId: user.sub, action: 'COLLECTION_TASK_EVIDENCE_LINKED', metadata: { taskId: id, evidenceId, sirId: task.sirId } } }); return this.visibleTask(user, await tx.collectionTask.findUniqueOrThrow({ where: { id }, include })); }); } catch (error) { this.conflict(error); }
  }
}
