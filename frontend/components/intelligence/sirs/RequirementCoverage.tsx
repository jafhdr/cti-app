'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useThreatIntelligenceTenant } from '../ThreatIntelligenceShell';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Gap = { code: string; explanation: string };
type Coverage = { sir: { id: string; pirId: string; reference: string; title: string; status: string }; signals: { taskTotal: number; activeTasks: number; planned: number; inProgress: number; blocked: number; overdue: number; completedFindings: number; completedNoFindings: number; documentedResults: number; tasksWithSource: number; visibleEvidence: number; analystAnswer: boolean; relatedReports: number | null; feedbackRequestReports: number | null }; gaps: Gap[]; outstanding: boolean; note: string };
type CoverageList = { items: Coverage[]; total: number; page: number; totalPages: number; summary: { requirements: number; withOperationalGaps: number }; restricted: { reportsAndFeedback: boolean } };
const gapOptions = [
  ['NO_TASK', 'No collection task'], ['NO_VISIBLE_EVIDENCE', 'No visible evidence'], ['BLOCKED', 'Blocked task'],
  ['OVERDUE', 'Overdue task'], ['AWAITING_REVIEW', 'Awaiting analyst review'], ['FURTHER_INTELLIGENCE', 'Further intelligence requested'],
] as const;

function useCoverage(path: string, role: Role) {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const [data, setData] = useState<CoverageList | Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (role === 'SUPER_ADMIN' && (!ready || !tenantId)) { setLoading(false); return; }
    let live = true;
    const separator = path.includes('?') ? '&' : '?';
    const url = `${API}/intelligence/coverage/${path}${role === 'SUPER_ADMIN' ? `${separator}tenantId=${encodeURIComponent(tenantId)}` : ''}`;
    setLoading(true); setError('');
    fetch(url, { credentials: 'include', cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error(`Coverage unavailable (${response.status})`); return response.json() as Promise<CoverageList | Coverage>; })
      .then(value => { if (live) setData(value); })
      .catch(cause => { if (live) setError(cause instanceof Error ? cause.message : 'Coverage unavailable'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, role, tenantId, ready]);
  return { data, loading, error };
}

function Signals({ row, role }: { row: Coverage; role: Role }) {
  return <div className="coverage-signals">
    <span>{row.signals.taskTotal} tasks · {row.signals.activeTasks} active · {row.signals.planned} planned · {row.signals.inProgress} in progress · {row.signals.blocked} blocked · {row.signals.overdue} overdue</span>
    <span>{row.signals.documentedResults} recorded results · {row.signals.completedFindings} completed with findings · {row.signals.completedNoFindings} completed with no findings</span>
    <span>{row.signals.visibleEvidence} visible SIR evidence · {row.signals.tasksWithSource} tasks with linked source</span>
    <span>Analyst answer: {row.signals.analystAnswer ? 'recorded' : 'not recorded'}</span>
    <span>{role === 'USER' ? 'Report and feedback context restricted' : `${row.signals.relatedReports ?? 0} related reports · ${row.signals.feedbackRequestReports ?? 0} related reports with further-intelligence feedback`}</span>
  </div>;
}

export function CoverageOverview({ role, pirId }: { role: Role; pirId?: string }) {
  const [page, setPage] = useState(1);
  const [outstandingOnly, setOutstandingOnly] = useState(true);
  const [gap, setGap] = useState('');
  const query = new URLSearchParams({ page: String(page), limit: '5' });
  if (pirId) query.set('pirId', pirId);
  if (outstandingOnly) query.set('outstandingOnly', 'true');
  if (gap) query.set('gap', gap);
  const { data, loading, error } = useCoverage(`sirs?${query}`, role);
  const result = data && 'items' in data ? data : null;
  return <section className="sir-evidence requirement-coverage" aria-label="Requirement coverage"><h3>Requirement Coverage</h3><p>Operational signals from existing collection, evidence, analysis, and authorized feedback. These are not a completeness or quality score.</p>
    <div className="coverage-filters"><label><input type="checkbox" checked={outstandingOnly} onChange={event => { setPage(1); setOutstandingOnly(event.target.checked); }} /> Outstanding requirements only</label><label>Gap type<select value={gap} onChange={event => { setPage(1); setGap(event.target.value); }}><option value="">All gap types</option>{gapOptions.filter(([code]) => role !== 'USER' || code !== 'FURTHER_INTELLIGENCE').map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label></div>
    {loading ? <p role="status">Loading requirement coverage...</p> : error ? <p role="alert">{error}</p> : result ? <>
      <p>{result.summary.requirements} requirements · {result.summary.withOperationalGaps} with operational gaps{result.restricted.reportsAndFeedback ? ' · report and feedback context restricted' : ''}</p>
      {result.items.length ? <div className="coverage-list">{result.items.map(row => <article key={row.sir.id} className="coverage-card"><h4><Link href={`/threat-intelligence/sirs?sirId=${encodeURIComponent(row.sir.id)}`}>{row.sir.reference} · {row.sir.title}</Link></h4><p>{row.sir.status.replaceAll('_', ' ')}</p><Signals row={row} role={role} /><div className="coverage-gaps">{row.gaps.length ? row.gaps.map(item => <p key={item.code}><strong>{gapOptions.find(([code]) => code === item.code)?.[1] || item.code}:</strong> {item.explanation}</p>) : <p>No operational gap flagged.</p>}</div><Link href={`/threat-intelligence/collection?sirId=${encodeURIComponent(row.sir.id)}`}>Open collection tasks</Link></article>)}</div> : <p>No requirements match these filters.</p>}
      {result.totalPages > 1 && <div className="pir-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {result.totalPages}</span><button type="button" disabled={page >= result.totalPages} onClick={() => setPage(page + 1)}>Next</button></div>}
    </> : <p>Coverage unavailable.</p>}
  </section>;
}

export function SirCoverage({ role, sirId }: { role: Role; sirId: string }) {
  const { data, loading, error } = useCoverage(`sirs/${encodeURIComponent(sirId)}`, role);
  const row = data && 'signals' in data ? data : null;
  return <section className="sir-evidence requirement-coverage" aria-label="SIR requirement coverage"><h3>Requirement Coverage</h3><p>Read-only workflow facts; completion does not mean this requirement has been answered.</p>
    {loading ? <p role="status">Loading requirement coverage...</p> : error ? <p role="alert">{error}</p> : row ? <><Signals row={row} role={role} /><h4>Operational gaps</h4>{row.gaps.length ? <div className="coverage-gaps">{row.gaps.map(item => <p key={item.code}><strong>{gapOptions.find(([code]) => code === item.code)?.[1] || item.code}:</strong> {item.explanation}</p>)}</div> : <p>No operational gap flagged.</p>}<p><Link href={`/threat-intelligence/collection?sirId=${encodeURIComponent(sirId)}`}>Open collection tasks</Link> · <Link href={`/threat-intelligence/sirs?sirId=${encodeURIComponent(sirId)}`}>Open SIR evidence</Link></p></> : <p>Coverage unavailable.</p>}
  </section>;
}
