import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingCycle, Prisma, SubscriptionStatus } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import { type AuthUser } from '../users/users.types';
import { type CreateSubscriptionInput, type UpdateSubscriptionStatusInput } from './subscription.types';

const subscriptionInclude = {
  package: { include: { modules: { include: { module: { include: { features: true } } } } } },
  customModules: { include: { module: { include: { features: true } } } },
} satisfies Prisma.TenantSubscriptionInclude;

@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService, private readonly moduleAccess: ModuleAccessService) {}

  listPackages() {
    return this.prisma.subscriptionPackage.findMany({
      where: { isActive: true },
      include: { modules: { include: { module: { include: { features: true } } }, orderBy: { module: { name: 'asc' } } } },
      orderBy: [{ type: 'asc' }, { priceMonthly: 'asc' }],
    });
  }

  async getMy(user: AuthUser, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const subscription = await this.prisma.tenantSubscription.findUnique({ where: { tenantId }, include: subscriptionInclude });
    if (!subscription) return null;
    const includedModules = await this.moduleAccess.listTenantPolicies(tenantId);
    return {
      ...subscription,
      subscriptionActive: includedModules[0]?.subscriptionActive ?? false,
      subscriptionSource: subscription.isCustom ? 'Custom Subscription' : subscription.package?.name ?? null,
      includedModules: includedModules.map(module => ({ id: module.id, name: module.name, slug: module.slug, subscriptionIncluded: module.subscriptionIncluded })),
    };
  }

  async subscribe(user: AuthUser, input: CreateSubscriptionInput) {
    const tenantId = this.resolveTenant(user, input.tenantId);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, isActive: true } });
    if (!tenant?.isActive) throw new NotFoundException('Tenant aktif tidak ditemukan');
    const cycle = input.billingCycle;
    if (!cycle || !Object.values(BillingCycle).includes(cycle)) throw new BadRequestException('Billing cycle tidak valid');
    return input.isCustom
      ? this.subscribeCustom(user, tenantId, cycle, input.moduleIds ?? [])
      : this.subscribePredefined(user, tenantId, cycle, input.packageId);
  }

  async updateStatus(user: AuthUser, input: UpdateSubscriptionStatusInput) {
    const tenantId = this.resolveTenant(user, input.tenantId);
    if (!input.status || !Object.values(SubscriptionStatus).includes(input.status)) {
      throw new BadRequestException('Status subscription wajib diisi');
    }
    return this.prisma.$transaction(async tx => {
      const before = await tx.tenantSubscription.findUnique({ where: { tenantId } });
      const subscription = await tx.tenantSubscription.update({ where: { tenantId }, data: { status: input.status }, include: subscriptionInclude });
      await tx.auditLog.create({ data: { userId: user.sub, tenantId, action: 'SUBSCRIPTION_STATUS_UPDATED', metadata: { previousStatus: before?.status ?? null, status: subscription.status } } });
      return subscription;
    });
  }

  async modulePrice(moduleSlug: string) {
    const catalog = await this.customCatalog();
    const entry = catalog.modules.find(({ module }) => module.slug === moduleSlug);
    if (!entry) throw new NotFoundException('Harga modul tidak ditemukan');
    return { module: entry.module, priceMonthly: entry.modulePriceMonthly, priceYearly: entry.modulePriceYearly };
  }

  private async subscribePredefined(user: AuthUser, tenantId: string, cycle: BillingCycle, packageId?: string) {
    if (!packageId) throw new BadRequestException('Paket subscription wajib dipilih');
    const selected = await this.prisma.subscriptionPackage.findFirst({ where: { id: packageId, type: 'PREDEFINED', isActive: true } });
    if (!selected) throw new NotFoundException('Paket subscription tidak ditemukan');
    const renewalAt = this.nextRenewal(cycle);
    const subscription = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.tenantSubscription.upsert({
        where: { tenantId },
        create: { tenantId, packageId, isCustom: false, billingCycle: cycle, priceMonthly: selected.priceMonthly, priceYearly: selected.priceYearly, status: 'ACTIVE', renewalAt },
        update: { packageId, isCustom: false, billingCycle: cycle, priceMonthly: selected.priceMonthly, priceYearly: selected.priceYearly, status: 'ACTIVE', subscribedAt: new Date(), renewalAt },
      });
      await tx.tenantCustomModule.deleteMany({ where: { subscriptionId: saved.id } });
      await tx.auditLog.create({ data: { userId: user.sub, tenantId, action: 'SUBSCRIPTION_UPDATED', metadata: { packageId, isCustom: false, billingCycle: cycle } } });
      return tx.tenantSubscription.findUniqueOrThrow({ where: { id: saved.id }, include: subscriptionInclude });
    });
    return subscription;
  }

  private async subscribeCustom(user: AuthUser, tenantId: string, cycle: BillingCycle, moduleIds: readonly string[]) {
    const uniqueIds = [...new Set(moduleIds)];
    if (uniqueIds.length === 0) throw new BadRequestException('Pilih minimal satu modul');
    const catalog = await this.customCatalog();
    const selected = catalog.modules.filter(({ moduleId }) => uniqueIds.includes(moduleId));
    if (selected.length !== uniqueIds.length) throw new BadRequestException('Salah satu modul tidak tersedia dalam katalog custom');
    if (selected.some((entry) => entry.modulePriceMonthly === null || entry.modulePriceYearly === null)) throw new BadRequestException('Harga modul custom belum lengkap');
    const priceMonthly = selected.reduce((sum, entry) => sum + (entry.modulePriceMonthly ?? 0), 0);
    const priceYearly = selected.reduce((sum, entry) => sum + (entry.modulePriceYearly ?? 0), 0);
    const renewalAt = this.nextRenewal(cycle);
    const subscription = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.tenantSubscription.upsert({
        where: { tenantId },
        create: { tenantId, isCustom: true, billingCycle: cycle, priceMonthly, priceYearly, status: 'ACTIVE', renewalAt },
        update: { packageId: null, isCustom: true, billingCycle: cycle, priceMonthly, priceYearly, status: 'ACTIVE', subscribedAt: new Date(), renewalAt },
      });
      await tx.tenantCustomModule.deleteMany({ where: { subscriptionId: saved.id } });
      await tx.tenantCustomModule.createMany({ data: uniqueIds.map((moduleId) => ({ subscriptionId: saved.id, moduleId })) });
      await tx.auditLog.create({ data: { userId: user.sub, tenantId, action: 'SUBSCRIPTION_UPDATED', metadata: { isCustom: true, billingCycle: cycle, moduleIds: uniqueIds } } });
      return tx.tenantSubscription.findUniqueOrThrow({ where: { id: saved.id }, include: subscriptionInclude });
    });
    return subscription;
  }

  private customCatalog() {
    return this.prisma.subscriptionPackage.findFirstOrThrow({
      where: { type: 'CUSTOM', isActive: true },
      include: { modules: { where: { module: { isActive: true } }, include: { module: { include: { features: true } } }, orderBy: { module: { name: 'asc' } } } },
    });
  }

  private resolveTenant(user: AuthUser, requestedTenantId?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!requestedTenantId) throw new BadRequestException('Tenant wajib dipilih');
      return requestedTenantId;
    }
    if (requestedTenantId && requestedTenantId !== user.tenantId) throw new ForbiddenException('Anda hanya dapat mengakses subscription tenant sendiri');
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }

  private nextRenewal(cycle: BillingCycle) {
    const date = new Date();
    if (cycle === 'YEARLY') date.setFullYear(date.getFullYear() + 1);
    else date.setMonth(date.getMonth() + 1);
    return date;
  }

}
