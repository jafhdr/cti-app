import { evaluateContextualPriority, type PriorityCandidate } from './priority-evaluator';

const asOf = new Date('2026-10-28T12:00:00.000Z');
const recent = new Date('2026-10-28T11:00:00.000Z');

function candidate(overrides: Partial<PriorityCandidate> = {}): PriorityCandidate {
  return { id: 'correlation-a', tenantId: 'tenant-a', assetId: 'asset-a', workflowVersion: 2,
    status: 'ACTIVE', reviewStatus: 'ACCEPTED', evidenceHash: 'hash-a', reviewedEvidenceHash: 'hash-a',
    confidence: 'HIGH', lastSeenAt: recent, service: { id: 'service-a', tenantId: 'tenant-a', assetId: 'asset-a', status: 'OPEN', lastSeenAt: recent, port: 22, protocol: 'TCP' },
    vulnerability: { id: 'vuln-a', tenantId: 'tenant-a', cveId: 'CVE-2026-0001', severity: 'HIGH', cvssScore: null }, ...overrides };
}

test('only current accepted evidence contributes; old V1 Finding is irrelevant', () => {
  const result = evaluateContextualPriority({ assetId: 'asset-a', tenantId: 'tenant-a', criticality: 'HIGH', asOf,
    candidates: [candidate(), candidate({ id: 'pending', reviewStatus: 'PENDING' }), candidate({ id: 'rejected', reviewStatus: 'REJECTED' }), candidate({ id: 'changed', evidenceHash: 'new-hash' }), candidate({ id: 'stale', status: 'STALE' }), candidate({ id: 'legacy', workflowVersion: 1 })] });
  expect(result.priority).toBe('HIGH');
  expect(result.score).toBe(70);
  expect(result.contributing).toHaveLength(1);
  expect(result.excluded).toMatchObject({ PENDING: 1, REJECTED: 1, EVIDENCE_CHANGED: 1, STALE: 1, LEGACY_V1: 1 });
  expect(result.missing).toContain('TI_CVSS_UNAVAILABLE');
});

test('no eligible evidence is NOT_ASSESSED and freshness is explicit', () => {
  const old = new Date('2026-08-01T00:00:00.000Z');
  const result = evaluateContextualPriority({ assetId: 'asset-a', tenantId: 'tenant-a', criticality: null, asOf,
    candidates: [candidate({ service: { ...candidate().service, lastSeenAt: old } })] });
  expect(result.priority).toBe('NOT_ASSESSED');
  expect(result.score).toBeNull();
  expect(result.missing).toContain('ASSET_CRITICALITY_UNAVAILABLE');
  expect(result.excluded.STALE_SOURCE).toBe(1);
});

test('multiple CVEs use maximum score with deterministic tie break and no repeated evidence bonus', () => {
  const second = candidate({ id: 'correlation-b', service: { ...candidate().service, id: 'service-b' },
    vulnerability: { id: 'vuln-b', tenantId: 'tenant-a', cveId: 'CVE-2026-0002', severity: 'HIGH', cvssScore: null } });
  const input = { assetId: 'asset-a', tenantId: 'tenant-a', criticality: 'CRITICAL' as const, asOf, candidates: [second, candidate()] };
  const first = evaluateContextualPriority(input);
  const repeated = evaluateContextualPriority({ ...input, candidates: [candidate(), second] });
  expect(first.score).toBe(80);
  expect(first.priority).toBe('HIGH');
  expect(first.contributing.map(item => item.cveId)).toEqual(['CVE-2026-0001', 'CVE-2026-0002']);
  expect(repeated).toEqual(first);
});

test('foreign or invalid service relationship cannot contribute', () => {
  const result = evaluateContextualPriority({ assetId: 'asset-a', tenantId: 'tenant-a', criticality: 'CRITICAL', asOf,
    candidates: [candidate({ tenantId: 'tenant-b' }), candidate({ id: 'bad-service', service: { ...candidate().service, assetId: 'asset-b' } })] });
  expect(result.priority).toBe('NOT_ASSESSED');
  expect(result.excluded.FOREIGN_TENANT).toBe(1);
  expect(result.excluded.INVALID_RELATIONSHIP).toBe(1);
});
