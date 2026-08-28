import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = 'superadmin@cti.local';
  const password = 'SuperAdmin123!';
  const name = 'Super Administrator';

  console.log('Creating SUPER_ADMIN...');

  // Cek apakah email sudah digunakan
  const existingUser = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (existingUser) {
    if (existingUser.role === Role.SUPER_ADMIN) {
      console.log('SUPER_ADMIN sudah ada.');
      console.log(`Email: ${existingUser.email}`);
      return;
    }

    throw new Error(
      `Email ${email} sudah digunakan oleh user dengan role ${existingUser.role}.`,
    );
  }

  // SUPER_ADMIN tidak membutuhkan tenant
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: Role.SUPER_ADMIN,
      tenantId: null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      tenantId: true,
      createdAt: true,
    },
  });

  console.log('');
  console.log('========================================');
  console.log('SUPER_ADMIN BERHASIL DIBUAT');
  console.log('========================================');
  console.log(`ID       : ${user.id}`);
  console.log(`Name     : ${user.name}`);
  console.log(`Email    : ${user.email}`);
  console.log(`Role     : ${user.role}`);
  console.log(`Tenant   : ${user.tenantId ?? 'Tidak terikat tenant'}`);
  console.log(`Password : ${password}`);
  console.log('========================================');
}

main()
  .catch((error) => {
    console.error('');
    console.error('Gagal membuat SUPER_ADMIN:');
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });