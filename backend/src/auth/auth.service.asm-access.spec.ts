import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { AuthService } from './auth.service';
import { ModuleAccessService } from './module-access.service';

describe('effective access in auth/me', () => {
  it.each([false, true])('reports shared decision %s while retaining assignment data', async accessible => {
    const listForUser = jest.fn().mockResolvedValue([{
      id: 'asm', name: 'Attack Surface Management', slug: 'attack-surface-management',
      assigned: true, accessible, featureKeys: ['asset-management'],
      effectiveFeatures: accessible ? ['asset-management'] : [],
      subscriptionIncluded: accessible, subscriptionActive: accessible, isActive: true,
      tenantEnabled: true, roleAllowed: true, reason: accessible ? null : 'Subscription tenant tidak aktif',
    }]);
    const module = await Test.createTestingModule({
      providers: [AuthService,
        { provide: JwtService, useValue: {} },
        { provide: ModuleAccessService, useValue: { listForUser } },
        { provide: PrismaService, useValue: {
          user: { findUnique: jest.fn().mockResolvedValue({ id: 'cj-admin', email: 'admin@cj.test', name: 'Admin', role: 'ADMIN', tenant: { id: 'cj', name: 'CJ', slug: 'cj' } }) },
        } },
      ],
    }).compile();
    const result = await module.get(AuthService).me('cj-admin');
    expect(listForUser).toHaveBeenCalledWith({ sub: 'cj-admin', tenantId: 'cj', role: 'ADMIN' });
    expect(result?.moduleAccess[0]).toMatchObject({ assigned: true, accessible, features: accessible ? ['asset-management'] : [] });
  });
});
