import { AuthService } from './auth.service';
import type { PrismaService } from '../prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { ModuleAccessService } from './module-access.service';
import * as bcrypt from 'bcrypt';

describe('AuthService tenant login', () => {
  it('rejects an inactive tenant before creating a session or LOGIN audit', async () => {
    const password = 'Password-123';
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({
        id: 'user', email: 'user@example.test', passwordHash: await bcrypt.hash(password, 4),
        isActive: true, tenantId: 'tenant', tenant: { id: 'tenant', isActive: false }, sessionVersion: 0,
      }) },
      authSession: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      tenant: { findUnique: jest.fn().mockResolvedValue({ isActive: false }) },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async operation => operation(prisma));
    const service = new AuthService(prisma as unknown as PrismaService, {} as JwtService, {} as ModuleAccessService);

    await expect(service.login('user@example.test', password)).rejects.toMatchObject({ status: 401 });
    expect(prisma.authSession.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
