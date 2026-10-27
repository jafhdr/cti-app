'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useThreatIntelligenceTenant } from '../ThreatIntelligenceShell';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Page<T> = { items: T[]; total: number; page: number; restricted?: boolean };
type Task = { id: string; reference: string; title: string; status: string; evidence: { evidenceId: string }[] };
type Evidence = { id: string; indicatorId: string | null; threatActorId: string | null; campaignId: string | null };
type Report = { id: string; reference: string; title: string; status: string };
type SirTrace = { sir: { id: string; reference: string; pir: { id: string; reference: string; title: string } }; progress: { total: number; completed: number; withEvidence: number }; tasks: Page<Task>; evidence: Page<Evidence>; reports: Page<Report> };
type TaskTrace = { sir: { id: string; reference: string; pir: { id: string; reference: string; title: string } }; task: Task & { resultKind: string | null; resultSummary: string | null }; citingReports: Page<Report> };
type ReportTrace = { report: { pir: { id: string; reference: string; title: string }; sirs: { id: string; reference: string; title: string }[]; frozen: boolean }; citations: Page<{ id: string; sirId: string; source: { name: string; type: string } | null }>; associations: Page<{ evidenceId: string; task: Task }>; dissemination: Page<{ id: string; status: string; recipient: { name: string }; feedback: { id: string; submittedAt: string } | null }> };

