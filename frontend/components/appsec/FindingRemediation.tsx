'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAppSec } from './AppSecShell';
import { appsecUrl, errorMessage, type Finding } from './types';

type RemediationAction = 'start' | 'evidence' | 'request-verification';
const rollout = process.env.NEXT_PUBLIC_APPSEC_V2_REMEDIATION_ENABLED === 'true';
const verificationRollout = process.env.NEXT_PUBLIC_APPSEC_V2_VERIFICATION_ENABLED === 'true';

export function FindingRemediation({ finding, onChanged }: { readonly finding: Finding; readonly onChanged: (finding: Finding) => void }) {
  const { role, tenantId, userId, canSubmitRemediation } = useAppSec();
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (finding.workflowVersion !== 2) return null;
  const ownsFinding = finding.assigneeId === userId;
  const canAct = rollout && canSubmitRemediation && ownsFinding;
  const canStart = canAct && finding.status === 'OPEN' && finding.validationState === 'VALID' && finding.priority !== null;
  const canSubmit = canAct && finding.status === 'IN_PROGRESS' && finding.verificationState !== 'REQUESTED';
  const canRequest = canAct && verificationRollout && finding.status === 'IN_PROGRESS' && finding.verificationState !== 'REQUESTED';

  async function act(action: RemediationAction): Promise<void> {
    if (action === 'evidence' && !note.trim()) { setError('Evidence note is required.'); return; }
    if (action === 'request-verification' && !summary.trim()) { setError('Verification summary is required.'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch(appsecUrl(`/appsec/findings/${finding.id}/lifecycle/${action}`, role, tenantId), {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: finding.revision, requestKey: crypto.randomUUID(),
          ...(action === 'evidence' ? { note: note.trim(), ...(reference.trim() ? { reference: reference.trim() } : {}) } : {}),
          ...(action === 'request-verification' ? { summary: summary.trim() } : {}),
        }),
      });
      const body: { readonly finding?: Finding; readonly message?: string | readonly string[] } = await response.json();
      if (!response.ok || !body.finding) throw new Error(response.status === 409 ? 'Finding changed. Refresh and try again.' : errorMessage(body, 'Remediation action failed.', response.status));
      onChanged({ ...body.finding, application: finding.application, assigneeName: finding.assigneeName });
      setNote(''); setReference(''); setSummary('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Remediation action failed.'); }
    finally { setBusy(false); }
  }

  return <section className="appsec-card appsec-remediation-work" aria-label="Remediation work">
    <div className="appsec-section-head"><div><span className="source-eyebrow">APPSEC / REMEDIATION</span><h2>Remediation work and evidence</h2></div></div>
    <dl className="appsec-remediation"><div><dt>Work status</dt><dd>{finding.status.replaceAll('_', ' ')}</dd></div><div><dt>Assigned owner</dt><dd>{finding.assigneeId ? finding.assigneeName ?? 'Assignee unavailable' : 'Unassigned'}</dd></div><div><dt>Current revision</dt><dd>{finding.revision}</dd></div></dl>
    {finding.verificationState === 'REQUESTED' ? <p>Verification is pending an independent reviewer decision. Evidence is locked until the decision.</p>
      : finding.verificationState === 'REJECTED' ? <p>Verification was rejected. Submit fresh evidence before requesting another review.</p>
        : finding.status === 'IN_PROGRESS' && <p>Submit evidence, then request independent verification when ready.</p>}
    {canStart && <Button disabled={busy} onClick={() => void act('start')}>Start remediation</Button>}
    {canSubmit && <div className="appsec-remediation-form">
      <label>Evidence note<textarea aria-label="Evidence note" maxLength={4000} value={note} onChange={event => setNote(event.target.value)} /></label>
      <label>Reference (optional HTTPS URL)<input aria-label="Evidence reference" type="url" maxLength={2048} value={reference} onChange={event => setReference(event.target.value)} /></label>
      <Button disabled={busy || !note.trim()} onClick={() => void act('evidence')}>Submit evidence</Button>
    </div>}
    {canRequest && <div className="appsec-remediation-form"><label>Verification summary<textarea aria-label="Verification summary" maxLength={2000} value={summary} onChange={event => setSummary(event.target.value)} /></label><Button disabled={busy || !summary.trim()} onClick={() => void act('request-verification')}>Request verification</Button></div>}
    {!canAct && <p>Remediation actions require the current assignment and an explicit remediation grant.</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => window.location.reload()}>Refresh</button></p>}
  </section>;
}
