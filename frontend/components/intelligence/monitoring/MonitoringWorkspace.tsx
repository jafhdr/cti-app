'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useThreatIntelligenceTenant } from '../ThreatIntelligenceShell';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Watch = { readonly id: string; readonly kind: string; readonly label: string; readonly active: boolean; readonly expiresAt: string | null; readonly assetId: string | null };
type Source = { readonly id: string; readonly providerKey: string; readonly authorized: boolean; readonly retentionDays: number; readonly connectorVersion: number; readonly collectionEnabled: boolean; readonly lastSuccessAt: string | null; readonly lastFailureReason: string | null; readonly coverageLabel: string | null; readonly nextCollectionAt: string | null; readonly catalogSource: { readonly name: string; readonly status: string; readonly tlp: string } };
type Collection = { readonly id: string; readonly sourceId: string; readonly status: string; readonly attempt: number; readonly createdAt: string; readonly finishedAt: string | null; readonly observationCount: number; readonly failureReason: string | null; readonly collectionLatencyMs: number | null; readonly processingLatencyMs: number | null };
type Finding = { readonly id: string; readonly status: string; readonly alertId: string | null; readonly caseId: string | null; readonly createdAt: string; readonly match: { readonly rule: string; readonly confidence: number; readonly severity: string; readonly watchlist: { readonly label: string; readonly kind: string; readonly assetId: string | null }; readonly observation: { readonly id: string; readonly kind: string; readonly domain: string | null; readonly metadataCategory: string; readonly tlp: string; readonly observedAt: string; readonly providerPublishedAt?: string | null; readonly collectedAt?: string | null; readonly expiresAt: string; readonly evidenceRef?: string; readonly evidenceDigest?: string; readonly source: { readonly providerKey: string; readonly catalogSource?: { readonly name: string } } } }; readonly reviews: readonly { readonly id: string; readonly fromStatus: string; readonly toStatus: string; readonly reason: string; readonly createdAt: string; readonly actor: { readonly name: string } }[] };
type CatalogSource = { readonly id: string; readonly name: string; readonly status: string };
const statuses = ['NEW', 'UNDER_REVIEW', 'CONFIRMED', 'FALSE_POSITIVE', 'RESOLVED'] as const;

