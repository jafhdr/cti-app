'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useThreatIntelligenceTenant } from '../ThreatIntelligenceShell';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Match = { readonly id: string; readonly alertId: string; readonly domain: string; readonly title: string; readonly tlp: string };
type Decision = { readonly id: string; readonly kind: string; readonly reason: string; readonly createdAt: string; readonly actor: { readonly name: string } };
type Receipt = { readonly id: string; readonly adapter: string; readonly action: string; readonly result: string; readonly attempt: number; readonly targetDigest: string; readonly createdAt: string; readonly evidence: { readonly sandboxOnly?: boolean } };
type Step = { readonly id: string; readonly ordinal: number; readonly actionKind: string; readonly status: string; readonly attemptCount: number; readonly failureCode: string | null; readonly receipts: readonly Receipt[] };
type SandboxEvent = { readonly id: string; readonly kind: string; readonly createdAt: string; readonly evidence: { readonly code?: string; readonly blocked?: boolean; readonly reason?: string; readonly ordinal?: number } };
type SandboxJob = { readonly id: string; readonly operation: string; readonly status: string; readonly attempts: number; readonly failureCode: string | null; readonly events: readonly SandboxEvent[] };
type Run = { readonly id: string; readonly status: string; readonly domain: string; readonly tlp: string; readonly createdAt: string; readonly alertId: string; readonly caseId: string | null; readonly definition: { readonly title: string; readonly version: number }; readonly alert: { readonly title: string; readonly status: string }; readonly steps: readonly Step[]; readonly decisions: readonly Decision[]; readonly sandboxJobs: readonly SandboxJob[] };

