import { correlationEvidence } from './correlation-evidence';

const service = {
  id: 'service-1', protocol: 'TCP' as const, port: 22, service: 'ssh', product: 'OpenSSH',
  version: '8.4', source: 'PROBE', firstSeenAt: new Date('2026-01-01T00:00:00Z'), lastSeenAt: new Date('2026-01-02T00:00:00Z'),
};
const vulnerability = {
  id: 'vuln-1', cveId: 'CVE-2026-1234', affectedProduct: 'OpenSSH', affectedVersionExact: null,
  affectedVersionStart: '8.0', affectedVersionEnd: '8.9', severity: 'HIGH' as const, source: 'TI',
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};
const match = { confidence: 'HIGH' as const, reason: 'Product and numeric version within inclusive affected range' };

describe('ASM V2 canonical evidence', () => {
  it('ignores volatile timestamps and harmless case/outer whitespace', () => {
    const first = correlationEvidence(service, vulnerability, match);
    const second = correlationEvidence(
      { ...service, product: ' openssh ', lastSeenAt: new Date('2026-02-02T00:00:00Z') },
      { ...vulnerability, updatedAt: new Date('2026-02-03T00:00:00Z') }, match,
    );
    expect(second.evidenceHash).toBe(first.evidenceHash);
  });

  it('changes hash for a material version, source or affected range change', () => {
    const original = correlationEvidence(service, vulnerability, match).evidenceHash;
    expect(correlationEvidence({ ...service, version: '8.5' }, vulnerability, match).evidenceHash).not.toBe(original);
    expect(correlationEvidence({ ...service, source: 'MANUAL' }, vulnerability, match).evidenceHash).not.toBe(original);
    expect(correlationEvidence(service, { ...vulnerability, affectedVersionEnd: '8.5' }, match).evidenceHash).not.toBe(original);
  });
});
