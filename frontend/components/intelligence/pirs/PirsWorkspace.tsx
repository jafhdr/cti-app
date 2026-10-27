'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FormModal } from '@/components/ui/modal-patterns';
import { useThreatIntelligenceTenant } from '../ThreatIntelligenceShell';
import { CoverageOverview } from '../sirs/RequirementCoverage';
import { FeedbackFollowUps } from '../reports/FeedbackFollowUps';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Stakeholder = { id: string; name: string; category: string; intelligenceInterests: string | null; isActive?: boolean };
type User = { id: string; name: string };
type Pir = { id: string; reference: string; title: string; question: string; description: string | null; strategicContext: string | null; priority: string; status: string; stakeholderId: string; stakeholder: Stakeholder; responsibleUserId: string | null; responsibleUser: User | null; timeHorizon: string | null; dueDate: string | null; expectedOutcome: string | null };
type Form = { reference: string; title: string; question: string; description: string; strategicContext: string; priority: string; stakeholderId: string; responsibleUserId: string; timeHorizon: string; dueDate: string; expectedOutcome: string };
const blank: Form = { reference: '', title: '', question: '', description: '', strategicContext: '', priority: 'MEDIUM', stakeholderId: '', responsibleUserId: '', timeHorizon: '', dueDate: '', expectedOutcome: '' };
const priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const statuses = ['OPEN', 'IN_COLLECTION', 'IN_ANALYSIS', 'ANSWERED', 'EXPIRED'];
const next: Record<string, string[]> = { OPEN: ['IN_COLLECTION', 'EXPIRED'], IN_COLLECTION: ['IN_ANALYSIS', 'EXPIRED'], IN_ANALYSIS: ['ANSWERED', 'EXPIRED'], ANSWERED: ['OPEN'], EXPIRED: ['OPEN'] };
export function PirsWorkspace({ role }: { role: Role }) {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const [items, setItems] = useState<Pir[]>([]);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<Pir | null>(null);
  const [linkedSirs, setLinkedSirs] = useState<{ id: string; reference: string; title: string; status: string }[]>([]);
  const [sirTotal, setSirTotal] = useState(0);
  const [sirStatusCounts, setSirStatusCounts] = useState<Record<string, number>>({});
  const [form, setForm] = useState<Form>(blank);
  const [modal, setModal] = useState(false);
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('');
  const [stakeholderId, setStakeholderId] = useState('');
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
  const endpoint = `${API}/intelligence/pirs`;
  useEffect(() => { const id = new URLSearchParams(window.location.search).get('stakeholderId'); if (id) setStakeholderId(id); }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('pirId');
    if (!id || (role === 'SUPER_ADMIN' && (!ready || !tenantId))) return;
    fetch(`${endpoint}/${encodeURIComponent(id)}${tenantParam ? `?${tenantParam}` : ''}`, { credentials: 'include', cache: 'no-store' }).then(async response => response.ok ? response.json() : null).then(item => { if (item) setSelected(item); }).catch(() => {});
  }, [role, ready, tenantId, tenantParam, endpoint]);
  const load = useCallback(async () => {
    if (role === 'SUPER_ADMIN' && (!ready || !tenantId)) return;
    setLoading(true); setError('');
    const [sortBy, sortOrder] = sort.split(':');
    const query = new URLSearchParams({ page: String(page), limit: '10', sortBy, sortOrder });
    if (tenantParam) query.set('tenantId', tenantId);
    if (search.trim()) query.set('search', search.trim());
    if (priority) query.set('priority', priority);
    if (status) query.set('status', status);
    if (stakeholderId) query.set('stakeholderId', stakeholderId);
    try {
      const response = await fetch(`${endpoint}?${query}`, { credentials: 'include', cache: 'no-store' });
      const data: { items?: Pir[]; total?: number; totalPages?: number; message?: string } = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to load PIRs');
      setItems(data.items || []); setTotal(data.total || 0); setPages(Math.max(data.totalPages || 1, 1));
      setSelected(previous => data.items?.find(item => item.id === previous?.id) || null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to load PIRs'); } finally { setLoading(false); }
  }, [role, ready, tenantId, tenantParam, page, search, priority, status, stakeholderId, sort, endpoint]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (role === 'SUPER_ADMIN' && !tenantId) return;
    const suffix = tenantParam ? `?${tenantParam}` : '';
    Promise.all([fetch(`${endpoint}/eligible-stakeholders${suffix}`, { credentials: 'include' }), fetch(`${endpoint}/responsible-users${suffix}`, { credentials: 'include' })]).then(async ([a, b]) => { if (!a.ok || !b.ok) throw Error('Could not load PIR associations'); setStakeholders(await a.json()); setUsers(await b.json()); }).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not load associations'));
  }, [role, tenantId, tenantParam, endpoint]);
  useEffect(() => {
    if (!selected) { setLinkedSirs([]); setSirTotal(0); setSirStatusCounts({}); return; }
    const query = new URLSearchParams({ pirId: selected.id, limit: '100' });
    if (tenantParam) query.set('tenantId', tenantId);
    fetch(`${API}/intelligence/sirs?${query}`, { credentials: 'include', cache: 'no-store' }).then(async response => response.ok ? response.json() : { items: [], total: 0 }).then(data => { setLinkedSirs(data.items || []); setSirTotal(data.total || 0); setSirStatusCounts(data.statusCounts || {}); }).catch(() => { setLinkedSirs([]); setSirTotal(0); setSirStatusCounts({}); });
  }, [selected?.id, tenantParam, tenantId]);
  function edit(item?: Pir) { setSelected(item || null); setForm(item ? { reference: item.reference, title: item.title, question: item.question, description: item.description || '', strategicContext: item.strategicContext || '', priority: item.priority, stakeholderId: item.stakeholderId, responsibleUserId: item.responsibleUserId || '', timeHorizon: item.timeHorizon || '', dueDate: item.dueDate?.slice(0, 10) || '', expectedOutcome: item.expectedOutcome || '' } : { ...blank, stakeholderId: stakeholderId || '' }); setError(''); setModal(true); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const body = { ...form, responsibleUserId: form.responsibleUserId || null, dueDate: form.dueDate ? `${form.dueDate}T00:00:00.000Z` : null };
      const response = await fetch(`${endpoint}${selected ? `/${selected.id}` : ''}${tenantParam ? `?${tenantParam}` : ''}`, { method: selected ? 'PATCH' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data: { message?: string } = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not save PIR');
      setModal(false); setNotice(selected ? 'PIR updated.' : 'PIR created.'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save PIR'); } finally { setSaving(false); }
  }
  async function changeStatus(value: string) {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`${endpoint}/${selected.id}/status${tenantParam ? `?${tenantParam}` : ''}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: value }) });
      const data: { message?: string } = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not change PIR status');
      setNotice(`PIR status changed to ${value}.`); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change PIR status'); } finally { setSaving(false); }
  }
  return <section className="pir-workspace">
    <header className="editorial-heading"><div><p>INTELLIGENCE REQUIREMENTS</p><h1>Priority Intelligence Requirements</h1><p>Questions that guide collection and analysis for stakeholders.</p></div>{canManage && <Button onClick={() => edit()}>Add PIR</Button>}</header>
    <div className="pir-controls">
      <label>Search<input value={search} onChange={event => { setPage(1); setSearch(event.target.value); }} placeholder="Reference, title, or question" /></label>
      <label>Priority<select value={priority} onChange={event => { setPage(1); setPriority(event.target.value); }}><option value="">All priorities</option>{priorities.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Status<select value={status} onChange={event => { setPage(1); setStatus(event.target.value); }}><option value="">All statuses</option>{statuses.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Stakeholder<select value={stakeholderId} onChange={event => { setPage(1); setStakeholderId(event.target.value); }}><option value="">All stakeholders</option>{stakeholders.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
      <label>Sort<select value={sort} onChange={event => { setPage(1); setSort(event.target.value); }}><option value="updatedAt:desc">Recently updated</option><option value="dueDate:asc">Due date</option><option value="priority:desc">Priority</option><option value="reference:asc">Reference</option></select></label>
    </div>
    {notice && <p role="status" className="pir-notice">{notice}</p>}{error && !modal && <p role="alert" className="error">{error}</p>}
    {loading ? <p role="status">Loading PIRs...</p> : items.length ? <><p>{total} PIRs</p><div className="pir-list">{items.map(item => <article key={item.id} className="pir-card"><button type="button" onClick={() => setSelected(item)}><span className="pir-reference">{item.reference}</span><strong>{item.title}</strong><span>{item.stakeholder.name} · <span className={`pir-priority pir-priority-${item.priority.toLowerCase()}`}>{item.priority}</span> · {item.status.replaceAll('_', ' ')}{item.dueDate ? ` · Due ${new Date(item.dueDate).toLocaleDateString()}` : ''}</span></button>{canManage && <Button variant="outline" onClick={() => edit(item)}>Edit</Button>}</article>)}</div><div className="pir-pagination"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {pages}</span><Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></> : <p>No PIRs match these filters.</p>}
    {selected && !modal && <aside className="pir-detail">
      <div className="pir-detail-head"><div><p>PIR PROFILE · {selected.reference}</p><h2>{selected.title}</h2><span className={`pir-priority pir-priority-${selected.priority.toLowerCase()}`}>{selected.priority}</span> · {selected.status.replaceAll('_', ' ')}</div><Button variant="outline" onClick={() => setSelected(null)}>Close</Button></div>
      <h3>Primary intelligence question</h3><p>{selected.question}</p>
      <dl><div><dt>Stakeholder</dt><dd><Link href={`/threat-intelligence/stakeholders?stakeholderId=${encodeURIComponent(selected.stakeholderId)}`}>{selected.stakeholder.name}</Link> · {selected.stakeholder.category}{!selected.stakeholder.isActive ? ' · Inactive' : ''}</dd></div><div><dt>Stakeholder interests</dt><dd>{selected.stakeholder.intelligenceInterests || 'Not specified'}</dd></div><div><dt>Responsible user</dt><dd>{selected.responsibleUser?.name || 'Unassigned'}</dd></div><div><dt>Due date</dt><dd>{selected.dueDate ? new Date(selected.dueDate).toLocaleDateString() : 'Not set'}</dd></div><div><dt>Time horizon</dt><dd>{selected.timeHorizon || 'Not set'}</dd></div><div><dt>Expected outcome</dt><dd>{selected.expectedOutcome || 'Not specified'}</dd></div><div><dt>Strategic context</dt><dd>{selected.strategicContext || 'Not specified'}</dd></div><div><dt>Description</dt><dd>{selected.description || 'Not specified'}</dd></div></dl>
      <CoverageOverview key={`coverage-${selected.id}`} role={role} pirId={selected.id} />
      {role !== 'USER' && process.env.NEXT_PUBLIC_FEEDBACK_FOLLOW_UP_ENABLED === 'true' && <FeedbackFollowUps key={`feedback-${selected.id}`} role={role} pirId={selected.id} />}
      <section className="stake-linked-pirs"><h3>Specific Intelligence Requirements ({sirTotal})</h3><p>{statuses.map(value => `${value.replaceAll('_', ' ')}: ${sirStatusCounts[value] || 0}`).join(' · ')}</p>{linkedSirs.length ? <ul>{linkedSirs.map(sir => <li key={sir.id}><Link href={`/threat-intelligence/sirs?pirId=${encodeURIComponent(selected.id)}&sirId=${encodeURIComponent(sir.id)}`}>{sir.reference} · {sir.title}</Link> · {sir.status.replaceAll('_', ' ')}</li>)}</ul> : <p>No SIRs linked yet.</p>}<Link href={`/threat-intelligence/sirs?pirId=${encodeURIComponent(selected.id)}${canManage && !['ANSWERED', 'EXPIRED'].includes(selected.status) ? '&create=1' : ''}`}>{canManage && !['ANSWERED', 'EXPIRED'].includes(selected.status) ? 'Add SIR' : 'View SIR workspace'}</Link></section>
      {canManage && <Link className="pir-create-report" href={`/threat-intelligence/reports?pirId=${encodeURIComponent(selected.id)}`}>Create Report from this PIR</Link>}
      {canManage && <div className="pir-actions"><Button variant="outline" onClick={() => edit(selected)}>Edit PIR</Button>{next[selected.status].map(value => <Button key={value} variant="outline" disabled={saving} onClick={() => void changeStatus(value)}>{value === 'OPEN' ? 'Reopen' : `Move to ${value.replaceAll('_', ' ')}`}</Button>)}</div>}
    </aside>}
    <FormModal open={modal} onOpenChange={setModal} title={selected ? 'Edit PIR' : 'Add PIR'} onSubmit={event => void save(event)} loading={saving} error={modal ? error : ''} submitLabel={selected ? 'Save changes' : 'Create PIR'}>
      <div className="pir-form">
        <label>Reference<input required maxLength={40} value={form.reference} onChange={event => setForm({ ...form, reference: event.target.value })} /></label>
        <label>Title<input required maxLength={200} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
        <label>Primary intelligence question<textarea required maxLength={4000} value={form.question} onChange={event => setForm({ ...form, question: event.target.value })} /></label>
        <label>Stakeholder<select required value={form.stakeholderId} onChange={event => setForm({ ...form, stakeholderId: event.target.value })}><option value="">Select stakeholder</option>{selected?.stakeholder && !stakeholders.some(value => value.id === selected.stakeholderId) && <option value={selected.stakeholderId}>{selected.stakeholder.name} (inactive)</option>}{stakeholders.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
        <label>Priority<select value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}>{priorities.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Responsible user<select value={form.responsibleUserId} onChange={event => setForm({ ...form, responsibleUserId: event.target.value })}><option value="">Unassigned</option>{users.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
        <label>Due date<input type="date" value={form.dueDate} onChange={event => setForm({ ...form, dueDate: event.target.value })} /></label>
        <label>Time horizon<input maxLength={120} value={form.timeHorizon} onChange={event => setForm({ ...form, timeHorizon: event.target.value })} /></label>
        <label>Description<textarea maxLength={4000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
        <label>Strategic context<textarea maxLength={4000} value={form.strategicContext} onChange={event => setForm({ ...form, strategicContext: event.target.value })} /></label>
        <label>Expected outcome<textarea maxLength={4000} value={form.expectedOutcome} onChange={event => setForm({ ...form, expectedOutcome: event.target.value })} /></label>
      </div>
    </FormModal>
  </section>;
}
