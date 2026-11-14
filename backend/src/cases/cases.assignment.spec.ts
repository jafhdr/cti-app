import { Test, TestingModule } from '@nestjs/testing';
import { CasesService } from './cases.service';
import type { AuditLog, Case, User } from '@prisma/client';
import type { AuthUser } from '../users/users.types';
import { PrismaService } from '../prisma.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('CasesService - Assignment', () => {
  let service: CasesService;
  let prisma: PrismaService;

  const mockUser: AuthUser = {
    sub: 'user-1',
    role: 'ADMIN',
    tenantId: 'tenant-1',
  };

  const mockCase: Case = {
    id: 'case-1',
    tenantId: 'tenant-1',
    caseNumber: 'CASE-2026-00001',
    title: 'Test Case',
    description: 'Test',
    status: 'OPEN',
    priority: 'MEDIUM',
    severity: 'MEDIUM',
    assigneeId: null,
    revision: 0,
    investigationCycle: 1,
    dueAt: null,
    slaPolicyKey: null,
    createdBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUser1: User = {
    id: 'user-2',
    name: 'John Doe',
    email: 'john@test.com',
    tenantId: 'tenant-1',
    role: 'USER',
    isActive: true,
    passwordHash: 'unused-test-hash',
    sessionVersion: 0,
    deactivatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUser2: User = {
    ...mockUser1,
    id: 'user-3',
    name: 'Jane Doe',
    email: 'jane@test.com',
    tenantId: 'tenant-2',
    role: 'USER',
    isActive: true,
  };

  const mockAuditLog: AuditLog = {
    id: 'audit-1',
    userId: mockUser.sub,
    tenantId: mockUser.tenantId,
    action: 'CASE_ASSIGNED',
    metadata: null,
    createdAt: new Date(),
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
            caseActivity: {
              create: jest.fn(),
            },
            notificationOutbox: { create: jest.fn() },
            $transaction: jest.fn(async (callback: (tx: PrismaService) => Promise<unknown>) => callback(prisma)),
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
      });
      jest.spyOn(prisma.auditLog, 'create').mockResolvedValue(mockAuditLog);

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

    it('should reject assignment to inactive user', async () => {
      jest.spyOn(prisma.case, 'findFirst').mockResolvedValue(mockCase);
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ ...mockUser1, isActive: false });

      await expect(service.assign(mockUser, 'case-1', 'user-2')).rejects.toThrow('Assignee harus aktif');
      expect(prisma.case.update).not.toHaveBeenCalled();
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
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ ...mockUser1, id: 'user-3' });
      jest.spyOn(prisma.case, 'update').mockResolvedValue({
        ...caseWithAssignee,
        assigneeId: 'user-3',
      });
      jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({ ...mockAuditLog, action: 'CASE_REASSIGNED' });

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
