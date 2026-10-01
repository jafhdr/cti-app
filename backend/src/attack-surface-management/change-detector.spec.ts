import { AsmChangeType } from '@prisma/client';
import { detectChanges, type ExposureSnapshot } from './change-detector';
const empty: ExposureSnapshot = { assets: [], dns: [], ports: [], vulnerabilities: [] };
const port443 = { assetId: 'ip-a', protocol: 'TCP', port: 443, service: 'https', product: null, version: null };
const port22 = { assetId: 'ip-a', protocol: 'TCP', port: 22, service: 'ssh', product: 'OpenSSH', version: '8.4' };
const first: ExposureSnapshot = { assets: [{ id: 'ip-a', type: 'IP_ADDRESS', value: '192.0.2.1' }], dns: [{ source: 'example.test', target: '192.0.2.1' }], ports: [port443], vulnerabilities: [] };
describe('ASM change detector', () => {
  it('only reports the new port after the second complete run', () => {
    expect(detectChanges(first, { ...first, ports: [port443, port22] }, true).map(item => item.type)).toEqual([AsmChangeType.PORT_OPENED, AsmChangeType.SERVICE_DISCOVERED]);
  });
  it('retains missing port history without negative events on a partial run', () => {
    const prior = { ...first, ports: [port443, port22] };
    expect(detectChanges(prior, first, true)).toEqual(expect.arrayContaining([expect.objectContaining({ type: AsmChangeType.PORT_NOT_OBSERVED })]));
    expect(detectChanges(prior, first, false)).toEqual([]);
  });
  it('reports a service first identified on an already open port', () => {
    const unnamed = { ...port443, service: null };
    expect(detectChanges({ ...first, ports: [unnamed] }, first, true)).toEqual([expect.objectContaining({ type: AsmChangeType.SERVICE_DISCOVERED })]);
  });
  it('records DNS and version changes with prior and current values', () => {
    const changes = detectChanges({ ...first, ports: [port22] }, { ...first, dns: [{ source: 'example.test', target: '192.0.2.2' }], ports: [{ ...port22, version: '8.5' }] }, true);
    expect(changes).toEqual(expect.arrayContaining([expect.objectContaining({ type: AsmChangeType.DNS_CHANGED }), expect.objectContaining({ type: AsmChangeType.SERVICE_CHANGED })]));
  });
  it('reports confirmation and stale vulnerability states', () => {
    const hit = { assetId: 'ip-a', serviceId: 's1', vulnerabilityId: 'v1', cveId: 'CVE-2026-99999' };
    expect(detectChanges(empty, { ...empty, vulnerabilities: [hit] }, true)[0].type).toBe(AsmChangeType.VULNERABILITY_CONFIRMED);
    expect(detectChanges({ ...empty, vulnerabilities: [hit] }, empty, true)[0].type).toBe(AsmChangeType.VULNERABILITY_STALE);
  });
});
