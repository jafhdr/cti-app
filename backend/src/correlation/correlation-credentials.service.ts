import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';

const digest = (secret: string): string => createHash('sha256').update(secret).digest('hex');
const issueSecret = (): string => randomBytes(32).toString('base64url');
type CredentialView = { id: string; tenantId: string; name: string; scope: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null; rotatedFromId: string | null; lastUsedAt: Date | null };
const view = (row: CredentialView) => ({ id: row.id, tenantId: row.tenantId, name: row.name, scope: row.scope,
  createdAt: row.createdAt, expiresAt: row.expiresAt, revokedAt: row.revokedAt, rotatedFromId: row.rotatedFromId, lastUsedAt: row.lastUsedAt });

@Injectable()
export class CorrelationCredentialsService {
  constructor(private readonly prisma: PrismaService) {}

  private enabled(): void {
    const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/disabled').pathname.slice(1);
    if (process.env.THREAT_CORRELATION_PILOT_ENABLED !== 'true' || process.env.SICTI_ISOLATED_QA !== 'true'
      || !/^cti_corr_qa_[a-z0-9_]+$/.test(database)) throw new NotFoundException('Correlation connector unavailable');
  }

  private async tenantId(user: AuthUser, requested?: string): Promise<string> {
    const id = user.role === 'SUPER_ADMIN' ? requested : user.tenantId;
    if (!id || (user.role !== 'SUPER_ADMIN' && requested && requested !== user.tenantId)) throw new ForbiddenException('Tenant context denied');
    if (!await this.prisma.tenant.findFirst({ where: { id, isActive: true }, select: { id: true } })) throw new NotFoundException('Tenant unavailable');
    return id;
  }

  async create(user: AuthUser, name: string, expiresInDays: number, requested?: string) {
    this.enabled();
    const tenantId = await this.tenantId(user, requested);
    const secret = issueSecret();
    const expiresAt = new Date(Date.now() + expiresInDays * 86400000);
    const row = await this.prisma.$transaction(async tx => {
      const created = await tx.correlationConnectorCredential.create({ data: { tenantId, name, secretHash: digest(secret), expiresAt } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'CORRELATION_CONNECTOR_CREDENTIAL_CREATED', metadata: { credentialId: created.id, expiresAt } } });
      return created;
    });
    return { ...view(row), token: `sicti_c_${row.id}.${secret}` };
  }

  async list(user: AuthUser, requested?: string) {
    this.enabled();
    const tenantId = await this.tenantId(user, requested);
    return (await this.prisma.correlationConnectorCredential.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } })).map(view);
  }

  async rotate(user: AuthUser, id: string, expiresInDays: number, requested?: string) {
    this.enabled();
    const tenantId = await this.tenantId(user, requested);
    const secret = issueSecret();
    const expiresAt = new Date(Date.now() + expiresInDays * 86400000);
    const row = await this.prisma.$transaction(async tx => {
      const current = await tx.correlationConnectorCredential.findFirst({ where: { id, tenantId, revokedAt: null } });
      if (!current) throw new NotFoundException('Active connector credential unavailable');
      const revoked = await tx.correlationConnectorCredential.updateMany({ where: { id, tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (revoked.count !== 1) throw new NotFoundException('Active connector credential unavailable');
      const created = await tx.correlationConnectorCredential.create({ data: { tenantId, name: current.name, secretHash: digest(secret), expiresAt, rotatedFromId: id } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'CORRELATION_CONNECTOR_CREDENTIAL_ROTATED', metadata: { oldId: id, newId: created.id } } });
      return created;
    });
    return { ...view(row), token: `sicti_c_${row.id}.${secret}` };
  }

  async revoke(user: AuthUser, id: string, requested?: string) {
    this.enabled();
    const tenantId = await this.tenantId(user, requested);
    await this.prisma.$transaction(async tx => {
      const updated = await tx.correlationConnectorCredential.updateMany({ where: { id, tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (updated.count !== 1) throw new NotFoundException('Active connector credential unavailable');
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'CORRELATION_CONNECTOR_CREDENTIAL_REVOKED', metadata: { credentialId: id } } });
    });
    return { revoked: true };
  }

  async authenticate(header?: string): Promise<{ tenantId: string; credentialId: string }> {
    this.enabled();
    const match = /^SICTIConnector sicti_c_([a-z0-9]+)\.([A-Za-z0-9_-]{43})$/.exec(header ?? '');
    if (!match) throw new UnauthorizedException('Invalid connector credential');
    const row = await this.prisma.correlationConnectorCredential.findUnique({ where: { id: match[1] }, include: { tenant: { select: { isActive: true } } } });
    if (!row || row.revokedAt || row.expiresAt <= new Date() || !row.tenant.isActive || row.scope !== 'telemetry:write')
      throw new UnauthorizedException('Invalid connector credential');
    const candidate = Buffer.from(digest(match[2]), 'hex');
    const stored = Buffer.from(row.secretHash, 'hex');
    if (candidate.length !== stored.length || !timingSafeEqual(candidate, stored)) throw new UnauthorizedException('Invalid connector credential');
    await this.prisma.correlationConnectorCredential.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    return { tenantId: row.tenantId, credentialId: row.id };
  }
}
