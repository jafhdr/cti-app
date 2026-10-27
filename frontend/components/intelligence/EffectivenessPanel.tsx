'use client';

import { useEffect, useState } from 'react';
import { useThreatIntelligenceTenant } from './ThreatIntelligenceShell';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Range = '30d' | '90d' | 'custom';
type Ratio = { readonly numerator: number; readonly denominator: number; readonly percent: number | null };
type Coverage = { readonly eligible: number; readonly assessed: number; readonly unassessed: number };
type Metrics = {
  readonly period: { readonly range: Range; readonly from: string; readonly toExclusive: string; readonly asOf: string; readonly timezone: string };
  readonly requirements: { readonly pirTotal: number; readonly pirStatus: Readonly<Record<string, number>>; readonly pirOpen: number; readonly pirOverdue: number; readonly sirTotal: number; readonly sirStatus: Readonly<Record<string, number>>; readonly sirOpen: number; readonly sirUnanswered: number; readonly sirOverdue: number; readonly answered: Ratio };
  readonly collection: { readonly total: number; readonly status: Readonly<Record<string, number>>; readonly completed: number; readonly blocked: number; readonly overdueActive: number; readonly completedFindings: number; readonly completedNoFindings: number; readonly onTime: Ratio };
  readonly reporting: { readonly total: number; readonly status: Readonly<Record<string, number>>; readonly withPir: number; readonly withSir: number; readonly finalizedDisseminated: number; readonly productionHours: { readonly average: number | null; readonly sampleSize: number } };
  readonly dissemination: { readonly reportsAvailable: number; readonly distributions: number; readonly viewed: number; readonly feedbackSubmittedForDistributions: number; readonly responseRate: Ratio; readonly feedbackSubmittedInPeriod: number; readonly relevance: { readonly average: number | null; readonly sampleSize: number }; readonly actionability: { readonly average: number | null; readonly sampleSize: number }; readonly furtherIntelligenceRequests: number; readonly stakeholderCategories: readonly { readonly category: string; readonly distributions: number; readonly viewed: number; readonly responded: number; readonly responsePercent: number | null }[] };
  readonly assessmentCoverage: { readonly sources: Coverage; readonly evidence: Coverage };
};
type Selection = { readonly range: Range; readonly from: string; readonly to: string };
const initialSelection: Selection = { range: '30d', from: '', to: '' };
const requirementStatuses = ['OPEN', 'IN_COLLECTION', 'IN_ANALYSIS', 'ANSWERED', 'EXPIRED'] as const;
const taskStatuses = ['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED'] as const;

