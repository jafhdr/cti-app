'use client';

import { AlertTriangle, Plus, Radar, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import { ConfirmationModal } from '@/components/ui/modal-patterns';
import { AssetPanel, formatDate } from './AssetPanel';
import { useAttackSurface } from './AttackSurfaceShell';
import { assetCriticalities, assetStatuses, assetTypes, emptyAssetForm, type Asset, type AssetFormValue, type DiscoverySummary } from './types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type ListResponse = { readonly items: readonly Asset[]; readonly total: number; readonly totalPages: number; readonly message?: string };
type ErrorBody = { readonly message?: string | readonly string[] };

export function AssetsWorkspace() {
  const latestLoad = useRef(0);
  const detailWorkspaceRef = useRef<HTMLElement>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const { role, tenantId, ready } = useAttackSurface();
  const [items, setItems] = useState<readonly Asset[]>([]);
  const [page, setPage] = useState(1); const [total, setTotal] = useState(0); const [pages, setPages] = useState(1);
  const [search, setSearch] = useState(''); const [type, setType] = useState(''); const [status, setStatus] = useState(''); const [criticality, setCriticality] = useState('');
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [denied, setDenied] = useState(false); const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<'closed' | 'form' | 'detail'>('closed'); const [selected, setSelected] = useState<Asset | null>(null); const [form, setForm] = useState<AssetFormValue>(emptyAssetForm); const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(''); const [discovery, setDiscovery] = useState<DiscoverySummary | null>(null); const [discoveryError, setDiscoveryError] = useState(''); const [lastDiscoveryAsset, setLastDiscoveryAsset] = useState<Asset | null>(null);
  const [discoveryRun, setDiscoveryRun] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const canManage = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const tenantQuery = role === 'SUPER_ADMIN' ? `tenantId=${encodeURIComponent(tenantId)}` : '';

  const load = useCallback(async () => {
    if (!ready) return;
    const requestId = ++latestLoad.current;
    setLoading(true); setError(''); setDenied(false);
    const params = new URLSearchParams({ page: String(page), limit: '10', sortBy: 'updatedAt', sortOrder: 'desc' });
    if (tenantQuery) params.set('tenantId', tenantId); if (search.trim()) params.set('search', search.trim()); if (type) params.set('type', type); if (status) params.set('status', status); if (criticality) params.set('criticality', criticality);
    try {
      const response = await fetch(`${API}/attack-surface/assets?${params}`, { credentials: 'include', cache: 'no-store' });
      if (requestId !== latestLoad.current) return;
      if (response.status === 403) { setDenied(true); setItems([]); return; }
      const body: ListResponse = await response.json(); if (!response.ok) throw new Error(messageOf(body, 'Failed to load assets.'));
      if (requestId !== latestLoad.current) return;
      setItems(body.items); setTotal(body.total); setPages(Math.max(body.totalPages, 1));
    } catch (cause) { if (requestId === latestLoad.current) { setError(cause instanceof Error ? cause.message : 'Failed to load assets.'); setItems([]); } }
    finally { if (requestId === latestLoad.current) setLoading(false); }
  }, [criticality, page, ready, search, status, tenantId, tenantQuery, type]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (panel !== 'detail') return;
    const frame = requestAnimationFrame(() => { detailWorkspaceRef.current?.scrollIntoView({ block: 'start' }); detailWorkspaceRef.current?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
  }, [panel, selected]);

  function openDetail(asset: Asset): void { detailTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSelected(asset); setPanel('detail'); }
  function closePanel(): void { setPanel('closed'); if (panel === 'detail' && detailTriggerRef.current?.isConnected) detailTriggerRef.current.focus(); }
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
    setDeleting(true); setDeleteError('');
    try {
      const response = await fetch(`${API}/attack-surface/assets/${asset.id}${tenantQuery ? `?${tenantQuery}` : ''}`, { method: 'DELETE', credentials: 'include' });
      const body: ErrorBody = await response.json(); if (!response.ok) throw new Error(messageOf(body, 'Failed to delete asset.'));
      setDeleteTarget(null); setNotice('Asset deleted successfully.'); await load();
    } catch (cause) { setDeleteError(cause instanceof Error ? cause.message : 'Failed to delete asset.'); }
    finally { setDeleting(false); }
  }
  async function discover(asset: Asset): Promise<void> {
    setDiscovering(asset.id); setLastDiscoveryAsset(asset); setDiscovery(null); setDiscoveryError('');
    try {
      const response = await fetch(`${API}/attack-surface/assets/${asset.id}/discover${tenantQuery ? `?${tenantQuery}` : ''}`, { method: 'POST', credentials: 'include' });
      const body: DiscoverySummary & ErrorBody = await response.json(); if (!response.ok) throw new Error(messageOf(body, 'Subdomain discovery failed.'));
      setDiscovery(body); setDiscoveryRun(run => run + 1); setNotice(`Discovery completed for ${body.rootDomain}.`); await load();
    } catch (cause) { setDiscoveryError(cause instanceof Error ? cause.message : 'Subdomain discovery failed.'); } finally { setDiscovering(''); }
  }

  const visibleCount = (assetType: string) => items.filter(asset => asset.type === assetType).length;
  return <main className="content editorial-module"><div className="asm-heading editorial-heading"><div><span className="source-eyebrow">ATTACK SURFACE MANAGEMENT</span><h1>Know what is exposed.</h1><p>Discover assets, services and relationships across your attack surface.</p></div>{canManage && <Button size="l" onClick={openCreate}><Plus size={16} />Create asset</Button>}</div>
    <section className="editorial-metrics" aria-label="Asset summary"><div><span>Total assets</span><strong>{loading ? '—' : total}</strong></div><div><span>Domains on this page</span><strong>{loading ? '—' : visibleCount('DOMAIN')}</strong></div><div><span>Subdomains on this page</span><strong>{loading ? '—' : visibleCount('SUBDOMAIN')}</strong></div><div><span>IP addresses on this page</span><strong>{loading ? '—' : visibleCount('IP_ADDRESS')}</strong></div></section>
    <section className="editorial-feature" aria-label="Attack surface overview"><div><span className="source-eyebrow">ATTACK SURFACE OVERVIEW</span><h2>From names to infrastructure.</h2><p>Explore the inventory by asset type, then open an asset to inspect its real discovery results, ports, and relationships.</p></div><div className="editorial-type-map">{assetTypes.map(assetType => <div key={assetType}><span>{assetType.replaceAll('_', ' ')}</span><strong>{loading ? '—' : visibleCount(assetType)}</strong></div>)}</div></section>
    <div className="editorial-section-heading"><span className="source-eyebrow">ASSET INVENTORY</span><h2>Operational assets</h2><p>Search, filter, and manage the assets in the selected tenant.</p></div>
    {notice && <div className="success" role="status">{notice}</div>}{error && <div className="error" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></div>}
    {discoveryError && <div className="error" role="alert">{discoveryError} {lastDiscoveryAsset && <button type="button" onClick={() => void discover(lastDiscoveryAsset)}>Retry discovery</button>}</div>}
    {discovery && <DiscoveryResult summary={discovery} />}
    <Card view="outlined" className="asm-card"><div className="asm-filters"><label><Search size={15} /><input aria-label="Search assets" placeholder="Search name or value" value={search} onChange={event => { setPage(1); setSearch(event.target.value); }} /></label><select aria-label="Filter type" value={type} onChange={event => { setPage(1); setType(event.target.value); }}><option value="">All types</option>{assetTypes.map(value => <option key={value}>{value}</option>)}</select><select aria-label="Filter status" value={status} onChange={event => { setPage(1); setStatus(event.target.value); }}><option value="">All status</option>{assetStatuses.map(value => <option key={value}>{value}</option>)}</select><select aria-label="Filter criticality" value={criticality} onChange={event => { setPage(1); setCriticality(event.target.value); }}><option value="">All criticality</option>{assetCriticalities.map(value => <option key={value}>{value}</option>)}</select></div>
      {loading ? <div className="asm-state" aria-live="polite"><RefreshCw className="spin" size={18} />Loading assets...</div> : denied ? <div className="asm-state asm-denied" role="alert"><AlertTriangle size={22} /><strong>Module access required</strong><span>Your account cannot access Attack Surface Management.</span><Link href="/dashboard">Back to Dashboard</Link></div> : error ? null : items.length === 0 ? <div className="asm-state"><Radar size={24} /><strong>No assets found</strong><span>{canManage ? 'Adjust the filters or create your first asset.' : 'Adjust the filters or contact an administrator to add assets.'}</span></div> : <AssetTable items={items} canManage={canManage} discovering={discovering} onDetail={openDetail} onEdit={openEdit} onDelete={asset => { setDeleteTarget(asset); setDeleteError(''); }} onDiscover={discover} />}
      <div className="asm-pagination"><span>{total} assets · Page {page} of {pages}</span><div><Button view="outlined" size="s" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</Button><Button view="outlined" size="s" disabled={page >= pages || loading} onClick={() => setPage(value => value + 1)}>Next</Button></div></div>
    </Card>{panel !== 'closed' && <AssetPanel asset={selected} form={form} mode={panel} saving={saving} error={error} onChange={setField} onClose={closePanel} onSubmit={submit} tenantQuery={tenantQuery} canManage={canManage} discovery={selected?.id === lastDiscoveryAsset?.id ? discovery : null} discoveryError={selected?.id === lastDiscoveryAsset?.id ? discoveryError : ''} discoveryRun={discoveryRun} discovering={discovering === selected?.id} onDiscoverAsset={discover} workspaceRef={detailWorkspaceRef} />}
    <ConfirmationModal open={deleteTarget !== null} onOpenChange={open => { if (!open) setDeleteTarget(null); }} title="Delete Asset?" description="You are about to delete this asset." target={deleteTarget?.name} consequence="This action cannot be undone." confirmLabel="Delete Asset" destructive loading={deleting} error={deleteError} onConfirm={() => deleteTarget ? remove(deleteTarget) : undefined} />
  </main>;
}

function AssetTable({ items, canManage, discovering, onDetail, onEdit, onDelete, onDiscover }: { readonly items: readonly Asset[]; readonly canManage: boolean; readonly discovering: string; readonly onDetail: (asset: Asset) => void; readonly onEdit: (asset: Asset) => void; readonly onDelete: (asset: Asset) => void; readonly onDiscover: (asset: Asset) => Promise<void> }) {
  return <Table data={items} columns={[{ id: 'name', name: 'Asset', template: asset => <button className="source-name" onClick={() => onDetail(asset)}>{asset.name}</button> }, { id: 'type', name: 'Type', template: asset => <span className="asm-type">{asset.type}</span> }, { id: 'value', name: 'Value', template: asset => <code>{asset.value}</code> }, { id: 'status', name: 'Status', template: asset => <span className={`cti-status is-${asset.status.toLowerCase()}`}>{asset.status}</span> }, { id: 'criticality', name: 'Criticality', template: asset => <span className={`ioc-severity severity-${asset.criticality.toLowerCase()}`}>{asset.criticality}</span> }, { id: 'owner', name: 'Owner', template: asset => asset.owner || '-' }, { id: 'updated', name: 'Updated', template: asset => formatDate(asset.updatedAt) }, { id: 'actions', name: 'Actions', template: asset => <div className="ioc-actions"><Button view="flat" size="s" onClick={() => onDetail(asset)}>Detail</Button>{(asset.type === 'DOMAIN' || asset.type === 'SUBDOMAIN') && <Button view="outlined" size="s" disabled={discovering === asset.id} onClick={() => void onDiscover(asset)}>{discovering === asset.id ? 'Discovering...' : asset.type === 'DOMAIN' ? 'Discover Subdomains' : 'Discover DNS/IP'}</Button>}{canManage && <><Button view="flat" size="s" onClick={() => onEdit(asset)}>Edit</Button><Button view="flat-danger" size="s" onClick={() => onDelete(asset)}>Delete</Button></>}</div> }]}/>;
}

function DiscoveryResult({ summary }: { readonly summary: DiscoverySummary }) {
  const metrics = [['Discovered', summary.discovered], ['Created', summary.created], ['Updated', summary.updated], ['Skipped', summary.skipped], ['Failed', summary.failed]] as const;
  return <section className="asm-discovery" aria-label="Discovery results"><header><div><span className="source-eyebrow">DISCOVER ASSETS / RESULT</span><h2>{summary.rootDomain}</h2><p>Target asset · {summary.providers.length ? `Providers: ${summary.providers.join(' · ')}` : 'No provider completed'}</p></div><span className="asm-discovery-status">{summary.failed > 0 ? 'Completed with errors' : 'Completed'}</span></header><dl>{metrics.map(([label, value]) => <div key={label} className={label === 'Failed' && value > 0 ? 'is-danger' : ''}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="asm-discovery-note">Open the asset detail to inspect relationships created or updated by discovery.</p>{summary.errors.length > 0 && <div className="asm-discovery-errors" role="alert">{summary.errors.map(value => <span key={value}>{value}</span>)}</div>}</section>;
}

function messageOf(body: ErrorBody, fallback: string): string { return typeof body.message === 'string' ? body.message : body.message?.join(', ') || fallback; }
function formPayload(form: AssetFormValue): Record<string, string> { return { ...form }; }
function toForm(asset: Asset): AssetFormValue { return { name: asset.name, type: asset.type, value: asset.value, status: asset.status, criticality: asset.criticality, description: asset.description ?? '', owner: asset.owner ?? '', firstSeenAt: asset.firstSeenAt?.slice(0, 16) ?? '', lastSeenAt: asset.lastSeenAt?.slice(0, 16) ?? '' }; }
