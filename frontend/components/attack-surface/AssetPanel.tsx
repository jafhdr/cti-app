'use client';

import { type FormEvent, type Ref, useState } from 'react';
import { FormModal } from '@/components/ui/modal-patterns';
import { Button } from '@/components/ui/button';
import { assetCriticalities, assetStatuses, assetTypes, type Asset, type AssetFormValue, type DiscoverySummary } from './types';
import { PortServices } from './PortServices';
import { ThreatIntelligence } from './ThreatIntelligence';
import { DiscoveryRelationships } from './DiscoveryRelationships';
import { Findings } from './Findings';
import { RiskPosture } from './RiskPosture';
import { Vulnerabilities } from './Vulnerabilities';
import { DiscoverySchedule } from './DiscoverySchedule';
import { Alerts } from './Alerts';

type Props = {
  readonly asset: Asset | null;
  readonly form: AssetFormValue;
  readonly mode: 'form' | 'detail';
  readonly saving: boolean;
  readonly error: string;
  readonly onChange: (key: keyof AssetFormValue, value: string) => void;
  readonly onClose: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly tenantQuery: string;
  readonly canManage: boolean;
  readonly discovery: DiscoverySummary | null;
  readonly discoveryError: string;
  readonly discoveryRun: number;
  readonly discovering: boolean;
  readonly onDiscoverAsset: (asset: Asset) => Promise<void>;
  readonly workspaceRef?: Ref<HTMLElement>;
};

