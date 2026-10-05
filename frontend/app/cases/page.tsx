'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import CreateCaseModal from './create-case-modal';
import { useCaseMutationAccess, useCaseTenant } from './case-access';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const statuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

interface CaseItem {
  id: string; caseNumber: string; title: string; status: string; priority: string;
  assignee?: { name: string } | null; createdAt: string; updatedAt?: string;
}

const label = (value: string) => value.replaceAll('_', ' ');
const date = (value: string) => new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

export default function CasesPage() {
  const canMutateCases = useCaseMutationAccess();
  const { tenantId, ready, role } = useCaseTenant();
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCases = useCallback(async (signal?: AbortSignal) => {
    if (!ready) { setCases([]); setTotal(0); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (query) params.set('search', query);
      if (status) params.set('status', status);
      if (priority) params.set('priority', priority);
      if (role === 'SUPER_ADMIN') params.set('tenantId', tenantId);
      const response = await fetch(`${API}/cases?${params}`, { credentials: 'include', signal });
      if (!response.ok) throw new Error('Failed to fetch');
      const data: { items: CaseItem[]; total: number } = await response.json();
      setCases(data.items); setTotal(data.total);
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : 'Failed to fetch');
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [page, query, status, priority, tenantId, ready, role]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchCases(controller.signal);
    return () => controller.abort();
  }, [fetchCases]);
  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setQuery(search.trim()); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const reset = () => { setSearch(''); setQuery(''); setStatus(''); setPriority(''); setPage(1); };
  const changed = Boolean(query || status || priority);

  return <main className="case-page editorial-module case-workspace">
    <div className="case-heading-row"><div className="editorial-heading"><span className="source-eyebrow">CASE MANAGEMENT</span><h1>Case Management</h1><p>Track investigations and coordinate response activity.</p></div>{canMutateCases && <button onClick={() => setShowCreateModal(true)} className="soc-button-primary case-action"><Plus size={18} /> New Case</button>}</div>
    <section aria-label="Case overview"><div className="editorial-section-heading"><span className="source-eyebrow">CASE OVERVIEW</span><h2>Operations at a glance</h2></div><div className="editorial-metrics case-metrics"><div><span>{changed ? 'Matching cases' : 'Total cases'}</span><strong>{loading || error ? '—' : total}</strong></div><div><span>Open</span><strong>{!loading && !error && total <= 25 && !changed ? cases.filter(c => c.status === 'OPEN').length : 'Not available'}</strong></div><div><span>In progress</span><strong>{!loading && !error && total <= 25 && !changed ? cases.filter(c => c.status === 'IN_PROGRESS').length : 'Not available'}</strong></div><div><span>Critical</span><strong>{!loading && !error && total <= 25 && !changed ? cases.filter(c => c.priority === 'CRITICAL').length : 'Not available'}</strong></div></div></section>
    <section className="case-activity" aria-label="Case activity"><div><span className="source-eyebrow">CASE ACTIVITY</span><h2>Recent investigations</h2><p>Review the latest cases in your workspace.</p></div><div className="case-activity-items">{cases.slice(0, 3).map(c => <Link key={c.id} href={`/cases/${c.id}`} aria-label={`Recent investigation: ${c.title}`}><span>{c.caseNumber}</span><strong>{c.title}</strong><small>{label(c.status)}</small></Link>)}{!loading && cases.length === 0 && <p>No recent cases available.</p>}</div></section>
    <section aria-label="Case workspace"><div className="editorial-section-heading"><span className="source-eyebrow">CASE WORKSPACE</span><h2>Cases</h2><p>Investigate, assign, and track security incidents.</p></div><div className="case-panel case-inventory"><form className="case-filters" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(search.trim()); }}><label>Search<input aria-label="Search cases" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search title, description, or case number" /></label><label>Status<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{statuses.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label><label>Priority<select value={priority} onChange={event => { setPriority(event.target.value); setPage(1); }}><option value="">All priorities</option>{priorities.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label><button type="button" onClick={reset} className="soc-button-outline" disabled={!changed && !search}>Clear filters</button></form>
      {error ? <div role="alert" className="error rounded p-6"><p>{error}</p><button type="button" onClick={() => void fetchCases()} className="mt-3 font-semibold underline">Retry</button></div> : loading ? <p role="status" className="case-empty">Loading cases...</p> : cases.length === 0 ? <p className="case-empty">No cases found</p> : <><div className="case-table-wrap"><table className="case-table"><thead><tr><th>Case</th><th>Title</th><th>Priority</th><th>Status</th><th>Assignee</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{cases.map(c => <tr key={c.id}><td><Link href={`/cases/${c.id}`}>{c.caseNumber}</Link></td><td className="case-table-title">{c.title}</td><td><span className={`case-badge case-priority-${c.priority.toLowerCase()}`}>{label(c.priority)}</span></td><td><span className={`case-badge case-status-${c.status.toLowerCase()}`}>{label(c.status)}</span></td><td>{c.assignee?.name || 'Unassigned'}</td><td>{date(c.updatedAt || c.createdAt)}</td><td><Link href={`/cases/${c.id}`} className="case-open">Open case</Link></td></tr>)}</tbody></table></div><div className="case-mobile-list">{cases.map(c => <article key={c.id} className="case-mobile-card"><span className="source-eyebrow">CASE · {c.caseNumber}</span><h3>{c.title}</h3><div><span className={`case-badge case-priority-${c.priority.toLowerCase()}`}>{label(c.priority)}</span><span className={`case-badge case-status-${c.status.toLowerCase()}`}>{label(c.status)}</span></div><dl><div><dt>Assignee</dt><dd>{c.assignee?.name || 'Unassigned'}</dd></div><div><dt>Updated</dt><dd>{date(c.updatedAt || c.createdAt)}</dd></div></dl><Link href={`/cases/${c.id}`} className="case-open">Open case →</Link></article>)}</div></>}
    </div><div className="case-pagination"><span>Showing {total === 0 ? 0 : (page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total}</span><div><button disabled={page === 1 || loading} onClick={() => setPage(page - 1)} className="soc-button-outline">Previous</button><button disabled={page * 25 >= total || loading} onClick={() => setPage(page + 1)} className="soc-button-outline">Next</button></div></div></section>
    {showCreateModal && ready && <CreateCaseModal tenantId={role === 'SUPER_ADMIN' ? tenantId : undefined} onClose={() => setShowCreateModal(false)} onSuccess={() => void fetchCases()} />}
  </main>;
}
