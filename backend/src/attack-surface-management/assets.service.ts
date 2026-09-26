import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetStatus, AssetType, IndicatorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { CreateAssetDto, ListAssetsQueryDto, UpdateAssetDto } from './assets.dto';

const sortableFields = ['name', 'type', 'value', 'status', 'criticality', 'owner', 'firstSeenAt', 'lastSeenAt', 'createdAt', 'updatedAt'] as const;
type SortableField = typeof sortableFields[number];

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, query: ListAssetsQueryDto) {
    const tenantId = await this.resolveTenant(user, query.tenantId);
    const search = query.search?.trim();
    const where: Prisma.AssetWhereInput = { tenantId, ...(query.type ? { type: query.type } : {}), ...(query.status ? { status: query.status } : {}), ...(query.criticality ? { criticality: query.criticality } : {}), ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { value: { contains: search, mode: 'insensitive' } }] } : {}) };
    const sortBy = this.sortField(query.sortBy);
    const sortOrder: Prisma.SortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const [items, total] = await this.prisma.$transaction([this.prisma.asset.findMany({ where, orderBy: { [sortBy]: sortOrder }, skip: (query.page - 1) * query.limit, take: query.limit }), this.prisma.asset.count({ where })]);
    return { items, page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  }

  async get(user: AuthUser, id: string, requestedTenantId?: string) {
    return this.scopedAsset(user, id, requestedTenantId);
  }

  async threatIntelligence(user: AuthUser, id: string, requestedTenantId?: string) {
    const asset = await this.scopedAsset(user, id, requestedTenantId);
    const type = asset.type === AssetType.DOMAIN || asset.type === AssetType.SUBDOMAIN
      ? IndicatorType.DOMAIN
      : asset.type === AssetType.IP_ADDRESS ? IndicatorType.IP_ADDRESS : null;
    const matches = type ? await this.prisma.indicator.findMany({
      where: { tenantId: asset.tenantId, type, value: asset.value.trim() },
      select: { id: true, type: true, value: true, source: true, confidence: true, enrichments: { orderBy: { createdAt: 'desc' }, take: 1, select: { provider: true, status: true, createdAt: true } } },
    }) : [];
    return {
      assetId: asset.id, assetType: asset.type, assetValue: asset.value,
      matches: matches.map(indicator => ({
        id: indicator.id, type: indicator.type, value: indicator.value,
        source: indicator.source, confidence: indicator.confidence,
        enrichmentSummary: indicator.enrichments?.[0] ?? null,
      })),
    };
  }

  async create(user: AuthUser, input: CreateAssetDto, requestedTenantId?: string) {
    const tenantId = await this.resolveTenant(user, requestedTenantId);
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Nama wajib');
    const value = input.value.trim();
    if (!value) throw new BadRequestException('Nilai wajib');
    try {
      const asset = await this.prisma.asset.create({ data: { tenantId, name, type: input.type, value, status: input.status ?? AssetStatus.UNKNOWN, criticality: input.criticality ?? 'MEDIUM', description: input.description?.trim() || null, owner: input.owner?.trim() || null, firstSeenAt: this.parseDate(input.firstSeenAt), lastSeenAt: this.parseDate(input.lastSeenAt) } });
      await this.audit(user, tenantId, 'ASSET_CREATED', asset.id, { name: asset.name, type: asset.type });
      return asset;
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async update(user: AuthUser, id: string, input: UpdateAssetDto, requestedTenantId?: string) {
    const existing = await this.scopedAsset(user, id, requestedTenantId);
    const upd: Prisma.AssetUpdateInput = {};
    if (input.name) upd.name = input.name.trim();
    if (input.type) upd.type = input.type;
    if (input.value) upd.value = input.value.trim();
    if (input.status) upd.status = input.status;
    if (input.criticality) upd.criticality = input.criticality;
    if (input.description !== undefined) upd.description = input.description.trim() || null;
    if (input.owner !== undefined) upd.owner = input.owner.trim() || null;
    if (input.firstSeenAt !== undefined) upd.firstSeenAt = this.parseDate(input.firstSeenAt);
    if (input.lastSeenAt !== undefined) upd.lastSeenAt = this.parseDate(input.lastSeenAt);
    try {
      const asset = await this.prisma.asset.update({ where: { id }, data: upd });
      await this.audit(user, existing.tenantId, 'ASSET_UPDATED', id, { name: asset.name });
      return asset;
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async remove(user: AuthUser, id: string, requestedTenantId?: string) {
    const asset = await this.scopedAsset(user, id, requestedTenantId);
    await this.prisma.asset.delete({ where: { id } });
    await this.audit(user, asset.tenantId, 'ASSET_DELETED', id, { name: asset.name });
    return { deleted: true, id };
  }

  private async resolveTenant(user: AuthUser, requestedTenantId?: string): Promise<string> {
    if (user.role === 'SUPER_ADMIN') {
      if (!requestedTenantId) throw new BadRequestException('Tenant wajib');
      const tenant = await this.prisma.tenant.findUnique({ where: { id: requestedTenantId }, select: { id: true } });
      if (!tenant) throw new BadRequestException('Tenant tidak ditemukan');
      return requestedTenantId;
    }
    return this.tenantId(user);
  }

  private tenantId(user: AuthUser): string {
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib');
    return user.tenantId;
  }

  private async scopedAsset(user: AuthUser, id: string, requestedTenantId?: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id, tenantId: await this.resolveTenant(user, requestedTenantId) } });
    if (!asset) throw new NotFoundException('Asset tidak ditemukan');
    return asset;
  }

  private sortField(v?: string): SortableField { return sortableFields.find(f => f === v) ?? 'updatedAt'; }
  private parseDate(v?: string): Date | null { if (!v) return null; const p = new Date(v); if (isNaN(p.getTime())) throw new BadRequestException('Tanggal'); return p; }
  private rethrowConflict(e: any): never { if (e?.code === 'P2002') throw new ConflictException('Duplicate'); throw e; }
  private audit(a: AuthUser, t: string, ac: string, id: string, m: any) { return this.prisma.auditLog.create({ data: { userId: a.sub, tenantId: t, action: ac, metadata: { assetId: id, ...m } } }); }
}
