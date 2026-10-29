'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const visible = process.env.NEXT_PUBLIC_ASM_V2_REVIEW_ENABLED === 'true';

const decisionKindSchema = z.enum(['ACCEPT', 'REJECT', 'REQUEST_REVIEW']);
const decisionSchema = z.object({ id: z.string(), kind: z.string(), reason: z.string(), createdAt: z.string(), resultingRevision: z.number(), actor: z.object({ name: z.string(), role: z.string() }) });
const reviewStateSchema = z.object({ id: z.string(), reviewStatus: z.string().nullable(), status: z.string(), confidence: z.string(), revision: z.number(), evidenceHash: z.string().nullable(), matchReason: z.string() });
type Decision = z.infer<typeof decisionSchema>;
type ReviewState = z.infer<typeof reviewStateSchema>;

export function CorrelationReview({ assetId, correlationId, tenantQuery, onChanged }: {
  readonly assetId: string; readonly correlationId: string; readonly tenantQuery: string; readonly onChanged: () => void;
}) {
  const [current, setCurrent] = useState<ReviewState | null>(null);
  const [history, setHistory] = useState<readonly Decision[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [allowed, setAllowed] = useState(false);
  const [kind, setKind] = useState<z.infer<typeof decisionKindSchema>>('ACCEPT');
  const [reason, setReason] = useState('');
  const [inspected, setInspected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const query = tenantQuery ? `?${tenantQuery}` : '';
  const base = `${API}/attack-surface/v2/assets/${assetId}/correlations/${correlationId}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(''); setCurrent(null); setHistory([]);
    try {
      const [detail, decisions, availability] = await Promise.all([
        fetch(`${base}${query}`, { credentials: 'include', cache: 'no-store', signal }),
        fetch(`${base}/decisions${query ? `${query}&` : '?'}page=${historyPage}`, { credentials: 'include', cache: 'no-store', signal }),
        fetch(`${API}/attack-surface/v2/review-availability${query}`, { credentials: 'include', cache: 'no-store', signal }),
      ]);
      if (!detail.ok || !decisions.ok || !availability.ok) throw new Error('Could not load analyst review.');
      const row: ReviewState = reviewStateSchema.parse(await detail.json());
      const events = z.object({ items: z.array(decisionSchema), total: z.number() }).parse(await decisions.json());
      const policy = z.object({ canReview: z.boolean() }).parse(await availability.json());
      if (signal?.aborted) return;
      setCurrent(row); setHistory(events.items); setHistoryTotal(events.total); setAllowed(visible && policy.canReview);
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Could not load analyst review.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [base, query, historyPage]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  async function submit() {
    if (!current?.evidenceHash) return;
    if (!window.confirm(`Confirm ${kind.replace('_', ' ').toLowerCase()} for this asset and evidence revision?`)) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`${base}/decisions${query}`, { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, reason: reason.trim(), inspectedEvidence: inspected,
          expectedRevision: current.revision, evidenceHash: current.evidenceHash, requestKey: crypto.randomUUID() }) });
      if (response.status === 409) throw new Error('Evidence or revision changed. Reload the review before deciding.');
      if (!response.ok) throw new Error('Review decision was not saved.');
      setReason(''); setInspected(false); setHistoryPage(1); await load(); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review decision was not saved.'); }
    finally { setSaving(false); }
  }

  return <section className="asm-intelligence-section" aria-label="Analyst correlation review">
    <div className="asm-section-heading"><span className="source-eyebrow">ASSET-SPECIFIC REVIEW</span><h4>Analyst review</h4></div>
    {error && <p role="alert" className="error">{error} <button type="button" onClick={() => void load()}>Reload review</button></p>}
    {loading ? <p role="status">Loading analyst review...</p> : current && <>
      <p>Machine confidence: {current.confidence} · Observation: {current.status} · Analyst review: {current.reviewStatus || 'PENDING'}</p>
      <p>Evidence: {current.matchReason}</p><p className="asm-review-hash">Revision {current.revision} · Hash <code>{current.evidenceHash}</code></p>
      {!allowed ? <p>Review actions are unavailable for this account or rollout.</p> : current.status !== 'ACTIVE' ? <p>Stale observations cannot be accepted as current relevance.</p> : <div className="asm-review-actions">
        <label>Decision <select value={kind} onChange={event => { const parsed = decisionKindSchema.safeParse(event.target.value); if (parsed.success) setKind(parsed.data); }} disabled={saving}><option value="ACCEPT">Accept relevance</option><option value="REJECT">Reject false match</option><option value="REQUEST_REVIEW">Request review</option></select></label>
        <label>Reason <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} disabled={saving} /></label>
        {kind === 'ACCEPT' && <label><input type="checkbox" checked={inspected} onChange={event => setInspected(event.target.checked)} disabled={saving} /> I inspected this evidence revision</label>}
        <Button type="button" size="s" disabled={saving || !reason.trim() || (kind === 'ACCEPT' && !inspected)} onClick={() => void submit()}>{saving ? 'Saving...' : 'Confirm decision'}</Button>
      </div>}
      <h5>Decision history</h5>{history.length ? <ol>{history.map(item => <li key={item.id}>{new Date(item.createdAt).toLocaleString('id-ID')} · {item.actor.name} ({item.actor.role}) · {item.kind} · revision {item.resultingRevision} · {item.reason}</li>)}</ol> : <p>No analyst decisions recorded.</p>}
      {historyTotal > 25 && <p>Page {historyPage} of {Math.ceil(historyTotal / 25)} · <button type="button" disabled={historyPage === 1} onClick={() => setHistoryPage(page => page - 1)}>Previous decisions</button> <button type="button" disabled={historyPage * 25 >= historyTotal} onClick={() => setHistoryPage(page => page + 1)}>Next decisions</button></p>}
    </>}
  </section>;
}
