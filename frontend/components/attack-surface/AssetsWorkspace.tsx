'use client';

import { AlertTriangle, Plus, Radar, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import { AssetPanel, formatDate } from './AssetPanel';
import { useAttackSurface } from './AttackSurfaceShell';
import { assetCriticalities, assetStatuses, assetTypes, emptyAssetForm, type Asset, type AssetFormValue, type DiscoverySummary } from './types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type ListResponse = { readonly items: readonly Asset[]; readonly total: number; readonly totalPages: number; readonly message?: string };
type ErrorBody = { readonly message?: string | readonly string[] };

export function AssetsWorkspace() {
  const { role, tenantId, ready } = useAttackSurface();
  const [items, setItems] = useState<readonly Asset[]>([]);
  const [page, setPage] = useState(1); const [total, setTotal] = useState(0); const [pages, setPages] = useState(1);
  const [search, setSearch] = useState(''); const [type, setType] = useState(''); const [status, setStatus] = useState(''); const [criticality, setCriticality] = useState('');
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [denied, setDenied] = useState(false); const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<'closed' | 'form' | 'detail'>('closed'); const [selected, setSelected] = useState<Asset | null>(null); const [form, setForm] = useState<AssetFormValue>(emptyAssetForm); const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(''); const [discovery, setDiscovery] = useState<DiscoverySummary | null>(null); const [discoveryError, setDiscoveryError] = useState(''); const [lastDiscoveryAsset, setLastDiscoveryAsset] = useState<Asset | null>(null);
  const canManage = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const tenantQuery = role === 'SUPER_ADMIN' ? `tenantId=${encodeURIComponent(tenantId)}` : '';

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true); setError(''); setDenied(false);
    const params = new URLSearchParams({ page: String(page), limit: '10', sortBy: 'updatedAt', sortOrder: 'desc' });
    if (tenantQuery) params.set('tenantId', tenantId); if (search.trim()) params.set('search', search.trim()); if (type) params.set('type', type); if (status) params.set('status', status); if (criticality) params.set('criticality', criticality);
    try {
      const response = await fetch(`${API}/attack-surface/assets?${params}`, { credentials: 'include', cache: 'no-store' });
      if (response.status === 403) { setDenied(true); setItems([]); return; }
      const body: ListResponse = await response.json(); if (!response.ok) throw new Error(messageOf(body, 'Failed to load assets.'));
      setItems(body.items); setTotal(body.total); setPages(Math.max(body.totalPages, 1));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to load assets.'); setItems([]); }
    finally { setLoading(false); }
  }, [criticality, page, ready, search, status, tenantId, tenantQuery, type]);
  useEffect(() => { void load(); }, [load]);

  function openCreate(): void { setSelected(null); setForm(emptyAssetForm); setPanel('form'); setError(''); }
  function openEdit(asset: Asset): void { setSelected(asset); setForm(toForm(asset)); setPanel('form'); setError(''); }
  function setField(key: keyof AssetFormValue, value: string): void { setForm(current => ({ ...current, [key]: value })); }
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const suffix = tenantQuery ? `?${tenantQuery}` : '';
      const response = await fetch(`${API}/attack-surface/assets${selected ? `/${selected.id}` : ''}${suffix}`, { method: selected ? 'PATCH' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formPayload(form)) });
      const body: ErrorBody = await response.json(); if (!response.ok) throw new Error(messageOf(body, 'Failed to save asset.'));
      setPanel('closed'); setNotice(selected ? 'Asset updated successfully.' : 'Asset created successfully.'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to save asset.'); } finally { setSaving(false); }
  }
  async function remove(asset: Asset): Promise<void> {
    if (!window.confirm(`Delete asset ${asset.name}?`)) return;
    const response = await fetch(`${API}/attack-surface/assets/${asset.id}${tenantQuery ? `?${tenantQuery}` : ''}`, { method: 'DELETE', credentials: 'include' });
    const body: ErrorBody = await response.json(); if (!response.ok) { setError(messageOf(body, 'Failed to delete asset.')); return; }
    setNotice('Asset deleted successfully.'); await load();
  }
  async function discover(asset: Asset): Promise<void> {
    setDiscovering(asset.id); setLastDiscoveryAsset(asset); setDiscovery(null); setDiscoveryError('');
    try {
      const response = await fetch(`${API}/attack-surface/assets/${asset.id}/discover${tenantQuery ? `?${tenantQuery}` : ''}`, { method: 'POST', credentials: 'include' });
      const body: DiscoverySummary & ErrorBody = await response.json(); if (!response.ok) throw new Error(messageOf(body, 'Subdomain discovery failed.'));
      setDiscovery(body); setNotice(`Discovery completed for ${body.rootDomain}.`); await load();
    } catch (cause) { setDiscoveryError(cause instanceof Error ? cause.message : 'Subdomain discovery failed.'); } finally { setDiscovering(''); }
  }

  return <main className="content"><div className="asm-heading"><div><span className="source-eyebrow">EXTERNAL EXPOSURE</span><h1>Attack Surface Assets</h1><p>Inventory internet-facing assets and discover subdomains from registered domains.</p></div>{canManage && <Button size="l" onClick={openCreate}><Plus size={16} />Create asset</Button>}</div>
    {notice && <div className="success" role="status">{notice}</div>}{error && <div className="error" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></div>}
    {discoveryError && <div className="error" role="alert">{discoveryError} {lastDiscoveryAsset && <button type="button" onClick={() => void discover(lastDiscoveryAsset)}>Retry discovery</button>}</div>}
    {discovery && <DiscoveryResult summary={discovery} />}
    <Card view="outlined" className="asm-card"><div className="asm-filters"><label><Search size={15} /><input aria-label="Search assets" placeholder="Search name or value" value={search} onChange={event => { setPage(1); setSearch(event.target.value); }} /></label><select aria-label="Filter type" value={type} onChange={event => { setPage(1); setType(event.target.value); }}><option value="">All types</option>{assetTypes.map(value => <option key={value}>{value}</option>)}</select><select aria-label="Filter status" value={status} onChange={event => { setPage(1); setStatus(event.target.value); }}><option value="">All status</option>{assetStatuses.map(value => <option key={value}>{value}</option>)}</select><select aria-label="Filter criticality" value={criticality} onChange={event => { setPage(1); setCriticality(event.target.value); }}><option value="">All criticality</option>{assetCriticalities.map(value => <option key={value}>{value}</option>)}</select></div>
      {loading ? <div className="asm-state" aria-live="polite"><RefreshCw className="spin" size={18} />Loading assets...</div> : denied ? <div className="asm-state asm-denied" role="alert"><AlertTriangle size={22} /><strong>Module access required</strong><span>Your account cannot access Attack Surface Management.</span><Link href="/dashboard">Back to Dashboard</Link></div> : error ? null : items.length === 0 ? <div className="asm-state"><Radar size={24} /><strong>No assets found</strong><span>Adjust the filters or create your first asset.</span></div> : <AssetTable items={items} canManage={canManage} discovering={discovering} onDetail={asset => { setSelected(asset); setPanel('detail'); }} onEdit={openEdit} onDelete={remove} onDiscover={discover} />}
      <div className="asm-pagination"><span>{total} assets · Page {page} of {pages}</span><div><Button view="outlined" size="s" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</Button><Button view="outlined" size="s" disabled={page >= pages || loading} onClick={() => setPage(value => value + 1)}>Next</Button></div></div>
    </Card>{panel !== 'closed' && <AssetPanel asset={selected} form={form} mode={panel} saving={saving} onChange={setField} onClose={() => setPanel('closed')} onSubmit={submit} />}
  </main>;
}

