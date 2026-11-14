import { CanActivate, ConflictException, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class CaseClosedMutationGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ method: string; params: { id?: string }; user: { tenantId?: string | null; role: string }; query: { tenantId?: string } }>();
    if (!request.params.id || request.method === 'GET' || request.method === 'DELETE') return true;
    const tenantId = request.user.role === 'SUPER_ADMIN' ? request.query.tenantId : request.user.tenantId;
    if (!tenantId) return true;
    const record = await this.prisma.case.findFirst({ where: { id: request.params.id, tenantId }, select: { status: true, investigationCycle: true } });
    if (record?.status !== 'CLOSED') return true;
    const closure = await this.prisma.caseClosure.findUnique({ where: { caseId_cycle: { caseId: request.params.id, cycle: record.investigationCycle } }, select: { id: true } });
    if (closure) throw new ConflictException('Case tertutup; buka kembali sebelum mengubah investigasi');
    if (process.env.CASE_V2_INTEGRITY_ENABLED !== 'true') return true;
    const assigned = await this.prisma.userModuleAccess.findFirst({ where: { tenantId, module: { slug: 'case-management' }, featureKeys: { has: 'case-v2-integrity' } }, select: { userId: true } });
    if (assigned) throw new ConflictException('Case tertutup; buka kembali sebelum mengubah investigasi');
    return true;
  }
}
