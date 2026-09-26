import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { AuthService } from './auth.service';
import { ModuleAccessService } from './module-access.service';

describe('ASM access in auth/me', () => {
  it.each([false, true])('reports guard decision %s while retaining assignment data', async (accessible) => {
    const evaluate = jest.fn().mockResolvedValue({ accessible });
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: {} },
        { provide: ModuleAccessService, useValue: { evaluate } },
        { provide: PrismaService, useValue: {
          user: { findUnique: jest.fn().mockResolvedValue({ id: 'cj-admin', email: 'admin@cj.test', name: 'Admin', role: 'ADMIN', tenant: { id: 'cj', name: 'CJ', slug: 'cj' } }) },
          appModule: { findMany: jest.fn().mockResolvedValue([{ id: 'asm', name: 'Attack Surface Management', slug: 'attack-surface-management', userAccess: [] }]) },
        } },
      ],
    }).compile();
    const result = await module.get(AuthService).me('cj-admin');
    expect(evaluate).toHaveBeenCalledWith({ sub: 'cj-admin', tenantId: 'cj', role: 'ADMIN' }, 'attack-surface-management');
    expect(result?.moduleAccess[0]).toMatchObject({ assigned: false, accessible });
  });
});
