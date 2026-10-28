'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmationModal, FormModal } from '@/components/ui/modal-patterns';
import { useAppSec } from './AppSecShell';
import { appsecUrl, errorMessage, isTerminalFinding, type Finding } from './types';

type Event = {
  readonly id: string; readonly kind: string; readonly actorId: string; readonly actorName: string;
  readonly cycle: number; readonly reason: string | null; readonly createdAt: string;
  readonly after?: { readonly evidenceEventId?: unknown; readonly note?: unknown; readonly reference?: unknown } | null;
};
type Action = 'verify' | 'accept-risk' | 'false-positive' | 'reopen';
type TerminalAction = Exclude<Action, 'verify'>;
const rollout = process.env.NEXT_PUBLIC_APPSEC_V2_VERIFICATION_ENABLED === 'true';

export function FindingVerification({ finding, onChanged }: { readonly finding: Finding; readonly onChanged: (finding: Finding) => void }) {
  const { role, tenantId, userId, canReviewFinding } = useAppSec();
  const [events, setEvents] = useState<readonly Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [reviewDueAt, setReviewDueAt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [terminalAction, setTerminalAction] = useState<TerminalAction | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents([]); setHistoryError('');
    if (finding.workflowVersion !== 2) return;
    setLoading(true);
    async function load(): Promise<void> {
      try {
        const found: Event[] = [];
        for (let page = 1; page <= 20; page += 1) {
          const response = await fetch(appsecUrl(`/appsec/findings/${finding.id}/lifecycle/events`, role, tenantId, new URLSearchParams({ page: String(page), limit: '100' })), { credentials: 'include', cache: 'no-store' });
          if (!response.ok) throw new Error('Verification history unavailable.');
          const body: { readonly items: readonly Event[]; readonly total: number } = await response.json();
          found.push(...body.items);
          if (found.length >= body.total) break;
        }
        if (!cancelled) setEvents(found);
      } catch (cause) { if (!cancelled) setHistoryError(cause instanceof Error ? cause.message : 'Verification history unavailable.'); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [finding.id, finding.revision, finding.workflowVersion, role, tenantId]);

  const current = events.filter(event => event.cycle === finding.lifecycleCycle);
  const request = current.find(event => event.kind === 'VERIFICATION_REQUESTED');
  const evidenceId = request?.after?.evidenceEventId;
  const evidence = current.find(event => event.id === evidenceId && event.kind === 'EVIDENCE_SUBMITTED');
  const latestEvidence = current.find(event => event.kind === 'EVIDENCE_SUBMITTED');
  const canReview = rollout && canReviewFinding;
  const canVerify = canReview && finding.status === 'IN_PROGRESS' && finding.verificationState === 'REQUESTED'
    && !!request && !!evidence && evidence.id === latestEvidence?.id && request.actorId !== userId && evidence.actorId !== userId;
  const canDecideTerminal = canReview && role !== 'USER' && finding.workflowVersion === 2
    && (finding.status === 'OPEN' || finding.status === 'IN_PROGRESS') && finding.verificationState !== 'REQUESTED'
    && latestEvidence?.actorId !== userId && request?.actorId !== userId;
  const canReopen = canReview && role !== 'USER' && isTerminalFinding(finding.status);

  async function act(action: Action, payload: object): Promise<void> {
    setBusy(true); setError('');
    try {
      const response = await fetch(appsecUrl(`/appsec/findings/${finding.id}/lifecycle/${action}`, role, tenantId), {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, expectedRevision: finding.revision, requestKey: crypto.randomUUID() }),
      });
      const body: { readonly finding?: Finding; readonly message?: string | readonly string[] } = await response.json();
      if (!response.ok || !body.finding) throw new Error(response.status === 409 ? 'Finding changed. Refresh and try again.' : errorMessage(body, 'Decision failed.', response.status));
      onChanged({ ...body.finding, application: finding.application, assigneeName: body.finding.assigneeId === finding.assigneeId ? finding.assigneeName : null });
      setApproveOpen(false); setTerminalAction(null); setNote(''); setReason(''); setReference(''); setReviewDueAt('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Decision failed.'); }
    finally { setBusy(false); }
  }

  function submitTerminal(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!terminalAction || !reason.trim()) { setError('A decision reason is required.'); return; }
    const payload = terminalAction === 'accept-risk' ? { reason: reason.trim(), reviewDueAt }
      : terminalAction === 'false-positive' ? { reason: reason.trim(), ...(reference.trim() ? { reference: reference.trim() } : {}) }
        : { reason: reason.trim() };
    void act(terminalAction, payload);
  }

  return <section className="appsec-card appsec-verification" aria-label="Finding verification">
    <div className="appsec-section-head"><div><span className="source-eyebrow">APPSEC / VERIFICATION</span><h2>Independent verification and closure</h2></div></div>
    <dl className="appsec-remediation"><div><dt>Verification</dt><dd>{finding.workflowVersion === 1 ? 'Legacy — not recorded' : finding.verificationState ?? 'NONE'}</dd></div><div><dt>Lifecycle cycle</dt><dd>{finding.lifecycleCycle}</dd></div><div><dt>Finding revision</dt><dd>{finding.revision}</dd></div></dl>
    {finding.verificationState === 'REQUESTED' && <p>Waiting for an independent reviewer. Evidence and assignment are locked while this request is pending.</p>}
    {finding.verificationState === 'REJECTED' && <p>Verification rejected. The assignee must submit fresh evidence before requesting another review.</p>}
    {finding.verificationState === 'APPROVED' && <p>Independently verified and resolved. Resolution: {finding.resolution ?? 'Unavailable'}.</p>}
    {finding.status === 'ACCEPTED_RISK' && <p>Risk accepted. Reason: {finding.resolution ?? 'Unavailable'}.</p>}
    {finding.status === 'FALSE_POSITIVE' && <p>False positive approved. Reason: {finding.resolution ?? 'Unavailable'}.</p>}
    {loading && <p role="status">Loading verification context...</p>}
    {historyError && <p role="alert">{historyError}</p>}
    {finding.verificationState === 'REQUESTED' && request && <div className="appsec-review-context"><h3>Evidence under review</h3><p>Requested by {request.actorName} on {new Date(request.createdAt).toLocaleString()}.</p><p>{request.reason}</p>{evidence ? <><p>Submitted by {evidence.actorName} on {new Date(evidence.createdAt).toLocaleString()}.</p><p>{typeof evidence.after?.note === 'string' ? evidence.after.note : evidence.reason}</p></> : <p>Referenced evidence is unavailable in the loaded history. Reviewer actions are hidden.</p>}</div>}
    {canVerify && <div className="appsec-review-form"><label>Reviewer decision note<textarea aria-label="Reviewer decision note" maxLength={4000} value={note} onChange={event => setNote(event.target.value)} /></label><div><Button disabled={busy || !note.trim()} onClick={() => setApproveOpen(true)}>Approve verification</Button><Button view="outlined" disabled={busy || !note.trim()} onClick={() => void act('verify', { decision: 'REJECT', note: note.trim() })}>Reject verification</Button></div></div>}
    {canDecideTerminal && <div className="appsec-review-actions"><Button view="outlined" onClick={() => setTerminalAction('accept-risk')}>Accept risk</Button><Button view="outlined" onClick={() => setTerminalAction('false-positive')}>Approve false positive</Button></div>}
    {canReopen && <Button view="outlined" onClick={() => setTerminalAction('reopen')}>Reopen Finding</Button>}
    {error && <p role="alert">{error} <button type="button" onClick={() => window.location.reload()}>Refresh</button></p>}
    <ConfirmationModal open={approveOpen} onOpenChange={setApproveOpen} title="Approve independent verification?" description="This resolves the Finding and preserves the evidence and decision history." confirmLabel="Approve and resolve" loading={busy} error={error} onConfirm={() => act('verify', { decision: 'APPROVE', note: note.trim() })} />
    <FormModal open={terminalAction !== null} onOpenChange={open => { if (!open) setTerminalAction(null); }} title={terminalAction === 'accept-risk' ? 'Accept Finding risk' : terminalAction === 'false-positive' ? 'Approve false positive' : 'Reopen Finding'} description={terminalAction === 'reopen' ? 'A new lifecycle cycle starts. Earlier decisions remain in history.' : 'Record an explicit, auditable decision.'} submitLabel={terminalAction === 'reopen' ? 'Reopen' : 'Record decision'} loading={busy} error={error} submitDisabled={!reason.trim() || (terminalAction === 'accept-risk' && !reviewDueAt)} onSubmit={submitTerminal}>
      <label>Decision reason<textarea aria-label="Decision reason" maxLength={4000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      {terminalAction === 'accept-risk' && <label>Review due date<input aria-label="Review due date" type="date" value={reviewDueAt} onChange={event => setReviewDueAt(event.target.value)} /></label>}
      {terminalAction === 'false-positive' && <label>Supporting reference (optional HTTPS URL)<input aria-label="Supporting reference" type="url" maxLength={2048} value={reference} onChange={event => setReference(event.target.value)} /></label>}
    </FormModal>
  </section>;
}
