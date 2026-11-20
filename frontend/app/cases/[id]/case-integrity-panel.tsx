'use client';

import { useCallback, useEffect, useState } from 'react';
import { caseWorkspaceUrl, useCaseTenant } from '../case-access';
import { CaseEvidenceHistory, type CaseEvidenceItem } from './case-evidence-history';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Review = { readonly id: string; readonly cycle: number; readonly reviewerId: string; readonly reviewer: { readonly name: string }; readonly status: 'REQUESTED' | 'APPROVED' | 'REJECTED'; readonly decision: { readonly reason: string; readonly decidedAt: string } | null; readonly createdAt: string };
type Closure = { readonly id: string; readonly cycle: number; readonly reason: string; readonly investigationSummary: string; readonly closedAt: string };
type Reopen = { readonly id: string; readonly fromCycle: number; readonly toCycle: number; readonly reason: string; readonly reopenedAt: string };
type Integrity = { readonly status: string; readonly revision: number; readonly cycle: number; readonly canManage: boolean; readonly currentUserId: string; readonly reviewerGrant: boolean;
  readonly reviewerCandidates: readonly { readonly id: string; readonly name: string }[];
  readonly checklist: { readonly resolved: boolean; readonly evidence: boolean; readonly tasksComplete: boolean; readonly approved: boolean; readonly unchanged: boolean };
  readonly reviews: readonly Review[]; readonly closures: readonly Closure[]; readonly reopens: readonly Reopen[] };