export function AssetPanel({ asset, form, mode, saving, error, onChange, onClose, onSubmit, tenantQuery, canManage, discovery, discoveryError, discoveryRun, discovering, onDiscoverAsset, workspaceRef }: Props) {
  const [findingsRefresh, setFindingsRefresh] = useState(0);
  if (mode === 'detail' && asset) return <section ref={workspaceRef} className="asm-intelligence-dialog asm-intelligence-workspace" role="region" aria-label={`Asset Intelligence Workspace: ${asset.name}`} tabIndex={-1}>
    <header><div><span className="source-eyebrow">ASSET INTELLIGENCE</span><h2 id="asset-workspace-title">{asset.name}</h2><p className="asm-asset-identity">{asset.value}</p></div><Button type="button" view="outlined" onClick={onClose}>Back to assets</Button></header>
      <div><AssetDetails asset={asset} /><section className="asm-intelligence-section" aria-label="Asset discovery"><div className="asm-section-heading"><span className="source-eyebrow">02 / DISCOVERY</span><h3>Discovery</h3></div>{(asset.type === 'DOMAIN' || asset.type === 'SUBDOMAIN') && canManage && <Button view="outlined" size="s" disabled={discovering} onClick={() => void onDiscoverAsset(asset)}>{discovering ? 'Discovering...' : asset.type === 'DOMAIN' ? 'Discover subdomains' : 'Discover DNS/IP'}</Button>}{discovering && <p role="status">Discovery is running for {asset.value}...</p>}{discoveryError && <p className="error" role="alert">{discoveryError}</p>}{discovery ? <><p className="asm-discovery-context">Latest discovery result in this session for {discovery.rootDomain} · {discovery.providers.length ? discovery.providers.join(' · ') : 'No provider completed'}</p><dl className="asm-service-metrics"><div><dt>Discovered</dt><dd>{discovery.discovered}</dd></div><div><dt>Created</dt><dd>{discovery.created}</dd></div><div><dt>Updated</dt><dd>{discovery.updated}</dd></div></dl></> : <p className="asm-discovery-context">No discovery result is available in this session. Recorded relationships appear below.</p>}</section><DiscoveryRelationships asset={asset} tenantQuery={tenantQuery} discoveryRun={discoveryRun} />{asset.type === 'IP_ADDRESS' && <PortServices asset={asset} tenantQuery={tenantQuery} canDiscover={canManage} onDiscoveryComplete={() => setFindingsRefresh(value => value + 1)} />}<div id="asm-vulnerabilities"><Vulnerabilities asset={asset} tenantQuery={tenantQuery} canManage={canManage} refresh={findingsRefresh + discoveryRun} /></div><div id="asm-findings"><Findings asset={asset} tenantQuery={tenantQuery} refresh={findingsRefresh + discoveryRun} /></div><div id="asm-risk-posture"><RiskPosture asset={asset} tenantQuery={tenantQuery} refresh={findingsRefresh + discoveryRun} /></div><Alerts asset={asset} tenantQuery={tenantQuery} refresh={findingsRefresh + discoveryRun} />{(asset.type === 'DOMAIN' || asset.type === 'SUBDOMAIN' || asset.type === 'IP_ADDRESS') && <div id="asm-discovery"><DiscoverySchedule asset={asset} tenantQuery={tenantQuery} canManage={canManage} refresh={findingsRefresh + discoveryRun} onRunComplete={() => setFindingsRefresh(value => value + 1)} /></div>}<ThreatIntelligence asset={asset} tenantQuery={tenantQuery} /></div>
  </section>;
  return <FormModal open onOpenChange={open => { if (!open) onClose(); }} title={asset ? 'Edit Asset' : 'Create Asset'} onSubmit={onSubmit} loading={saving} error={error} submitLabel={asset ? 'Save changes' : 'Create asset'}>
    <div className="cti-asm-form">        <label>Name<input required maxLength={255} value={form.name} onChange={event => onChange('name', event.target.value)} /></label>
        <label>Type<select value={form.type} onChange={event => onChange('type', event.target.value)}>{assetTypes.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="asm-form-wide">Value<input required maxLength={1024} value={form.value} onChange={event => onChange('value', event.target.value)} /></label>
        <label>Status<select value={form.status} onChange={event => onChange('status', event.target.value)}>{assetStatuses.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Criticality<select value={form.criticality} onChange={event => onChange('criticality', event.target.value)}>{assetCriticalities.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Owner<input maxLength={255} value={form.owner} onChange={event => onChange('owner', event.target.value)} /></label>
        <label>First seen<input type="datetime-local" value={form.firstSeenAt} onChange={event => onChange('firstSeenAt', event.target.value)} /></label>
        <label>Last seen<input type="datetime-local" value={form.lastSeenAt} onChange={event => onChange('lastSeenAt', event.target.value)} /></label>
        <label className="asm-form-wide">Description<textarea rows={4} maxLength={2000} value={form.description} onChange={event => onChange('description', event.target.value)} /></label>
</div>
  </FormModal>;
}

function AssetDetails({ asset }: { readonly asset: Asset }) {
  return <section className="asm-intelligence-section" aria-labelledby="asset-overview-title"><div className="asm-section-heading"><span className="source-eyebrow">01 / IDENTITY</span><h3 id="asset-overview-title">Asset overview</h3></div><dl className="asm-detail">
    <div><dt>Type</dt><dd>{asset.type.replaceAll('_', ' ')}</dd></div><div><dt>Status</dt><dd><span className={`cti-status is-${asset.status.toLowerCase()}`}>{asset.status}</span></dd></div>
    <div><dt>Criticality</dt><dd><span className={`ioc-severity severity-${asset.criticality.toLowerCase()}`}>{asset.criticality}</span></dd></div><div><dt>Owner</dt><dd>{asset.owner || 'Not assigned'}</dd></div>
    <div className="asm-detail-wide"><dt>Description</dt><dd>{asset.description || 'No description recorded.'}</dd></div>
    <div><dt>First seen</dt><dd>{formatDate(asset.firstSeenAt)}</dd></div><div><dt>Last seen</dt><dd>{formatDate(asset.lastSeenAt)}</dd></div>
    <div><dt>Created</dt><dd>{formatDate(asset.createdAt)}</dd></div><div><dt>Updated</dt><dd>{formatDate(asset.updatedAt)}</dd></div>
  </dl></section>;
}

export function formatDate(value: string | null): string {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('id-ID');
}
