'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAppSec } from './AppSecShell';
import { FindingForm } from './FindingForm';
import { FindingIntegrations } from './FindingIntegrations';
import { FindingTriage } from './FindingTriage';
import { FindingRemediation } from './FindingRemediation';
import { FindingVerification } from './FindingVerification';
import { appsecUrl, errorMessage, findingTransitions, isTerminalFinding, type Finding, type FindingStatus } from './types';

function date(value: string | null): string { return value ? new Date(value).toLocaleString() : '—'; }
export function FindingDetail() {
  const params = useParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const { role, tenantId, canManage, canViewApplications, canViewTi } = useAppSec();
  const latest = useRef(0);
  const [finding, setFinding] = useState<Finding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<FindingStatus | ''>('');
  const [resolution, setResolution] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const load = useCallback(async () => {
    const requestId = ++latest.current;
    setLoading(true); setError(''); setFinding(null);
    try {
      const response = await fetch(appsecUrl(`/appsec/findings/${id}`, role, tenantId), { credentials: 'include', cache: 'no-store' });
      const body: Finding & { readonly message?: string | readonly string[] } = await response.json();
      if (!response.ok) throw new Error(response.status === 404 ? 'Finding tidak ditemukan dalam tenant ini.' : errorMessage(body, 'Gagal memuat Finding.', response.status));
      if (requestId === latest.current) setFinding(body);
    } catch (cause) { if (requestId === latest.current) setError(cause instanceof Error ? cause.message : 'Gagal memuat Finding.'); }
    finally { if (requestId === latest.current) setLoading(false); }
  }, [id, role, tenantId]);
  useEffect(() => { void load(); return () => { latest.current += 1; }; }, [load]);
  async function transition(): Promise<void> {
    if (!target) return;
    if (isTerminalFinding(target) && !resolution.trim()) { setActionError('Resolution wajib untuk status terminal.'); return; }
    setSaving(true); setActionError('');
    try {
      const response = await fetch(appsecUrl(`/appsec/findings/${id}`, role, tenantId), { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: target, ...(isTerminalFinding(target) ? { resolution: resolution.trim() } : {}) }) });
      const body: Finding & { readonly message?: string | readonly string[] } = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal mengubah status Finding.', response.status));
      setFinding(current => current ? { ...current, ...body, application: current.application } : body);
      setTarget(''); setResolution(''); setNotice(target === 'OPEN' ? 'Finding reopened. Active resolution cleared.' : 'Finding status updated.');
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Gagal mengubah status Finding.'); }
    finally { setSaving(false); }
  }
  return <main className="content editorial-module appsec-workspace appsec-finding-detail"><Link className="appsec-back" href="/appsec/findings">← Findings</Link>
    {loading ? <div className="appsec-state" role="status">Loading Finding...</div> : error ? <div className="appsec-state" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></div> : finding && <>
      <header className="editorial-heading appsec-heading"><div><span className="source-eyebrow">APPSEC / FINDING DETAIL</span><h1>{finding.title}</h1><p>Manual finding and remediation record.</p></div>{canManage && <Button view="outlined" onClick={() => setEditing(true)}>Edit finding</Button>}</header>
      {notice && <div className="success" role="status">{notice}</div>}
      <dl className="appsec-facts"><div><dt>Application</dt><dd>{canViewApplications ? <Link href={`/appsec/applications/${finding.applicationId}`}>{finding.application?.name ?? '—'}</Link> : finding.application?.name ?? '—'}</dd></div><div><dt>Severity</dt><dd><span className={`ioc-severity severity-${finding.severity.toLowerCase()}`}>{finding.severity}</span></dd></div><div><dt>Status</dt><dd>{finding.status.replaceAll('_', ' ')}</dd></div><div><dt>Revision</dt><dd>{finding.revision}</dd></div><div><dt>Source</dt><dd>{finding.source}</dd></div><div><dt>Category</dt><dd>{finding.category || '—'}</dd></div><div><dt>CWE</dt><dd>{finding.cweId || '—'}</dd></div><div><dt>Location</dt><dd>{finding.location || '—'}</dd></div><div><dt>First seen</dt><dd>{date(finding.firstSeenAt)}</dd></div><div><dt>Last seen</dt><dd>{date(finding.lastSeenAt)}</dd></div><div><dt>Created</dt><dd>{date(finding.createdAt)}</dd></div><div><dt>Updated</dt><dd>{date(finding.updatedAt)}</dd></div><div><dt>Description</dt><dd>{finding.description || 'No description.'}</dd></div></dl>
      <div className={`appsec-detail-lower${canViewTi ? ' has-ti' : ''}`}><section className="appsec-assets"><div className="appsec-section-head"><div><span className="source-eyebrow">REMEDIATION</span><h2>Resolution and next steps</h2></div></div><dl className="appsec-remediation"><div><dt>Remediation note</dt><dd>{finding.remediationNote || '—'}</dd></div><div><dt>Due date</dt><dd>{date(finding.dueDate)}</dd></div><div><dt>Resolution</dt><dd>{finding.resolution || '—'}</dd></div><div><dt>Resolved at</dt><dd>{date(finding.resolvedAt)}</dd></div></dl>
        {canManage && finding.workflowVersion !== 2 && <div className="appsec-transition"><label>Change status<select aria-label="Change status" value={target} onChange={event => { setTarget(findingTransitions(finding.status).find(value => value === event.target.value) ?? ''); setActionError(''); }}><option value="">Select transition</option>{findingTransitions(finding.status).map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>{target && isTerminalFinding(target) && <label>Resolution *<textarea aria-label="Resolution" required rows={3} maxLength={4000} value={resolution} onChange={event => setResolution(event.target.value)} /></label>}{target === 'OPEN' && isTerminalFinding(finding.status) && <p>Reopening clears the active resolution and resolved date. Earlier decisions remain in the audit log.</p>}<Button disabled={!target || saving} onClick={() => void transition()}>{saving ? 'Saving...' : 'Update status'}</Button>{actionError && <p role="alert">{actionError}</p>}</div>}
      </section><FindingIntegrations finding={finding} /></div><FindingTriage key={tenantId + finding.id} finding={finding} onChanged={updated => { setFinding(updated); setNotice('Triage action saved.'); }} /><FindingRemediation key={`remediation-${tenantId}-${finding.id}`} finding={finding} onChanged={updated => { setFinding(updated); setNotice('Remediation action saved.'); }} /><FindingVerification key={`verification-${tenantId}-${finding.id}`} finding={finding} onChanged={updated => { setFinding(updated); setNotice('Verification decision saved.'); }} /><FindingForm open={editing} finding={finding} onClose={() => setEditing(false)} onSaved={updated => { setFinding({ ...updated, application: finding.application }); setNotice('Finding updated.'); }} />
    </>}
  </main>;
}
