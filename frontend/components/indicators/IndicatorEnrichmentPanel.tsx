'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ThreatActorDiscoveryPanel } from './ThreatActorDiscoveryPanel';
import { RelatedCases } from './RelatedCases';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type IndicatorSummary = { readonly id: string; readonly value: string; readonly type: string };
type Enrichment = {
  readonly id: string;
  readonly provider: string;
  readonly data: unknown;
  readonly status: 'SUCCESS' | 'FAILED';
  readonly error: string | null;
  readonly createdAt: string;
};

export function IndicatorEnrichmentPanel({ indicator, canManage, canAccessCases, onClose }: {
  readonly indicator: IndicatorSummary;
  readonly canManage: boolean;
  readonly canAccessCases: boolean;
  readonly onClose: () => void;
}) {
  const [items, setItems] = useState<readonly Enrichment[]>([]);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load(): Promise<void> {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/indicators/${indicator.id}/enrichments`, { credentials: 'include', cache: 'no-store' });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(messageFrom(data, 'Gagal memuat enrichment.'));
      setItems(Array.isArray(data) ? data : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal memuat enrichment.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [indicator.id]);

  async function enrich(): Promise<void> {
    setEnriching(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${API}/indicators/${indicator.id}/enrich`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'VIRUSTOTAL' }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(messageFrom(data, 'Enrichment gagal dijalankan.'));
      const result = isEnrichment(data) ? data : null;
      setNotice(result?.status === 'SUCCESS' ? 'Enrichment berhasil disimpan.' : 'Provider gagal; detail kegagalan telah disimpan.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enrichment gagal dijalankan.');
    } finally {
      setEnriching(false);
    }
  }

  return <Card view="outlined" className="source-panel indicator-enrichment-panel" role="region" aria-labelledby="indicator-enrichment-title">
    <div className="source-panel-heading">
      <div><span className="source-eyebrow">INDICATOR CONTEXT</span><h2 id="indicator-enrichment-title">{indicator.value}</h2><span className="indicator-enrichment-type">{indicator.type}</span></div>
      <div className="ioc-actions">{canManage && <Button view="action" disabled={enriching} onClick={() => void enrich()}>{enriching ? 'Enriching...' : 'Enrich with VirusTotal'}</Button>}<Button view="flat" onClick={onClose}>Close</Button></div>
    </div>
    {error && <div className="error" role="alert">{error}</div>}
    {notice && <div className="success" role="status">{notice}</div>}
    {canManage && <ThreatActorDiscoveryPanel indicatorId={indicator.id} />}
    {canAccessCases && <RelatedCases indicatorId={indicator.id} canMutate={canManage} />}
    {loading ? <div className="source-state" aria-live="polite">Loading enrichment history...</div> : items.length === 0 ? <div className="source-state"><strong>No enrichment yet</strong><span>{canManage ? 'Run enrichment to collect provider context.' : 'An administrator has not enriched this indicator yet.'}</span></div> : <div className="indicator-enrichment-history">{items.map(item => <article key={item.id} className={`indicator-enrichment-entry is-${item.status.toLowerCase()}`}>
      <header><strong>{item.provider}</strong><span className={`cti-status ${item.status === 'SUCCESS' ? 'is-active' : 'is-inactive'}`}>{item.status}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('id-ID')}</time></header>
      {item.error ? <p className="indicator-enrichment-error">{item.error}</p> : item.provider === 'VIRUSTOTAL' ? <VirusTotalSummary data={item.data} /> : <pre>{JSON.stringify(item.data, null, 2)}</pre>}
    </article>)}</div>}
  </Card>;
}

function VirusTotalSummary({ data }: { readonly data: unknown }) {
  const detections = field(data, 'detections');
  const malicious = numberValue(field(detections, 'malicious'));
  const suspicious = numberValue(field(detections, 'suspicious'));
  const total = numberValue(field(detections, 'total'));
  const reputation = numberValue(field(data, 'reputation'));
  const rawAnalysisAt = field(data, 'analysisAt');
  const analysisAt = typeof rawAnalysisAt === 'string' ? rawAnalysisAt : null;
  return <dl className="indicator-enrichment-summary">
    <div><dt>Detections</dt><dd>{malicious + suspicious} / {total}</dd></div>
    <div><dt>Reputation</dt><dd>{reputation}</dd></div>
    {analysisAt && <div><dt>Last analysis</dt><dd><time dateTime={analysisAt}>{new Date(analysisAt).toLocaleString('id-ID')}</time></dd></div>}
  </dl>;
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function messageFrom(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null || !('message' in value)) return fallback;
  return typeof value.message === 'string' ? value.message : fallback;
}

function isEnrichment(value: unknown): value is Enrichment {
  return typeof value === 'object' && value !== null && 'status' in value && (value.status === 'SUCCESS' || value.status === 'FAILED');
}
