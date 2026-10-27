'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormModal, ConfirmationModal } from '@/components/ui/modal-patterns';
import { useThreatIntelligenceTenant } from '../ThreatIntelligenceShell';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Stakeholder = { id: string; name: string; scope: string; category: string; type: string; isActive: boolean; description: string | null; intelligenceInterests: string | null; responsibleUserId: string | null; responsibleUser?: { name: string } | null; reportingFormat: string | null; reportingFrequency: string | null; distributionChannel: string | null; classificationPreference: string | null };
type Form = { name: string; scope: string; category: string; type: string; responsibleUserId: string; description: string; intelligenceInterests: string; reportingFormat: string; reportingFrequency: string; distributionChannel: string; classificationPreference: string };
const empty: Form = { name: '', scope: 'INTERNAL', category: 'STRATEGIC', type: 'INDIVIDUAL', responsibleUserId: '', description: '', intelligenceInterests: '', reportingFormat: '', reportingFrequency: '', distributionChannel: '', classificationPreference: '' };
const categories = ['STRATEGIC', 'OPERATIONAL', 'TACTICAL'];
export function StakeholdersWorkspace({ role }: { role: Role }) {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const [items, setItems] = useState<Stakeholder[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<Stakeholder | null>(null);
  const [linkedPirs, setLinkedPirs] = useState<{ id: string; reference: string; title: string; status: string }[]>([]);
  const [form, setForm] = useState<Form>(empty);
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canManage = role !== 'USER';
  const tenantParam = role === 'SUPER_ADMIN' ? `tenantId=${encodeURIComponent(tenantId)}` : '';
  const endpoint = `${API}/intelligence/stakeholders`;
  const load = useCallback(async () => {
    if (role === 'SUPER_ADMIN' && (!ready || !tenantId)) return;
    setLoading(true); setError(''); setSelected(null);
    const query = new URLSearchParams({ page: String(page), limit: '10' });
    if (tenantParam) query.set('tenantId', tenantId);
    if (search.trim()) query.set('search', search.trim());
    if (category) query.set('category', category);
    if (status) query.set('isActive', status);
    try {
      const response = await fetch(`${endpoint}?${query}`, { credentials: 'include', cache: 'no-store' });
      const data: { items?: Stakeholder[]; total?: number; totalPages?: number; message?: string } = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to load stakeholders');
      setItems(data.items || []); setTotal(data.total || 0); setPages(Math.max(data.totalPages || 1, 1));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to load stakeholders'); } finally { setLoading(false); }
  }, [role, ready, tenantId, tenantParam, page, search, category, status, endpoint]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (role === 'SUPER_ADMIN' && !tenantId) return;
    fetch(`${endpoint}/responsible-users${tenantParam ? `?${tenantParam}` : ''}`, { credentials: 'include' }).then(async response => response.ok ? response.json() : []).then(setUsers).catch(() => setUsers([]));
  }, [role, tenantId, tenantParam, endpoint]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('stakeholderId');
    if (!id || (role === 'SUPER_ADMIN' && (!ready || !tenantId))) return;
    fetch(`${endpoint}/${encodeURIComponent(id)}${tenantParam ? `?${tenantParam}` : ''}`, { credentials: 'include', cache: 'no-store' }).then(async response => response.ok ? response.json() : null).then(item => { if (item) setSelected(item); }).catch(() => {});
  }, [role, ready, tenantId, tenantParam, endpoint]);
  useEffect(() => {
    if (!selected || (role === 'SUPER_ADMIN' && !tenantId)) { setLinkedPirs([]); return; }
    const query = new URLSearchParams({ stakeholderId: selected.id, limit: '100' });
    if (tenantParam) query.set('tenantId', tenantId);
    fetch(`${API}/intelligence/pirs?${query}`, { credentials: 'include', cache: 'no-store' }).then(async response => response.ok ? response.json() : { items: [] }).then(data => setLinkedPirs(data.items || [])).catch(() => setLinkedPirs([]));
  }, [selected, role, tenantId, tenantParam]);
  function edit(item?: Stakeholder) { setSelected(item || null); setForm(item ? { name: item.name, scope: item.scope, category: item.category, type: item.type, responsibleUserId: item.responsibleUserId || '', description: item.description || '', intelligenceInterests: item.intelligenceInterests || '', reportingFormat: item.reportingFormat || '', reportingFrequency: item.reportingFrequency || '', distributionChannel: item.distributionChannel || '', classificationPreference: item.classificationPreference || '' } : empty); setError(''); setModal(true); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    const body = { ...form, responsibleUserId: form.responsibleUserId || null, classificationPreference: form.classificationPreference || null };
    try {
      const response = await fetch(`${endpoint}${selected ? `/${selected.id}` : ''}${tenantParam ? `?${tenantParam}` : ''}`, { method: selected ? 'PATCH' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data: { message?: string } = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not save stakeholder');
      setModal(false); setNotice(selected ? 'Stakeholder updated.' : 'Stakeholder created.'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save stakeholder'); } finally { setSaving(false); }
  }
  async function toggle() {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`${endpoint}/${selected.id}/active${tenantParam ? `?${tenantParam}` : ''}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !selected.isActive }) });
      if (!response.ok) throw new Error('Could not change stakeholder status');
      setNotice(selected.isActive ? 'Stakeholder deactivated.' : 'Stakeholder activated.'); setConfirm(false); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change status'); } finally { setSaving(false); }
  }
  return <section className="stake-workspace">
    <header className="editorial-heading"><div><p>INTELLIGENCE GOVERNANCE</p><h1>Stakeholders</h1><p>People and teams whose intelligence needs guide CTI work.</p></div>{canManage && <Button onClick={() => edit()}>Add stakeholder</Button>}</header>
    <div className="stake-controls">
      <label>Search<input value={search} onChange={event => { setPage(1); setSearch(event.target.value); }} placeholder="Name or interests" /></label>
      <label>Category<select value={category} onChange={event => { setPage(1); setCategory(event.target.value); }}><option value="">All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Status<select value={status} onChange={event => { setPage(1); setStatus(event.target.value); }}><option value="">All statuses</option><option value="true">Active</option><option value="false">Inactive</option></select></label>
    </div>
    {notice && <p role="status">{notice}</p>}{error && !modal && <p role="alert" className="error">{error}</p>}
    {loading ? <p role="status">Loading stakeholders...</p> : items.length ? <><p>{total} stakeholders</p><div className="stake-list">{items.map(item => <article key={item.id} className="stake-card"><button type="button" onClick={() => setSelected(item)}><strong>{item.name}</strong><span>{item.category} · {item.scope} · {item.isActive ? 'Active' : 'Inactive'}</span></button>{canManage && <Button variant="outline" onClick={() => edit(item)}>Edit</Button>}</article>)}</div><div className="stake-pagination"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {pages}</span><Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></> : <p>No stakeholders match these filters.</p>}
    {selected && !modal && <aside className="stake-detail"><div className="stake-detail-head"><div><p>STAKEHOLDER PROFILE</p><h2>{selected.name}</h2></div><Button variant="outline" onClick={() => setSelected(null)}>Close</Button></div><p>{selected.description || 'No description provided.'}</p><dl><div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>Type</dt><dd>{selected.type}</dd></div><div><dt>Responsible SICTI user</dt><dd>{selected.responsibleUser?.name || 'Unassigned'}</dd></div><div><dt>Intelligence interests</dt><dd>{selected.intelligenceInterests || 'Not specified'}</dd></div></dl><h3>Reporting preferences</h3><dl><div><dt>Format</dt><dd>{selected.reportingFormat || 'Not specified'}</dd></div><div><dt>Frequency</dt><dd>{selected.reportingFrequency || 'Not specified'}</dd></div><div><dt>Channel</dt><dd>{selected.distributionChannel || 'Not specified'}</dd></div><div><dt>Classification</dt><dd>{selected.classificationPreference || 'Not specified'}</dd></div></dl><section className="stake-linked-pirs"><h3>Linked PIRs</h3>{linkedPirs.length ? <ul>{linkedPirs.map(pir => <li key={pir.id}><Link href={`/threat-intelligence/pirs?pirId=${encodeURIComponent(pir.id)}`}>{pir.reference} · {pir.title}</Link> · {pir.status.replaceAll('_', ' ')}</li>)}</ul> : <p>No PIRs linked yet.</p>}</section>{canManage && <Button variant="outline" onClick={() => setConfirm(true)}>{selected.isActive ? 'Deactivate' : 'Activate'}</Button>}</aside>}
    <FormModal open={modal} onOpenChange={setModal} title={selected ? 'Edit stakeholder' : 'Add stakeholder'} onSubmit={event => void save(event)} loading={saving} error={modal ? error : ''} submitLabel={selected ? 'Save changes' : 'Create stakeholder'}>
      <div className="stake-form">
        {(['name', 'description', 'intelligenceInterests', 'reportingFormat', 'reportingFrequency', 'distributionChannel'] as const).map(key => <label key={key}>{key.replace(/([A-Z])/g, ' $1')}<input required={key === 'name'} maxLength={key === 'name' ? 160 : key === 'description' || key === 'intelligenceInterests' ? 4000 : 120} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>)}
        {([['scope', ['INTERNAL', 'EXTERNAL']], ['category', categories], ['type', ['INDIVIDUAL', 'TEAM', 'ORGANIZATION']]] as const).map(([key, values]) => <label key={key}>{key}<select value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })}>{values.map(value => <option key={value}>{value}</option>)}</select></label>)}
        <label>Responsible SICTI user<select value={form.responsibleUserId} onChange={event => setForm({ ...form, responsibleUserId: event.target.value })}><option value="">Unassigned</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
        <label>Classification<select value={form.classificationPreference} onChange={event => setForm({ ...form, classificationPreference: event.target.value })}><option value="">Not specified</option>{['CLEAR', 'GREEN', 'AMBER', 'AMBER_STRICT', 'RED'].map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
    </FormModal>
    <ConfirmationModal open={confirm} onOpenChange={setConfirm} title={selected?.isActive ? 'Deactivate stakeholder?' : 'Activate stakeholder?'} target={selected?.name} confirmLabel={selected?.isActive ? 'Deactivate' : 'Activate'} destructive={selected?.isActive} loading={saving} error={confirm ? error : ''} onConfirm={toggle} />
  </section>;
}