function useTrace<T>(path: string, role: Role) {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (role === 'SUPER_ADMIN' && (!ready || !tenantId)) { setLoading(false); return; }
    let live = true;
    const query = new URLSearchParams({ page: String(page), limit: '5' });
    if (role === 'SUPER_ADMIN') query.set('tenantId', tenantId);
    setLoading(true); setError('');
    fetch(`${API}/intelligence/traceability/${path}?${query}`, { credentials: 'include', cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error(`Trace unavailable (${response.status})`); return response.json() as Promise<T>; })
      .then(value => { if (live) setData(value); })
      .catch(cause => { if (live) setError(cause instanceof Error ? cause.message : 'Trace unavailable'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, role, tenantId, ready, page]);
  return { data, error, loading, page, setPage, tenantId };
}

function Pager({ page, total, next }: { page: number; total: number; next: (value: number) => void }) {
  if (total <= 5) return null;
  return <div className="pir-pagination"><button type="button" disabled={page <= 1} onClick={() => next(page - 1)}>Previous</button><span>Page {page} of {Math.ceil(total / 5)}</span><button type="button" disabled={page * 5 >= total} onClick={() => next(page + 1)}>Next</button></div>;
}
function empty(total: number, label: string) {
  return total > 0 ? `No ${label} on this page.` : `Not linked: no ${label}.`;
}

export function SirTraceability({ sirId, role }: { sirId: string; role: Role }) {
  const { data, error, loading, page, setPage, tenantId } = useTrace<SirTrace>(`sirs/${encodeURIComponent(sirId)}`, role);
  const tenant = role === 'SUPER_ADMIN' ? `&tenantId=${encodeURIComponent(tenantId)}` : '';
  return <section className="sir-evidence sir-collection-section intelligence-trace" aria-label="Intelligence traceability"><h3>Intelligence traceability</h3><p>Current links from requirement to collection, evidence, and analysis. Association does not prove original discovery.</p>
    {loading ? <p role="status">Loading trace...</p> : error ? <p role="alert">{error}</p> : data ? <>
      <p><Link href={`/threat-intelligence/pirs?pirId=${encodeURIComponent(data.sir.pir.id)}`}>{data.sir.pir.reference} · {data.sir.pir.title}</Link> → {data.sir.reference}</p>
      <p>{data.progress.total} tasks · {data.progress.completed} completed · {data.progress.withEvidence} with visible evidence</p>
      <h4>Collection tasks</h4>{data.tasks.items.length ? <ul>{data.tasks.items.map(task => <li key={task.id}><Link href={`/threat-intelligence/collection?taskId=${encodeURIComponent(task.id)}${tenant}`}>{task.reference} · {task.title}</Link> · {task.status} · {task.evidence.length} associated evidence</li>)}</ul> : <p>{empty(data.tasks.total, 'collection tasks')}</p>}
      <h4>Associated SIR evidence</h4>{data.evidence.items.length ? <ul>{data.evidence.items.map(item => <li key={item.id}>Evidence {item.id} · {item.indicatorId ? 'Indicator' : item.threatActorId ? 'Threat actor' : 'Campaign'}</li>)}</ul> : <p>{empty(data.evidence.total, 'visible SIR evidence')}</p>}
      <h4>Analysis reports</h4>{data.reports.restricted ? <p>Restricted to report authors. Received reports remain in your inbox.</p> : data.reports.items.length ? <ul>{data.reports.items.map(report => <li key={report.id}><Link href={`/threat-intelligence/reports?reportId=${encodeURIComponent(report.id)}${tenant}`}>{report.reference} · {report.title}</Link> · {report.status}</li>)}</ul> : <p>{empty(data.reports.total, 'visible analysis reports')}</p>}
      <Pager page={page} total={Math.max(data.tasks.total, data.evidence.total, data.reports.total)} next={setPage} />
    </> : <p>Trace unavailable.</p>}
  </section>;
}

export function TaskTraceability({ taskId, role }: { taskId: string; role: Role }) {
  const { data, error, loading, page, setPage, tenantId } = useTrace<TaskTrace>(`tasks/${encodeURIComponent(taskId)}`, role);
  const tenant = role === 'SUPER_ADMIN' ? `&tenantId=${encodeURIComponent(tenantId)}` : '';
  return <section className="sir-evidence sir-collection-section intelligence-trace" aria-label="Task intelligence traceability"><h3>Intelligence traceability</h3><p>Current task associations; original discovery is not established by these links.</p>
    {loading ? <p role="status">Loading trace...</p> : error ? <p role="alert">{error}</p> : data ? <>
      <p><Link href={`/threat-intelligence/pirs?pirId=${encodeURIComponent(data.sir.pir.id)}`}>{data.sir.pir.reference} · {data.sir.pir.title}</Link> → <Link href={`/threat-intelligence/sirs?sirId=${encodeURIComponent(data.sir.id)}${tenant}`}>{data.sir.reference}</Link></p>
      <p><strong>Recorded outcome:</strong> {data.task.resultKind ? `${data.task.resultKind.replaceAll('_', ' ')} · ${data.task.resultSummary || ''}` : 'Not recorded'}</p>
      <h4>Currently associated evidence</h4>{data.task.evidence.length ? <ul>{data.task.evidence.map(link => <li key={link.evidenceId}>Evidence {link.evidenceId}</li>)}</ul> : <p>Not linked: no associated evidence.</p>}
      <h4>Reports citing that evidence</h4>{data.citingReports.restricted ? <p>Restricted to report authors.</p> : data.citingReports.items.length ? <ul>{data.citingReports.items.map(report => <li key={report.id}><Link href={`/threat-intelligence/reports?reportId=${encodeURIComponent(report.id)}${tenant}`}>{report.reference} · {report.title}</Link> · {report.status}</li>)}</ul> : <p>{empty(data.citingReports.total, 'visible report citations')}</p>}
      <Pager page={page} total={data.citingReports.total} next={setPage} />
    </> : <p>Trace unavailable.</p>}
  </section>;
}

export function ReportTraceability({ reportId, role }: { reportId: string; role: Role }) {
  const { data, error, loading, page, setPage, tenantId } = useTrace<ReportTrace>(`reports/${encodeURIComponent(reportId)}`, role);
  const tenant = role === 'SUPER_ADMIN' ? `&tenantId=${encodeURIComponent(tenantId)}` : '';
  return <section className="sir-evidence sir-collection-section intelligence-trace" aria-label="Report intelligence traceability"><h3>Intelligence traceability</h3><p>{data?.report.frozen ? 'Selected SIRs and citations are part of the finalized report. Task associations below reflect current live links.' : 'Selected SIRs and citations are the current report draft. Task associations reflect current live links.'}</p>
    {loading ? <p role="status">Loading trace...</p> : error ? <p role="alert">{error}</p> : data ? <>
      <p><Link href={`/threat-intelligence/pirs?pirId=${encodeURIComponent(data.report.pir.id)}`}>{data.report.pir.reference} · {data.report.pir.title}</Link></p>
      <h4>Selected SIRs</h4>{data.report.sirs.length ? <ul>{data.report.sirs.map(sir => <li key={sir.id}><Link href={`/threat-intelligence/sirs?sirId=${encodeURIComponent(sir.id)}${tenant}`}>{sir.reference} · {sir.title}</Link></li>)}</ul> : <p>Not linked: no selected SIR.</p>}
      <h4>Analyst-selected citations</h4>{data.citations.items.length ? <ul>{data.citations.items.map(item => <li key={item.id}>{item.source?.type || 'Evidence'} · {item.source?.name || item.id}</li>)}</ul> : <p>{empty(data.citations.total, 'citations')}</p>}
      <h4>Current collection task associations</h4>{data.associations.items.length ? <ul>{data.associations.items.map(link => <li key={`${link.task.id}-${link.evidenceId}`}><Link href={`/threat-intelligence/collection?taskId=${encodeURIComponent(link.task.id)}${tenant}`}>{link.task.reference} · {link.task.title}</Link> · associated with cited evidence {link.evidenceId}</li>)}</ul> : <p>{empty(data.associations.total, 'current task associations for cited evidence')}</p>}
      <h4>Dissemination and feedback</h4>{data.dissemination.items.length ? <ul>{data.dissemination.items.map(item => <li key={item.id}>{item.recipient.name} · {item.status} · {item.feedback ? `Feedback submitted ${new Date(item.feedback.submittedAt).toLocaleDateString()}` : 'No feedback submitted'}</li>)}</ul> : <p>{empty(data.dissemination.total, 'dissemination')}</p>}
      <Pager page={page} total={Math.max(data.citations.total, data.associations.total, data.dissemination.total)} next={setPage} />
    </> : <p>Trace unavailable.</p>}
  </section>;
}
