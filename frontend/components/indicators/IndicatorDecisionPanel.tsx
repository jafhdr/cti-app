'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type DecisionKind = 'FALSE_POSITIVE' | 'SAFELIST' | 'CLEAR';
type Decision = { readonly id: string; readonly kind: DecisionKind; readonly reason: string; readonly createdAt: string; readonly actor: { readonly name: string } };
type Detail = { readonly id: string; readonly status: string; readonly expiresAt: string | null; readonly suppressionKind: 'FALSE_POSITIVE' | 'SAFELIST' | null; readonly eligibility: { readonly eligible: boolean; readonly reason: string | null }; readonly decisions: readonly Decision[] };

export function IndicatorDecisionPanel({ indicatorId, canManage, onChanged }: { readonly indicatorId: string; readonly canManage: boolean; readonly onChanged: () => Promise<void> }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [kind, setKind] = useState<DecisionKind>('FALSE_POSITIVE');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDetail(null); setError(''); setMessage('');
    fetch(`${API}/indicators/${encodeURIComponent(indicatorId)}`, { credentials: 'include', cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Indicator detail could not be loaded.');
        const value: Detail = await response.json();
        if (!cancelled) setDetail(value);
      })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Indicator detail could not be loaded.'); });
    return () => { cancelled = true; };
  }, [indicatorId]);

  async function submit() {
    if (pending || !detail) return;
    if (reason.trim().length < 5) { setError('Enter a reason of at least five characters.'); return; }
    if (!window.confirm(kind === 'CLEAR' ? 'Clear this analyst suppression?' : `Mark this indicator as ${kind.replace('_', ' ').toLowerCase()}?`)) return;
    setPending(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${API}/indicators/${encodeURIComponent(indicatorId)}/decision`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, reason: reason.trim() }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(typeof value.message === 'string' ? value.message : 'Decision could not be saved.');
      setDetail(value); setReason(''); setMessage('Analyst decision recorded.');
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Decision could not be saved.'); }
    finally { setPending(false); }
  }

  return <section className="ioc-decision-panel" aria-label="Indicator lifecycle decision">
    <h3>Operational eligibility</h3>
    {!detail && !error && <p role="status">Loading lifecycle state…</p>}
    {detail && <>
      <p><strong>{detail.eligibility.eligible ? 'Eligible for active use' : `Not eligible: ${detail.eligibility.reason?.replace('_', ' ')}`}</strong></p>
      <p>Lifecycle: {detail.status} · Expires: {detail.expiresAt ? new Date(detail.expiresAt).toLocaleString() : 'No expiry'} · Analyst decision: {detail.suppressionKind?.replace('_', ' ') ?? 'None'}</p>
      {canManage && <div className="ioc-decision-form">
        <label>Decision<select value={kind} onChange={event => setKind(event.target.value as DecisionKind)}><option value="FALSE_POSITIVE">False positive</option><option value="SAFELIST">Safelist</option><option value="CLEAR" disabled={!detail.suppressionKind}>Clear decision</option></select></label>
        <label>Reason<textarea value={reason} onChange={event => setReason(event.target.value)} minLength={5} maxLength={500} required /></label>
        <Button view="action" onClick={submit} disabled={pending || (kind === 'CLEAR' && !detail.suppressionKind)}>{pending ? 'Saving…' : 'Record decision'}</Button>
      </div>}
      <h4>Decision history</h4>
      {detail.decisions.length ? <ol>{detail.decisions.map(item => <li key={item.id}><strong>{item.kind.replace('_', ' ')}</strong> · {item.actor.name} · {new Date(item.createdAt).toLocaleString()}<p>{item.reason}</p></li>)}</ol> : <p>No analyst decisions recorded.</p>}
    </>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