function AssetTable({ items, canManage, discovering, onDetail, onEdit, onDelete, onDiscover }: { readonly items: readonly Asset[]; readonly canManage: boolean; readonly discovering: string; readonly onDetail: (asset: Asset) => void; readonly onEdit: (asset: Asset) => void; readonly onDelete: (asset: Asset) => Promise<void>; readonly onDiscover: (asset: Asset) => Promise<void> }) {
  return <Table data={items} columns={[{ id: 'name', name: 'Asset', template: asset => <button className="source-name" onClick={() => onDetail(asset)}>{asset.name}</button> }, { id: 'type', name: 'Type', template: asset => <span className="asm-type">{asset.type}</span> }, { id: 'value', name: 'Value', template: asset => <code>{asset.value}</code> }, { id: 'status', name: 'Status', template: asset => <span className={`cti-status is-${asset.status.toLowerCase()}`}>{asset.status}</span> }, { id: 'criticality', name: 'Criticality', template: asset => <span className={`ioc-severity severity-${asset.criticality.toLowerCase()}`}>{asset.criticality}</span> }, { id: 'owner', name: 'Owner', template: asset => asset.owner || '-' }, { id: 'updated', name: 'Updated', template: asset => formatDate(asset.updatedAt) }, { id: 'actions', name: 'Actions', template: asset => <div className="ioc-actions"><Button view="flat" size="s" onClick={() => onDetail(asset)}>Detail</Button>{asset.type === 'DOMAIN' && <Button view="outlined" size="s" disabled={discovering === asset.id} onClick={() => void onDiscover(asset)}>{discovering === asset.id ? 'Discovering...' : 'Discover Subdomains'}</Button>}{canManage && <><Button view="flat" size="s" onClick={() => onEdit(asset)}>Edit</Button><Button view="flat-danger" size="s" onClick={() => void onDelete(asset)}>Delete</Button></>}</div> }]}/>;
}

function DiscoveryResult({ summary }: { readonly summary: DiscoverySummary }) {
  const metrics = [['Discovered', summary.discovered], ['Created', summary.created], ['Updated', summary.updated], ['Skipped', summary.skipped], ['Failed', summary.failed]] as const;
  return <section className="asm-discovery" aria-label="Discovery results"><header><div><span className="source-eyebrow">DISCOVERY RESULT</span><h2>{summary.rootDomain}</h2></div><span>{summary.providers.length ? summary.providers.join(' · ') : 'No provider completed'}</span></header><dl>{metrics.map(([label, value]) => <div key={label} className={label === 'Failed' && value > 0 ? 'is-danger' : ''}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{summary.errors.length > 0 && <div className="asm-discovery-errors" role="alert">{summary.errors.map(value => <span key={value}>{value}</span>)}</div>}</section>;
}

function messageOf(body: ErrorBody, fallback: string): string { return typeof body.message === 'string' ? body.message : body.message?.join(', ') || fallback; }
function formPayload(form: AssetFormValue): Record<string, string | undefined> { return { ...form, description: form.description || undefined, owner: form.owner || undefined, firstSeenAt: form.firstSeenAt || undefined, lastSeenAt: form.lastSeenAt || undefined }; }
function toForm(asset: Asset): AssetFormValue { return { name: asset.name, type: asset.type, value: asset.value, status: asset.status, criticality: asset.criticality, description: asset.description ?? '', owner: asset.owner ?? '', firstSeenAt: asset.firstSeenAt?.slice(0, 16) ?? '', lastSeenAt: asset.lastSeenAt?.slice(0, 16) ?? '' }; }
