import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-tenant' },
    update: {},
    create: { name: 'Demo Organization', slug: 'demo-tenant' },
  });

  const passwordHash = await bcrypt.hash('Admin123!', 10);

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
  ].map((module) => prisma.appModule.upsert({ where: { slug: module.slug }, update: module, create: module })),
  );
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

  const superAdminPasswordHash = await bcrypt.hash('SuperAdmin123!', 10);

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

  console.log('Seed completed: admin@cti.local / Admin123!');
}

main()
  .finally(() => prisma.$disconnect());
