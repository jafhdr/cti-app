'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useThreatIntelligenceTenant } from '../ThreatIntelligenceShell';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Row = { readonly id: string; readonly score: number; readonly reason: string; readonly evidence: { readonly provider: string; readonly ioaKind: string; readonly feedObservedAt: string }; readonly matchedAt: string; readonly correlatedAt: string; readonly alertVisibleAt: string; readonly event: { readonly observableValue: string; readonly observableType: string; readonly sourceName: string; readonly observedAt: string; readonly ingestedAt: string; readonly tlp: string }; readonly indicator: { readonly value: string; readonly severity: string }; readonly alert: { readonly title: string; readonly status: string; readonly severity: string } };
type Outcome = { readonly status: string; readonly eventId: string; readonly correlationId: string | null; readonly processingLatencyMs?: number; readonly message?: string };

export function CorrelationWorkspace({ role }: { readonly role: Role }) {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [value, setValue] = useState('');
  const [type, setType] = useState('DOMAIN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const query = role === 'SUPER_ADMIN' ? `?tenantId=${encodeURIComponent(tenantId)}` : '';

  const load = useCallback(async () => {
    if (role === 'SUPER_ADMIN' && (!ready || !tenantId)) return;
    const response = await fetch(`${API}/threat-correlations${query}`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 404 ? 'Correlation pilot is unavailable in this environment.' : 'Could not load correlations.');
    setRows(await response.json());
  }, [query, ready, role, tenantId]);

  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : 'Could not load correlations.')); }, [load]);

  async function ingest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true); setError(''); setOutcome(null);
    try {
      const ioaKind = type === 'DOMAIN' ? 'DNS_QUERY' : type === 'URL' ? 'HTTP_REQUEST' : type === 'IP_ADDRESS' ? 'IP_CONNECTION' : type === 'FILE_HASH' ? 'HASH_EXECUTION' : 'EMAIL_CONTACT';
      const response = await fetch(`${API}/threat-correlations/qa-telemetry`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        ...(role === 'SUPER_ADMIN' ? { tenantId } : {}), sourceKey: crypto.randomUUID(), sourceName: 'Synthetic SOC telemetry',
        observedAt: new Date().toISOString(), observableType: type, observableValue: value, ioaKind, confidence: 90, tlp: 'AMBER',
      }) });
      const body: Outcome = await response.json();
      if (!response.ok) throw new Error(body.message || 'Telemetry submission failed.');
      setOutcome(body);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Telemetry submission failed.'); }
    finally { setBusy(false); }
  }

  return <div className="ti-phase2b">
    <div className="source-heading"><div><span className="source-eyebrow">PHASE 1 · ISOLATED QA</span><h1>Threat correlations</h1><p>Exact IOC matches between URLhaus feed observations and synthetic internal security telemetry.</p></div></div>
    {role !== 'USER' && <Card view="outlined" className="feed-card"><h2>Submit synthetic telemetry</h2><p>Use an IOC currently observed in the URLhaus feed. This action is available only in an isolated QA database.</p><form className="ioc-decision-form" onSubmit={event => void ingest(event)}><label>Observable type<select value={type} onChange={event => setType(event.target.value)}><option>DOMAIN</option><option>URL</option><option>IP_ADDRESS</option><option>FILE_HASH</option><option>EMAIL</option></select></label><label>Observed value<input required minLength={2} value={value} onChange={event => setValue(event.target.value)} placeholder="example.org" /></label><Button view="action" size="s" type="submit" disabled={busy || (role === 'SUPER_ADMIN' && !tenantId)}>{busy ? 'Correlating...' : 'Submit QA event'}</Button></form></Card>}
    {error && <Card view="outlined" role="alert" className="source-state error">{error}</Card>}
    {outcome && <Card view="outlined" role="status" className="source-state"><strong>{outcome.status.replaceAll('_', ' ')}</strong>{outcome.processingLatencyMs !== undefined && <p>Application processing: {outcome.processingLatencyMs} ms. This is one sample, not an SLA measurement.</p>}</Card>}
    <div className="editorial-section-heading"><span className="source-eyebrow">ANALYST EVIDENCE</span><h2>Recent matches</h2></div>
    {rows.length === 0 ? <Card view="outlined" className="source-state">No matches in this tenant.</Card> : <div className="feed-grid">{rows.map(row => <Card view="outlined" className="feed-card" key={row.id}><header><div><span className="source-eyebrow">{row.alert.severity} · {row.alert.status}</span><h2>{row.event.observableValue}</h2></div><strong>{row.score}/100</strong></header><dl><div><dt>Rule</dt><dd>{row.reason.replaceAll('_', ' ')}</dd></div><div><dt>Feed</dt><dd>{row.evidence.provider} · {format(row.evidence.feedObservedAt)}</dd></div><div><dt>Internal signal</dt><dd>{row.evidence.ioaKind} · {row.event.sourceName}</dd></div><div><dt>Observed / ingested</dt><dd>{format(row.event.observedAt)} / {format(row.event.ingestedAt)}</dd></div><div><dt>Matched / alert visible</dt><dd>{format(row.matchedAt)} / {format(row.alertVisibleAt)}</dd></div><div><dt>Classification</dt><dd>{row.event.tlp}</dd></div></dl></Card>)}</div>}
  </div>;
}

function format(value: string): string { return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' }); }