export function PlaybookWorkspace({ role }: { readonly role: Role }) {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const [runs, setRuns] = useState<readonly Run[]>([]);
  const [matches, setMatches] = useState<readonly Match[]>([]);
  const [selected, setSelected] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [simulationEnabled, setSimulationEnabled] = useState(false);
  const [connectorEnabled, setConnectorEnabled] = useState(false);
  const pendingKey = useRef<string | null>(null);
  const recoveryKeys = useRef<Record<string, string>>({});
  const query = role === 'SUPER_ADMIN' ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  const canAct = role !== 'USER';

  const load = useCallback(async () => {
    if (role === 'SUPER_ADMIN' && (!ready || !tenantId)) return;
    setLoading(true);
    try {
      const [runResponse, matchResponse, capabilityResponse] = await Promise.all([
        fetch(`${API}/playbooks/runs${query}`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${API}/playbooks/eligible-alerts${query}`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${API}/playbooks/capabilities${query}`, { credentials: 'include', cache: 'no-store' }),
      ]);
      if (!runResponse.ok || !matchResponse.ok) throw new Error('Could not load playbook runs or eligible alerts. Check module access and schema.');
      setRuns(await runResponse.json());
      setMatches(await matchResponse.json());
      const capabilities = capabilityResponse.ok ? await capabilityResponse.json() : {};
      setSimulationEnabled(Boolean(capabilities.simulationEnabled));
      setConnectorEnabled(Boolean(capabilities.connectorEnabled));
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load playbooks.'); }
    finally { setLoading(false); }
  }, [query, ready, role, tenantId]);
  useEffect(() => { void load(); }, [load]);

  async function submit(path: string, body?: object): Promise<boolean> {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${API}${path}${query}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) { const result: { readonly message?: string } = await response.json(); throw new Error(result.message || 'Playbook action failed.'); }
      setNotice('Playbook state recorded.'); await load(); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Playbook action failed.'); return false; }
    finally { setBusy(false); }
  }

  async function trigger(): Promise<void> {
    if (!selected) return;
    pendingKey.current ??= crypto.randomUUID();
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${API}/playbooks/runs${query}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alertId: selected, idempotencyKey: pendingKey.current }) });
      if (!response.ok) { const result: { readonly message?: string } = await response.json(); throw new Error(result.message || 'Could not create playbook run.'); }
      pendingKey.current = null; setNotice('Playbook trigger recorded. Confirm the target before approval.'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create playbook run.'); }
    finally { setBusy(false); }
  }

  function decide(run: Run, kind: 'CONFIRM' | 'APPROVE' | 'REJECT'): void {
    const reason = reasons[run.id] ?? '';
    if (reason.trim().length < 10) { setError('Enter a reason of at least 10 characters.'); return; }
    if (kind === 'APPROVE' && !window.confirm(`Approve sandbox simulation for ${run.domain}? A different analyst must approve.`)) return;
    void submit(`/playbooks/runs/${run.id}/decisions`, { kind, reason: reason.trim() }).then(succeeded => {
      if (succeeded) setReasons(current => ({ ...current, [run.id]: '' }));
    });
  }

  async function recoverRollback(run: Run): Promise<void> {
    const reason = (reasons[run.id] ?? '').trim();
    if (reason.length < 10) { setError('Enter a recovery reason of at least 10 characters.'); return; }
    if (!window.confirm(`Retry sandbox restoration for ${run.domain}? Previous failure remains in the audit history.`)) return;
    recoveryKeys.current[run.id] ??= crypto.randomUUID();
    const succeeded = await submit(`/playbooks/runs/${run.id}/sandbox/recover-rollback`, { reason, idempotencyKey: recoveryKeys.current[run.id] });
    if (succeeded) delete recoveryKeys.current[run.id];
  }

  return <div className="ti-phase2b playbook-workspace">
    <div className="source-heading"><div><span className="source-eyebrow">PHASE 3B · SANDBOX RESPONSE</span><h1>Response playbooks</h1><p>Review correlation evidence and approve a synthetic target. The isolated sandbox connector records and verifies simulated tool state; no production mitigation is sent.</p><p role="status">Sandbox connector: {connectorEnabled ? 'Enabled in isolated QA' : 'Disabled in this environment'}</p></div></div>
    {canAct && <Card view="outlined" className="feed-card playbook-trigger"><span className="source-eyebrow">01 / TRIGGER</span><h2>Start from a correlation alert</h2><p>Only active, matched domain indicators are eligible. A linked case can be reviewed in the run detail.</p><div className="playbook-controls"><label>Correlation alert<select value={selected} onChange={event => { setSelected(event.target.value); pendingKey.current = null; }}><option value="">Select an eligible alert</option>{matches.map(match => <option key={match.id} value={match.alertId}>{match.domain} · {match.title}</option>)}</select></label><Button view="action" type="button" disabled={busy || !selected || (role === 'SUPER_ADMIN' && !tenantId)} onClick={() => void trigger()}>Create playbook run</Button></div></Card>}
    {loading && <Card view="outlined" className="source-state" role="status">Loading playbook history...</Card>}
    {error && <Card view="outlined" className="source-state error playbook-feedback" role="alert">{error}</Card>}
    {notice && <Card view="outlined" className="source-state playbook-feedback" role="status">{notice}</Card>}
    <div className="editorial-section-heading"><span className="source-eyebrow">02 / RESPONSE HISTORY</span><h2>Playbook runs</h2><Button view="outlined" disabled={loading} onClick={() => void load()}>Refresh status</Button></div>
    {!loading && runs.length === 0 && <Card view="outlined" className="source-state">No playbook runs are visible for this tenant.</Card>}
    <div className="playbook-runs">{runs.map(run => <Card view="outlined" className="feed-card playbook-run" key={run.id}>
      <header><div><span className="source-eyebrow">{run.definition.title} · v{run.definition.version}</span><h2>{run.domain}</h2><p>{run.alert.title}</p></div><strong className="playbook-status">{run.status.replaceAll('_', ' ')}</strong></header>
      <dl className="playbook-facts"><div><dt>Alert</dt><dd>{run.alertId} · {run.alert.status}</dd></div><div><dt>Case</dt><dd>{run.caseId ? <Link href={`/cases/${run.caseId}`}>Open linked case</Link> : 'No case linked'}</dd></div><div><dt>Classification</dt><dd>{run.tlp}</dd></div><div><dt>Triggered</dt><dd>{format(run.createdAt)}</dd></div></dl>
      <div className="playbook-steps"><h3>Execution step</h3>{run.steps.map(step => <article key={step.id}><strong>{step.ordinal}. Simulated domain block · {step.status.replaceAll('_', ' ')}</strong><p>Attempts {step.attemptCount}/2 {step.failureCode ? `· ${step.failureCode}` : ''}</p>{step.receipts.map(receipt => <div className="playbook-receipt" key={receipt.id}><span className="source-eyebrow">IMMUTABLE ACTION RECEIPT</span><p>{receipt.result} · {receipt.adapter} · attempt {receipt.attempt} · {format(receipt.createdAt)}</p><small>Target SHA-256: {receipt.targetDigest}</small><p>{receipt.evidence.sandboxOnly ? (receipt.adapter === 'SIGNED_LOOPBACK_SANDBOX' ? 'Sandbox tool state verified; no production block was made.' : 'Sandbox only; no external block was made.') : 'Receipt requires investigation.'}</p></div>)}</article>)}</div>
      {run.sandboxJobs.length > 0 && <section className="playbook-history" aria-label="Sandbox connector history"><h3>Sandbox connector</h3>{run.sandboxJobs.map(job => <article className="playbook-receipt" key={job.id}><strong>{job.operation.replaceAll('_', ' ')} · {job.status.replaceAll('_', ' ')}</strong><p>Attempts {job.attempts}/3{job.failureCode ? ` · ${job.failureCode}` : ''}</p><ol>{job.events.map(event => <li key={event.id}>{event.kind.replaceAll('_', ' ')} · {format(event.createdAt)}{event.evidence.blocked !== undefined ? ` · blocked: ${event.evidence.blocked ? 'yes' : 'no'}` : ''}{event.evidence.code ? ` · ${event.evidence.code}` : ''}{event.evidence.reason && <span> · Recovery {event.evidence.ordinal}: {event.evidence.reason}</span>}</li>)}</ol></article>)}</section>}
      {canAct && ['PENDING_CONFIRMATION', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'VERIFYING', 'FAILED', 'VERIFIED', 'ROLLBACK_FAILED'].includes(run.status) && <div className="playbook-decision">{['PENDING_CONFIRMATION', 'PENDING_APPROVAL', 'ROLLBACK_FAILED'].includes(run.status) && <label>{run.status === 'ROLLBACK_FAILED' ? 'Recovery reason' : 'Decision reason'}<input value={reasons[run.id] ?? ''} onChange={event => setReasons(current => ({ ...current, [run.id]: event.target.value }))} minLength={10} maxLength={1000} placeholder={run.status === 'ROLLBACK_FAILED' ? 'Describe outage, checks, and recovery basis' : 'Describe the evidence and approval basis'} /></label>}<div className="playbook-actions">{run.status === 'PENDING_CONFIRMATION' && <Button view="action" disabled={busy} onClick={() => decide(run, 'CONFIRM')}>Confirm target</Button>}{run.status === 'PENDING_APPROVAL' && <Button view="action" disabled={busy} onClick={() => decide(run, 'APPROVE')}>Approve simulation</Button>}{['PENDING_CONFIRMATION', 'PENDING_APPROVAL'].includes(run.status) && <Button view="outlined" disabled={busy} onClick={() => decide(run, 'REJECT')}>Reject</Button>}{run.status === 'APPROVED' && run.domain.endsWith('.test') && <Button view="action" disabled={busy || !connectorEnabled} onClick={() => void submit(`/playbooks/runs/${run.id}/sandbox/execute`)}>Queue sandbox block</Button>}{run.status === 'APPROVED' && !run.domain.endsWith('.test') && <Button view="action" disabled={busy || !simulationEnabled} onClick={() => void submit(`/playbooks/runs/${run.id}/execute`)}>Execute sandbox simulation</Button>}{run.status === 'VERIFYING' && <Button view="action" disabled={busy || !simulationEnabled} onClick={() => void submit(`/playbooks/runs/${run.id}/verify`)}>Verify receipt</Button>}{run.status === 'VERIFIED' && run.sandboxJobs.some(job => job.operation === 'BLOCK_DOMAIN' && job.status === 'SUCCEEDED') && <Button view="outlined" disabled={busy || !connectorEnabled} onClick={() => { if (window.confirm(`Rollback synthetic block for ${run.domain}?`)) void submit(`/playbooks/runs/${run.id}/sandbox/rollback`); }}>Queue safe rollback</Button>}{run.status === 'ROLLBACK_FAILED' && run.sandboxJobs.flatMap(job => job.events).filter(event => event.kind === 'RECOVERY_QUEUED').length < 2 && <Button view="action" disabled={busy || !connectorEnabled} onClick={() => void recoverRollback(run)}>Retry sandbox restoration</Button>}{run.status === 'ROLLBACK_FAILED' && run.sandboxJobs.flatMap(job => job.events).filter(event => event.kind === 'RECOVERY_QUEUED').length >= 2 && <p role="status">Recovery limit reached; investigate the sandbox tool state manually.</p>}{run.status === 'EXECUTING' && <Button view="outlined" disabled={busy || !connectorEnabled} onClick={() => void submit(`/playbooks/runs/${run.id}/sandbox/abort`)}>Abort queued action</Button>}{run.status === 'FAILED' && run.steps.some(step => step.attemptCount < 2) && !run.domain.endsWith('.test') && <Button view="outlined" disabled={busy || !simulationEnabled} onClick={() => void submit(`/playbooks/runs/${run.id}/retry`)}>Retry simulation</Button>}</div></div>}
      <div className="playbook-history"><h3>Decision history</h3>{run.decisions.length === 0 ? <p>Awaiting analyst confirmation.</p> : <ol>{run.decisions.map(decision => <li key={decision.id}><strong>{decision.kind}</strong> · {decision.actor.name} · {format(decision.createdAt)}<p>{decision.reason}</p></li>)}</ol>}</div>
    </Card>)}</div>
  </div>;
}

function format(value: string): string { return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' }); }
