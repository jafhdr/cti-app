'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useThreatIntelligenceTenant } from '../ThreatIntelligenceShell';
import { DisseminateReport } from './ReportDissemination';
import { ReportTraceability } from '../collection/TraceabilitySection';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Evidence = { id: string; sirId: string; relevanceNote: string | null; createdBy: { name: string }; source: { type: string; name: string; href: string } | null };
type Sir = { id: string; reference: string; title: string; question: string; analystAnswer: string | null; evidenceNotes: string | null; evidence: Evidence[] };
type Pir = { id: string; reference: string; title: string; question: string; stakeholder: { id: string; name: string; category: string }; sirs: Sir[] };
type Report = { id: string; reference: string; title: string; pirId: string; stakeholderId: string; summary: string; keyFindings: string | null; content: string; recommendedActions: string | null; informationGaps: string | null; confidence: string | null; tlp: string; reportType: string; status: 'DRAFT' | 'IN_REVIEW' | 'FINAL'; author: { name: string }; reviewer: { id: string; name: string } | null; createdAt: string; updatedAt: string; finalizedAt: string | null; sirIds: string[]; evidenceIds: string[]; sirs: Omit<Sir, 'evidence'>[]; evidence: Evidence[]; finalSnapshot: Report | null; pir: { reference: string; title: string }; stakeholder: { name: string } };
type Form = { reviewerId: string; reference: string; title: string; pirId: string; sirIds: string[]; evidenceIds: string[]; summary: string; keyFindings: string; content: string; recommendedActions: string; informationGaps: string; confidence: string; tlp: string; reportType: string };
const blank: Form = { reviewerId: '', reference: '', title: '', pirId: '', sirIds: [], evidenceIds: [], summary: '', keyFindings: '', content: '', recommendedActions: '', informationGaps: '', confidence: '', tlp: 'AMBER', reportType: 'STRATEGIC' };

