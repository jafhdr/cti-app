'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import './case-operations.css';
import { useCaseTenant } from './case-access';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Timing = { samples: number; medianHours: number | null; p90Hours: number | null };
type Summary = { asOf: string; counts: { total: number; OPEN: number; IN_PROGRESS: number; RESOLVED: number; CLOSED: number }; workload: { active: number; byAssignee: { assigneeId: string | null; assigneeName: string; count: number }[]; tasks: Record<string, number> }; overdue: { count: number; approachingSevenDays: number; missingDue: number }; aging: { open: Timing; firstClosure: Timing }; resolution: { first: Timing; missingHistoricalEvents: number }; origins: Record<string, number>; reviewQueue: { pending: number; approvedDecisions: number; rejectedDecisions: number }; reopening: { cases: number; events: number; totalCycles: number }; limitations: { missingFirstClosure: number; notes: string[] } };
type QueueItem = { id: string; caseNumber: string; title: string; status: string; assigneeName: string | null; dueAt: string | null; review: string; origin: string };
type Queue = { items: QueueItem[]; total: number; page: number; limit: number };
const label = (value: string) => value.replaceAll('_', ' ');
const hours = (value: number | null) => value === null ? 'Not enough data' : `${value} h`;

export default function CaseOperationsPanel() {
  const { tenantId, ready, role } = useCaseTenant();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [queueKind, setQueueKind] = useState('OVERDUE');
  const [status, setStatus] = useState('');
  const [origin, setOrigin] = useState('');
  const [review, setReview] = useState('');
  const [assignee, setAssignee] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const load = useCallback(async (signal: AbortSignal) => {
    if (!ready) { setState('denied'); setSummary(null); setQueue(null); return; }
    setState('loading'); setSummary(null); setQueue(null);
    const params = new URLSearchParams();
    if (role === 'SUPER_ADMIN') params.set('tenantId', tenantId);
    if (status) params.set('status', status);
    if (origin) params.set('origin', origin);
    if (review) params.set('review', review);
    if (assignee) params.set('assigneeId', assignee);
    if (from) params.set('from', `${from}T00:00:00Z`);
    if (to) params.set('to', `${to}T00:00:00Z`);
    const queueParams = new URLSearchParams(params);
    queueParams.set('queue', queueKind); queueParams.set('page', String(page)); queueParams.set('limit', '10');
    try {
      const [s, q] = await Promise.all([
        fetch(`${API}/cases/v2/operations/summary?${params}`, { credentials: 'include', signal }),
        fetch(`${API}/cases/v2/operations/queue?${queueParams}`, { credentials: 'include', signal }),
      ]);
      if (s.status === 403 || q.status === 403) { setState('denied'); return; }
      if (!s.ok || !q.ok) throw new Error('Reporting could not be loaded');
      setSummary(await s.json() as Summary); setQueue(await q.json() as Queue); setState('ready');
    } catch (error) { if (!signal.aborted) setState('error'); }
  }, [ready, role, tenantId, status, origin, review, assignee, from, to, queueKind, page, refresh]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  if (state === 'denied') return null;
  return <section className="case-report" aria-label="Case operational reporting">
    <div className="editorial-section-heading"><span className="source-eyebrow">OPERATIONAL REPORTING</span><h2>Investigation performance</h2><p>Current tenant workload and recorded investigation history.</p></div>
    <div className="case-panel">
      <div className="case-report-filters">
        <label>Created from (UTC)<input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label>
        <label>Created before (UTC)<input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
        <label>Assignee<select value={assignee} onChange={e => { setAssignee(e.target.value); setPage(1); }}><option value="">All analysts</option><option value="unassigned">Unassigned</option>{summary?.workload.byAssignee.filter(a => a.assigneeId).map(a => <option key={a.assigneeId} value={a.assigneeId || ''}>{a.assigneeName}</option>)}</select></label>
        <label>Status<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All</option>{['OPEN','IN_PROGRESS','RESOLVED','CLOSED'].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Origin<select value={origin} onChange={e => { setOrigin(e.target.value); setPage(1); }}><option value="">All</option>{['MANUAL','INDICATOR','ASM_ALERT','ASM_FINDING','APPSEC_FINDING','LEGACY_UNKNOWN'].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Review<select value={review} onChange={e => { setReview(e.target.value); setPage(1); }}><option value="">All</option>{['NONE','PENDING','APPROVED','REJECTED'].map(v => <option key={v}>{v}</option>)}</select></label>
      </div>
      {state === 'loading' && <p role="status">Loading operational metrics...</p>}
      {state === 'error' && <div role="alert"><p>Reporting could not be loaded. Check filters or try again.</p><button className="soc-button-outline" onClick={() => setRefresh(v => v + 1)}>Retry</button></div>}
      {state === 'ready' && summary && queue && <>
        <p className="case-report-asof">Snapshot as of {new Date(summary.asOf).toLocaleString('id-ID', { timeZone: 'UTC' })} UTC · Date range uses created time, with the end excluded.</p>
        <div className="editorial-metrics case-metrics">{Object.entries(summary.counts).map(([key, value]) => <div key={key}><span>{label(key)}</span><strong>{value}</strong></div>)}</div>
        {summary.counts.total === 0 && <p>No cases match these filters.</p>}
        <div className="case-report-grid"><div><h3>Active workload</h3><p><strong>{summary.workload.active}</strong> active · {summary.overdue.count} overdue · {summary.overdue.approachingSevenDays} due within 7 days · {summary.overdue.missingDue} without due date</p><h4>By analyst</h4><div className="case-report-scroll"><table className="case-table"><thead><tr><th>Analyst</th><th>Open workload</th></tr></thead><tbody>{summary.workload.byAssignee.map(a => <tr key={a.assigneeId || 'unassigned'}><td>{a.assigneeName}</td><td>{a.count}</td></tr>)}</tbody></table></div><h4>Investigation tasks</h4><p>{Object.entries(summary.workload.tasks).map(([state, count]) => `${label(state)} ${count}`).join(' · ')}</p></div><div><h3>Recorded time</h3><p>Open aging: median {hours(summary.aging.open.medianHours)}, p90 {hours(summary.aging.open.p90Hours)} ({summary.aging.open.samples} cases)</p><p>First resolution: median {hours(summary.resolution.first.medianHours)}, p90 {hours(summary.resolution.first.p90Hours)} ({summary.resolution.first.samples} cases)</p><p>First closure: median {hours(summary.aging.firstClosure.medianHours)}, p90 {hours(summary.aging.firstClosure.p90Hours)} ({summary.aging.firstClosure.samples} cases)</p><p>{summary.reopening.cases} reopened cases · {summary.reopening.events} reopen events · {summary.reopening.totalCycles} recorded cycles</p></div><div><h3>Origins</h3>{Object.entries(summary.origins).map(([key, value]) => <p key={key}>{label(key)}: <strong>{value}</strong></p>)}</div><div><h3>Independent review</h3><p>{summary.reviewQueue.pending} pending · {summary.reviewQueue.approvedDecisions} approved decisions · {summary.reviewQueue.rejectedDecisions} rejected decisions</p><p>{summary.resolution.missingHistoricalEvents} resolved or closed cases lack a first-resolution event; {summary.limitations.missingFirstClosure} closed cases lack a first-closure record.</p></div></div>
        <div className="case-report-queue"><div className="editorial-section-heading"><h3>Operational queue</h3></div><label>Queue<select value={queueKind} onChange={e => { setQueueKind(e.target.value); setPage(1); }}><option value="OVERDUE">Overdue</option><option value="APPROACHING">Due within 7 days</option><option value="REVIEW">Pending review</option><option value="ALL">All cases</option></select></label>{queue.items.length === 0 ? <p>No cases in this queue.</p> : <div className="case-report-scroll"><table className="case-table"><thead><tr><th>Case</th><th>Title</th><th>Status</th><th>Assignee</th><th>Due UTC</th><th>Review</th></tr></thead><tbody>{queue.items.map(item => <tr key={item.id}><td><Link href={`/cases/${item.id}`}>{item.caseNumber}</Link></td><td>{item.title}</td><td>{label(item.status)}</td><td>{item.assigneeName || 'Unassigned'}</td><td>{item.dueAt ? new Date(item.dueAt).toLocaleString('id-ID', { timeZone: 'UTC' }) : 'No due date'}</td><td>{label(item.review)}</td></tr>)}</tbody></table></div>}<div className="case-report-pager"><span>{queue.total} cases · page {page}</span><button className="soc-button-outline" disabled={page === 1} onClick={() => setPage(v => v - 1)}>Previous</button><button className="soc-button-outline" disabled={page * queue.limit >= queue.total} onClick={() => setPage(v => v + 1)}>Next</button></div></div>
        <details><summary>Historical data limitations</summary><ul>{summary.limitations.notes.map(note => <li key={note}>{note}</li>)}</ul></details>
      </>}
    </div>
  </section>;
}
