'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { assetCriticalities, assetStatuses, assetTypes, type Asset, type AssetFormValue, type DiscoverySummary } from './types';
import { PortServices } from './PortServices';
import { ThreatIntelligence } from './ThreatIntelligence';
import { DiscoveryRelationships } from './DiscoveryRelationships';

type Props = {
  readonly asset: Asset | null;
  readonly form: AssetFormValue;
  readonly mode: 'form' | 'detail';
  readonly saving: boolean;
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
};

export function AssetPanel({ asset, form, mode, saving, onChange, onClose, onSubmit, tenantQuery, canManage, discovery, discoveryError, discoveryRun, discovering, onDiscoverAsset }: Props) {
  const detail = mode === 'detail' && asset;
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => opener?.focus();
  }, []);
  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])');
    if (!focusable?.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div className="asm-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className={`asm-dialog${detail ? ' asm-intelligence-dialog' : ''}`} role="dialog" aria-modal="true" aria-labelledby="asset-panel-title" onKeyDown={handleKeyDown}>
      <header><div><span className="source-eyebrow">{detail ? 'ASSET INTELLIGENCE' : 'ASSET REGISTRY'}</span><h2 id="asset-panel-title">{detail ? asset.name : asset ? 'Edit Asset' : 'Create Asset'}</h2>{detail && <p className="asm-asset-identity">{asset.value}</p>}</div><Button view="flat" size="s" aria-label="Close asset panel" onClick={onClose}><X size={16} /></Button></header>
      {detail ? <><AssetDetails asset={asset} /><section className="asm-intelligence-section" aria-label="Asset discovery"><div className="asm-section-heading"><span className="source-eyebrow">02 / DISCOVERY</span><h3>Discovery</h3></div>{(asset.type === 'DOMAIN' || asset.type === 'SUBDOMAIN') && canManage && <Button view="outlined" size="s" disabled={discovering} onClick={() => void onDiscoverAsset(asset)}>{discovering ? 'Discovering...' : asset.type === 'DOMAIN' ? 'Discover subdomains' : 'Discover DNS/IP'}</Button>}{discovering && <p role="status">Discovery is running for {asset.value}...</p>}{discoveryError && <p className="error" role="alert">{discoveryError}</p>}{discovery ? <><p className="asm-discovery-context">Latest discovery result in this session for {discovery.rootDomain} · {discovery.providers.length ? discovery.providers.join(' · ') : 'No provider completed'}</p><dl className="asm-service-metrics"><div><dt>Discovered</dt><dd>{discovery.discovered}</dd></div><div><dt>Created</dt><dd>{discovery.created}</dd></div><div><dt>Updated</dt><dd>{discovery.updated}</dd></div></dl></> : <p className="asm-discovery-context">No discovery result is available in this session. Recorded relationships appear below.</p>}</section><DiscoveryRelationships asset={asset} tenantQuery={tenantQuery} discoveryRun={discoveryRun} />{asset.type === 'IP_ADDRESS' && <PortServices asset={asset} tenantQuery={tenantQuery} canDiscover={canManage} />}<ThreatIntelligence asset={asset} tenantQuery={tenantQuery} /></> : <form className="asm-form" onSubmit={onSubmit}>
        <label>Name<input required maxLength={255} value={form.name} onChange={event => onChange('name', event.target.value)} /></label>
        <label>Type<select value={form.type} onChange={event => onChange('type', event.target.value)}>{assetTypes.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="asm-form-wide">Value<input required maxLength={1024} value={form.value} onChange={event => onChange('value', event.target.value)} /></label>
        <label>Status<select value={form.status} onChange={event => onChange('status', event.target.value)}>{assetStatuses.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Criticality<select value={form.criticality} onChange={event => onChange('criticality', event.target.value)}>{assetCriticalities.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Owner<input maxLength={255} value={form.owner} onChange={event => onChange('owner', event.target.value)} /></label>
        <label>First seen<input type="datetime-local" value={form.firstSeenAt} onChange={event => onChange('firstSeenAt', event.target.value)} /></label>
        <label>Last seen<input type="datetime-local" value={form.lastSeenAt} onChange={event => onChange('lastSeenAt', event.target.value)} /></label>
        <label className="asm-form-wide">Description<textarea rows={4} maxLength={2000} value={form.description} onChange={event => onChange('description', event.target.value)} /></label>
        <footer><Button type="button" view="outlined" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving...' : asset ? 'Save changes' : 'Create asset'}</Button></footer>
      </form>}
    </section>
  </div>;
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