export function AnalysisReportsWorkspace({ role }: { role: Role }) {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const canManage = role !== 'USER';
  const [items, setItems] = useState<Report[]>([]);
  const [pirs, setPirs] = useState<Pir[]>([]);
  const [reviewers, setReviewers] = useState<{ id: string; name: string }[]>([]);
  const [context, setContext] = useState<Pir | null>(null);
  const [selected, setSelected] = useState<Report | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [mode, setMode] = useState<'list' | 'edit' | 'preview' | 'detail'>('list');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('updatedAt:desc');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const openedLink = useRef('');
  const tenantQuery = role === 'SUPER_ADMIN' && tenantId ? `tenantId=${encodeURIComponent(tenantId)}` : '';
  const endpoint = `${API}/intelligence/reports/analysis`;
  const readyToLoad = role !== 'SUPER_ADMIN' || (ready && Boolean(tenantId));
  const request = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...init });
    const body: T & { message?: string | string[] } = await response.json();
    if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message || `Request failed (${response.status})`);
    return body;
  }, []);
  const load = useCallback(async () => {
    if (!readyToLoad) return;
    setLoading(true);
    try {
      const [sortBy, sortOrder] = sort.split(':');
      const query = new URLSearchParams({ page: String(page), limit: '10', sortBy, sortOrder });
      if (tenantQuery) query.set('tenantId', tenantId);
      if (search.trim()) query.set('search', search.trim());
      if (status) query.set('status', status);
      const data = await request<{ items: Report[]; total: number; totalPages: number }>(`${endpoint}?${query}`);
      setItems(data.items); setTotal(data.total); setPages(Math.max(data.totalPages, 1));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load reports'); } finally { setLoading(false); }
  }, [readyToLoad, sort, page, tenantQuery, tenantId, search, status, request, endpoint]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!readyToLoad) return; const query = new URLSearchParams({ limit: '100' }); if (tenantQuery) query.set('tenantId', tenantId); void request<{ items: Pir[] }>(`${API}/intelligence/pirs?${query}`).then(data => setPirs(data.items)).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not load PIRs')); }, [readyToLoad, tenantQuery, tenantId, request]);
  useEffect(() => { if (!readyToLoad) return; void request<{ id: string; name: string }[]>(`${API}/intelligence/pirs/responsible-users${tenantQuery ? `?${tenantQuery}` : ''}`).then(setReviewers).catch(() => setReviewers([])); }, [readyToLoad, tenantQuery, request]);
  const loadContext = useCallback(async (pirId: string) => {
    if (!pirId) { setContext(null); return; }
    try { const result = await request<Pir>(`${endpoint}/context/${encodeURIComponent(pirId)}${tenantQuery ? `?${tenantQuery}` : ''}`); setContext(result); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load PIR context'); }
  }, [endpoint, tenantQuery, request]);
  useEffect(() => { if (!readyToLoad || !canManage) return; const pirId = new URLSearchParams(window.location.search).get('pirId'); if (pirId) { setSelected(null); setForm({ ...blank, pirId }); setMode('edit'); void loadContext(pirId); } }, [readyToLoad, canManage, loadContext]);
  function create() { setSelected(null); setForm(blank); setContext(null); setError(''); setMode('edit'); }
  const open = useCallback(async (item: Pick<Report, 'id'>, edit = false) => {
    setError('');
    try {
      const full = await request<Report>(`${endpoint}/${item.id}${tenantQuery ? `?${tenantQuery}` : ''}`);
      setSelected(full);
      setForm({ reviewerId: full.reviewer?.id || '', reference: full.reference, title: full.title, pirId: full.pirId, sirIds: full.sirIds, evidenceIds: full.evidenceIds, summary: full.summary, keyFindings: full.keyFindings || '', content: full.content, recommendedActions: full.recommendedActions || '', informationGaps: full.informationGaps || '', confidence: full.confidence || '', tlp: full.tlp, reportType: full.reportType });
      await loadContext(full.pirId);
      setMode(edit ? 'edit' : 'detail');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open report'); }
  }, [request, endpoint, tenantQuery, loadContext]);
  useEffect(() => {
    if (!readyToLoad) return;
    const reportId = new URLSearchParams(window.location.search).get('reportId');
    if (!reportId || openedLink.current === reportId) return;
    openedLink.current = reportId;
    void open({ id: reportId });
  }, [readyToLoad, open]);
  function changePir(pirId: string) { setForm(current => ({ ...current, pirId, sirIds: [], evidenceIds: [] })); void loadContext(pirId); }
  function toggleSir(id: string) { setForm(current => ({ ...current, sirIds: current.sirIds.includes(id) ? current.sirIds.filter(value => value !== id) : [...current.sirIds, id], evidenceIds: current.sirIds.includes(id) ? current.evidenceIds.filter(value => context?.sirs.find(sir => sir.id === id)?.evidence.every(item => item.id !== value)) : current.evidenceIds })); }
  function toggleEvidence(id: string) { setForm(current => ({ ...current, evidenceIds: current.evidenceIds.includes(id) ? current.evidenceIds.filter(value => value !== id) : [...current.evidenceIds, id] })); }
  async function save(event?: FormEvent) {
    event?.preventDefault(); setBusy(true); setError('');
    try {
      const data = await request<Report>(`${endpoint}${selected ? `/${selected.id}` : ''}${tenantQuery ? `?${tenantQuery}` : ''}`, { method: selected ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, confidence: form.confidence || undefined }) });
      setSelected(data); setNotice('Draft saved.'); setMode('detail'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save draft'); } finally { setBusy(false); }
  }
  async function action(kind: 'review' | 'draft' | 'finalize') {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const route = kind === 'finalize' ? 'finalize' : 'status';
      const result = await request<Report>(`${endpoint}/${selected.id}/${route}${tenantQuery ? `?${tenantQuery}` : ''}`, { method: kind === 'finalize' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, ...(kind !== 'finalize' ? { body: JSON.stringify({ status: kind === 'review' ? 'IN_REVIEW' : 'DRAFT' }) } : {}) });
      setSelected(result); setNotice(kind === 'finalize' ? 'Report finalized.' : 'Status updated.'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change status'); } finally { setBusy(false); }
  }
  const display = selected?.status === 'FINAL' && selected.finalSnapshot ? selected.finalSnapshot : selected;
  return <section className="analysis-reports">
    <div className="source-heading"><div><span className="source-eyebrow">REQUIREMENT-LED ANALYSIS</span><h2>Intelligence analysis</h2><p>Author assessments from selected PIRs, SIR answers, and cited evidence.</p></div>{canManage && <Button view="action" size="l" onClick={create}>Create Report</Button>}</div>
    {notice && <p className="success" role="status">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}
    {mode === 'list' && <><div className="ioc-filters"><input aria-label="Search analysis reports" placeholder="Search reference or title" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /><select aria-label="Filter analysis status" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option>DRAFT</option><option>IN_REVIEW</option><option>FINAL</option></select><select aria-label="Sort analysis reports" value={sort} onChange={event => setSort(event.target.value)}><option value="updatedAt:desc">Recently updated</option><option value="createdAt:asc">Oldest first</option><option value="reference:asc">Reference A–Z</option><option value="title:asc">Title A–Z</option><option value="finalizedAt:desc">Recently finalized</option></select></div><Card>{loading ? <p role="status">Loading analysis reports...</p> : items.length ? <div className="cti-table-wrap" role="region" aria-label="Analysis reports" tabIndex={0}><table className="cti-table"><thead><tr><th>Reference</th><th>Title</th><th>PIR</th><th>Confidence</th><th>TLP</th><th>Status</th><th>Updated</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td data-label="Reference"><button className="source-name-button" onClick={() => void open(item)}>{item.reference}</button></td><td data-label="Title">{item.title}</td><td data-label="PIR">{item.pir.reference}</td><td data-label="Confidence">{item.confidence || 'Not set'}</td><td data-label="TLP">{item.tlp}</td><td data-label="Status">{item.status.replaceAll('_', ' ')}</td><td data-label="Updated">{new Date(item.updatedAt).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <p>No analysis reports yet. Select a PIR and create the first report.</p>}</Card><div className="source-pagination"><span>{total} reports · Page {page} of {pages}</span><div><Button view="outlined" size="s" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button view="outlined" size="s" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div></>}
    {mode === 'edit' && <Card><form className="analysis-editor" onSubmit={event => void save(event)}><div className="analysis-editor-head"><div><span className="source-eyebrow">REPORT AUTHORING</span><h3>{selected ? `Edit ${selected.reference}` : 'New intelligence report'}</h3></div><Button view="outlined" size="s" type="button" onClick={() => setMode('list')}>Close</Button></div>
      <div className="analysis-editor-grid"><label>Report reference<input required maxLength={40} value={form.reference} onChange={event => setForm({ ...form, reference: event.target.value })} /></label><label>Title<input required maxLength={200} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label><label>PIR<select required value={form.pirId} onChange={event => changePir(event.target.value)}><option value="">Select PIR</option>{pirs.map(pir => <option key={pir.id} value={pir.id}>{pir.reference} · {pir.title}</option>)}</select></label><label>Reviewer (optional)<select value={form.reviewerId} onChange={event => setForm({ ...form, reviewerId: event.target.value })}><option value="">Unassigned</option>{reviewers.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label>Report type<select value={form.reportType} onChange={event => setForm({ ...form, reportType: event.target.value })}><option>STRATEGIC</option><option>TACTICAL</option><option>OPERATIONAL</option><option>TECHNICAL</option></select></label></div>
      {context && <div className="analysis-context"><p className="source-eyebrow">REQUIREMENT CONTEXT</p><h4>{context.reference} · {context.title}</h4><p>{context.question}</p><p><strong>Stakeholder:</strong> {context.stakeholder.name} · {context.stakeholder.category}</p><div className="analysis-sirs"><h4>Select relevant SIRs</h4>{context.sirs.length ? context.sirs.map(sir => <article key={sir.id}><label className="analysis-choice"><input type="checkbox" checked={form.sirIds.includes(sir.id)} onChange={() => toggleSir(sir.id)} /><strong>{sir.reference} · {sir.title}</strong></label><p>{sir.question}</p><p><strong>Analyst answer:</strong> {sir.analystAnswer || 'No answer recorded'}</p>{sir.evidenceNotes && <p><strong>Evidence notes:</strong> {sir.evidenceNotes}</p>}{form.sirIds.includes(sir.id) && <div className="analysis-evidence"><strong>Cite linked evidence</strong>{sir.evidence.length ? sir.evidence.map(evidence => <label className="analysis-choice" key={evidence.id}><input type="checkbox" checked={form.evidenceIds.includes(evidence.id)} onChange={() => toggleEvidence(evidence.id)} /><span>{evidence.source?.type} · {evidence.source?.name}<small>{evidence.relevanceNote || 'No relevance note'} · linked by {evidence.createdBy.name}</small></span></label>) : <p>No linked evidence.</p>}</div>}</article>) : <p>No SIRs linked to this PIR.</p>}</div></div>}
      <div className="analysis-editor-grid"><label className="analysis-wide">Executive summary<textarea value={form.summary} onChange={event => setForm({ ...form, summary: event.target.value })} placeholder="Summarize the analyst's conclusions" /></label><label className="analysis-wide">Key findings<textarea value={form.keyFindings} onChange={event => setForm({ ...form, keyFindings: event.target.value })} placeholder="Separate observed facts and analytical interpretation" /></label><label className="analysis-wide">Analytical assessment<textarea value={form.content} onChange={event => setForm({ ...form, content: event.target.value })} placeholder="Explain the reasoning and cite selected evidence" /></label><label className="analysis-wide">Recommended actions<textarea value={form.recommendedActions} onChange={event => setForm({ ...form, recommendedActions: event.target.value })} /></label><label className="analysis-wide">Information gaps and limitations<textarea value={form.informationGaps} onChange={event => setForm({ ...form, informationGaps: event.target.value })} placeholder="Document uncertainty and conflicting evidence" /></label><label>Confidence<select value={form.confidence} onChange={event => setForm({ ...form, confidence: event.target.value })}><option value="">Select confidence</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></label><label>TLP<select value={form.tlp} onChange={event => setForm({ ...form, tlp: event.target.value })}><option>CLEAR</option><option>GREEN</option><option>AMBER</option><option>AMBER_STRICT</option><option>RED</option></select></label></div>
      <div className="analysis-actions"><Button view="outlined" size="s" type="button" onClick={() => setMode('preview')}>Preview</Button><Button view="action" size="s" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save draft'}</Button></div></form></Card>}
    {mode === 'preview' && <Card><div className="analysis-editor-head"><div><span className="source-eyebrow">PREVIEW · UNSAVED CHANGES</span><h3>{form.reference} · {form.title}</h3></div><Button view="outlined" size="s" onClick={() => setMode('edit')}>Back to editor</Button></div><ReportBody report={form} context={context} selectedSirs={form.sirIds} selectedEvidence={form.evidenceIds} /><div className="analysis-actions"><Button view="action" size="s" disabled={busy} onClick={() => void save()}>Save draft</Button></div></Card>}
    {mode === 'detail' && selected && display && <Card><div className="analysis-editor-head"><div><span className="source-eyebrow">{selected.status.replaceAll('_', ' ')} · {selected.tlp}</span><h3>{display.reference} · {display.title}</h3><p>Authored by {display.author?.name || selected.author.name}{selected.reviewer ? ` · Reviewer: ${selected.reviewer.name}` : ''} · Updated {new Date(selected.updatedAt).toLocaleString()}{selected.finalizedAt ? ` · Finalized ${new Date(selected.finalizedAt).toLocaleString()}` : ''}</p></div><Button view="outlined" size="s" onClick={() => setMode('list')}>Back to reports</Button></div>{selected.status === 'FINAL' && <p className="analysis-frozen">Finalized snapshot. Source links below open current live records; the assessment shown here is frozen.</p>}<ReportBody report={display} context={context} selectedSirs={display.sirIds} selectedEvidence={display.evidenceIds} /><ReportTraceability key={selected.id} reportId={selected.id} role={role} />{canManage && selected.status === 'FINAL' && <DisseminateReport reportId={selected.id} role={role} />}<div className="analysis-actions">{canManage && selected.status === 'DRAFT' && <><Button view="outlined" size="s" onClick={() => void open(selected, true)}>Edit draft</Button><Button view="action" size="s" disabled={busy} onClick={() => void action('review')}>Move to review</Button></>}{canManage && selected.status === 'IN_REVIEW' && <><Button view="outlined" size="s" disabled={busy} onClick={() => void action('draft')}>Return to draft</Button><Button view="action" size="s" disabled={busy} onClick={() => void action('finalize')}>Finalize report</Button></>}</div></Card>}
  </section>;
}
function ReportBody({ report, context, selectedSirs, selectedEvidence }: { report: Form | Report; context: Pir | null; selectedSirs: string[]; selectedEvidence: string[] }) {
  const sirs = 'sirs' in report ? report.sirs : context?.sirs.filter(item => selectedSirs.includes(item.id)) || [];
  const evidence = 'evidence' in report ? report.evidence : context?.sirs.flatMap(item => item.evidence).filter(item => selectedEvidence.includes(item.id)) || [];
  const stakeholder = 'stakeholder' in report ? report.stakeholder.name : context?.stakeholder.name;
  const pirReference = 'pir' in report ? report.pir.reference : context?.reference;
  return <div className="analysis-document"><p><strong>PIR:</strong> {pirReference || ''} · <strong>Stakeholder:</strong> {stakeholder || '—'}</p><p><strong>Confidence:</strong> {report.confidence || 'Not set'} · <strong>TLP:</strong> {report.tlp} · <strong>Type:</strong> {report.reportType}</p><section><h4>Executive summary</h4><p>{report.summary || 'Not written'}</p></section><section><h4>Key findings</h4><p>{report.keyFindings || 'Not written'}</p></section><section><h4>Analytical assessment</h4><p>{report.content || 'Not written'}</p></section><section><h4>Recommended actions</h4><p>{report.recommendedActions || 'Not written'}</p></section><section><h4>Information gaps and limitations</h4><p>{report.informationGaps || 'Not written'}</p></section><section><h4>Selected SIRs and recorded answers</h4>{sirs.length ? sirs.map(sir => <div key={sir.id}><strong>{sir.reference} · {sir.title}</strong><p>{sir.analystAnswer || 'No answer recorded'}</p></div>) : <p>No SIR selected</p>}</section><section><h4>Cited evidence</h4>{evidence.length ? evidence.map(item => <div key={item.id}><strong>{item.source?.type} · {item.source?.name}</strong><p>Source fact: {item.relevanceNote || 'No relevance note'} · linked by {item.createdBy.name}</p>{item.source && <Link href={item.source.href}>Open live source</Link>}</div>) : <p>No evidence cited</p>}</section></div>;
}
