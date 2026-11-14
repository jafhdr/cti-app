'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import type { Asset } from './types';
import { CorrelationReview } from './CorrelationReview';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const correlationSchema = z.object({
  id: z.string(), workflowVersion: z.number(), confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  status: z.enum(['ACTIVE', 'STALE']), reviewStatus: z.string().nullable(), matchReason: z.string(), lastSeenAt: z.string(),
  service: z.object({ port: z.number(), protocol: z.string(), service: z.string().nullable(), product: z.string().nullable(), version: z.string().nullable(), source: z.string().nullable() }),
  vulnerability: z.object({ cveId: z.string(), name: z.string(), severity: z.string(), cvssScore: z.number().nullable(), source: z.string().nullable() }),
});
type Correlation = z.infer<typeof correlationSchema>;
const enrollmentSchema = z.object({ rolloutEnabled: z.boolean(), enrolled: z.boolean(), active: z.boolean() });
type Enrollment = z.infer<typeof enrollmentSchema>;
const historySchema = z.object({ items: z.array(z.object({ id: z.string(), kind: z.string(), observedAt: z.string(), confidence: z.string().nullable(), matchReason: z.string().nullable(), matcherVersion: z.string(), fingerprintSource: z.string().nullable() })), total: z.number() });
type History = z.infer<typeof historySchema>;

