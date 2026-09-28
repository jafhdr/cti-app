'use client';

import { AlertCircle, CheckCircle2, Clock3, RefreshCw, Radio, TimerReset } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useThreatIntelligenceTenant } from '../ThreatIntelligenceShell';
import { Phase2bSummary } from '../Phase2bSummary';
import type { FeedStatusResponse, FeedSyncResponse } from './types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type SyncFeedback = { readonly tone: 'success' | 'warning' | 'error'; readonly message: string };

export function FeedsWorkspace({ role }: { readonly role: Role }) {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const [data, setData] = useState<FeedStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<SyncFeedback | null>(null);
  const canSync = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const tenantQuery = role === 'SUPER_ADMIN' ? `?tenantId=${encodeURIComponent(tenantId)}` : '';

  const load = useCallback(async () => {
    if (role === 'SUPER_ADMIN' && (!ready || !tenantId)) { setLoading(true); return; }
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API}/indicators/feed-status${tenantQuery}`, { credentials: 'include', cache: 'no-store' });
      const body: FeedStatusResponse = await response.json();
      if (!response.ok) throw new Error(body.message || 'Gagal memuat status threat feed.');
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal memuat status threat feed.');
    } finally { setLoading(false); }
  }, [ready, role, tenantId, tenantQuery]);

  useEffect(() => { void load(); }, [load]);

  async function syncNow(): Promise<void> {
    setSyncing(true); setError(''); setFeedback(null);
    try {
      const response = await fetch(`${API}/indicators/feed-sync`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(role === 'SUPER_ADMIN' ? { tenantId } : {}) });
      const body: FeedSyncResponse = await response.json();
      if (!response.ok) throw new Error(body.message || 'Threat feed sync gagal.');
      const failed = body.results.filter(result => result.status === 'FAILED').length;
      const synced = body.results.filter(result => result.status === 'SYNCED').length;
      const skipped = body.results.filter(result => result.status === 'SKIPPED').length;
      const tone = synced === 0 ? 'error' : failed > 0 || skipped > 0 ? 'warning' : 'success';
      const state = synced === 0 ? (failed > 0 ? 'Sync gagal' : 'Sync tidak dapat dijalankan') : failed > 0 || skipped > 0 ? 'Sync selesai sebagian' : 'Sync selesai';
      setFeedback({ tone, message: `${state}. ${body.totals.created} dibuat, ${body.totals.updated} diperbarui, ${body.totals.received} diterima.` });
      await load();
    } catch (cause) {
      setFeedback({ tone: 'error', message: cause instanceof Error ? cause.message : 'Threat feed sync gagal.' });
    } finally { setSyncing(false); }
  }

  return <div className="ti-phase2b">
    <div className="source-heading feed-heading"><div><span className="source-eyebrow">AUTOMATED INGESTION</span><h1>Threat Feeds</h1><p>Monitor external intelligence entering the platform.</p></div>{canSync && <Button view="action" size="l" disabled={syncing || (role === 'SUPER_ADMIN' && !tenantId)} onClick={() => void syncNow()}><RefreshCw size={16} className={syncing ? 'feed-spin' : undefined} aria-hidden="true" />{syncing ? 'Syncing...' : 'Sync Now'}</Button>}</div>
    {error && <div className="error feed-feedback" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div>}
    {feedback && <div className={`feed-feedback feed-feedback-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.tone === 'success' ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}<span>{feedback.message}</span></div>}
    {data && <Phase2bSummary title="FEED STATUS" metrics={[{label:"Active",value:data.providers.filter(feed=>feed.status==="ACTIVE").length},{label:"Failed",value:data.providers.filter(feed=>feed.status==="FAILED").length},{label:"Not configured",value:data.providers.filter(feed=>feed.status==="NOT_CONFIGURED").length}]}/>}
    <section className="feed-scheduler" aria-labelledby="scheduler-title"><div><span className="source-eyebrow">SCHEDULER</span><h2 id="scheduler-title">Automatic Sync</h2></div><div className="feed-scheduler-stat"><Radio size={17} aria-hidden="true" /><span>Status<strong>{data ? (data.scheduler.enabled ? 'Enabled' : 'Disabled') : loading ? 'Loading' : 'Unavailable'}</strong></span></div><div className="feed-scheduler-stat"><TimerReset size={17} aria-hidden="true" /><span>Sync Interval<strong>{data ? formatInterval(data.scheduler.intervalMinutes) : '—'}</strong></span></div><div className="feed-scheduler-stat"><Clock3 size={17} aria-hidden="true" /><span>Next Sync<strong>{data ? formatDate(data.scheduler.nextSyncAt) : '—'}</strong></span></div></section>
    <div className="editorial-section-heading"><span className="source-eyebrow">PROVIDERS</span><h2>Provider health</h2></div>
    {loading && !data ? <Card view="outlined" className="source-state" aria-live="polite">Loading threat feeds...</Card> : <div className="feed-grid">{data?.providers.map(feed => <Card view="outlined" className="feed-card" key={feed.provider}><header><div className="feed-provider-icon"><Radio size={18} aria-hidden="true" /></div><div><span className="source-eyebrow">{feed.provider}</span><h2>{feed.name}</h2></div><span className={`feed-status feed-status-${feed.status.toLowerCase().replace('_', '-')}`}><span aria-hidden="true" />{statusLabel(feed.status)}</span></header><dl><div><dt>Last Sync</dt><dd>{formatDate(feed.lastSyncAt)}</dd></div><div><dt>Indicators Received</dt><dd>{feed.received.toLocaleString('id-ID')}</dd></div><div><dt>Created</dt><dd>{formatCount(feed.created)}</dd></div><div><dt>Updated</dt><dd>{formatCount(feed.updated)}</dd></div></dl>{feed.error && <div className="feed-error"><AlertCircle size={15} aria-hidden="true" /><span><strong>Last error</strong>{feed.error}</span></div>}</Card>)}</div>}
  </div>;
}

function formatDate(value: string | null): string { return value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not available'; }
function formatCount(value: number | null): string { return value === null ? '—' : value.toLocaleString('id-ID'); }
function formatInterval(minutes: number): string { return minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`; }
function statusLabel(status: FeedStatusResponse['providers'][number]['status']): string { return status === 'ACTIVE' ? 'Active' : status === 'FAILED' ? 'Failed' : 'Not Configured'; }
