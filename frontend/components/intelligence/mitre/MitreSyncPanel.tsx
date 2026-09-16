'use client';

import { AlertCircle, CheckCircle2, Clock3, Database, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type SyncResult = { readonly total: number; readonly created: number; readonly updated: number; readonly failed: number };
type SyncSummary = SyncResult & { readonly lastSyncAt: string | null };
type AuditItem = { readonly createdAt: string; readonly metadata: SyncResult | null };
type AuditResponse = { readonly items: readonly AuditItem[]; readonly message?: string };
type SyncResponse = SyncResult & { readonly message?: string };

const emptySummary: SyncSummary = { lastSyncAt: null, total: 0, created: 0, updated: 0, failed: 0 };

export function MitreSyncPanel({ role, tenantId, ready, onSynced }: { readonly role: Role; readonly tenantId: string; readonly ready: boolean; readonly onSynced: () => Promise<void> }) {
  const [summary, setSummary] = useState<SyncSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const canSync = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const tenantQuery = role === 'SUPER_ADMIN' ? `&tenantId=${encodeURIComponent(tenantId)}` : '';
  const ingestQuery = role === 'SUPER_ADMIN' ? `?tenantId=${encodeURIComponent(tenantId)}` : '';

  const loadSummary = useCallback(async () => {
    if (!canSync) { setLoading(false); return; }
    if (role === 'SUPER_ADMIN' && (!ready || !tenantId)) { setLoading(true); return; }
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API}/audit-logs?page=1&limit=1&action=MITRE_THREAT_ACTORS_INGESTED${tenantQuery}`, { credentials: 'include', cache: 'no-store' });
      const body: AuditResponse = await response.json();
      if (!response.ok) throw new Error(body.message || 'Gagal memuat status MITRE ATT&CK.');
      const latest = body.items[0];
      setSummary(latest?.metadata ? { ...latest.metadata, lastSyncAt: latest.createdAt } : emptySummary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal memuat status MITRE ATT&CK.');
    } finally { setLoading(false); }
  }, [canSync, ready, role, tenantId, tenantQuery]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  async function syncNow(): Promise<void> {
    setSyncing(true); setError(''); setSuccess('');
    try {
      const response = await fetch(`${API}/intelligence/threat-actors/ingest-mitre${ingestQuery}`, { method: 'POST', credentials: 'include' });
      const body: SyncResponse = await response.json();
      if (!response.ok) throw new Error(body.message || 'MITRE ATT&CK sync gagal.');
      setSummary({ lastSyncAt: new Date().toISOString(), total: body.total, created: body.created, updated: body.updated, failed: body.failed });
      setSuccess(`Sync selesai. ${body.created} dibuat, ${body.updated} diperbarui, ${body.failed} gagal.`);
      await onSynced();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'MITRE ATT&CK sync gagal.');
    } finally { setSyncing(false); }
  }

  return <Card view="outlined" className="mitre-sync" role="region" aria-label="MITRE ATT&CK sync status" aria-busy={loading || syncing}>
    <header className="mitre-sync-header"><div><span className="source-eyebrow">ENTERPRISE BUNDLE</span><h1>MITRE ATT&amp;CK Sync</h1><p>Monitor dan perbarui katalog Threat Actor dari sumber resmi MITRE ATT&amp;CK.</p></div>{canSync && <Button view="action" size="l" aria-label={syncing ? 'Syncing MITRE ATT&CK' : 'Sync Now'} disabled={syncing || (role === 'SUPER_ADMIN' && !tenantId)} onClick={() => void syncNow()}><RefreshCw size={16} className={syncing ? 'feed-spin' : undefined} aria-hidden="true" />{syncing ? 'Syncing...' : 'Sync Now'}</Button>}</header>
    {error && <div className="feed-feedback feed-feedback-error" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{error}</span></div>}
    {success && <div className="feed-feedback feed-feedback-success" role="status"><CheckCircle2 size={16} aria-hidden="true" /><span>{success}</span></div>}
    <dl className="mitre-sync-metrics">
      <div className="mitre-sync-last"><Clock3 size={18} aria-hidden="true" /><dt>Last Sync</dt><dd>{loading ? 'Loading...' : formatDate(summary.lastSyncAt)}</dd></div>
      <Metric label="Total" value={summary.total} testId="mitre-sync-total" />
      <Metric label="Created" value={summary.created} testId="mitre-sync-created" />
      <Metric label="Updated" value={summary.updated} testId="mitre-sync-updated" />
      <Metric label="Failed" value={summary.failed} testId="mitre-sync-failed" danger={summary.failed > 0} />
    </dl>
  </Card>;
}

function Metric({ label, value, testId, danger = false }: { readonly label: string; readonly value: number; readonly testId: string; readonly danger?: boolean }) {
  return <div className={danger ? 'is-danger' : undefined}><Database size={18} aria-hidden="true" /><dt>{label}</dt><dd data-testid={testId}>{value.toLocaleString('id-ID')}</dd></div>;
}

function formatDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not available';
}
