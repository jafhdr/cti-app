'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAppSec } from './AppSecShell';
import { appsecUrl, errorMessage, findingSeverities, type Finding } from './types';

type Person = { readonly id: string; readonly name: string };
type ActionEvent = { readonly id: string; readonly kind: string; readonly actorId: string; readonly actorName: string; readonly cycle?: number; readonly reason: string | null; readonly after?: { readonly note?: unknown; readonly reference?: unknown } | null; readonly createdAt: string };
type Action = 'activate' | 'validate' | 'priority' | 'assign';
const rollout = process.env.NEXT_PUBLIC_APPSEC_V2_TRIAGE_ENABLED === 'true';

export function FindingTriage({ finding, onChanged }: { readonly finding: Finding; readonly onChanged: (finding: Finding) => void }) {
  const { role, tenantId, canManage } = useAppSec();
  const [people, setPeople] = useState<readonly Person[]>([]);
  const [events, setEvents] = useState<readonly ActionEvent[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [decision, setDecision] = useState<'VALID' | 'REJECTED'>('VALID');
  const [priority, setPriority] = useState<Finding['priority']>('MEDIUM');
  const [assigneeId, setAssigneeId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyError, setHistoryError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setPeople([]); setEvents([]); setHistoryTotal(0); setAssigneeId(finding.assigneeId ?? ''); setPriority(finding.priority ?? 'MEDIUM'); setReason(''); setError(''); setHistoryError('');
    if (finding.workflowVersion === 2) {
      void fetch(appsecUrl(`/appsec/findings/${finding.id}/lifecycle/events`, role, tenantId), { credentials: 'include', cache: 'no-store' })
        .then(async response => {
          if (!response.ok) throw new Error('History unavailable.');
          const body: { readonly items: readonly ActionEvent[]; readonly total: number } = await response.json();
          if (!cancelled) { setEvents(body.items); setHistoryTotal(body.total); }
        }).catch((cause: unknown) => { if (!cancelled) setHistoryError(cause instanceof Error ? cause.message : 'History unavailable.'); });
    }
    if (canManage && rollout) {
      void fetch(appsecUrl('/appsec/findings/assignees', role, tenantId), { credentials: 'include', cache: 'no-store' })
        .then(async response => {
          if (!response.ok) throw new Error('Assignees unavailable.');
          const body: readonly Person[] = await response.json();
          if (!cancelled) setPeople(body);
        }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Assignees unavailable.'); });
    }
    return () => { cancelled = true; };
  }, [finding.id, finding.workflowVersion, finding.revision, finding.assigneeId, finding.priority, role, tenantId, canManage]);

  async function loadMore(): Promise<void> {
    setHistoryBusy(true); setHistoryError('');
    const params = new URLSearchParams({ page: String(Math.floor(events.length / 25) + 1), limit: '25' });
    try {
      const response = await fetch(appsecUrl(`/appsec/findings/${finding.id}/lifecycle/events`, role, tenantId, params), { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('History unavailable.');
      const body: { readonly items: readonly ActionEvent[]; readonly total: number } = await response.json();
      setEvents(current => [...current, ...body.items.filter(item => !current.some(existing => existing.id === item.id))]);
      setHistoryTotal(body.total);
    } catch (cause) { setHistoryError(cause instanceof Error ? cause.message : 'History unavailable.'); }
    finally { setHistoryBusy(false); }
  }

  async function act(action: Action): Promise<void> {
    const trimmed = reason.trim();
    if (action !== 'assign' && !trimmed) { setError('A reason is required.'); return; }
    if (action === 'assign' && finding.assigneeId && !trimmed) { setError('A reassignment reason is required.'); return; }
    setBusy(true); setError('');
    const payload = action === 'activate' ? { reason: trimmed }
      : action === 'validate' ? { decision, rationale: trimmed }
      : action === 'priority' ? { priority, rationale: trimmed }
      : { assigneeId: assigneeId || null, reason: trimmed || undefined };
    try {
      const response = await fetch(appsecUrl(`/appsec/findings/${finding.id}/lifecycle/${action}`, role, tenantId), {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, expectedRevision: finding.revision, requestKey: crypto.randomUUID() }),
      });
      const body: { readonly finding?: Finding; readonly message?: string | readonly string[] } = await response.json();
      if (!response.ok || !body.finding) throw new Error(response.status === 409 ? 'Finding changed. Refresh and try again.' : errorMessage(body, 'Action failed.', response.status));
      const assigneeName = body.finding.assigneeId
        ? body.finding.assigneeId === finding.assigneeId
          ? finding.assigneeName ?? null
          : people.find(person => person.id === body.finding?.assigneeId)?.name ?? null
        : null;
      onChanged({ ...body.finding, application: finding.application, assigneeName });
      setReason('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed.'); }
    finally { setBusy(false); }
  }

  const isV2 = finding.workflowVersion === 2;
  const canTriage = canManage && rollout;
  const evidence = events.filter(event => event.kind === 'EVIDENCE_SUBMITTED');
  return <section className="appsec-card appsec-triage" aria-label="Finding triage">
    <div className="appsec-section-head"><div><span className="source-eyebrow">APPSEC / TRIAGE</span><h2>{isV2 ? 'Validation, priority and owner' : 'Legacy finding'}</h2></div></div>
    {!isV2 && <p>This finding predates V2. Independent validation has not been recorded.</p>}
    {isV2 && <dl className="appsec-remediation"><div><dt>Validation</dt><dd>{finding.validationState ?? 'Pending'}</dd></div><div><dt>Priority</dt><dd>{finding.priority ?? 'Not set'}</dd></div><div><dt>Assignee</dt><dd>{finding.assigneeId ? finding.assigneeName ?? people.find(person => person.id === finding.assigneeId)?.name ?? 'Assignee unavailable' : 'Unassigned'}</dd></div></dl>}
    {canTriage && (finding.status === 'OPEN' || finding.status === 'IN_PROGRESS') && <div className="appsec-triage-controls">
      {!isV2 && <Button disabled={busy} onClick={() => void act('activate')}>Activate V2 triage</Button>}
      {isV2 && (finding.status === 'OPEN' || finding.status === 'IN_PROGRESS') && finding.validationState !== 'VALID' && <><label>Validation<select value={decision} onChange={event => setDecision(event.target.value === 'REJECTED' ? 'REJECTED' : 'VALID')}><option value="VALID">Valid</option><option value="REJECTED">Rejected</option></select></label><Button disabled={busy} onClick={() => void act('validate')}>Record validation</Button></>}
      {isV2 && finding.validationState === 'VALID' && <><label>Priority<select value={priority ?? 'MEDIUM'} onChange={event => setPriority(findingSeverities.find(value => value === event.target.value) ?? 'MEDIUM')}>{findingSeverities.map(value => <option key={value}>{value}</option>)}</select></label><Button disabled={busy} onClick={() => void act('priority')}>Set priority</Button></>}
      {isV2 && finding.validationState === 'VALID' && finding.priority && <><label>Assignee<select value={assigneeId} onChange={event => setAssigneeId(event.target.value)}><option value="">Unassigned</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><Button disabled={busy || (assigneeId || null) === finding.assigneeId} onClick={() => void act('assign')}>Save assignment</Button></>}
      <label className="appsec-triage-reason">Reason<textarea aria-label="Triage reason" maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label>
    </div>}
    {error && <p role="alert">{error} <button type="button" onClick={() => window.location.reload()}>Refresh</button></p>}
    {isV2 && <div className="appsec-triage-history"><h3>Action history</h3>{historyError ? <p role="alert">{historyError}</p> : events.length ? <ol>{events.map(event => <li key={event.id}><strong>{event.kind.replaceAll('_', ' ')}</strong> · {new Date(event.createdAt).toLocaleString()} · By {event.actorName || 'Actor unavailable'}{event.cycle ? ` · Cycle ${event.cycle}` : ''}{event.reason ? <p>{event.reason}</p> : null}</li>)}</ol> : <p>No actions recorded.</p>}{events.length < historyTotal && <Button view="outlined" disabled={historyBusy} onClick={() => void loadMore()}>{historyBusy ? 'Loading...' : 'Load more history'}</Button>}</div>}
    {isV2 && <div className="appsec-triage-history appsec-evidence-history"><h3>Evidence timeline</h3>{evidence.length ? <ol>{evidence.map(event => {
      const note = typeof event.after?.note === 'string' ? event.after.note : event.reason;
      const reference = typeof event.after?.reference === 'string' && event.after.reference.startsWith('https://') ? event.after.reference : null;
      return <li key={event.id}><strong>{event.actorName || 'Actor unavailable'}</strong> · {new Date(event.createdAt).toLocaleString()}{note && <p>{note}</p>}{reference && <a href={reference} target="_blank" rel="noopener noreferrer">Evidence reference</a>}</li>;
    })}</ol> : <p>No remediation evidence recorded.</p>}{events.length < historyTotal && <p>Load more action history to view older evidence.</p>}</div>}
  </section>;
}