function number(value: number): string { return new Intl.NumberFormat('en-US').format(value); }
function decimal(value: number | null, suffix = ''): string { return value === null ? 'Not available' : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)}${suffix}`; }
function Metric({ label, value, detail }: { readonly label: string; readonly value: string | number; readonly detail: string }) {
  return <div className="cti-effectiveness-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
function StatusBars({ title, total, counts, statuses }: { readonly title: string; readonly total: number; readonly counts: Readonly<Record<string, number>>; readonly statuses: readonly string[] }) {
  return <div className="cti-effectiveness-bars"><h4>{title}</h4>{statuses.map(status => { const value = counts[status] ?? 0; return <div className="cti-effectiveness-bar" key={status}><span>{status.replaceAll('_', ' ')}</span><div className="cti-effectiveness-track"><i style={{ width: `${total ? value / total * 100 : 0}%` }} /></div><strong>{number(value)}</strong></div>; })}</div>;
}
function RatioMetric({ label, ratio, detail }: { readonly label: string; readonly ratio: Ratio; readonly detail: string }) {
  return <Metric label={label} value={decimal(ratio.percent, '%')} detail={`${number(ratio.numerator)} / ${number(ratio.denominator)} · ${detail}`} />;
}

export function EffectivenessPanel() {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const [selection, setSelection] = useState<Selection>(initialSelection);
  const [applied, setApplied] = useState<Selection>(initialSelection);
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ range: applied.range });
    if (tenantId) params.set('tenantId', tenantId);
    if (applied.range === 'custom') { params.set('from', applied.from); params.set('to', applied.to); }
    setLoading(true); setError(''); setRestricted(false);
    fetch(`${API}/intelligence/effectiveness?${params}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (response.status === 403) { setRestricted(true); return null; }
        if (!response.ok) throw new Error('Could not load CTI effectiveness metrics.');
        const result: Metrics = await response.json();
        return result;
      })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError('Could not load CTI effectiveness metrics. Check the connection and retry.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ready, tenantId, applied]);

  const canApply = selection.range !== 'custom' || (selection.from !== '' && selection.to !== '' && selection.from <= selection.to);
  return <section className="cti-effectiveness" aria-labelledby="cti-effectiveness-title">
    <div className="editorial-section-heading"><span className="source-eyebrow">OPERATIONAL EFFECTIVENESS</span><h2 id="cti-effectiveness-title">How the intelligence workflow is moving</h2><p>Recorded requirements, collection, reporting, feedback and assessment activity. These measures describe workflow, not intelligence quality.</p></div>
    <div className="cti-effectiveness-filter"><label>Time range<select value={selection.range} onChange={event => setSelection({ ...selection, range: event.target.value === '90d' ? '90d' : event.target.value === 'custom' ? 'custom' : '30d' })}><option value="30d">Rolling 30 days</option><option value="90d">Rolling 90 days</option><option value="custom">Custom UTC dates</option></select></label>{selection.range === 'custom' && <><label>From<input type="date" value={selection.from} onChange={event => setSelection({ ...selection, from: event.target.value })} /></label><label>Through<input type="date" min={selection.from} value={selection.to} onChange={event => setSelection({ ...selection, to: event.target.value })} /></label></>}<button type="button" disabled={!canApply || loading} onClick={() => setApplied(selection)}>Apply range</button></div>
    {loading && <p className="cti-effectiveness-state" role="status">Loading workflow metrics…</p>}
    {!loading && restricted && <p className="cti-effectiveness-state" role="status">Effectiveness metrics require ADMIN access to Intelligence Hub and Indicator Management for the selected tenant.</p>}
    {!loading && error && <p className="cti-effectiveness-state error" role="alert">{error} <button type="button" onClick={() => setApplied({ ...applied })}>Retry</button></p>}
    {!loading && !restricted && !error && data && <MetricsContent data={data} />}
  </section>;
}

