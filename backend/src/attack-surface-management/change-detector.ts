import { AsmChangeType } from '@prisma/client';

export type AssetObservation = { readonly id: string; readonly type: 'SUBDOMAIN' | 'IP_ADDRESS'; readonly value: string };
export type DnsObservation = { readonly source: string; readonly target: string };
export type PortObservation = { readonly assetId: string; readonly protocol: string; readonly port: number; readonly service: string | null; readonly product: string | null; readonly version: string | null };
export type VulnerabilityObservation = { readonly assetId: string; readonly serviceId: string; readonly vulnerabilityId: string; readonly cveId: string };
export type ExposureSnapshot = { readonly assets: readonly AssetObservation[]; readonly dns: readonly DnsObservation[]; readonly ports: readonly PortObservation[]; readonly vulnerabilities: readonly VulnerabilityObservation[] };
export type ExposureChange = { readonly type: AsmChangeType; readonly entityKey: string; readonly previousValue?: string; readonly currentValue?: string };
const keyPort = (item: PortObservation) => `${item.assetId}:${item.protocol}:${item.port}`;
const keyVulnerability = (item: VulnerabilityObservation) => `${item.serviceId}:${item.vulnerabilityId}`;
const encode = (value: unknown) => JSON.stringify(value);

export function detectChanges(previous: ExposureSnapshot | null, current: ExposureSnapshot, complete: boolean): ExposureChange[] {
  const changes: ExposureChange[] = [];
  const oldAssets = new Map(previous?.assets.map(item => [item.id, item]) ?? []);
  const newAssets = new Map(current.assets.map(item => [item.id, item]));
  for (const item of current.assets) if (!oldAssets.has(item.id)) changes.push({ type: item.type === 'IP_ADDRESS' ? AsmChangeType.IP_DISCOVERED : AsmChangeType.ASSET_DISCOVERED, entityKey: item.id, currentValue: item.value });
  if (complete) for (const item of oldAssets.values()) if (!newAssets.has(item.id)) changes.push({ type: item.type === 'IP_ADDRESS' ? AsmChangeType.IP_NOT_OBSERVED : AsmChangeType.ASSET_NOT_OBSERVED, entityKey: item.id, previousValue: item.value });
  const groupDns = (items: readonly DnsObservation[]) => {
    const grouped = new Map<string, string[]>();
    for (const item of items) grouped.set(item.source, [...(grouped.get(item.source) ?? []), item.target]);
    for (const targets of grouped.values()) targets.sort();
    return grouped;
  };
  const oldDns = groupDns(previous?.dns ?? []);
  const newDns = groupDns(current.dns);
  for (const [source, targets] of newDns) {
    const before = oldDns.get(source);
    if (before && encode(before) !== encode(targets)) changes.push({ type: AsmChangeType.DNS_CHANGED, entityKey: source, previousValue: encode(before), currentValue: encode(targets) });
  }
  const oldPorts = new Map(previous?.ports.map(item => [keyPort(item), item]) ?? []);
  const newPorts = new Map(current.ports.map(item => [keyPort(item), item]));
  for (const [key, item] of newPorts) {
    const before = oldPorts.get(key);
    if (!before) {
      changes.push({ type: AsmChangeType.PORT_OPENED, entityKey: key, currentValue: encode(item) });
      if (item.service) changes.push({ type: AsmChangeType.SERVICE_DISCOVERED, entityKey: key, currentValue: item.service });
    } else if (!before.service && item.service) {
      changes.push({ type: AsmChangeType.SERVICE_DISCOVERED, entityKey: key, currentValue: encode({ service: item.service, product: item.product, version: item.version }) });
    } else if (before.service !== item.service || before.product !== item.product || before.version !== item.version) {
      changes.push({ type: AsmChangeType.SERVICE_CHANGED, entityKey: key, previousValue: encode({ service: before.service, product: before.product, version: before.version }), currentValue: encode({ service: item.service, product: item.product, version: item.version }) });
    }
  }
  if (complete) for (const [key, item] of oldPorts) if (!newPorts.has(key)) changes.push({ type: AsmChangeType.PORT_NOT_OBSERVED, entityKey: key, previousValue: encode(item) });
  const oldVulnerabilities = new Map(previous?.vulnerabilities.map(item => [keyVulnerability(item), item]) ?? []);
  const newVulnerabilities = new Map(current.vulnerabilities.map(item => [keyVulnerability(item), item]));
  for (const [key, item] of newVulnerabilities) if (!oldVulnerabilities.has(key)) changes.push({ type: AsmChangeType.VULNERABILITY_CONFIRMED, entityKey: key, currentValue: item.cveId });
  if (complete) for (const [key, item] of oldVulnerabilities) if (!newVulnerabilities.has(key)) changes.push({ type: AsmChangeType.VULNERABILITY_STALE, entityKey: key, previousValue: item.cveId });
  return changes;
}
