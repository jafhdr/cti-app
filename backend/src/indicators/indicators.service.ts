import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IndicatorStatus, IndicatorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthUser } from '../users/users.types';
import { IndicatorInput } from './indicators.types';

@Injectable()
export class IndicatorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(currentUser: AuthUser, query: Record<string, string | undefined>) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
    const where: Prisma.IndicatorWhereInput = {
      ...(currentUser.role === 'SUPER_ADMIN' ? {} : { tenantId: this.tenantId(currentUser) }),
      ...(this.isType(query.type) ? { type: query.type } : {}),
      ...(this.isSeverity(query.severity) ? { severity: query.severity } : {}),
      ...(this.isStatus(query.status) ? { status: query.status } : {}),
      ...(query.search?.trim() ? {
        OR: [
          { value: { contains: query.search.trim(), mode: 'insensitive' } },
          { source: { contains: query.search.trim(), mode: 'insensitive' } },
          { tags: { has: query.search.trim().toLowerCase() } },
        ],
      } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.indicator.findMany({ where, include: { tenant: { select: { id: true, name: true, slug: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.indicator.count({ where }),
    ]);
    return { items, page, limit, total };
  }

  async create(currentUser: AuthUser, input: IndicatorInput) {
    const tenantId = currentUser.role === 'SUPER_ADMIN' ? input.tenantId : this.tenantId(currentUser);
    if (!tenantId) throw new BadRequestException('Tenant wajib dipilih');
    await this.assertTenant(tenantId);
    const data = this.validateInput(input);
    try {
      const indicator = await this.prisma.indicator.create({
        data: { ...data, tenantId, createdById: currentUser.sub },
        include: { tenant: { select: { id: true, name: true, slug: true } } },
      });
      await this.audit(currentUser, tenantId, 'INDICATOR_CREATED', { indicatorId: indicator.id, type: indicator.type, value: indicator.value });
      return indicator;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Indicator dengan type dan value tersebut sudah ada pada tenant ini');
      throw error;
    }
  }

  async update(currentUser: AuthUser, id: string, input: IndicatorInput) {
    const indicator = await this.scopedIndicator(currentUser, id);
    const data = this.validateInput(input);
    try {
      const updated = await this.prisma.indicator.update({ where: { id }, data, include: { tenant: { select: { id: true, name: true, slug: true } } } });
      await this.audit(currentUser, indicator.tenantId, 'INDICATOR_UPDATED', { indicatorId: id, type: updated.type, value: updated.value });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Indicator dengan type dan value tersebut sudah ada pada tenant ini');
      throw error;
    }
  }

  async deactivate(currentUser: AuthUser, id: string) {
    const indicator = await this.scopedIndicator(currentUser, id);
    const updated = await this.prisma.indicator.update({ where: { id }, data: { status: IndicatorStatus.INACTIVE } });
    await this.audit(currentUser, indicator.tenantId, 'INDICATOR_DEACTIVATED', { indicatorId: id, value: indicator.value });
    return updated;
  }

  private validateInput(input: IndicatorInput) {
    const value = input.value?.trim();
    if (!value || !this.isType(input.type) || !this.isSeverity(input.severity)) throw new BadRequestException('Value, type, dan severity wajib valid');
    const confidence = Number(input.confidence);
    if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) throw new BadRequestException('Confidence harus berupa angka 0 sampai 100');
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new BadRequestException('Tanggal kadaluarsa tidak valid');
    return {
      value, type: input.type, severity: input.severity, confidence,
      status: this.isStatus(input.status) ? input.status : IndicatorStatus.ACTIVE,
      tags: [...new Set((input.tags || []).map(tag => tag.trim().toLowerCase()).filter(Boolean))],
      source: input.source?.trim() || null,
      description: input.description?.trim() || null,
      expiresAt,
    };
  }

  private async scopedIndicator(currentUser: AuthUser, id: string) {
    const indicator = await this.prisma.indicator.findUnique({ where: { id } });
    if (!indicator) throw new NotFoundException('Indicator tidak ditemukan');
    if (currentUser.role !== 'SUPER_ADMIN' && indicator.tenantId !== this.tenantId(currentUser)) throw new ForbiddenException('Indicator berada di tenant lain');
    return indicator;
  }

  private async assertTenant(id: string) {
    if (!await this.prisma.tenant.findUnique({ where: { id } })) throw new NotFoundException('Tenant tidak ditemukan');
  }
  private tenantId(user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }
  private audit(actor: AuthUser, tenantId: string, action: string, metadata: Record<string, string>) {
    return this.prisma.auditLog.create({ data: { userId: actor.sub, tenantId, action, metadata: metadata as Prisma.InputJsonValue } });
  }
  private isType(value?: string): value is IndicatorType { return ['IP_ADDRESS', 'DOMAIN', 'URL', 'FILE_HASH', 'EMAIL'].includes(value || ''); }
  private isSeverity(value?: string): value is 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' { return ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(value || ''); }
  private isStatus(value?: string): value is 'ACTIVE' | 'INACTIVE' | 'EXPIRED' { return ['ACTIVE', 'INACTIVE', 'EXPIRED'].includes(value || ''); }
}
