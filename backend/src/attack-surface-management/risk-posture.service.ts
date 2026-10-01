import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { evaluateRiskPosture } from './risk-posture';

@Injectable()
export class RiskPostureService {
  constructor(private readonly prisma: PrismaService) {}

  async history(user: AuthUser, assetId: string, requested?: string) {
    const tenantId = user.role === 'SUPER_ADMIN' ? requested : user.tenantId;
    if (!tenantId) throw user.role === 'SUPER_ADMIN' ? new BadRequestException('Tenant wajib') : new ForbiddenException('Tenant context wajib');
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId }, select: { id: true } });
    if (!asset) throw new NotFoundException('Asset tidak ditemukan');
    const history = await this.prisma.asmRiskSnapshot.findMany({ where: { tenantId, assetId }, orderBy: [{ evaluatedAt: 'desc' }, { id: 'desc' }], take: 20 });
    return { current: history[0] ?? null, previous: history[1] ?? null, history };
  }

  async capture(tx: Prisma.TransactionClient, tenantId: string, assetId: string, runId: string, evaluatedAt: Date) {
    const priorForRun = await tx.asmRiskSnapshot.findUnique({ where: { runId_assetId: { runId, assetId } } });
    if (priorForRun) return priorForRun;
    const previous = await tx.asmRiskSnapshot.findFirst({ where: { tenantId, assetId }, orderBy: [{ evaluatedAt: 'desc' }, { id: 'desc' }] });
    const findings = await tx.assetFinding.findMany({ where: { tenantId, assetId, status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { id: true, title: true, severity: true } });
    const posture = evaluateRiskPosture(findings, previous);
    const snapshot = await tx.asmRiskSnapshot.create({ data: {
      tenantId, assetId, runId, critical: posture.critical, high: posture.high, medium: posture.medium, low: posture.low,
      total: posture.total, score: posture.score, previousScore: posture.previousScore, trend: posture.trend,
      highImpactFindingIds: [...posture.highImpactFindingIds], evaluatedAt,
    } });
    if (posture.shouldAlert) {
      const newFindings = findings.filter(item => posture.newHighImpactFindingIds.includes(item.id));
      const sourceKey = `risk:${assetId}:${runId}`;
      const alert = await tx.alert.create({ data: {
        tenantId, assetId, riskSnapshotId: snapshot.id, source: 'ASM', sourceKey,
        severity: newFindings.some(item => item.severity === 'CRITICAL') ? 'CRITICAL' : 'HIGH',
        title: 'Asset risk posture increased',
        description: `Risk score increased from ${posture.previousScore} to ${posture.score}. New high-impact findings (${newFindings.length}): ${newFindings.map(item => item.title).join('; ')}.`,
        firstSeenAt: evaluatedAt, lastSeenAt: evaluatedAt,
      } });
      await tx.auditLog.create({ data: { tenantId, action: 'ASM_ALERT_CREATED', metadata: { alertId: alert.id, assetId, sourceKey, riskSnapshotId: snapshot.id } } });
    }
    return snapshot;
  }
}
