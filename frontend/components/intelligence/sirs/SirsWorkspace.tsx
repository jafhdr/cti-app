'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FormModal } from '@/components/ui/modal-patterns';
import { SirEvidenceSection } from './SirEvidenceSection';
import { SirCollectionSection } from '../collection/SirCollectionSection';
import { SirTraceability } from '../collection/TraceabilitySection';
import { CoverageOverview, SirCoverage } from './RequirementCoverage';
import { useThreatIntelligenceTenant } from '../ThreatIntelligenceShell';
import { FeedbackFollowUps } from '../reports/FeedbackFollowUps';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Pir = { id: string; reference: string; title: string; status: string };
type User = { id: string; name: string };
type Sir = { id: string; pirId: string; pir: Pir; reference: string; title: string; question: string; description: string | null; intelligenceContext: string | null; knowledgeGaps: string | null; collectionGuidance: string | null; priority: string; status: string; responsibleUserId: string | null; responsibleUser: User | null; dueDate: string | null; expectedAnswerCriteria: string | null; analystAnswer: string | null; evidenceNotes: string | null };
type Form = { pirId: string; reference: string; title: string; question: string; description: string; intelligenceContext: string; knowledgeGaps: string; collectionGuidance: string; priority: string; responsibleUserId: string; dueDate: string; expectedAnswerCriteria: string };
const blank: Form = { pirId: '', reference: '', title: '', question: '', description: '', intelligenceContext: '', knowledgeGaps: '', collectionGuidance: '', priority: 'MEDIUM', responsibleUserId: '', dueDate: '', expectedAnswerCriteria: '' };
const priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const statuses = ['OPEN', 'IN_COLLECTION', 'IN_ANALYSIS', 'ANSWERED', 'EXPIRED'];
const next: Record<string, string[]> = { OPEN: ['IN_COLLECTION', 'EXPIRED'], IN_COLLECTION: ['IN_ANALYSIS', 'EXPIRED'], IN_ANALYSIS: ['ANSWERED', 'EXPIRED'], ANSWERED: ['OPEN'], EXPIRED: ['OPEN'] };
export function SirsWorkspace({ role }: { role: Role }) {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const [items, setItems] = useState<Sir[]>([]);
  const [pirs, setPirs] = useState<Pir[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<Sir | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [modal, setModal] = useState(false);
  const [answerModal, setAnswerModal] = useState(false);
  const [answer, setAnswer] = useState('');
  const [evidence, setEvidence] = useState('');
  const [pirId, setPirId] = useState('');
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('updatedAt:desc');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canManage = role !== 'USER';
  const tenantParam = role === 'SUPER_ADMIN' ? `tenantId=${encodeURIComponent(tenantId)}` : '';
  const endpoint = `${API}/intelligence/sirs`;
  useEffect(() => { const params = new URLSearchParams(window.location.search); const id = params.get('pirId'); if (id) { setPirId(id); setForm(previous => ({ ...previous, pirId: id })); } if (params.get('create') === '1') setModal(true); }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('sirId');
    if (!id || (role === 'SUPER_ADMIN' && (!ready || !tenantId))) return;
    fetch(`${endpoint}/${encodeURIComponent(id)}${tenantParam ? `?${tenantParam}` : ''}`, { credentials: 'include', cache: 'no-store' }).then(async response => response.ok ? response.json() : null).then(row => { if (row) setSelected(row); }).catch(() => {});
  }, [role, ready, tenantId, tenantParam, endpoint]);
  const load = useCallback(async () => {
    if (role === 'SUPER_ADMIN' && (!ready || !tenantId)) return;
    setLoading(true); setError('');
    const [sortBy, sortOrder] = sort.split(':');
    const query = new URLSearchParams({ page: String(page), limit: '10', sortBy, sortOrder });
    if (tenantParam) query.set('tenantId', tenantId);
    if (pirId) query.set('pirId', pirId);
    if (search.trim()) query.set('search', search.trim());
    if (priority) query.set('priority', priority);
    if (status) query.set('status', status);
    try {
      const response = await fetch(`${endpoint}?${query}`, { credentials: 'include', cache: 'no-store' });
      const data: { items?: Sir[]; total?: number; totalPages?: number; message?: string } = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not load SIRs');
      setItems(data.items || []); setTotal(data.total || 0); setPages(Math.max(data.totalPages || 1, 1));
      setSelected(previous => data.items?.find(item => item.id === previous?.id) || previous);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load SIRs'); } finally { setLoading(false); }
  }, [role, ready, tenantId, tenantParam, pirId, search, priority, status, sort, page, endpoint]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (role === 'SUPER_ADMIN' && (!ready || !tenantId)) return;
    const suffix = tenantParam ? `?${tenantParam}` : '';
    Promise.all([fetch(`${API}/intelligence/pirs?limit=100${tenantParam ? `&${tenantParam}` : ''}`, { credentials: 'include' }), fetch(`${API}/intelligence/pirs/responsible-users${suffix}`, { credentials: 'include' })]).then(async ([a, b]) => { if (!a.ok || !b.ok) throw Error('Could not load SIR associations'); const data: { items: Pir[] } = await a.json(); setPirs(data.items); setUsers(await b.json()); }).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not load associations'));
  }, [role, ready, tenantId, tenantParam]);
  function edit(item?: Sir) { setSelected(item || null); setForm(item ? { pirId: item.pirId, reference: item.reference, title: item.title, question: item.question, description: item.description || '', intelligenceContext: item.intelligenceContext || '', knowledgeGaps: item.knowledgeGaps || '', collectionGuidance: item.collectionGuidance || '', priority: item.priority, responsibleUserId: item.responsibleUserId || '', dueDate: item.dueDate?.slice(0, 10) || '', expectedAnswerCriteria: item.expectedAnswerCriteria || '' } : { ...blank, pirId }); setError(''); setModal(true); }
  async function request(path: string, method: string, body: object) {
    const response = await fetch(`${endpoint}${path}${tenantParam ? `?${tenantParam}` : ''}`, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data: { message?: string; id?: string } = await response.json();
    if (!response.ok) throw new Error(data.message || 'SIR action failed');
    return data;
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    try { const row = await request(selected ? `/${selected.id}` : '', selected ? 'PATCH' : 'POST', { ...form, responsibleUserId: form.responsibleUserId || null, dueDate: form.dueDate ? `${form.dueDate}T00:00:00.000Z` : null }); setModal(false); setNotice(selected ? 'SIR updated.' : 'SIR created.'); if (row.id) { const params = new URLSearchParams(window.location.search); params.delete('create'); params.set('sirId', row.id); window.history.replaceState(null, '', `${window.location.pathname}?${params}`); } await load(); if (row.id) { const response = await fetch(`${endpoint}/${row.id}${tenantParam ? `?${tenantParam}` : ''}`, { credentials: 'include' }); if (response.ok) setSelected(await response.json()); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save SIR'); } finally { setSaving(false); }
  }
  async function changeStatus(value: string) {
    if (!selected) return; setSaving(true); setError('');
    try { const row = await request(`/${selected.id}/status`, 'PATCH', { status: value }); setSelected(row as Sir); setNotice(`SIR status changed to ${value}.`); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change status'); } finally { setSaving(false); }
  }
  async function recordAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; setSaving(true); setError('');
    try { const row = await request(`/${selected.id}/answer`, 'PATCH', { analystAnswer: answer, evidenceNotes: evidence }); setSelected(row as Sir); setAnswerModal(false); setNotice('Analyst answer recorded.'); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not record answer'); } finally { setSaving(false); }
  }
  return <section className="pir-workspace">
    <header className="editorial-heading"><div><p>INTELLIGENCE REQUIREMENTS</p><h1>Specific Intelligence Requirements</h1><p>Focused collection and analysis questions under a PIR.</p></div>{canManage && <Button onClick={() => edit()}>Add SIR</Button>}</header>
    <CoverageOverview role={role} pirId={pirId || undefined} />
    <div className="pir-controls"><label>Search<input value={search} onChange={event => { setPage(1); setSearch(event.target.value); }} placeholder="Reference, title, or question" /></label><label>Parent PIR<select value={pirId} onChange={event => { setPage(1); setPirId(event.target.value); }}><option value="">All PIRs</option>{pirs.map(value => <option key={value.id} value={value.id}>{value.reference} · {value.title}</option>)}</select></label><label>Priority<select value={priority} onChange={event => { setPage(1); setPriority(event.target.value); }}><option value="">All priorities</option>{priorities.map(value => <option key={value}>{value}</option>)}</select></label><label>Status<select value={status} onChange={event => { setPage(1); setStatus(event.target.value); }}><option value="">All statuses</option>{statuses.map(value => <option key={value}>{value}</option>)}</select></label><label>Sort<select value={sort} onChange={event => { setPage(1); setSort(event.target.value); }}><option value="updatedAt:desc">Recently updated</option><option value="dueDate:asc">Due date</option><option value="priority:desc">Priority</option><option value="reference:asc">Reference</option></select></label></div>
    {notice && <p role="status" className="pir-notice">{notice}</p>}{error && !modal && !answerModal && <p role="alert" className="error">{error}</p>}
    {loading ? <p role="status">Loading SIRs...</p> : items.length ? <><p>{total} SIRs</p><div className="pir-list">{items.map(item => <article key={item.id} className="pir-card"><button type="button" onClick={() => setSelected(item)}><span className="pir-reference">{item.reference}</span><strong>{item.title}</strong><span>{item.pir.reference} · <span className={`pir-priority pir-priority-${item.priority.toLowerCase()}`}>{item.priority}</span> · {item.status.replaceAll('_', ' ')}{item.dueDate ? ` · Due ${new Date(item.dueDate).toLocaleDateString()}` : ''}</span></button>{canManage && <Button variant="outline" onClick={() => edit(item)}>Edit</Button>}</article>)}</div><div className="pir-pagination"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {pages}</span><Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></> : <p>No SIRs match these filters.</p>}
    {selected && !modal && <aside className="pir-detail"><div className="pir-detail-head"><div><p>SIR PROFILE · {selected.reference}</p><h2>{selected.title}</h2><span className={`pir-priority pir-priority-${selected.priority.toLowerCase()}`}>{selected.priority}</span> · {selected.status.replaceAll('_', ' ')}</div><Button variant="outline" onClick={() => setSelected(null)}>Close</Button></div><h3>Specific intelligence question</h3><p>{selected.question}</p><dl><div><dt>Parent PIR</dt><dd><Link href={`/threat-intelligence/pirs?pirId=${encodeURIComponent(selected.pirId)}`}>{selected.pir.reference} · {selected.pir.title}</Link></dd></div><div><dt>Responsible user</dt><dd>{selected.responsibleUser?.name || 'Unassigned'}</dd></div><div><dt>Due date</dt><dd>{selected.dueDate ? new Date(selected.dueDate).toLocaleDateString() : 'Not set'}</dd></div>{([['Description', selected.description], ['Intelligence context', selected.intelligenceContext], ['Knowledge gaps', selected.knowledgeGaps], ['Collection guidance', selected.collectionGuidance], ['Expected answer criteria', selected.expectedAnswerCriteria], ['Analyst answer', selected.analystAnswer], ['Evidence notes', selected.evidenceNotes]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not specified'}</dd></div>)}</dl><SirCoverage key={`coverage-${selected.id}`} sirId={selected.id} role={role} />{role !== 'USER' && process.env.NEXT_PUBLIC_FEEDBACK_FOLLOW_UP_ENABLED === 'true' && <FeedbackFollowUps key={`feedback-${selected.id}`} role={role} sirId={selected.id} />}<SirCollectionSection key={`collection-${selected.id}`} sirId={selected.id} role={role} /><SirTraceability key={`trace-${selected.id}`} sirId={selected.id} role={role} /><SirEvidenceSection key={selected.id} sirId={selected.id} role={role} tenantId={tenantId} />{canManage && <div className="pir-actions"><Button variant="outline" onClick={() => edit(selected)}>Edit SIR</Button>{(selected.status === 'IN_ANALYSIS' || selected.status === 'ANSWERED') && <Button variant="outline" onClick={() => { setAnswer(selected.analystAnswer || ''); setEvidence(selected.evidenceNotes || ''); setAnswerModal(true); }}>Record answer</Button>}{next[selected.status].map(value => <Button key={value} variant="outline" disabled={saving || (value === 'ANSWERED' && !selected.analystAnswer?.trim())} onClick={() => void changeStatus(value)}>{value === 'OPEN' ? 'Reopen' : `Move to ${value.replaceAll('_', ' ')}`}</Button>)}</div>}</aside>}
    <FormModal open={modal} onOpenChange={setModal} title={selected ? 'Edit SIR' : 'Add SIR'} onSubmit={event => void save(event)} loading={saving} error={modal ? error : ''} submitLabel={selected ? 'Save changes' : 'Create SIR'}><div className="pir-form"><label>Parent PIR<select required value={form.pirId} onChange={event => setForm({ ...form, pirId: event.target.value })}><option value="">Select PIR</option>{selected?.pir && !pirs.some(value => value.id === selected.pirId) && <option value={selected.pirId}>{selected.pir.reference}</option>}{pirs.map(value => <option key={value.id} value={value.id} disabled={value.status === 'ANSWERED' || value.status === 'EXPIRED'}>{value.reference} · {value.title}{value.status === 'ANSWERED' || value.status === 'EXPIRED' ? ' (closed)' : ''}</option>)}</select></label><label>Reference<input required maxLength={40} value={form.reference} onChange={event => setForm({ ...form, reference: event.target.value })} /></label><label>Title<input required maxLength={200} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label><label>Specific intelligence question<textarea required maxLength={4000} value={form.question} onChange={event => setForm({ ...form, question: event.target.value })} /></label><label>Priority<select value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}>{priorities.map(value => <option key={value}>{value}</option>)}</select></label><label>Responsible user<select value={form.responsibleUserId} onChange={event => setForm({ ...form, responsibleUserId: event.target.value })}><option value="">Unassigned</option>{users.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label><label>Due date<input type="date" value={form.dueDate} onChange={event => setForm({ ...form, dueDate: event.target.value })} /></label>{(['description', 'intelligenceContext', 'knowledgeGaps', 'collectionGuidance', 'expectedAnswerCriteria'] as const).map(key => <label key={key}>{({ description: 'Description', intelligenceContext: 'Intelligence context', knowledgeGaps: 'Knowledge gaps', collectionGuidance: 'Collection guidance', expectedAnswerCriteria: 'Expected answer criteria' })[key]}<textarea maxLength={4000} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>)}</div></FormModal>
    <FormModal open={answerModal} onOpenChange={setAnswerModal} title="Record analyst answer" onSubmit={event => void recordAnswer(event)} loading={saving} error={answerModal ? error : ''} submitLabel="Save answer"><div className="pir-form"><label>Analyst answer<textarea required maxLength={8000} value={answer} onChange={event => setAnswer(event.target.value)} /></label><label>Evidence notes<textarea maxLength={4000} value={evidence} onChange={event => setEvidence(event.target.value)} /></label></div></FormModal>
  </section>;
}
