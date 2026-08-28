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
