'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAppSec } from './AppSecShell';
import { appsecUrl, errorMessage, findingSeverities, findingStatuses, type Finding } from './types';

type Totals = { readonly open: number; readonly assigned: number; readonly unassigned: number; readonly overdue: number;
  readonly awaitingVerification: number; readonly rework: number; readonly resolved: number; readonly acceptedRisk: number; readonly falsePositive: number };
type Owner = { readonly assigneeId: string | null; readonly name: string | null; readonly open: number; readonly overdue: number; readonly awaitingVerification: number };
type Metrics = { readonly asOf: string; readonly from: string; readonly to: string; readonly filters: { readonly ownerId: string | null };
  readonly totals: Totals; readonly aging: readonly { readonly bucket: string; readonly count: number }[]; readonly owners: readonly Owner[];
  readonly filterOwners: readonly { readonly assigneeId: string; readonly name: string | null }[] };
type Queue = { readonly asOf: string; readonly items: readonly Finding[]; readonly total: number; readonly page: number; readonly limit: number };
const summary: readonly { readonly key: keyof Totals; readonly label: string }[] = [
  { key: 'open', label: 'Open' }, { key: 'resolved', label: 'Resolved' }, { key: 'acceptedRisk', label: 'Accepted risk' },
  { key: 'falsePositive', label: 'False positive' }, { key: 'assigned', label: 'Assigned open' },
  { key: 'unassigned', label: 'Unassigned open' }, { key: 'overdue', label: 'Overdue open' },
  { key: 'awaitingVerification', label: 'Awaiting verification' }, { key: 'rework', label: 'Rework' },
];
function utcBoundary(date: string): string | null { return date ? `${date}T00:00:00.000Z` : null; }
function readable(time: string): string { return new Date(time).toLocaleString(undefined, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC'; }

export function OperationalWorkspace() {
  const { role, tenantId } = useAppSec();
  const latest = useRef(0);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [ownerId, setOwnerId] = useState(''); const [status, setStatus] = useState('');
  const [priority, setPriority] = useState(''); const [verificationState, setVerificationState] = useState('');
  const [overdue, setOverdue] = useState(''); const [page, setPage] = useState(1);
  const [metrics, setMetrics] = useState<Metrics | null>(null); const [queue, setQueue] = useState<Queue | null>(null);
  const [owners, setOwners] = useState<Metrics['filterOwners']>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');

  useEffect(() => {
    setFrom(''); setTo(''); setOwnerId(''); setStatus(''); setPriority(''); setVerificationState(''); setOverdue('');
    setPage(1); setMetrics(null); setQueue(null); setOwners([]);
    return () => { latest.current += 1; };
  }, [tenantId]);

  useEffect(() => {
    const id = ++latest.current;
    setLoading(true); setError(''); setMetrics(null); setQueue(null);
    const scope = new URLSearchParams();
    const fromUtc = utcBoundary(from); const toUtc = utcBoundary(to);
    if (fromUtc) scope.set('from', fromUtc);
    if (toUtc) scope.set('to', toUtc);
    if (ownerId) scope.set('ownerId', ownerId);
    const filters = new URLSearchParams(scope);
    if (status) filters.set('status', status);
    if (priority) filters.set('priority', priority);
    if (verificationState) filters.set('verificationState', verificationState);
    if (overdue) filters.set('overdue', overdue);
    filters.set('page', String(page)); filters.set('limit', '25');
    async function load(): Promise<void> {
      try {
        const [metricsResponse, queueResponse] = await Promise.all([
          fetch(appsecUrl('/appsec/findings/operational-metrics', role, tenantId, scope), { credentials: 'include', cache: 'no-store' }),
          fetch(appsecUrl('/appsec/findings/queue', role, tenantId, filters), { credentials: 'include', cache: 'no-store' }),
        ]);
        const metricBody: Metrics & { readonly message?: string | readonly string[] } = await metricsResponse.json();
        const queueBody: Queue & { readonly message?: string | readonly string[] } = await queueResponse.json();
        if (!metricsResponse.ok) throw new Error(errorMessage(metricBody, 'Operational metrics unavailable.', metricsResponse.status));
        if (!queueResponse.ok) throw new Error(errorMessage(queueBody, 'Finding queue unavailable.', queueResponse.status));
        if (id === latest.current) { setMetrics(metricBody); setQueue(queueBody); if (!ownerId) setOwners(metricBody.filterOwners); }
      } catch (cause) { if (id === latest.current) setError(cause instanceof Error ? cause.message : 'Operational report unavailable.'); }
      finally { if (id === latest.current) setLoading(false); }
    }
    void load();
    return () => { latest.current += 1; };
  }, [from, to, ownerId, status, priority, verificationState, overdue, page, role, tenantId]);

  const pageCount = queue ? Math.max(1, Math.ceil(queue.total / queue.limit)) : 1;
  return <main className="content editorial-module appsec-workspace appsec-operations">
    <Link className="appsec-back" href="/appsec/findings">← Findings</Link>
    <header className="editorial-heading appsec-heading"><div><span className="source-eyebrow">APPSEC / OPERATIONS</span><h1>Finding operations</h1><p>Current states for the selected creation period. Closed legacy Findings do not imply independent verification.</p></div></header>
    <Card view="outlined" className="appsec-card"><div className="appsec-operation-filters">
      <label>Created from (UTC)<input aria-label="Created from UTC" type="date" value={from} onChange={event => { setPage(1); setFrom(event.target.value); }} /></label>
      <label>Created before (UTC)<input aria-label="Created before UTC" type="date" value={to} onChange={event => { setPage(1); setTo(event.target.value); }} /></label>
      <label>Current owner<select aria-label="Current owner" value={ownerId} onChange={event => { setPage(1); setOwnerId(event.target.value); }}><option value="">All owners</option><option value="unassigned">Unassigned</option>{owners.map(item => <option key={item.assigneeId} value={item.assigneeId}>{item.name ?? 'Name unavailable'}</option>)}</select></label>
    </div><p className="appsec-operation-note">Period uses [from, before) UTC boundaries. Default: previous 30 days. Counts reflect current Finding states.</p></Card>
    {loading && <Card view="outlined" className="appsec-card appsec-state" role="status">Loading operational report...</Card>}
    {error && <Card view="outlined" className="appsec-card appsec-state" role="alert">{error}</Card>}
    {metrics && <><p className="appsec-operation-note">Period: {readable(metrics.from)} to {readable(metrics.to)} (exclusive). As of {readable(metrics.asOf)}.</p>
      <section className="appsec-operation-metrics" aria-label="Operational metrics">{summary.map(item => <Card view="outlined" className="appsec-card" key={item.key}><span>{item.label}</span><strong>{metrics.totals[item.key]}</strong></Card>)}</section>
      <div className="appsec-operation-columns"><Card view="outlined" className="appsec-card"><h2>Open Finding age</h2><ul>{metrics.aging.map(item => <li key={item.bucket}><span>{item.bucket} UTC days</span><strong>{item.count}</strong></li>)}</ul></Card>
        <Card view="outlined" className="appsec-card"><h2>Current owner workload</h2>{metrics.owners.length ? <ul>{metrics.owners.map(item => <li key={item.assigneeId ?? 'unassigned'}><span>{item.assigneeId ? item.name ?? 'Name unavailable' : 'Unassigned'}</span><strong>{item.open} open · {item.overdue} overdue · {item.awaitingVerification} awaiting</strong></li>)}</ul> : <p>No open Findings in this period.</p>}</Card></div>
    </>}
    <Card view="outlined" className="appsec-card"><h2>Operational Finding queue</h2><div className="appsec-operation-filters">
      <label>Status<select aria-label="Queue status" value={status} onChange={event => { setPage(1); setStatus(event.target.value); }}><option value="">All statuses</option>{findingStatuses.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Priority<select aria-label="Queue priority" value={priority} onChange={event => { setPage(1); setPriority(event.target.value); }}><option value="">All priorities</option>{findingSeverities.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Verification<select aria-label="Queue verification" value={verificationState} onChange={event => { setPage(1); setVerificationState(event.target.value); }}><option value="">All states</option>{['NONE', 'REQUESTED', 'REJECTED', 'APPROVED'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Overdue<select aria-label="Queue overdue" value={overdue} onChange={event => { setPage(1); setOverdue(event.target.value); }}><option value="">Any</option><option value="true">Overdue</option><option value="false">Not overdue</option></select></label>
    </div>{queue && (queue.items.length ? <ul className="appsec-operation-queue">{queue.items.map(item => <li key={item.id}><Link href={`/appsec/findings/${item.id}`}>{item.title}</Link><span>{item.status.replaceAll('_', ' ')} · {item.workflowVersion === 1 ? 'Legacy — verification not recorded' : item.verificationState ?? 'No verification'} · {item.assigneeName ?? 'Unassigned'} · {item.priority ?? 'No priority'}</span></li>)}</ul> : <p>No Findings match these filters.</p>)}
      {queue && <div className="appsec-pagination"><span>{queue.total} Findings · Page {page} of {pageCount}</span><div><Button view="outlined" size="s" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</Button><Button view="outlined" size="s" disabled={page >= pageCount || loading} onClick={() => setPage(value => value + 1)}>Next</Button></div></div>}
    </Card>
  </main>;
}
