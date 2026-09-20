import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { IndicatorType, IocCandidateType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { extractIocs, type TelegramEntity } from './ioc-extractor';

@Injectable()
export class IocCandidatesService {
  constructor(private readonly prisma: PrismaService) {}

  async processPending(limit = 100): Promise<{ readonly processed: number; readonly failed: number }> {
    const messages = await this.prisma.telegramStagingMessage.findMany({ where: { processingStatus: 'PENDING' }, orderBy: { ingestedAt: 'asc' }, take: limit });
    let processed = 0;
    let failed = 0;
    for (const message of messages) {
      try {
        const entities = parseEntities(message.entities);
        const extracted = extractIocs({ text: message.text ?? message.content, caption: message.caption, entities });
        await this.prisma.$transaction(async transaction => {
          for (const ioc of extracted) {
            const candidate = await transaction.iocCandidate.upsert({
              where: { tenantId_type_normalizedValue: { tenantId: message.tenantId, type: ioc.type, normalizedValue: ioc.normalizedValue } },
              create: { tenantId: message.tenantId, intelligenceSourceId: message.intelligenceSourceId, type: ioc.type, rawValue: ioc.rawValue, normalizedValue: ioc.normalizedValue, confidence: ioc.confidence },
              update: { confidence: { set: ioc.confidence } },
            });
            await transaction.iocObservation.upsert({
              where: { tenantId_candidateId_telegramStagingMessageId_extractionMethod_spanStart_spanEnd: { tenantId: message.tenantId, candidateId: candidate.id, telegramStagingMessageId: message.id, extractionMethod: ioc.extractionMethod, spanStart: ioc.spanStart, spanEnd: ioc.spanEnd } },
              create: { tenantId: message.tenantId, candidateId: candidate.id, telegramStagingMessageId: message.id, rawValue: ioc.rawValue, extractionMethod: ioc.extractionMethod, spanStart: ioc.spanStart, spanEnd: ioc.spanEnd },
              update: { rawValue: ioc.rawValue },
            });
          }
          await transaction.telegramStagingMessage.update({ where: { id: message.id }, data: { processingStatus: 'PROCESSED', processingError: null } });
        });
        processed += 1;
      } catch (cause) {
        failed += 1;
        await this.prisma.telegramStagingMessage.update({ where: { id: message.id }, data: { processingStatus: 'FAILED', processingError: cause instanceof Error ? cause.message.slice(0, 500) : 'Unknown processing error' } });
      }
    }
    return { processed, failed };
  }

  async listPending(user: AuthUser, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    return this.prisma.iocCandidate.findMany({
      where: { tenantId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: { intelligenceSource: { select: { id: true, name: true } }, observations: { orderBy: { observedAt: 'desc' }, include: { telegramStagingMessage: { select: { id: true, messageId: true, channelTitle: true, channelUsername: true, messageUrl: true, messageTimestamp: true } } } } },
    });
  }

  async approve(user: AuthUser, id: string, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const candidate = await this.pendingCandidate(id, tenantId);
    const indicatorType = indicatorTypeFor(candidate.type);

    return this.prisma.$transaction(async transaction => {
      await this.claimPending(transaction, id, tenantId, user.sub, 'APPROVED');
      const created = await transaction.indicator.createMany({
        data: {
          tenantId,
          type: indicatorType,
          value: candidate.normalizedValue,
          confidence: candidate.confidence,
          severity: 'MEDIUM',
          status: 'ACTIVE',
          tags: ['telegram'],
          source: 'Telegram',
          intelligenceSourceId: candidate.intelligenceSourceId,
          createdById: user.sub,
        },
        skipDuplicates: true,
      });
      const indicator = await transaction.indicator.findUnique({
        where: { tenantId_type_value: { tenantId, type: indicatorType, value: candidate.normalizedValue } },
        select: { id: true },
      });
      if (!indicator) throw new NotFoundException('Indicator gagal dibuat atau ditemukan');

      await transaction.iocCandidate.update({
        where: { id_tenantId: { id, tenantId } },
        data: { indicatorId: indicator.id },
      });
      if (created.count === 1) {
        await transaction.auditLog.create({ data: { userId: user.sub, tenantId, action: 'INDICATOR_CREATED_FROM_IOC_CANDIDATE', metadata: { candidateId: id, indicatorId: indicator.id, type: indicatorType, normalizedValue: candidate.normalizedValue } } });
      }
      await transaction.auditLog.create({ data: { userId: user.sub, tenantId, action: 'IOC_CANDIDATE_APPROVED', metadata: { candidateId: id, indicatorId: indicator.id, indicatorCreated: created.count === 1, type: candidate.type, normalizedValue: candidate.normalizedValue } } });
      const insertedJob = await transaction.indicatorEnrichmentJob.createMany({
        data: { tenantId, indicatorId: indicator.id, provider: 'VIRUSTOTAL', trigger: 'TELEGRAM_APPROVAL', requestedById: user.sub },
        skipDuplicates: true,
      });
      const requeuedJob = insertedJob.count === 0
        ? await transaction.indicatorEnrichmentJob.updateMany({
          where: { tenantId, indicatorId: indicator.id, provider: 'VIRUSTOTAL', status: { in: ['SUCCESS', 'FAILED'] } },
          data: { status: 'PENDING', attempts: 0, availableAt: new Date(), lockedAt: null, lastError: null, trigger: 'TELEGRAM_APPROVAL', requestedById: user.sub },
        })
        : { count: 0 };
      if (insertedJob.count === 1 || requeuedJob.count === 1) {
        const job = await transaction.indicatorEnrichmentJob.findUniqueOrThrow({ where: { tenantId_indicatorId_provider: { tenantId, indicatorId: indicator.id, provider: 'VIRUSTOTAL' } } });
        await transaction.auditLog.create({ data: { userId: user.sub, tenantId, action: 'INDICATOR_ENRICHMENT_QUEUED', metadata: { indicatorId: indicator.id, provider: 'VIRUSTOTAL', trigger: 'TELEGRAM_APPROVAL', status: job.status, jobId: job.id } } });
      }
      return { status: 'APPROVED' as const, candidateId: id, indicatorId: indicator.id, indicatorCreated: created.count === 1 };
    });
  }

  async reject(user: AuthUser, id: string, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const candidate = await this.pendingCandidate(id, tenantId);
    return this.prisma.$transaction(async transaction => {
      await this.claimPending(transaction, id, tenantId, user.sub, 'REJECTED');
      await transaction.auditLog.create({ data: { userId: user.sub, tenantId, action: 'IOC_CANDIDATE_REJECTED', metadata: { candidateId: id, type: candidate.type, normalizedValue: candidate.normalizedValue } } });
      return { status: 'REJECTED' as const, candidateId: id };
    });
  }

  private async pendingCandidate(id: string, tenantId: string) {
    const candidate = await this.prisma.iocCandidate.findFirst({ where: { id, tenantId } });
    if (!candidate) throw new NotFoundException('IOC candidate tidak ditemukan');
    if (candidate.status !== 'PENDING') throw new ConflictException('IOC candidate hanya dapat diproses saat berstatus PENDING');
    return candidate;
  }

  private async claimPending(transaction: Prisma.TransactionClient, id: string, tenantId: string, reviewedBy: string, status: 'APPROVED' | 'REJECTED'): Promise<void> {
    const claimed = await transaction.iocCandidate.updateMany({
      where: { id, tenantId, status: 'PENDING' },
      data: { status, reviewedBy, reviewedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ConflictException('IOC candidate hanya dapat diproses saat berstatus PENDING');
  }

  private resolveTenant(user: AuthUser, requestedTenantId?: string): string {
    if (user.role === 'SUPER_ADMIN') {
      if (!requestedTenantId) throw new BadRequestException('Tenant wajib dipilih');
      return requestedTenantId;
    }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }
}

function indicatorTypeFor(type: IocCandidateType): IndicatorType {
  switch (type) {
    case 'IPV4':
    case 'IPV6': return 'IP_ADDRESS';
    case 'DOMAIN': return 'DOMAIN';
    case 'URL': return 'URL';
    case 'MD5':
    case 'SHA1':
    case 'SHA256': return 'FILE_HASH';
  }
}

function parseEntities(value: Prisma.JsonValue | null): readonly TelegramEntity[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const type = item['type']; const offset = item['offset']; const length = item['length']; const url = item['url'];
    return typeof type === 'string' && typeof offset === 'number' && typeof length === 'number' && (url === undefined || typeof url === 'string') ? [{ type, offset, length, ...(typeof url === 'string' ? { url } : {}) }] : [];
  });
}
