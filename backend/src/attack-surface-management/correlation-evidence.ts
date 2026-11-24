import { createHash } from 'node:crypto';
import type { AssetPortService, Vulnerability } from '@prisma/client';
import type { Match } from './version-match';

export const MATCHER_VERSION = 'asm-product-version-v1' as const;

type ServiceInput = Pick<AssetPortService, 'id' | 'protocol' | 'port' | 'service' | 'product' | 'version' | 'source' | 'firstSeenAt' | 'lastSeenAt'>;
type VulnerabilityInput = Pick<Vulnerability, 'id' | 'cveId' | 'affectedProduct' | 'affectedVersionExact' | 'affectedVersionStart' | 'affectedVersionEnd' | 'severity' | 'source' | 'updatedAt'>;

const normalized = (value: string | null): string | null => value?.trim().toLowerCase() || null;

export function correlationEvidence(service: ServiceInput, vulnerability: VulnerabilityInput, match: Match) {
  // Array order is the canonical v1 serialization. Volatile run/last-seen times are excluded.
  const canonical = [
    MATCHER_VERSION, service.protocol, service.port, normalized(service.service),
    normalized(service.product), normalized(service.version), normalized(service.source),
    vulnerability.id, normalized(vulnerability.cveId), normalized(vulnerability.affectedProduct),
    normalized(vulnerability.affectedVersionExact), normalized(vulnerability.affectedVersionStart),
    normalized(vulnerability.affectedVersionEnd), vulnerability.severity, normalized(vulnerability.source),
    match.confidence, match.reason,
  ];
  const evidenceHash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return {
    evidenceHash,
    serviceSnapshot: {
      protocol: service.protocol, port: service.port, service: service.service,
      product: service.product, version: service.version, fingerprintSource: service.source,
      firstSeenAt: service.firstSeenAt.toISOString(), lastSeenAt: service.lastSeenAt.toISOString(),
    },
    tiSnapshot: {
      vulnerabilityId: vulnerability.id, cveId: vulnerability.cveId,
      affectedProduct: vulnerability.affectedProduct, affectedVersionExact: vulnerability.affectedVersionExact,
      affectedVersionStart: vulnerability.affectedVersionStart, affectedVersionEnd: vulnerability.affectedVersionEnd,
      severity: vulnerability.severity, source: vulnerability.source, updatedAt: vulnerability.updatedAt.toISOString(),
    },
  };
}