export function CaseIntegrityPanel({ caseId, caseStatus, onCaseChange, onAvailability }: { readonly caseId: string; readonly caseStatus: string; readonly onCaseChange: () => void; readonly onAvailability: (enabled: boolean) => void }) {
  const { role, tenantId, ready } = useCaseTenant();
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [evidence, setEvidence] = useState<readonly CaseEvidenceItem[]>([]);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [decisionReason, setDecisionReason] = useState('');
  const [closureReason, setClosureReason] = useState('');
  const [summary, setSummary] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const url = useCallback((suffix: string) => caseWorkspaceUrl(`${API}/cases/${caseId}${suffix}`, role, tenantId), [caseId, role, tenantId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(url('/integrity'), { credentials: 'include', signal });
      if (response.status === 403) { setHidden(true); onAvailability(false); return; }
      if (!response.ok) throw new Error('Review dan closure gagal dimuat');
      const data: Integrity = await response.json();
      const evidenceResponse = await fetch(url('/evidence'), { credentials: 'include', signal });
      if (!evidenceResponse.ok) throw new Error('Evidence gagal dimuat');
      const items: readonly CaseEvidenceItem[] = await evidenceResponse.json();
      if (!signal?.aborted) { setIntegrity(data); setEvidence(items); setHidden(false); onAvailability(true); }
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Review dan closure gagal dimuat'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [url, onAvailability]);

  useEffect(() => { if (!ready) return; const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [ready, load, caseStatus]);
  useEffect(() => { const refresh = () => { void load(); }; window.addEventListener('case-activity-updated', refresh); return () => window.removeEventListener('case-activity-updated', refresh); }, [load]);

  async function mutate(suffix: string, payload: Record<string, unknown>): Promise<boolean> {
    if (!integrity || busy) return false;
    setBusy(true); setError('');
    try {
      const response = await fetch(url(suffix), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, expectedRevision: integrity.revision }) });
      if (!response.ok) {
        const problem: { message?: string | readonly string[] } = await response.json();
        const message = typeof problem.message === 'string' ? problem.message : problem.message?.join(', ') ?? 'Perubahan gagal';
        throw new Error(response.status === 409 ? 'Case berubah atau prasyarat belum terpenuhi. Data terbaru telah dimuat.' : message);
      }
      await load(); onCaseChange(); window.dispatchEvent(new Event('case-activity-updated'));
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Perubahan gagal'); await load(); return false; }
    finally { setBusy(false); }
  }

  if (hidden) return null;
  const currentReview = integrity?.reviews.find(item => item.cycle === integrity.cycle);
  const canDecide = Boolean(currentReview?.status === 'REQUESTED' && currentReview.reviewerId === integrity?.currentUserId && integrity?.reviewerGrant && integrity?.canManage);
  const checklist = integrity?.checklist;
  const canClose = Boolean(checklist && Object.values(checklist).every(Boolean));
  const history = integrity ? [
    ...integrity.closures.map(item => ({ kind: 'closure' as const, at: item.closedAt, item })),
    ...integrity.reopens.map(item => ({ kind: 'reopen' as const, at: item.reopenedAt, item })),
  ].sort((left, right) => right.at.localeCompare(left.at)) : [];
  return <section id="integrity" aria-labelledby="integrity-heading" className="case-panel mt-8 scroll-mt-4 p-8">
    <span className="source-eyebrow">EVIDENCE &amp; DECISION RECORD</span><h2 id="integrity-heading" className="case-detail-section-title">Review and closure</h2>
    {loading && !integrity ? <p role="status" className="mt-4">Loading review history…</p> : null}
    {error ? <p role="alert" className="error my-4 rounded p-3">{error}</p> : null}
    {integrity ? <div className="mt-6 space-y-6">
      <p className="text-sm text-muted-foreground">Cycle {integrity.cycle} · {integrity.status.replaceAll('_', ' ')} · Case revision {integrity.revision}</p>
      <CaseEvidenceHistory caseId={caseId} evidence={evidence} canManage={integrity.canManage} currentUserId={integrity.currentUserId} busy={busy} readOnly={integrity.status === 'CLOSED'} revise={(id, form) => mutate(`/evidence/${id}/revisions`, form)} />
      <div className="case-subpanel p-5"><h3 className="font-semibold">Independent review</h3>
        {integrity.reviews.length ? <ol className="mt-3 space-y-2 text-sm">{integrity.reviews.map(item => <li key={item.id} className="rounded border p-3"><strong>Cycle {item.cycle} · {item.status}</strong> · {item.reviewer.name}<p className="text-muted-foreground">Requested {new Date(item.createdAt).toLocaleString('id-ID')}{item.decision ? ` · Decided ${new Date(item.decision.decidedAt).toLocaleString('id-ID')}` : ''}</p>{item.decision ? <p>Reason: {item.decision.reason}</p> : null}</li>)}</ol> : <p className="mt-2 text-sm text-muted-foreground">No review requested.</p>}
        {integrity.canManage && integrity.status === 'RESOLVED' && currentReview?.status !== 'REQUESTED' ? <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void mutate('/reviews', { reviewerId, reason: requestReason }).then(ok => { if (ok) { setReviewerId(''); setRequestReason(''); } }); }}><label className="text-sm">Independent reviewer<select aria-label="Independent reviewer" className="mt-1 block rounded border p-2" required value={reviewerId} onChange={event => setReviewerId(event.target.value)}><option value="">Choose reviewer</option>{integrity.reviewerCandidates.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="text-sm">Request context<input aria-label="Review request context" className="mt-1 block rounded border p-2" maxLength={2000} value={requestReason} onChange={event => setRequestReason(event.target.value)} /></label><button className="soc-button-outline" disabled={busy}>Request review</button></form> : null}
        {canDecide ? <div className="mt-4 flex flex-wrap items-end gap-2"><label className="text-sm">Decision reason<input aria-label="Review decision reason" className="mt-1 block rounded border p-2" required maxLength={2000} value={decisionReason} onChange={event => setDecisionReason(event.target.value)} /></label><button type="button" className="soc-button-outline" disabled={busy || !decisionReason.trim()} onClick={() => void mutate(`/reviews/${currentReview?.id}/decision`, { kind: 'APPROVED', reason: decisionReason }).then(ok => { if (ok) setDecisionReason(''); })}>Approve review</button><button type="button" className="soc-button-outline" disabled={busy || !decisionReason.trim()} onClick={() => void mutate(`/reviews/${currentReview?.id}/decision`, { kind: 'REJECTED', reason: decisionReason }).then(ok => { if (ok) setDecisionReason(''); })}>Reject review</button></div> : null}
      </div>
      <div className="case-subpanel p-5"><h3 className="font-semibold">Closure checklist</h3>{integrity.status === 'CLOSED' ? <p className="mt-3 text-sm text-muted-foreground">Approved closure recorded for cycle {integrity.cycle}. Reopen to begin a new investigation cycle.</p> : <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{checklist ? Object.entries({ 'Case resolved': checklist.resolved, 'Evidence recorded': checklist.evidence, 'Tasks complete': checklist.tasksComplete, 'Independent approval': checklist.approved, 'Investigation unchanged': checklist.unchanged }).map(([label, ready]) => <li key={label}>{ready ? '✓' : '○'} {label}</li>) : null}</ul>}
        {integrity.canManage && integrity.status === 'RESOLVED' ? <form className="mt-4 grid gap-2" onSubmit={event => { event.preventDefault(); void mutate('/closure', { reason: closureReason, investigationSummary: summary }).then(ok => { if (ok) { setClosureReason(''); setSummary(''); } }); }}><label className="text-sm">Closure reason<input aria-label="Closure reason" className="mt-1 block w-full rounded border p-2" required maxLength={2000} value={closureReason} onChange={event => setClosureReason(event.target.value)} /></label><label className="text-sm">Final investigation summary<textarea aria-label="Final investigation summary" className="mt-1 block min-h-24 w-full rounded border p-2" required maxLength={10000} value={summary} onChange={event => setSummary(event.target.value)} /></label><button className="soc-button-outline justify-self-start" disabled={busy || !canClose}>Close case</button></form> : null}
        {integrity.canManage && integrity.status === 'CLOSED' ? <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void mutate('/reopen', { reason: reopenReason }).then(ok => { if (ok) setReopenReason(''); }); }}><label className="text-sm">Reopen reason<input aria-label="Reopen reason" className="mt-1 block rounded border p-2" required maxLength={2000} value={reopenReason} onChange={event => setReopenReason(event.target.value)} /></label><button className="soc-button-outline" disabled={busy}>Reopen case</button></form> : null}
      </div>
      <div className="case-subpanel p-5"><h3 className="font-semibold">Closure and reopening history</h3>{history.length ? <ul className="mt-3 space-y-2 text-sm">{history.map(entry => entry.kind === 'closure' ? <li key={entry.item.id} className="rounded border p-3"><strong>Closed · cycle {entry.item.cycle}</strong> · {new Date(entry.item.closedAt).toLocaleString('id-ID')}<p>{entry.item.reason}</p><p className="text-muted-foreground">{entry.item.investigationSummary}</p></li> : <li key={entry.item.id} className="rounded border p-3"><strong>Reopened · cycle {entry.item.fromCycle} → {entry.item.toCycle}</strong> · {new Date(entry.item.reopenedAt).toLocaleString('id-ID')}<p>{entry.item.reason}</p></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No closure history.</p>}</div>
    </div> : null}
  </section>;
}