function MetricsContent({ data }: { readonly data: Metrics }) {
  const { requirements: req, collection: col, reporting: rep, dissemination: dis, assessmentCoverage: cover } = data;
  const empty = req.pirTotal + req.sirTotal + col.total + rep.total + dis.distributions + cover.sources.eligible + cover.evidence.eligible === 0;
  return <div className="cti-effectiveness-content">
    <p className="cti-effectiveness-period">{new Date(data.period.from).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium' })} – {new Date(new Date(data.period.toExclusive).valueOf() - 1).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium' })} (UTC calendar dates for custom ranges; rolling ranges use exact instants). Status and coverage are current as of {new Date(data.period.asOf).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.</p>
    {empty && <p className="cti-effectiveness-state">No recorded workflow activity in this range. Select a wider range to inspect earlier records.</p>}
    <div className="cti-effectiveness-kpis"><Metric label="PIR created" value={number(req.pirTotal)} detail="Current lifecycle status" /><Metric label="SIR created" value={number(req.sirTotal)} detail="Current lifecycle status" /><RatioMetric label="Answered Requirements" ratio={req.answered} detail="SIR marked ANSWERED" /><RatioMetric label="On-time collection" ratio={col.onTime} detail="completed tasks with both timestamps" /></div>
    <div className="cti-effectiveness-grid">
      <section className="cti-effectiveness-section"><h3>Intelligence requirements</h3><p>PIRs and SIRs created in the range; statuses and overdue state are current.</p><StatusBars title="PIR status" total={req.pirTotal} counts={req.pirStatus} statuses={requirementStatuses} /><StatusBars title="SIR status" total={req.sirTotal} counts={req.sirStatus} statuses={requirementStatuses} /><div className="cti-effectiveness-facts"><span>Open PIR <strong>{number(req.pirOpen)}</strong></span><span>Overdue PIR <strong>{number(req.pirOverdue)}</strong></span><span>Open SIR <strong>{number(req.sirOpen)}</strong></span><span>Open, unanswered SIR <strong>{number(req.sirUnanswered)}</strong></span><span>Overdue SIR <strong>{number(req.sirOverdue)}</strong></span></div></section>
      <section className="cti-effectiveness-section"><h3>Collection performance</h3><p>Tasks created in the range; cancelled tasks remain separate from completed tasks.</p><StatusBars title="Task status" total={col.total} counts={col.status} statuses={taskStatuses} /><div className="cti-effectiveness-facts"><span>Completed <strong>{number(col.completed)}</strong></span><span>Blocked <strong>{number(col.blocked)}</strong></span><span>Overdue active <strong>{number(col.overdueActive)}</strong></span><span>With findings <strong>{number(col.completedFindings)}</strong></span><span>No findings <strong>{number(col.completedNoFindings)}</strong></span></div><p className="cti-effectiveness-note">“No findings” is the recorded NO_FINDINGS result. On-time uses completed tasks with both dueDate and completedAt; completion on or before dueDate counts on time.</p></section>
      <section className="cti-effectiveness-section"><h3>Analysis reporting</h3><p>Analysis reports created in the range; legacy report-library records are excluded.</p><div className="cti-effectiveness-facts"><span>Draft <strong>{number(rep.status.DRAFT ?? 0)}</strong></span><span>In review <strong>{number(rep.status.IN_REVIEW ?? 0)}</strong></span><span>Final <strong>{number(rep.status.FINAL ?? 0)}</strong></span><span>Linked to PIR <strong>{number(rep.withPir)}</strong></span><span>Linked to SIR <strong>{number(rep.withSir)}</strong></span><span>Final and disseminated <strong>{number(rep.finalizedDisseminated)}</strong></span><span>Mean production time <strong>{decimal(rep.productionHours.average, ' h')}</strong></span></div><p className="cti-effectiveness-note">Production time: createdAt to recorded finalizedAt, sample n={number(rep.productionHours.sampleSize)}. Missing finalization timestamps are excluded.</p></section>
      <section className="cti-effectiveness-section"><h3>Dissemination & feedback</h3><p>Distributions made in the range; viewing and response are observed as of now. Feedback ratings use submissions in the range.</p><div className="cti-effectiveness-facts"><span>Reports available <strong>{number(dis.reportsAvailable)}</strong></span><span>Distribution records <strong>{number(dis.distributions)}</strong></span><span>Viewed distributions <strong>{number(dis.viewed)}</strong></span><span>Responses to distributions <strong>{number(dis.feedbackSubmittedForDistributions)}</strong></span><span>Further intelligence requested <strong>{number(dis.furtherIntelligenceRequests)}</strong></span></div><div className="cti-effectiveness-mini"><RatioMetric label="Feedback response rate" ratio={dis.responseRate} detail="responded distributions" /><Metric label="Relevance average" value={decimal(dis.relevance.average)} detail={`submitted ratings, n=${number(dis.relevance.sampleSize)}`} /><Metric label="Actionability average" value={decimal(dis.actionability.average)} detail={`submitted ratings, n=${number(dis.actionability.sampleSize)}`} /></div><div className="cti-effectiveness-categories"><h4>Responses by stakeholder category</h4>{dis.stakeholderCategories.length === 0 ? <p>No distributions in this range.</p> : dis.stakeholderCategories.map(row => <div key={row.category}><strong>{row.category.replaceAll('_', ' ')}</strong><span>{number(row.viewed)} viewed · {number(row.responded)} responses / {number(row.distributions)} distributions · {decimal(row.responsePercent, '%')}</span></div>)}</div><p className="cti-effectiveness-note">Feedback submitted during range: {number(dis.feedbackSubmittedInPeriod)}. A report shared with several recipients counts once under reports available and once per recipient under distributions.</p></section>
      <section className="cti-effectiveness-section cti-effectiveness-wide"><h3>Authored assessment coverage</h3><p>Currently existing sources and SIR evidence created in the range. Only authored assessments linked to those live records count; registry grades and archived target history do not.</p><div className="cti-effectiveness-mini"><Metric label="Eligible sources" value={number(cover.sources.eligible)} detail={`${number(cover.sources.assessed)} assessed · ${number(cover.sources.unassessed)} unassessed`} /><Metric label="Eligible SIR evidence" value={number(cover.evidence.eligible)} detail={`${number(cover.evidence.assessed)} assessed · ${number(cover.evidence.unassessed)} unassessed`} /></div></section>
    </div>
  </div>;
}
