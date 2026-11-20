import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { CaseIntegrityCore } from './case-integrity.core';
import type { ReviseCaseEvidenceInput } from './case-integrity.types';

@Injectable()
export class CasesEvidenceV2Service {
  constructor(private readonly prisma: PrismaService, private readonly core: CaseIntegrityCore) {}

  async history(user: AuthUser, caseId: string, evidenceId: string, selected?: string) {
    const tenantId = this.core.scope(user, selected);
    await this.core.record(caseId, tenantId);
    const evidence = await this.prisma.caseEvidence.findFirst({ where: { id: evidenceId, caseId, tenantId }, include: { revisions: { orderBy: { revision: 'asc' } } } });
    if (!evidence) throw new NotFoundException('Evidence tidak ditemukan');
    return { evidenceId, integrityKind: evidence.revisions.length ? 'METADATA_ONLY' : 'LEGACY_UNVERSIONED',
      revisions: evidence.revisions.length ? evidence.revisions : [{ id: null, revision: 0, name: evidence.name, type: evidence.type,
        description: evidence.description, source: evidence.source, authorId: evidence.createdBy, recordedAt: evidence.createdAt,
        integrityKind: 'LEGACY_UNVERSIONED' }] };
  }

  async revise(user: AuthUser, caseId: string, evidenceId: string, selected: string | undefined, input: ReviseCaseEvidenceInput) {
    const tenantId = this.core.scope(user, selected);
    const record = await this.core.record(caseId, tenantId);
    if (record.status === 'CLOSED') throw new ConflictException('Case tertutup; buka kembali sebelum merevisi evidence');
    const evidence = await this.prisma.caseEvidence.findFirst({ where: { id: evidenceId, caseId, tenantId } });
    if (!evidence) throw new NotFoundException('Evidence tidak ditemukan');
    if (user.role === 'USER' && evidence.createdBy !== user.sub) throw new ForbiddenException('Evidence bukan milik Anda');
    const name = input.name.trim();
    const type = input.type.trim();
    if (!name || !type) throw new BadRequestException('Nama dan tipe evidence wajib');
    return this.prisma.$transaction(async tx => {
      await this.core.bump(tx, caseId, tenantId, input.expectedRevision);
      const latest = await tx.caseEvidenceRevision.findFirst({ where: { caseId, tenantId, evidenceId }, orderBy: { revision: 'desc' } });
      if (!latest) {
        await tx.caseEvidenceRevision.create({ data: { tenantId, caseId, evidenceId, revision: 1, name: evidence.name, type: evidence.type,
          description: evidence.description, source: evidence.source, authorId: user.sub, integrityKind: 'LEGACY_BASELINE' } });
      }
      const changed = await tx.caseEvidence.update({ where: { id: evidenceId, tenantId, caseId }, data: { name, type,
        description: input.description?.trim() || null, source: input.source?.trim() || null } });
      const revision = await tx.caseEvidenceRevision.create({ data: { tenantId, caseId, evidenceId, revision: (latest?.revision ?? 1) + 1,
        name: changed.name, type: changed.type, description: changed.description, source: changed.source, authorId: user.sub } });
      await this.core.event(tx, user, tenantId, caseId, 'CASE_EVIDENCE_REVISED', { evidenceId, evidenceRevisionId: revision.id, fromEvidenceRevision: latest?.revision ?? 1, toEvidenceRevision: revision.revision, integrityKind: revision.integrityKind });
      return revision;
    });
  }
}
