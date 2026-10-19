import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD ?? '';

if (!seedAdminPassword) {
  throw new Error('Missing required environment variable: SEED_ADMIN_PASSWORD');
}

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-tenant' },
    update: {},
    create: { name: 'Demo Organization', slug: 'demo-tenant' },
  });

  const passwordHash = await bcrypt.hash(seedAdminPassword, 10);

  await prisma.user.upsert({
    where: { email: 'admin@cti.local' },
    update: { passwordHash, tenantId: tenant.id, role: Role.ADMIN },
    create: {
      email: 'admin@cti.local',
      name: 'CTI Admin',
      passwordHash,
      tenantId: tenant.id,
      role: Role.ADMIN,
    },
  });

  const modules = await Promise.all([
    { slug: 'threat-intelligence', name: 'Threat Intelligence', description: 'Kelola indikator, intelijen ancaman, dan enrichment.', category: 'CTI' as const },
    { slug: 'appsec-posture', name: 'AppSec Posture', description: 'Pantau temuan keamanan aplikasi dan risiko deployment.', category: 'APPSEC' as const },
    { slug: 'case-management', name: 'Case Management', description: 'Koordinasikan investigasi dan respons insiden.', category: 'CTI' as const },
    { slug: 'attack-surface-management', name: 'Attack Surface Management', description: 'Kelola aset, temukan permukaan serangan, dan monitor risiko.', category: 'APPSEC' as const },
  ].map((module) => prisma.appModule.upsert({ where: { slug: module.slug }, update: module, create: module })),
  );

  const featuresBySlug: Record<string, Array<{ key: string; name: string; description: string }>> = {
    'threat-intelligence': [
      { key: 'indicator-management', name: 'Indicator Management', description: 'Kelola IOC dan status indikator.' },
      { key: 'intelligence-hub', name: 'Intelligence Hub', description: 'Relasi entitas, case, dan alert.' },
      { key: 'export', name: 'Export Data', description: 'Ekspor data intelijen untuk analisis lanjutan.' },
    ],
    'appsec-posture': [
      { key: 'posture-overview', name: 'Posture Overview', description: 'Ringkasan risiko keamanan aplikasi.' },
      { key: 'advanced-chart', name: 'Advanced Charts (Legacy)', description: 'Legacy catalog only; tidak dapat diberikan sebagai fitur baru.' },
      { key: 'application-inventory', name: 'Application Inventory', description: 'Kelola inventaris aplikasi.' },
      { key: 'finding-management', name: 'Finding Management', description: 'Kelola temuan keamanan aplikasi.' },
    ],
    'case-management': [
      { key: 'case-workflow', name: 'Case Workflow', description: 'Kelola siklus investigasi insiden.' },
      { key: 'alert-triage', name: 'Alert Triage', description: 'Prioritaskan dan tindak lanjuti alert.' },
    ],
    'attack-surface-management': [
      { key: 'asset-management', name: 'Asset Management', description: 'Kelola aset dan detail inventaris.' },
      { key: 'asset-discovery', name: 'Asset Discovery', description: 'Temukan dan monitor aset baru.' },
    ],
  };
  await Promise.all(modules.flatMap((module) => (featuresBySlug[module.slug] ?? []).map((feature) =>
    prisma.moduleFeature.upsert({
      where: { moduleId_key: { moduleId: module.id, key: feature.key } },
      update: { name: feature.name, description: feature.description },
      create: { moduleId: module.id, ...feature },
    }),
  )));

  const packageDefinitions = [
    { name: 'Community', description: 'Fondasi CTI untuk tim yang baru memulai.', priceMonthly: 0, priceYearly: 0, moduleSlugs: ['threat-intelligence'] },
    { name: 'Professional', description: 'Perlindungan terpadu untuk operasi keamanan berkembang.', priceMonthly: 1_500_000, priceYearly: 15_000_000, moduleSlugs: ['threat-intelligence', 'case-management'] },
    { name: 'Team', description: 'Seluruh kapabilitas platform untuk kolaborasi lintas tim.', priceMonthly: 4_000_000, priceYearly: 40_000_000, moduleSlugs: ['threat-intelligence', 'case-management', 'appsec-posture', 'attack-surface-management'] },
  ];
  for (const definition of packageDefinitions) {
    const subscriptionPackage = await prisma.subscriptionPackage.upsert({
      where: { name: definition.name },
      update: { description: definition.description, type: 'PREDEFINED', priceMonthly: definition.priceMonthly, priceYearly: definition.priceYearly, isActive: true },
      create: { name: definition.name, description: definition.description, type: 'PREDEFINED', billingCycle: 'MONTHLY', priceMonthly: definition.priceMonthly, priceYearly: definition.priceYearly },
    });
    const includedModules = modules.filter((module) => definition.moduleSlugs.includes(module.slug));
    await prisma.packageModule.deleteMany({ where: { packageId: subscriptionPackage.id, moduleId: { notIn: includedModules.map((module) => module.id) } } });
    await Promise.all(includedModules.map((module) => prisma.packageModule.upsert({
      where: { packageId_moduleId: { packageId: subscriptionPackage.id, moduleId: module.id } },
      update: {}, create: { packageId: subscriptionPackage.id, moduleId: module.id },
    })));
  }

  const customPackage = await prisma.subscriptionPackage.upsert({
    where: { name: 'Custom Package' },
    update: { description: 'Pilih modul sesuai kebutuhan organisasi.', type: 'CUSTOM', isActive: true },
    create: { name: 'Custom Package', description: 'Pilih modul sesuai kebutuhan organisasi.', type: 'CUSTOM', billingCycle: 'MONTHLY', priceMonthly: 0, priceYearly: 0 },
  });
  const customPrices: Record<string, { monthly: number; yearly: number }> = {
    'threat-intelligence': { monthly: 750_000, yearly: 7_500_000 },
    'case-management': { monthly: 600_000, yearly: 6_000_000 },
    'appsec-posture': { monthly: 900_000, yearly: 9_000_000 },
    'attack-surface-management': { monthly: 800_000, yearly: 8_000_000 },
  };
  await Promise.all(modules.map((module) => prisma.packageModule.upsert({
    where: { packageId_moduleId: { packageId: customPackage.id, moduleId: module.id } },
    update: { modulePriceMonthly: customPrices[module.slug].monthly, modulePriceYearly: customPrices[module.slug].yearly },
    create: { packageId: customPackage.id, moduleId: module.id, modulePriceMonthly: customPrices[module.slug].monthly, modulePriceYearly: customPrices[module.slug].yearly },
  })));

  const community = await prisma.subscriptionPackage.findUniqueOrThrow({ where: { name: 'Community' } });
  const renewalAt = new Date();
  renewalAt.setFullYear(renewalAt.getFullYear() + 1);
  await prisma.tenantSubscription.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id, packageId: community.id, billingCycle: 'YEARLY', priceMonthly: community.priceMonthly, priceYearly: community.priceYearly, status: 'ACTIVE', renewalAt },
  });
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  await Promise.all(tenants.flatMap((tenant) => modules.map(async (module) => {
    const setting = await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: tenant.id, moduleId: module.id } },
      update: {},
      create: { tenantId: tenant.id, moduleId: module.id, isEnabled: true },
    });
    await Promise.all([
      prisma.moduleRoleAccess.upsert({ where: { tenantModuleId_role: { tenantModuleId: setting.id, role: 'ADMIN' } }, update: {}, create: { tenantModuleId: setting.id, role: 'ADMIN', isAllowed: true } }),
      prisma.moduleRoleAccess.upsert({ where: { tenantModuleId_role: { tenantModuleId: setting.id, role: 'USER' } }, update: {}, create: { tenantModuleId: setting.id, role: 'USER', isAllowed: true } }),
    ]);
  })));

  const superAdminPasswordHash = await bcrypt.hash(seedAdminPassword, 10);

  await prisma.user.upsert({
    where: { email: 'superadmin@cti.local' },
    update: { passwordHash: superAdminPasswordHash },
    create: {
      email: 'superadmin@cti.local',
      name: 'Super Admin',
      passwordHash: superAdminPasswordHash,
      role: Role.SUPER_ADMIN,
    },
  });

  console.log('Seed completed.');
}

main()
  .finally(() => prisma.$disconnect());
