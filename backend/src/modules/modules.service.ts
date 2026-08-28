import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthUser } from '../users/users.types';
import {
  CreateModuleDto,
  UpdateModuleDto,
  CreateModuleEntitlementDto,
  UpdateModuleEntitlementDto,
  AssignModuleToTenantDto,
  UpdateTenantModuleDto,
  CreateGlobalConfigDto,
  UpdateModuleHealthDto,
} from './modules.types';

@Injectable()
export class ModulesService {
  constructor(private readonly prisma: PrismaService) {}

  // Global Module Catalog - List all modules
  async findAll() {
    return this.prisma.module.findMany({
      include: {
        entitlements: true,
        _count: {
          select: { tenantModules: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async findOne(id: string) {
    const module = await this.prisma.module.findUnique({
      where: { id },
      include: {
        entitlements: true,
        tenantModules: {
          include: { tenant: true }
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          take: 50
        }
      }
    });
    if (!module) throw new NotFoundException('Modul tidak ditemukan');
    return module;
  }

  // Create Module
  async create(actor: AuthUser, dto: CreateModuleDto) {
    const existing = await this.prisma.module.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Kode modul sudah digunakan');

    const module = await this.prisma.module.create({
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
        version: dto.version || '1.0.0',
        status: dto.status || 'ACTIVE',
        isGlobalEnabled: dto.isGlobalEnabled ?? true,
        config: dto.config as any,
      }
    });

    await this.prisma.moduleAuditLog.create({
      data: {
        moduleId: module.id,
        userId: actor.sub,
        action: 'MODULE_CREATED',
        metadata: { moduleName: module.name, moduleCode: module.code } as any
      }
    });

    return module;
  }

  // Update Module
  async update(actor: AuthUser, id: string, dto: UpdateModuleDto) {
    const module = await this.prisma.module.findUnique({ where: { id } });
    if (!module) throw new NotFoundException('Modul tidak ditemukan');

    if (dto.code && dto.code !== module.code) {
      const existing = await this.prisma.module.findUnique({ where: { code: dto.code } });
      if (existing) throw new ConflictException('Kode modul sudah digunakan');
    }

    const updated = await this.prisma.module.update({
      where: { id },
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
        version: dto.version,
        status: dto.status,
        isGlobalEnabled: dto.isGlobalEnabled,
        config: dto.config as any,
      }
    });

    await this.prisma.moduleAuditLog.create({
      data: {
        moduleId: id,
        userId: actor.sub,
        action: 'MODULE_UPDATED',
        metadata: { changes: dto } as any
      }
    });

    return updated;
  }

  // Delete Module
  async delete(actor: AuthUser, id: string) {
    const module = await this.prisma.module.findUnique({ where: { id } });
    if (!module) throw new NotFoundException('Modul tidak ditemukan');

    await this.prisma.module.delete({ where: { id } });

    await this.prisma.moduleAuditLog.create({
      data: {
        moduleId: id,
        userId: actor.sub,
        action: 'MODULE_DELETED',
        metadata: { moduleName: module.name, moduleCode: module.code } as any
      }
    });

    return { success: true, message: 'Modul berhasil dihapus' };
  }

  // Enable/Disable Module Globally
  async toggleGlobalStatus(actor: AuthUser, id: string, isEnabled: boolean) {
    const module = await this.prisma.module.findUnique({ where: { id } });
    if (!module) throw new NotFoundException('Modul tidak ditemukan');

    const updated = await this.prisma.module.update({
      where: { id },
      data: { isGlobalEnabled: isEnabled }
    });

    await this.prisma.moduleAuditLog.create({
      data: {
        moduleId: id,
        userId: actor.sub,
        action: isEnabled ? 'MODULE_GLOBALLY_ENABLED' : 'MODULE_GLOBALLY_DISABLED',
        metadata: { moduleName: module.name } as any
      }
    });

    return updated;
  }

  // Module Entitlement per Plan
  async createEntitlement(actor: AuthUser, dto: CreateModuleEntitlementDto) {
    const module = await this.prisma.module.findUnique({ where: { id: dto.moduleId } });
    if (!module) throw new NotFoundException('Modul tidak ditemukan');

    const entitlement = await this.prisma.moduleEntitlement.create({
      data: {
        moduleId: dto.moduleId,
        plan: dto.plan,
        isEnabled: dto.isEnabled ?? true,
        quotaLimit: dto.quotaLimit,
      }
    });

    await this.prisma.moduleAuditLog.create({
      data: {
        moduleId: dto.moduleId,
        userId: actor.sub,
        action: 'MODULE_ENTITLEMENT_CREATED',
        metadata: { plan: dto.plan, isEnabled: entitlement.isEnabled } as any
      }
    });

    return entitlement;
  }

  async updateEntitlement(actor: AuthUser, id: string, dto: UpdateModuleEntitlementDto) {
    const entitlement = await this.prisma.moduleEntitlement.findUnique({ where: { id } });
    if (!entitlement) throw new NotFoundException('Entitlement tidak ditemukan');

    const updated = await this.prisma.moduleEntitlement.update({
      where: { id },
      data: {
        isEnabled: dto.isEnabled,
        quotaLimit: dto.quotaLimit,
      }
    });

    await this.prisma.moduleAuditLog.create({
      data: {
        moduleId: entitlement.moduleId,
        userId: actor.sub,
        action: 'MODULE_ENTITLEMENT_UPDATED',
        metadata: { entitlementId: id, changes: dto } as any
      }
    });

    return updated;
  }

  async deleteEntitlement(actor: AuthUser, id: string) {
    const entitlement = await this.prisma.moduleEntitlement.findUnique({ where: { id } });
    if (!entitlement) throw new NotFoundException('Entitlement tidak ditemukan');

    await this.prisma.moduleEntitlement.delete({ where: { id } });

    await this.prisma.moduleAuditLog.create({
      data: {
        moduleId: entitlement.moduleId,
        userId: actor.sub,
        action: 'MODULE_ENTITLEMENT_DELETED',
        metadata: { entitlementId: id } as any
      }
    });

    return { success: true };
  }

  // Assign Module to Tenant
  async assignToTenant(actor: AuthUser, dto: AssignModuleToTenantDto) {
    const module = await this.prisma.module.findUnique({ where: { id: dto.moduleId } });
    if (!module) throw new NotFoundException('Modul tidak ditemukan');

    const tenant = await this.prisma.tenant.findUnique({ where: { id: dto.tenantId } });
    if (!tenant) throw new NotFoundException('Tenant tidak ditemukan');

    const existing = await this.prisma.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId: dto.tenantId, moduleId: dto.moduleId } }
    });

    if (existing) {
      throw new ConflictException('Modul sudah diassign ke tenant ini');
    }

    const tenantModule = await this.prisma.tenantModule.create({
      data: {
        tenantId: dto.tenantId,
        moduleId: dto.moduleId,
        isEnabled: dto.isEnabled ?? true,
        featureFlags: dto.featureFlags as any,
        config: dto.config as any,
        overrideReason: dto.overrideReason,
        assignedBy: actor.sub,
      },
      include: { tenant: true, module: true }
    });

    await this.prisma.moduleAuditLog.create({
      data: {
        moduleId: dto.moduleId,
        tenantId: dto.tenantId,
        userId: actor.sub,
        action: 'MODULE_ASSIGNED_TO_TENANT',
        metadata: { tenantId: dto.tenantId, tenantName: tenant.name } as any
      }
    });

    return tenantModule;
  }

