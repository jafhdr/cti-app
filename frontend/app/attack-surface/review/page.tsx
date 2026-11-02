'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import Link from 'next/link';
import { AttackSurfaceShell, useAttackSurface } from '@/components/attack-surface/AttackSurfaceShell';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const queueResponseSchema = z.object({ items: z.array(z.object({ id: z.string(), assetId: z.string(), asset: z.object({ name: z.string() }), vulnerability: z.object({ cveId: z.string(), severity: z.string() }), service: z.object({ product: z.string().nullable(), version: z.string().nullable() }), confidence: z.string(), status: z.string(), reviewStatus: z.string().nullable(), revision: z.number() })), total: z.number() });
type QueueItem = z.infer<typeof queueResponseSchema>['items'][number];

function ReviewQueue() {
  const { role, tenantId, ready } = useAttackSurface();
  const tenantQuery = role === 'SUPER_ADMIN' ? `tenantId=${encodeURIComponent(tenantId)}` : '';
  const [items, setItems] = useState<readonly QueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [review, setReview] = useState('PENDING');
  const [status, setStatus] = useState('');
  const [confidence, setConfidence] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('review');
    if (requested && ['PENDING', 'ACCEPTED', 'REJECTED', 'REVIEW_REQUIRED'].includes(requested)) setReview(requested);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setItems([]); setError(''); setLoading(true);
    const params = new URLSearchParams(tenantQuery);
    params.set('page', String(page));
    if (review) params.set('review', review);
    if (status) params.set('status', status);
    if (confidence) params.set('confidence', confidence);
    void fetch(`${API}/attack-surface/v2/correlation-queue?${params}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(response.status === 403 ? 'Review queue access denied.' : 'Could not load review queue.'); return queueResponseSchema.parse(await response.json()); })
      .then(result => { if (!controller.signal.aborted) { setItems(result.items); setTotal(result.total); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load review queue.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [tenantQuery, ready, page, review, status, confidence]);
  return <main className="asm-intelligence-section"><div className="asm-section-heading"><span className="source-eyebrow">ATTACK SURFACE MANAGEMENT</span><h1>Correlation review queue</h1></div>
    <p>Machine matches awaiting asset-specific analyst review. Acceptance does not confirm exploitation.</p>
    {process.env.NEXT_PUBLIC_ASM_V2_REVIEW_ENABLED !== 'true' ? <p>Analyst review is unavailable.</p> : <>
      <div className="asm-review-filters"><label>Review state <select value={review} onChange={event => { setReview(event.target.value); setPage(1); }}><option value="PENDING">Pending</option><option value="REVIEW_REQUIRED">Review required</option><option value="ACCEPTED">Accepted</option><option value="REJECTED">Rejected</option><option value="">All states</option></select></label>
      <label>Observation <select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All observations</option><option value="ACTIVE">Active</option><option value="STALE">Stale</option></select></label>
      <label>Machine confidence <select value={confidence} onChange={event => { setConfidence(event.target.value); setPage(1); }}><option value="">All confidence levels</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select></label></div>
      {error && <p role="alert" className="error">{error}</p>}{loading ? <p role="status">Loading review queue...</p> : items.length === 0 ? <p>No correlations in this queue.</p> : <div className="asm-port-scroll"><table className="asm-review-table"><thead><tr><th>Asset</th><th>CVE</th><th>Fingerprint</th><th>Machine confidence</th><th>Observation</th><th>Review</th><th>Revision</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><Link href={`/attack-surface/assets?${tenantQuery ? `${tenantQuery}&` : ""}assetId=${encodeURIComponent(item.assetId)}&correlationId=${encodeURIComponent(item.id)}#asm-vulnerabilities`}>{item.asset.name}</Link></td><td>{item.vulnerability.cveId} · {item.vulnerability.severity}</td><td>{item.service.product || 'Unknown'} {item.service.version || ''}</td><td>{item.confidence}</td><td>{item.status}</td><td>{item.reviewStatus || 'PENDING'}</td><td>{item.revision}</td></tr>)}</tbody></table></div>}
      <p>{total} correlations · page {page}</p><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button> <button type="button" disabled={page * 25 >= total} onClick={() => setPage(value => value + 1)}>Next</button>
      <p><Link href="/attack-surface/assets">Open assets to inspect evidence and decide</Link></p>
    </>}
  </main>;
}

export default function AttackSurfaceReviewPage() { return <AttackSurfaceShell><ReviewQueue /></AttackSurfaceShell>; }