export function Vulnerabilities({ asset, tenantQuery, canManage, refresh }: { readonly asset: Asset; readonly tenantQuery: string; readonly canManage: boolean; readonly refresh: number }) {
  const [items, setItems] = useState<readonly Correlation[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [selected, setSelected] = useState('');
  const [reviewId, setReviewId] = useState('');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const historyRequest = useRef(0);
  const scopeRef = useRef('');
  const query = tenantQuery ? `?${tenantQuery}` : '';
  const legacyUrl = `${API}/attack-surface/assets/${asset.id}/vulnerability-correlations`;
  const v2Url = `${API}/attack-surface/v2/assets/${asset.id}/correlations`;
  const scope = `${asset.id}:${tenantQuery}`;
  scopeRef.current = scope;
  const load = useCallback(async (signal?: AbortSignal) => {
    historyRequest.current += 1;
    setLoading(true); setError(''); setItems([]); setHistory(null); setSelected(''); setReviewId('');
    try {
      const [legacyResponse, enrollmentResponse] = await Promise.all([
        fetch(`${legacyUrl}${query}`, { credentials: 'include', cache: 'no-store', signal }),
        fetch(`${API}/attack-surface/v2/enrollment${query}`, { credentials: 'include', cache: 'no-store', signal }),
      ]);
      if (!legacyResponse.ok) throw new Error('Could not load vulnerability correlations.');
      const legacy = z.array(correlationSchema).parse(await legacyResponse.json());
      const state: Enrollment | null = enrollmentResponse.ok ? enrollmentSchema.parse(await enrollmentResponse.json()) : null;
      if (signal?.aborted) return;
      setItems(legacy); setEnrollment(state);
      const linkedId = new URLSearchParams(window.location.search).get('correlationId');
      if (linkedId && legacy.some(item => item.id === linkedId && item.workflowVersion === 2)) setReviewId(linkedId);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Could not load vulnerability correlations.');
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [legacyUrl, query]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, refresh]);

  async function action(url: string, body?: object) {
    setRunning(true); setError('');
    try {
      const response = await fetch(url, { method: 'POST', credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      if (!response.ok) throw new Error('Correlation action failed.');
      await load();
      window.dispatchEvent(new CustomEvent('asm-v2-review-changed', { detail: { assetId: asset.id } }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Correlation action failed.'); }
    finally { setRunning(false); }
  }

  async function refreshItems() {
    const response = await fetch(`${legacyUrl}${query}`, { credentials: 'include', cache: 'no-store' });
    if (response.ok) {
      const result = z.array(correlationSchema).parse(await response.json());
      if (scopeRef.current === scope) setItems(result);
    }
  }

  async function showHistory(id: string) {
    const request = ++historyRequest.current;
    if (selected === id) { setSelected(''); setHistory(null); return; }
    setSelected(id); setHistory(null); setError('');
    try {
      const response = await fetch(`${v2Url}/${id}/observations${query}`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load evidence history.');
      const result: History = historySchema.parse(await response.json());
      if (historyRequest.current === request) setHistory(result);
    } catch (cause) { if (historyRequest.current === request) setError(cause instanceof Error ? cause.message : 'Could not load evidence history.'); }
  }

  return <section className="asm-intelligence-section" aria-label="Vulnerabilities">
    <div className="asm-section-heading"><span className="source-eyebrow">VULNERABILITY CORRELATION</span><h3>Vulnerabilities</h3></div>
    <p className="asm-discovery-context">A service fingerprint suggests asset relevance; it does not confirm exploitation or compromise.</p>
    {enrollment?.rolloutEnabled && canManage && !enrollment.enrolled && <Button type="button" view="outlined" size="s" disabled={running} onClick={() => void action(`${API}/attack-surface/v2/enrollment${query}`, { enabled: true })}>Enable V2 evidence for this tenant</Button>}
    {canManage && <Button type="button" view="outlined" size="s" disabled={running} onClick={() => void action(`${legacyUrl}/refresh${query}`)}>{running ? 'Working...' : 'Refresh correlations'}</Button>}
    {error && <p className="error" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
    {loading ? <p role="status">Loading vulnerability correlations...</p> : items.length === 0 ? <p>No vulnerability correlations recorded.</p> : <div className="asm-port-scroll"><table className="asm-vulnerability-table"><thead><tr><th>Vulnerability</th><th>Service</th><th>Product / version</th><th>Severity / CVSS</th><th>Machine confidence</th><th>Observation / review</th><th>Evidence</th></tr></thead><tbody>{items.map(item => <tr key={item.id}>
      <td>{item.vulnerability.cveId}<br />{item.vulnerability.name}</td><td>{item.service.service || 'Service'} · {item.service.protocol} {item.service.port}</td><td>{item.service.product || 'Unknown'} / {item.service.version || 'Unknown'}</td><td>{item.vulnerability.severity} / {item.vulnerability.cvssScore ?? '–'}</td>
      <td>{item.confidence === 'HIGH' ? 'High-confidence candidate' : `${item.confidence.toLowerCase()}-confidence candidate`}</td>
      <td>{item.status === 'STALE' ? 'Stale observation' : 'Active observation'} · {item.workflowVersion === 2 ? item.reviewStatus || 'PENDING' : 'Legacy V1'}<br />Last seen {new Date(item.lastSeenAt).toLocaleString('id-ID')}</td>
      <td>{item.matchReason}<br />Source: {item.service.source || 'Unknown'} / {item.vulnerability.source || 'Catalog'}{item.workflowVersion === 2 ? <><br /><button type="button" onClick={() => void showHistory(item.id)}>{selected === item.id ? 'Hide evidence history' : 'Evidence history'}</button>{process.env.NEXT_PUBLIC_ASM_V2_REVIEW_ENABLED === 'true' && <><br /><button type="button" onClick={() => setReviewId(reviewId === item.id ? '' : item.id)}>{reviewId === item.id ? 'Hide analyst review' : 'Analyst review'}</button></>}</> : enrollment?.active && canManage ? <><br /><button type="button" disabled={running} onClick={() => void action(`${v2Url}/${item.id}/activate${query}`)}>Activate legacy correlation</button></> : null}</td>
    </tr>)}</tbody></table></div>}
    {selected && <div className="asm-discovery-context" aria-live="polite"><h4>Evidence history</h4>{history ? history.items.length ? <ol>{history.items.map(event => <li key={event.id}>{new Date(event.observedAt).toLocaleString('id-ID')} · {event.kind} · {event.confidence || 'uncertain'} · {event.matchReason || 'No rationale'} · {event.matcherVersion} · {event.fingerprintSource || 'Source unknown'}</li>)}</ol> : <p>No evidence events recorded.</p> : <p role="status">Loading evidence history...</p>}</div>}
    {reviewId && <CorrelationReview key={`${asset.id}:${reviewId}:${tenantQuery}`} assetId={asset.id} correlationId={reviewId} tenantQuery={tenantQuery} onChanged={() => { void refreshItems(); window.dispatchEvent(new CustomEvent('asm-v2-review-changed', { detail: { assetId: asset.id } })); }} />}
  </section>;
}
