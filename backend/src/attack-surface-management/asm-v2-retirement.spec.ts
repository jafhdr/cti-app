import { PrismaService } from '../prisma.service';
import { AsmV2EvidenceService } from './asm-v2-evidence.service';

const startedAt = new Date('2026-11-02T00:00:00Z');
const completedAt = new Date('2026-11-02T00:01:00Z');

describe('ASM V2 verified retirement', () => {
  const priorFlag = process.env.ASM_V2_EVIDENCE_ENABLED;
  beforeEach(() => { process.env.ASM_V2_EVIDENCE_ENABLED = 'true'; });
  afterAll(() => { process.env.ASM_V2_EVIDENCE_ENABLED = priorFlag; });

  function setup() {
    const current = {
      id: 'correlation', tenantId: 'tenant', assetId: 'asset', serviceId: 'service', vulnerabilityId: 'vulnerability',
      workflowVersion: 2, revision: 3, status: 'ACTIVE', evidenceHash: 'old',
      service: { id: 'service', tenantId: 'tenant', assetId: 'asset', status: 'OPEN', protocol: 'TCP', port: 22,
        product: 'OpenSSH', version: '9.9', source: 'SSH_BANNER' },
      vulnerability: { id: 'vulnerability', tenantId: 'tenant', affectedProduct: 'OpenSSH',
        affectedVersionExact: '8.4', affectedVersionStart: null, affectedVersionEnd: null },
    };
    const tx = {
      assetVulnerabilityCorrelation: { findFirst: jest.fn().mockResolvedValueOnce({ serviceId: 'service', vulnerabilityId: 'vulnerability' }).mockResolvedValue(current), update: jest.fn() },
      $queryRaw: jest.fn(),
      asmDiscoveryRun: { findFirst: jest.fn().mockResolvedValue({ assetId: 'asset', startedAt, completedAt }) },
      assetRelationship: { findFirst: jest.fn().mockResolvedValue(null) },
      asmServiceFingerprintObservation: { findFirst: jest.fn().mockResolvedValue({ id: 'fingerprint', product: 'OpenSSH', version: '9.9', source: 'SSH_BANNER', bannerHash: 'digest', observedAt: startedAt }) },
      asmCorrelationObservation: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      assetFinding: { updateMany: jest.fn() },
    };
    const prisma = new PrismaService();
    Reflect.set(prisma, '$transaction', async (callback: (transaction: typeof tx) => Promise<boolean>) => callback(tx));
    return { service: new AsmV2EvidenceService(prisma), tx, prisma };
  }

  it('retires after a completed run with a fresh scoped fingerprint', async () => {
    const { service, tx } = setup();
    expect(await service.markNotObserved('tenant', 'asset', 'correlation', 'run')).toBe(true);
    expect(tx.asmDiscoveryRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'COMPLETED', failed: 0 }) }));
    expect(tx.asmServiceFingerprintObservation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ discoveryRunId: 'run', tenantId: 'tenant', assetId: 'asset', serviceId: 'service' }) }));
    expect(tx.assetVulnerabilityCorrelation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'STALE', revision: { increment: 1 } } }));
    expect(tx.asmCorrelationObservation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'NOT_OBSERVED', discoveryRunId: 'run' }) }));
    expect(tx.assetFinding.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ source: 'VULNERABILITY_CORRELATION', status: 'OPEN' }) }));
  });

  it('keeps the correlation when the run has no verified fingerprint', async () => {
    const { service, tx } = setup();
    tx.asmServiceFingerprintObservation.findFirst.mockResolvedValue(null);
    expect(await service.markNotObserved('tenant', 'asset', 'correlation', 'run')).toBe(false);
    expect(tx.assetVulnerabilityCorrelation.update).not.toHaveBeenCalled();
  });

  it('keeps the correlation when the run did not complete successfully', async () => {
    const { service, tx } = setup();
    tx.asmDiscoveryRun.findFirst.mockResolvedValue(null);
    expect(await service.markNotObserved('tenant', 'asset', 'correlation', 'run')).toBe(false);
    expect(tx.asmServiceFingerprintObservation.findFirst).not.toHaveBeenCalled();
    expect(tx.assetVulnerabilityCorrelation.update).not.toHaveBeenCalled();
  });

  it('keeps the correlation when the observed version differs from current service state', async () => {
    const { service, tx } = setup();
    tx.asmServiceFingerprintObservation.findFirst.mockResolvedValue({ id: 'fingerprint', product: 'OpenSSH',
      version: '9.8', source: 'SSH_BANNER', bannerHash: 'digest', observedAt: startedAt });
    expect(await service.markNotObserved('tenant', 'asset', 'correlation', 'run')).toBe(false);
    expect(tx.assetVulnerabilityCorrelation.update).not.toHaveBeenCalled();
  });

  it('uses the caller transaction when retiring a correlation', async () => {
    const { service, tx, prisma } = setup();
    const transaction = jest.spyOn(prisma, '$transaction');
    expect(await service.markNotObserved('tenant', 'asset', 'correlation', 'run', tx as never)).toBe(true);
    expect(transaction).not.toHaveBeenCalled();
    expect(tx.assetVulnerabilityCorrelation.update).toHaveBeenCalledTimes(1);
  });

  it('uses the caller transaction when checking matched evidence', async () => {
    const { service, tx, prisma } = setup();
    const transaction = jest.spyOn(prisma, '$transaction');
    Object.assign(tx, {
      assetPortService: { findFirst: jest.fn().mockResolvedValue({ id: 'service' }) },
      vulnerability: { findFirst: jest.fn().mockResolvedValue({ id: 'vulnerability' }) },
    });
    Object.assign(tx.assetVulnerabilityCorrelation, { findUnique: jest.fn().mockResolvedValue(null) });
    tx.asmDiscoveryRun.findFirst.mockResolvedValue(null);
    const observedService = { id: 'service', protocol: 'TCP', port: 22, service: 'ssh', product: 'OpenSSH',
      version: '9.9', source: 'SSH_BANNER', firstSeenAt: startedAt, lastSeenAt: startedAt };
    const vulnerability = { id: 'vulnerability', cveId: 'CVE-TEST', affectedProduct: 'OpenSSH',
      affectedVersionExact: '9.9', affectedVersionStart: null, affectedVersionEnd: null,
      severity: 'HIGH', source: 'TEST', updatedAt: startedAt };

    await service.observe('tenant', 'asset', observedService as never, vulnerability as never,
      { confidence: 'HIGH', reason: 'Exact product and version match' }, 'run', tx as never);

    expect(transaction).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.asmDiscoveryRun.findFirst).toHaveBeenCalledTimes(1);
  });
});
