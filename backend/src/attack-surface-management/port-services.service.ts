import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { RecordPortServiceDto } from './port-services.dto';

@Injectable()
export class PortServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, assetId: string, requestedTenantId?: string) {
    const tenantId = await this.resolveTenant(user, requestedTenantId);
    await this.ipAsset(assetId, tenantId);
    return this.prisma.assetPortService.findMany({
      where: { tenantId, assetId },
      orderBy: [{ port: 'asc' }, { protocol: 'asc' }],
    });
  }

  async record(user: AuthUser, assetId: string, input: RecordPortServiceDto, requestedTenantId?: string) {
    const tenantId = await this.resolveTenant(user, requestedTenantId);
    await this.ipAsset(assetId, tenantId);
    const observedAt = new Date();
    const service = input.service?.trim() || null;
    const mutation = this.prisma.assetPortService.upsert({
      where: {
        tenantId_assetId_protocol_port: {
          tenantId,
          assetId,
          protocol: input.protocol,
          port: input.port,
        },
      },
      create: {
        tenantId,
        assetId,
        port: input.port,
        protocol: input.protocol,
        service,
        status: input.status,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
      },
      update: { service, status: input.status, lastSeenAt: observedAt },
    });
    const audit = this.prisma.auditLog.create({
      data: {
        userId: user.sub,
        tenantId,
        action: 'ASSET_PORT_SERVICE_RECORDED',
        metadata: { assetId, port: input.port, protocol: input.protocol, status: input.status },
      },
    });
    const [result] = await this.prisma.$transaction([mutation, audit]);
    return result;
  }

  private async ipAsset(assetId: string, tenantId: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId } });
    if (!asset) throw new NotFoundException('Asset tidak ditemukan');
    if (asset.type !== AssetType.IP_ADDRESS) {
      throw new BadRequestException('Port/service hanya dapat dicatat pada asset IP_ADDRESS');
    }
    return asset;
  }

  private async resolveTenant(user: AuthUser, requestedTenantId?: string): Promise<string> {
    if (user.role === 'SUPER_ADMIN') {
      if (!requestedTenantId) throw new BadRequestException('Tenant wajib');
      const tenant = await this.prisma.tenant.findUnique({ where: { id: requestedTenantId }, select: { id: true } });
      if (!tenant) throw new BadRequestException('Tenant tidak ditemukan');
      return requestedTenantId;
    }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib');
    return user.tenantId;
  }
}
