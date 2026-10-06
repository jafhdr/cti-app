'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ThreatActorDiscoveryPanel } from './ThreatActorDiscoveryPanel';
import { RelatedCases } from './RelatedCases';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type IndicatorSummary = { readonly id: string; readonly value: string; readonly type: string; readonly severity?: string; readonly confidence?: number; readonly source?: string | null; readonly sourceObservations?: readonly { readonly id: string; readonly sourceName: string; readonly provider: string | null; readonly firstSeenAt: string; readonly lastSeenAt: string }[]; readonly status?: string; readonly description?: string | null; readonly tags?: readonly string[]; readonly expiresAt?: string | null };
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
  const virusTotalAvailable = indicator.type !== 'EMAIL';

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
      <div><span className="source-eyebrow">INDICATOR INTELLIGENCE</span><h2 id="indicator-enrichment-title">{indicator.value}</h2><div className="ti-indicator-badges"><span>{indicator.type.replaceAll('_', ' ')}</span>{indicator.severity && <span>{indicator.severity} risk</span>}{indicator.confidence !== undefined && <span>{indicator.confidence}% confidence</span>}{indicator.status && <span>{indicator.status}</span>}</div></div>
      <div className="ioc-actions">{canManage && virusTotalAvailable && <Button view="action" disabled={enriching} onClick={() => void enrich()}>{enriching ? 'Enriching...' : 'Enrich with VirusTotal'}</Button>}<Button view="flat" onClick={onClose}>Close</Button></div>
    </div>
    {error && <div className="error" role="alert">{error}</div>}
    {notice && <div className="success" role="status">{notice}</div>}
    <section className="ti-detail-section"><span className="source-eyebrow">OVERVIEW</span><h3>Indicator metadata</h3><dl className="ti-indicator-meta"><div><dt>Source</dt><dd>{indicator.source || 'Not provided'}</dd></div><div><dt>Description</dt><dd>{indicator.description || 'No description'}</dd></div><div><dt>Tags</dt><dd>{indicator.tags?.join(', ') || 'None'}</dd></div><div><dt>Expires</dt><dd>{indicator.expiresAt ? new Date(indicator.expiresAt).toLocaleDateString('id-ID') : 'Not set'}</dd></div></dl></section>
    {!!indicator.sourceObservations?.length && <section className="ti-detail-section"><span className="source-eyebrow">PROVENANCE</span><h3>Observed sources</h3><ul className="space-y-2">{indicator.sourceObservations.map(observation => <li key={observation.id} className="rounded-md border border-input p-3 text-sm"><strong>{observation.sourceName}</strong><span className="ml-2 text-muted-foreground">{observation.provider ?? 'Unknown provider'}</span><div className="text-xs text-muted-foreground">First seen <time dateTime={observation.firstSeenAt}>{new Date(observation.firstSeenAt).toLocaleString('id-ID')}</time> · Last seen <time dateTime={observation.lastSeenAt}>{new Date(observation.lastSeenAt).toLocaleString('id-ID')}</time></div></li>)}</ul></section>}
    <section className="ti-detail-section"><span className="source-eyebrow">ENRICHMENT</span><h3>Provider results</h3>
    {!virusTotalAvailable && <div className="source-state"><strong>VirusTotal not available</strong><span>This provider does not support email indicators.</span></div>}
    {loading ? <div className="source-state" aria-live="polite">Loading enrichment history...</div> : items.length === 0 ? <div className="source-state"><strong>No enrichment yet</strong><span>{canManage && virusTotalAvailable ? 'Run enrichment to collect provider context.' : 'No provider result is available for this indicator.'}</span></div> : <div className="indicator-enrichment-history">{items.map(item => <article key={item.id} className={`indicator-enrichment-entry is-${item.status.toLowerCase()}`}>
      <header><strong>{item.provider}</strong><span className={`cti-status ${item.status === 'SUCCESS' ? 'is-active' : 'is-inactive'}`}>{item.status}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('id-ID')}</time></header>
      {item.error ? <p className="indicator-enrichment-error">{item.error}</p> : item.provider === 'VIRUSTOTAL' ? <VirusTotalSummary data={item.data} /> : <pre>{JSON.stringify(item.data, null, 2)}</pre>}
    </article>)}</div>}</section>
    <section className="ti-detail-section"><span className="source-eyebrow">THREAT CONTEXT</span><h3>Related intelligence</h3>{canManage && <ThreatActorDiscoveryPanel indicatorId={indicator.id} />}{canAccessCases && <RelatedCases indicatorId={indicator.id} canMutate={canManage} />}{!canManage && !canAccessCases && <p>No related intelligence available.</p>}</section>
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
