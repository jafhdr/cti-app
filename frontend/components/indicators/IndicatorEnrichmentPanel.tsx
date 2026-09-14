'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

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
type AttributionEvidence = { readonly kind: string; readonly value: string; readonly weight: number };
type AttributionCandidate = { readonly id: string; readonly name: string; readonly confidence?: number };
type AttributionResult = {
  readonly status: 'MATCH' | 'NO_MATCH' | 'AMBIGUOUS';
  readonly confidence: number;
  readonly candidate?: AttributionCandidate;
  readonly candidates?: readonly AttributionCandidate[];
  readonly matchedEvidence: readonly AttributionEvidence[];
};

export function IndicatorEnrichmentPanel({ indicator, canManage, onClose }: {
  readonly indicator: IndicatorSummary;
  readonly canManage: boolean;
  readonly onClose: () => void;
}) {
  const [items, setItems] = useState<readonly Enrichment[]>([]);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [attributing, setAttributing] = useState(false);
  const [attribution, setAttribution] = useState<AttributionResult | null>(null);
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
      const response = await fetch(`${API}/indicators/${indicator.id}/enrich`, { method: 'POST', credentials: 'include' });
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

  async function attribute(): Promise<void> {
    setAttributing(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${API}/indicators/${indicator.id}/attribute-threat-actor`, { method: 'POST', credentials: 'include' });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(messageFrom(data, 'Attribution gagal dijalankan.'));
      if (!isAttributionResult(data)) throw new Error('Respons attribution tidak valid.');
      setAttribution(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Attribution gagal dijalankan.');
    } finally {
      setAttributing(false);
    }
  }

  return <Card view="outlined" className="source-panel indicator-enrichment-panel" role="region" aria-labelledby="indicator-enrichment-title">
    <div className="source-panel-heading">
      <div><span className="source-eyebrow">INDICATOR CONTEXT</span><h2 id="indicator-enrichment-title">{indicator.value}</h2><span className="indicator-enrichment-type">{indicator.type}</span></div>
      <div className="ioc-actions">{canManage && <><Button view="action" disabled={enriching} onClick={() => void enrich()}>{enriching ? 'Enriching...' : 'Enrich'}</Button><Button view="outlined" disabled={attributing} onClick={() => void attribute()}>{attributing ? 'Attributing...' : 'Run attribution'}</Button></>}<Button view="flat" onClick={onClose}>Close</Button></div>
    </div>
    {error && <div className="error" role="alert">{error}</div>}
    {notice && <div className="success" role="status">{notice}</div>}
    {attribution && <section className={`indicator-enrichment-entry attribution-result ${attributionClass(attribution.status)}`} aria-label="Threat actor attribution result" role="status" aria-live="polite">
      <header><strong>Threat Actor Attribution</strong><span className={`cti-status attribution-status ${attributionClass(attribution.status)}`}>{attribution.status}</span><span>{attribution.confidence}% confidence</span></header>
      <div className="attribution-result-body">
        {attribution.candidate && <p><strong>{attribution.candidate.name}</strong></p>}
        {attribution.status === 'AMBIGUOUS' && <p>{attribution.candidates?.map(candidate => `${candidate.name} (${candidate.confidence ?? 0}%)`).join(', ')}</p>}
        {attribution.status === 'NO_MATCH' && <p>No sufficiently strong, unique candidate was found. No relation was created.</p>}
        {attribution.matchedEvidence.length > 0 && <ul>{attribution.matchedEvidence.map(evidence => <li key={`${evidence.kind}-${evidence.value}`}>{evidence.kind}: {evidence.value} (+{evidence.weight})</li>)}</ul>}
      </div>
    </section>}
    {loading ? <div className="source-state" aria-live="polite">Loading enrichment history...</div> : items.length === 0 ? <div className="source-state"><strong>No enrichment yet</strong><span>{canManage ? 'Run enrichment to collect provider context.' : 'An administrator has not enriched this indicator yet.'}</span></div> : <div className="indicator-enrichment-history">{items.map(item => <article key={item.id} className={`indicator-enrichment-entry is-${item.status.toLowerCase()}`}>
      <header><strong>{item.provider}</strong><span className={`cti-status ${item.status === 'SUCCESS' ? 'is-active' : 'is-inactive'}`}>{item.status}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('id-ID')}</time></header>
      {item.error ? <p className="indicator-enrichment-error">{item.error}</p> : <pre>{JSON.stringify(item.data, null, 2)}</pre>}
    </article>)}</div>}
  </Card>;
}

function messageFrom(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null || !('message' in value)) return fallback;
  return typeof value.message === 'string' ? value.message : fallback;
}

function isEnrichment(value: unknown): value is Enrichment {
  return typeof value === 'object' && value !== null && 'status' in value && (value.status === 'SUCCESS' || value.status === 'FAILED');
}

function isAttributionResult(value: unknown): value is AttributionResult {
  return typeof value === 'object' && value !== null && 'status' in value && 'confidence' in value && 'matchedEvidence' in value
    && (value.status === 'MATCH' || value.status === 'NO_MATCH' || value.status === 'AMBIGUOUS')
    && typeof value.confidence === 'number' && Array.isArray(value.matchedEvidence);
}

function attributionClass(status: AttributionResult['status']): string {
  switch (status) {
    case 'MATCH': return 'is-match';
    case 'NO_MATCH': return 'is-no-match';
    case 'AMBIGUOUS': return 'is-ambiguous';
    default: return assertNever(status);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported attribution status: ${value}`);
}
