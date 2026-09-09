import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { CreateMitreTechniqueDto, ListMitreTechniquesQueryDto, UpdateMitreTechniqueDto } from './mitre-techniques.dto';

@Injectable()
export class MitreTechniquesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, query: ListMitreTechniquesQueryDto) {
    const tenantId = this.resolveTenant(user, query.tenantId);
    const search = query.search?.trim();
    const where: Prisma.MitreTechniqueWhereInput = { tenantId, ...(query.tactic ? { tactic: query.tactic } : {}), ...(query.platform ? { platform: query.platform } : {}), ...(search ? { OR: [{ externalId: { contains: search, mode: 'insensitive' } }, { name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }, { tactic: { contains: search, mode: 'insensitive' } }, { platform: { contains: search, mode: 'insensitive' } }] } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.mitreTechnique.findMany({ where, include: { _count: { select: { campaigns: true } } }, orderBy: [{ externalId: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.mitreTechnique.count({ where }),
    ]);
    return { items, page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  }

  async get(user: AuthUser, id: string, requestedTenantId?: string) { return this.scoped(user, id, requestedTenantId); }

  async create(user: AuthUser, input: CreateMitreTechniqueDto, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const data = this.requiredData(input);
    try {
      const technique = await this.prisma.mitreTechnique.create({ data: { tenantId, ...data }, include: { campaigns: { include: { campaign: { select: { id: true, name: true, status: true } } } }, _count: { select: { campaigns: true } } } });
      await this.audit(user, tenantId, 'MITRE_TECHNIQUE_CREATED', technique.id, technique.externalId);
      return technique;
    } catch (error) { this.rethrowConflict(error); }
  }

  async update(user: AuthUser, id: string, input: UpdateMitreTechniqueDto, requestedTenantId?: string) {
    const existing = await this.scoped(user, id, requestedTenantId);
    const values = [input.externalId, input.name, input.tactic, input.platform];
    if (values.some(value => value !== undefined && !value.trim())) throw new BadRequestException('External ID, nama, tactic, dan platform tidak boleh kosong');
    try {
      const technique = await this.prisma.mitreTechnique.update({ where: { id }, data: { ...(input.externalId !== undefined ? { externalId: input.externalId.trim().toUpperCase() } : {}), ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(input.description !== undefined ? { description: input.description.trim() || null } : {}), ...(input.tactic !== undefined ? { tactic: input.tactic.trim() } : {}), ...(input.platform !== undefined ? { platform: input.platform.trim() } : {}), ...(input.url !== undefined ? { url: input.url.trim() || null } : {}) }, include: { campaigns: { include: { campaign: { select: { id: true, name: true, status: true } } } }, _count: { select: { campaigns: true } } } });
      await this.audit(user, existing.tenantId, 'MITRE_TECHNIQUE_UPDATED', id, technique.externalId);
      return technique;
    } catch (error) { this.rethrowConflict(error); }
  }

  async remove(user: AuthUser, id: string, requestedTenantId?: string) {
    const technique = await this.scoped(user, id, requestedTenantId);
    await this.prisma.mitreTechnique.delete({ where: { id } });
    await this.audit(user, technique.tenantId, 'MITRE_TECHNIQUE_DELETED', id, technique.externalId);
    return { deleted: true, id };
  }

  private requiredData(input: CreateMitreTechniqueDto) {
    const externalId = input.externalId.trim().toUpperCase(); const name = input.name.trim(); const tactic = input.tactic.trim(); const platform = input.platform.trim();
    if (!externalId || !name || !tactic || !platform) throw new BadRequestException('External ID, nama, tactic, dan platform wajib diisi');
    return { externalId, name, tactic, platform, description: input.description?.trim() || null, url: input.url?.trim() || null };
  }
  private resolveTenant(user: AuthUser, requestedTenantId?: string): string { if (user.role === 'SUPER_ADMIN') { if (!requestedTenantId) throw new BadRequestException('Tenant wajib dipilih'); return requestedTenantId; } if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia'); return user.tenantId; }
  private async scoped(user: AuthUser, id: string, requestedTenantId?: string) { const technique = await this.prisma.mitreTechnique.findFirst({ where: { id, tenantId: this.resolveTenant(user, requestedTenantId) }, include: { campaigns: { include: { campaign: { select: { id: true, name: true, status: true } } } }, _count: { select: { campaigns: true } } } }); if (!technique) throw new NotFoundException('MITRE technique tidak ditemukan'); return technique; }
  private rethrowConflict(error: unknown): never { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('External ID MITRE sudah ada pada tenant ini'); throw error; }
  private audit(actor: AuthUser, tenantId: string, action: string, techniqueId: string, externalId: string) { return this.prisma.auditLog.create({ data: { userId: actor.sub, tenantId, action, metadata: { techniqueId, externalId } } }); }
}