export function MonitoringWorkspace({ role }: { readonly role: Role }) {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const query = role === 'SUPER_ADMIN' ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  const canAct = role !== 'USER';
  const [watches, setWatches] = useState<readonly Watch[]>([]);
  const [sources, setSources] = useState<readonly Source[]>([]);
  const [collections, setCollections] = useState<readonly Collection[]>([]);
  const [catalog, setCatalog] = useState<readonly CatalogSource[]>([]);
  const [findings, setFindings] = useState<readonly Finding[]>([]);
  const [detail, setDetail] = useState<Finding | null>(null);
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<'DOMAIN' | 'BRAND' | 'IDENTITY_HASH'>('DOMAIN');
  const [value, setValue] = useState('');
  const [assetId, setAssetId] = useState('');
  const [catalogSourceId, setCatalogSourceId] = useState('');
  const [providerKey, setProviderKey] = useState('qa-fixture-monitoring');
  const [reason, setReason] = useState('');
  const [caseId, setCaseId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (role === 'SUPER_ADMIN' && (!ready || !tenantId)) return;
    setLoading(true);
    try {
      const [watchResponse, sourceResponse, findingResponse, catalogResponse, collectionResponse] = await Promise.all([
        fetch(`${API}/intelligence/monitoring/watchlists${query}`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${API}/intelligence/monitoring/sources${query}`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${API}/intelligence/monitoring/findings${query}`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${API}/intelligence/sources${query}`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${API}/intelligence/monitoring/collections${query}`, { credentials: 'include', cache: 'no-store' }),
      ]);
      if (!watchResponse.ok || !sourceResponse.ok || !findingResponse.ok) throw new Error('Monitoring access or data is unavailable.');
      setWatches(await watchResponse.json()); setSources(await sourceResponse.json()); setFindings(await findingResponse.json());
      if (collectionResponse.ok) setCollections(await collectionResponse.json());
      if (catalogResponse.ok) { const data: { readonly items?: readonly CatalogSource[] } = await catalogResponse.json(); setCatalog(data.items ?? []); }
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load monitoring.'); setWatches([]); setSources([]); setCollections([]); setFindings([]); setDetail(null); }
    finally { setLoading(false); }
  }, [query, ready, role, tenantId]);
  useEffect(() => { setSelected(''); setDetail(null); void load(); }, [load]);

  async function post(path: string, body: object, method = 'POST'): Promise<boolean> {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${API}/intelligence/monitoring/${path}${query}`, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) { const result: { readonly message?: string | readonly string[] } = await response.json(); throw new Error(typeof result.message === 'string' ? result.message : result.message?.join(', ') || 'Monitoring action failed.'); }
      setNotice('Monitoring record saved.'); await load();
      if (selected) await openDetail(selected);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Monitoring action failed.'); return false; }
    finally { setBusy(false); }
  }

  async function openDetail(id: string): Promise<void> {
    setSelected(id); setDetail(null); setError('');
    try {
      const response = await fetch(`${API}/intelligence/monitoring/findings/${id}${query}`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('Finding evidence is unavailable or restricted.');
      setDetail(await response.json());
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load evidence.'); }
  }

  function review(status: 'UNDER_REVIEW' | 'CONFIRMED' | 'FALSE_POSITIVE' | 'RESOLVED'): void {
    if (!detail || reason.trim().length < 10) { setError('Enter a review reason of at least 10 characters.'); return; }
    void post(`findings/${detail.id}/reviews`, { status, expectedStatus: detail.status, reason: reason.trim() }).then(ok => { if (ok) setReason(''); });
  }

  const visible = filter ? findings.filter(finding => finding.status === filter) : findings;
  return <div className="ti-phase2b monitoring-workspace">
    <div className="source-heading"><div><span className="source-eyebrow">PHASE 4B / AUTHORIZED QA COLLECTION</span><h1>Dark Web &amp; Brand Monitoring</h1><p>Review authorized synthetic exposure signals against tenant watchlists and ASM domains. Simulated collection runs only in isolated QA; no live underground source or production provider is connected.</p></div></div>
    {error && <Card view="outlined" className="source-state error" role="alert">{error}</Card>}
    {notice && <Card view="outlined" className="source-state monitoring-feedback" role="status">{notice}</Card>}
    {canAct && <Card view="outlined" className="feed-card monitoring-panel"><span className="source-eyebrow">01 / WATCHLIST</span><h2>Add a monitored term</h2><div className="monitoring-controls"><label>Type<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="DOMAIN">Corporate domain</option><option value="BRAND">Brand name</option><option value="IDENTITY_HASH">Approved identity</option></select></label><label>{kind === 'IDENTITY_HASH' ? 'Approved corporate email (stored as hash)' : kind === 'BRAND' ? 'Brand name' : 'Corporate domain'}<input value={value} onChange={event => setValue(event.target.value)} placeholder={kind === 'IDENTITY_HASH' ? 'analyst@company.test' : kind === 'BRAND' ? 'Company name' : 'company.test'} /></label>{kind === 'DOMAIN' && <label>ASM asset ID (optional)<input value={assetId} onChange={event => setAssetId(event.target.value)} /></label>}<Button view="action" disabled={busy || !value.trim()} onClick={() => void post('watchlists', { kind, value, ...(assetId && kind === 'DOMAIN' ? { assetId } : {}) }).then(ok => { if (ok) { setValue(''); setAssetId(''); } })}>Add watch</Button></div></Card>}
    <Card view="outlined" className="feed-card monitoring-panel"><span className="source-eyebrow">WATCHLIST HISTORY</span><h2>Tenant terms</h2>{watches.length === 0 ? <p>No watchlists for this tenant.</p> : <div className="monitoring-list">{watches.map(watch => <article key={watch.id}><strong>{watch.label}</strong><p>{watch.kind.replaceAll('_', ' ')} / {watch.active ? 'Active' : 'Paused'}{watch.expiresAt ? ` / expires ${new Date(watch.expiresAt).toLocaleDateString()}` : ''}{watch.assetId ? ` / ASM asset ${watch.assetId}` : ''}</p>{canAct && <Button view="outlined" disabled={busy} onClick={() => void post(`watchlists/${watch.id}`, { active: !watch.active }, 'PATCH')}>{watch.active ? 'Pause' : 'Reactivate'}</Button>}</article>)}</div>}</Card>
    <Card view="outlined" className="feed-card monitoring-panel"><span className="source-eyebrow">02 / PROVENANCE</span><h2>Authorized QA sources</h2>{sources.length === 0 ? <p>No monitoring source authorized.</p> : <div className="monitoring-list">{sources.map(source => <article key={source.id}><strong>{source.catalogSource.name}</strong><p>{source.providerKey} / {source.catalogSource.tlp} / {source.retentionDays} day retention / {source.authorized ? 'Authorized synthetic QA' : 'Not authorized'}</p></article>)}</div>}{canAct && <div className="monitoring-controls"><label>Intelligence source<select value={catalogSourceId} onChange={event => setCatalogSourceId(event.target.value)}><option value="">Select an active local source</option>{catalog.filter(source => source.status === 'ACTIVE').map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label><label>QA provider key<input value={providerKey} onChange={event => setProviderKey(event.target.value)} /></label><Button view="outlined" disabled={busy || !catalogSourceId} onClick={() => void post('sources', { catalogSourceId, providerKey, retentionDays: 30 })}>Authorize QA source</Button></div>}</Card>
    <Card view="outlined" className="feed-card monitoring-panel"><span className="source-eyebrow">COLLECTION STATUS</span><h2>Simulated connector health</h2>{sources.length === 0 ? <p>Authorize a local QA source to enable collection.</p> : <div className="monitoring-list">{sources.map(source => <article key={source.id}><strong>{source.catalogSource.name}</strong><p>Connector v{source.connectorVersion} / {source.collectionEnabled ? 'Scheduled QA collection' : 'Collection disabled'} / {source.catalogSource.status}</p><p>Coverage: {source.coverageLabel ?? 'No collection yet'} / Last success: {source.lastSuccessAt ? new Date(source.lastSuccessAt).toLocaleString() : 'Never'} / Next due: {source.nextCollectionAt ? new Date(source.nextCollectionAt).toLocaleString() : 'Not scheduled'}</p>{source.lastFailureReason && <p role="status">Last failure: {source.lastFailureReason}</p>}{canAct && <div className="monitoring-heading-actions">{source.collectionEnabled ? <><Button view="outlined" disabled={busy} onClick={() => void post(`sources/${source.id}/collect`, {})}>Collect now</Button><Button view="outlined" disabled={busy} onClick={() => void post(`sources/${source.id}/connector`, {}, 'PATCH')}>Disable</Button></> : <Button view="action" disabled={busy || source.catalogSource.status !== 'ACTIVE'} onClick={() => void post(`sources/${source.id}/connector`, { intervalMinutes: 60 })}>Enable QA schedule</Button>}</div>}</article>)}</div>}{canAct && sources.some(source => source.collectionEnabled) && <Button view="outlined" disabled={busy} onClick={() => void post('collections/schedule', {})}>Run due schedules</Button>}</Card>
    <Card view="outlined" className="feed-card monitoring-panel"><span className="source-eyebrow">COLLECTION HISTORY</span><h2>Execution and latency</h2>{collections.length === 0 ? <p>No collection jobs yet.</p> : <ol className="monitoring-history">{collections.map(job => <li key={job.id}><strong>{job.status.replaceAll('_', ' ')}</strong> / {new Date(job.createdAt).toLocaleString()} / {job.observationCount} observations / attempt {job.attempt}<p>{job.failureReason ? `Failure: ${job.failureReason}` : `Collection: ${job.collectionLatencyMs ?? '—'} ms / Processing: ${job.processingLatencyMs ?? '—'} ms`}</p></li>)}</ol>}</Card>
    <div className="editorial-section-heading"><span className="source-eyebrow">03 / FINDINGS</span><h2>Evidence queue</h2><div className="monitoring-heading-actions"><label>Status<select value={filter} onChange={event => setFilter(event.target.value)}><option value="">All statuses</option>{statuses.map(status => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label><Button view="outlined" disabled={loading} onClick={() => void load()}>Refresh</Button></div></div>
    {loading ? <Card view="outlined" className="source-state" role="status">Loading monitoring history...</Card> : visible.length === 0 ? <Card view="outlined" className="source-state">No findings match this filter.</Card> : <div className="monitoring-list">{visible.map(finding => <Card view="outlined" className="feed-card monitoring-finding" key={finding.id}><div className="monitoring-finding-head"><div><span className="source-eyebrow">{finding.match.observation.kind.replaceAll('_', ' ')}</span><h3>{finding.match.watchlist.label}</h3></div><strong>{finding.status.replaceAll('_', ' ')}</strong></div><p>{finding.match.rule.replaceAll('_', ' ')} / confidence {finding.match.confidence}/100 / {finding.match.severity} / {finding.match.observation.tlp}</p><p>{finding.match.observation.source.providerKey} / observed {new Date(finding.match.observation.observedAt).toLocaleString()}</p><Button view="outlined" onClick={() => void openDetail(finding.id)}>Inspect evidence</Button></Card>)}</div>}
    {detail && <Card view="outlined" className="feed-card monitoring-detail" role="region" aria-label="Monitoring evidence detail"><span className="source-eyebrow">04 / EVIDENCE AND REVIEW</span><h2>{detail.match.watchlist.label} / {detail.status.replaceAll('_', ' ')}</h2><dl className="monitoring-facts"><div><dt>Detection rule</dt><dd>{detail.match.rule.replaceAll('_', ' ')} / {detail.match.confidence}/100</dd></div><div><dt>Severity / TLP</dt><dd>{detail.match.severity} / {detail.match.observation.tlp}</dd></div><div><dt>Source</dt><dd>{detail.match.observation.source.catalogSource?.name ?? detail.match.observation.source.providerKey}</dd></div><div><dt>Metadata</dt><dd>{detail.match.observation.metadataCategory.replaceAll('_', ' ')}</dd></div><div><dt>Safe evidence reference</dt><dd>{detail.match.observation.evidenceRef}</dd></div><div><dt>Evidence SHA-256</dt><dd>{detail.match.observation.evidenceDigest}</dd></div><div><dt>Provider published</dt><dd>{detail.match.observation.providerPublishedAt ? new Date(detail.match.observation.providerPublishedAt).toLocaleString() : 'Not reported'}</dd></div><div><dt>Collected locally</dt><dd>{detail.match.observation.collectedAt ? new Date(detail.match.observation.collectedAt).toLocaleString() : 'Not collected'}</dd></div><div><dt>Retention</dt><dd>Accessible until {new Date(detail.match.observation.expiresAt).toLocaleString()}</dd></div><div><dt>Alert / Case</dt><dd>{detail.alertId ?? 'No alert'} / {detail.caseId ? <Link href={`/cases/${detail.caseId}`}>Open linked case</Link> : 'No case'}</dd></div></dl><h3>Review history</h3>{detail.reviews.length === 0 ? <p>No analyst review yet.</p> : <ol className="monitoring-history">{detail.reviews.map(review => <li key={review.id}>{review.fromStatus.replaceAll('_', ' ')} to {review.toStatus.replaceAll('_', ' ')} / {review.actor.name} / {new Date(review.createdAt).toLocaleString()}<p>{review.reason}</p></li>)}</ol>}{canAct && <div className="monitoring-actions"><label>Review reason<input value={reason} onChange={event => setReason(event.target.value)} minLength={10} maxLength={1000} placeholder="Explain the evidence and decision" /></label><div>{detail.status === 'NEW' && <><Button view="action" disabled={busy} onClick={() => review('UNDER_REVIEW')}>Start review</Button><Button view="outlined" disabled={busy} onClick={() => review('FALSE_POSITIVE')}>False positive</Button></>}{detail.status === 'UNDER_REVIEW' && <><Button view="action" disabled={busy} onClick={() => review('CONFIRMED')}>Confirm finding</Button><Button view="outlined" disabled={busy} onClick={() => review('FALSE_POSITIVE')}>False positive</Button></>}{detail.status === 'CONFIRMED' && <><Button view="outlined" disabled={busy} onClick={() => review('RESOLVED')}>Resolve</Button><Button view="outlined" disabled={busy} onClick={() => review('FALSE_POSITIVE')}>False positive</Button></>}</div>{detail.status === 'CONFIRMED' && <div><Button view="action" disabled={busy || Boolean(detail.alertId)} onClick={() => void post(`findings/${detail.id}/alert`, {})}>{detail.alertId ? 'Alert linked' : 'Create alert'}</Button><Button view="outlined" disabled={busy || Boolean(detail.caseId)} onClick={() => void post(`findings/${detail.id}/case`, { createCase: true })}>{detail.caseId ? 'Case linked' : 'Create case'}</Button><label>Existing Case ID<input value={caseId} onChange={event => setCaseId(event.target.value)} /></label><Button view="outlined" disabled={busy || Boolean(detail.caseId) || !caseId} onClick={() => void post(`findings/${detail.id}/case`, { caseId })}>Link case</Button></div>}</div>}</Card>}
  </div>;
}