  async updateTenantModule(actor: AuthUser, tenantId: string, moduleId: string, dto: UpdateTenantModuleDto) {
    const tenantModule = await this.prisma.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId } }
    });

    if (!tenantModule) throw new NotFoundException('Assignment modul tidak ditemukan');

    const updated = await this.prisma.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId } },
      data: {
        isEnabled: dto.isEnabled,
        featureFlags: dto.featureFlags as any,
        config: dto.config as any,
        overrideReason: dto.overrideReason,
        isOverride: !!dto.overrideReason,
      }
    });

    await this.prisma.moduleAuditLog.create({
      data: {
        moduleId,
        tenantId,
        userId: actor.sub,
        action: 'MODULE_TENANT_CONFIG_UPDATED',
        metadata: { changes: dto } as any
      }
    });

    return updated;
  }

  async removeTenantModule(actor: AuthUser, tenantId: string, moduleId: string) {
    const tenantModule = await this.prisma.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId } }
    });

    if (!tenantModule) throw new NotFoundException('Assignment modul tidak ditemukan');

    await this.prisma.tenantModule.delete({
      where: { tenantId_moduleId: { tenantId, moduleId } }
    });

    await this.prisma.moduleAuditLog.create({
      data: {
        moduleId,
        tenantId,
        userId: actor.sub,
        action: 'MODULE_REMOVED_FROM_TENANT',
        metadata: { tenantId, moduleId } as any
      }
    });

    return { success: true };
  }

  // Global Module Configuration
  async createGlobalConfig(actor: AuthUser, dto: CreateGlobalConfigDto) {
    const existing = await this.prisma.globalModuleConfig.findUnique({ where: { key: dto.key } });
    if (existing) throw new ConflictException('Konfigurasi global dengan key ini sudah ada');

    const config = await this.prisma.globalModuleConfig.create({
      data: {
        key: dto.key,
        value: dto.value as any,
        moduleId: dto.moduleId,
      }
    });

    await this.prisma.moduleAuditLog.create({
      data: {
        moduleId: dto.moduleId,
        userId: actor.sub,
        action: 'GLOBAL_MODULE_CONFIG_CREATED',
        metadata: { configKey: dto.key } as any
      }
    });

    return config;
  }

  async updateGlobalConfig(actor: AuthUser, key: string, value: Record<string, any>) {
    const config = await this.prisma.globalModuleConfig.findUnique({ where: { key } });
    if (!config) throw new NotFoundException('Konfigurasi global tidak ditemukan');

    const updated = await this.prisma.globalModuleConfig.update({
      where: { key },
      data: { value: value as any }
    });

    await this.prisma.moduleAuditLog.create({
      data: {
        moduleId: config.moduleId,
        userId: actor.sub,
        action: 'GLOBAL_MODULE_CONFIG_UPDATED',
        metadata: { configKey: key } as any
      }
    });

    return updated;
  }

  async getGlobalConfigs(moduleId?: string) {
    const where = moduleId ? { moduleId } : {};
    return this.prisma.globalModuleConfig.findMany({ where, include: { module: true } });
  }

  // Module Health Monitoring
  async updateModuleHealth(moduleId: string, dto: UpdateModuleHealthDto) {
    const health = await this.prisma.moduleHealth.upsert({
      where: { moduleId },
      create: {
        moduleId,
        status: dto.status || 'unknown',
        errorRate: dto.errorRate ?? 0,
        latency: dto.latency ?? 0,
        queueBacklog: dto.queueBacklog ?? 0,
        failureCount: dto.failureCount ?? 0,
        metadata: dto.metadata as any,
      },
      update: {
        status: dto.status,
        errorRate: dto.errorRate,
        latency: dto.latency,
        queueBacklog: dto.queueBacklog,
        failureCount: dto.failureCount,
        metadata: dto.metadata as any,
        lastChecked: new Date(),
      }
    });

    return health;
  }

  async getModuleHealth() {
    return this.prisma.moduleHealth.findMany({
      include: { module: true },
      orderBy: { lastChecked: 'desc' }
    });
  }

  // Global Usage Monitoring
  async getUsageMonitoring(tenantId?: string) {
    if (tenantId) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException('Tenant tidak ditemukan');

      const indicators = await this.prisma.indicator.count({ where: { tenantId } });
      const tenantModules = await this.prisma.tenantModule.findMany({
        where: { tenantId },
        include: { module: true }
      });

      return {
        tenantId,
        tenantName: tenant.name,
        indicators,
        modules: tenantModules.map(tm => ({
          moduleId: tm.moduleId,
          moduleName: tm.module.name,
          isEnabled: tm.isEnabled,
        }))
      };
    }

    // Global usage
    const tenants = await this.prisma.tenant.findMany({
      select: {
        id: true,
        name: true,
        _count: { select: { indicators: true, users: true } }
      }
    });

    return tenants.map(t => ({
      tenantId: t.id,
      tenantName: t.name,
      indicators: t._count.indicators,
      users: t._count.users,
    }));
  }

  // Global Audit Log for Modules
  async getModuleAuditLogs(moduleId?: string, limit: number = 100) {
    const where = moduleId ? { moduleId } : {};
    return this.prisma.moduleAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        module: true,
      }
    });
  }

  // Tenant Override
  async overrideTenantModule(actor: AuthUser, tenantId: string, moduleId: string, isEnabled: boolean, reason: string) {
    const tenantModule = await this.prisma.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId } }
    });

    if (!tenantModule) {
      // Create new assignment with override
      return this.assignToTenant(actor, {
        tenantId,
        moduleId,
        isEnabled,
        overrideReason: reason,
      });
    }

    const updated = await this.prisma.tenantModule.update({
      where: { tenantId_moduleId: { tenantId, moduleId } },
      data: {
        isEnabled,
        isOverride: true,
        overrideReason: reason,
      }
    });

    await this.prisma.moduleAuditLog.create({
      data: {
        moduleId,
        tenantId,
        userId: actor.sub,
        action: 'MODULE_TENANT_OVERRIDE',
        metadata: { isEnabled, reason } as any
      }
    });

    return updated;
  }
}
