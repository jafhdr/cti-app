import { Test, TestingModule } from '@nestjs/testing';
import { CasesService } from './cases.service';
import { CasesController } from './cases.controller';
import { PrismaService } from '../prisma.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('CasesService - Assignment', () => {
  let service: CasesService;
  let prisma: PrismaService;

  const mockUser = {
    sub: 'user-1',
    email: 'admin@test.com',
    role: 'ADMIN',
    tenantId: 'tenant-1',
  };

  const mockCase = {
    id: 'case-1',
    tenantId: 'tenant-1',
    caseNumber: 'CASE-2026-00001',
    title: 'Test Case',
    description: 'Test',
    status: 'OPEN',
    priority: 'MEDIUM',
    severity: 'MEDIUM',
    assigneeId: null,
    createdBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUser1 = {
    id: 'user-2',
    name: 'John Doe',
    email: 'john@test.com',
    tenantId: 'tenant-1',
    role: 'USER',
    isActive: true,
  };

  const mockUser2 = {
    id: 'user-3',
    name: 'Jane Doe',
    email: 'jane@test.com',
    tenantId: 'tenant-2',
    role: 'USER',
    isActive: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CasesService,
        {
          provide: PrismaService,
          useValue: {
            case: {
              findFirst: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              count: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            user: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
            },
            tenant: {
              findUnique: jest.fn(),
            },
            auditLog: {
              create: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CasesService>(CasesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('assign', () => {
    it('should assign case to user in same tenant', async () => {
      jest.spyOn(prisma.case, 'findFirst').mockResolvedValue(mockCase);
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser1);
      jest.spyOn(prisma.case, 'update').mockResolvedValue({
        ...mockCase,
        assigneeId: 'user-2',
        assignee: mockUser1,
      });
      jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as any);

      const result = await service.assign(mockUser, 'case-1', 'user-2');

      expect(result.assigneeId).toBe('user-2');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CASE_ASSIGNED',
            metadata: expect.objectContaining({
              newAssigneeId: 'user-2',
            }),
          }),
        })
      );
    });

    it('should reject assignment to user in different tenant', async () => {
      jest.spyOn(prisma.case, 'findFirst').mockResolvedValue(mockCase);
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser2);

      await expect(
        service.assign(mockUser, 'case-1', 'user-3')
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject assignment to non-existent user', async () => {
      jest.spyOn(prisma.case, 'findFirst').mockResolvedValue(mockCase);
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);

      await expect(
        service.assign(mockUser, 'case-1', 'user-invalid')
      ).rejects.toThrow(NotFoundException);
    });

    it('should log CASE_REASSIGNED when reassigning', async () => {
      const caseWithAssignee = { ...mockCase, assigneeId: 'user-2' };
      jest.spyOn(prisma.case, 'findFirst').mockResolvedValue(caseWithAssignee);
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser1);
      jest.spyOn(prisma.case, 'update').mockResolvedValue({
        ...caseWithAssignee,
        assigneeId: 'user-3',
      });
      jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as any);

      await service.assign(mockUser, 'case-1', 'user-3');

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CASE_REASSIGNED',
            metadata: expect.objectContaining({
              previousAssigneeId: 'user-2',
              newAssigneeId: 'user-3',
            }),
          }),
        })
      );
    });
  });

  describe('getAssignableUsers', () => {
    it('should return active users from tenant', async () => {
      jest.spyOn(prisma.user, 'findMany').mockResolvedValue([mockUser1]);

      const result = await service.getAssignableUsers(mockUser);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-2');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            isActive: true,
          }),
        })
      );
    });
  });
});
