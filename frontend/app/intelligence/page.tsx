'use client';

import type { FormEvent, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/dashboard/Sidebar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const entityTypes = ['SOURCE', 'FEED', 'THREAT_ACTOR', 'CAMPAIGN', 'MALWARE', 'TOOL', 'VULNERABILITY'] as const;
const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const caseStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
const alertStatuses = ['OPEN', 'ACKNOWLEDGED', 'CLOSED'] as const;
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type FormKind = 'entity' | 'relationship' | 'case' | 'alert' | null;
type Entity = { readonly id: string; readonly type: string; readonly name: string; readonly severity: string; readonly confidence: number; readonly indicators: readonly { readonly id: string; readonly value: string; readonly type: string; readonly status: string }[] };
type Link = { readonly id: string; readonly relationshipType: string; readonly source: { readonly name: string }; readonly target: { readonly name: string } };
type CaseItem = { readonly id: string; readonly title: string; readonly status: string; readonly severity: string; readonly _count: { readonly alerts: number } };
type Alert = { readonly id: string; readonly title: string; readonly status: string; readonly severity: string; readonly case: { readonly title: string } | null };
type Overview = { readonly entities: readonly Entity[]; readonly relationships: readonly Link[]; readonly cases: readonly CaseItem[]; readonly alerts: readonly Alert[] };
type CurrentUser = { readonly role: Role; readonly email: string };
type Tenant = { readonly id: string; readonly name: string };
type EntityForm = { type: string; name: string; severity: string; confidence: string; description: string };
type RelationshipForm = { sourceId: string; targetId: string; relationshipType: string; description: string };
type CaseForm = { title: string; description: string; severity: string; entityIds: readonly string[] };
type AlertForm = { title: string; description: string; severity: string; caseId: string; entityIds: readonly string[] };

const emptyOverview: Overview = { entities: [], relationships: [], cases: [], alerts: [] };
const emptyEntity: EntityForm = { type: 'SOURCE', name: '', severity: 'MEDIUM', confidence: '50', description: '' };
const emptyRelationship: RelationshipForm = { sourceId: '', targetId: '', relationshipType: 'USES', description: '' };
const emptyCase: CaseForm = { title: '', description: '', severity: 'MEDIUM', entityIds: [] };
const emptyAlert: AlertForm = { title: '', description: '', severity: 'HIGH', caseId: '', entityIds: [] };

export default function IntelligencePage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [overview, setOverview] = useState<Overview>(emptyOverview);
  const [tenants, setTenants] = useState<readonly Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [formKind, setFormKind] = useState<FormKind>(null);
  const [entityForm, setEntityForm] = useState<EntityForm>(emptyEntity);
  const [relationshipForm, setRelationshipForm] = useState<RelationshipForm>(emptyRelationship);
  const [caseForm, setCaseForm] = useState<CaseForm>(emptyCase);
  const [alertForm, setAlertForm] = useState<AlertForm>(emptyAlert);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const canManage = user?.role === 'SUPER_ADMIN';

  async function request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${API}${path}`, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  }
  async function load(requestedTenantId = selectedTenantId): Promise<void> {
    const me = await request('/auth/me');
    if (me.status === 401) { router.replace('/'); return; }
    if (!me.ok) throw new Error('Gagal memuat sesi pengguna.');
    const currentUser: CurrentUser = await me.json();
    let tenantId = requestedTenantId;
    if (currentUser.role === 'SUPER_ADMIN') {
      const tenantResponse = await request('/users/tenants');
      if (!tenantResponse.ok) throw new Error('Gagal memuat daftar tenant.');
      const availableTenants: readonly Tenant[] = await tenantResponse.json();
      setTenants(availableTenants);
      tenantId = tenantId || availableTenants[0]?.id || '';
      setSelectedTenantId(tenantId);
      if (!tenantId) { setOverview(emptyOverview); setUser(currentUser); return; }
    }
    const overviewPath = currentUser.role === 'SUPER_ADMIN' ? `/intelligence/overview?tenantId=${encodeURIComponent(tenantId)}` : '/intelligence/overview';
    const data = await request(overviewPath);
    if (data.status === 401) { router.replace('/'); return; }
    if (!data.ok) throw new Error('Gagal memuat workspace CTI.');
    const currentOverview: Overview = await data.json();
    setUser(currentUser);
    setOverview(currentOverview);
  }
  useEffect(() => { load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Gagal memuat workspace CTI.')); }, []);
  function begin(kind: Exclude<FormKind, null>): void { setError(''); setSuccess(''); setFormKind(kind); }
  async function submit(path: string, body: object, message: string): Promise<boolean> {
    setError(''); setSuccess('');
    const response = await request(path, { method: 'POST', body: JSON.stringify(body) });
    if (!response.ok) { setError('Data tidak dapat disimpan. Pastikan semua pilihan valid dan Anda memiliki akses tenant.'); return false; }
    setSuccess(message); await load(); return true;
  }
  async function createEntity(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (await submit('/intelligence/entities', { ...entityForm, tenantId: selectedTenantId, confidence: Number(entityForm.confidence) }, 'Entitas intelligence berhasil ditambahkan.')) { setEntityForm(emptyEntity); setFormKind(null); }
  }
  async function createRelationship(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (relationshipForm.sourceId === relationshipForm.targetId) { setError('Sumber dan target relasi harus berbeda.'); return; }
    if (await submit('/intelligence/relationships', { ...relationshipForm, tenantId: selectedTenantId }, 'Relasi intelligence berhasil ditambahkan.')) { setRelationshipForm(emptyRelationship); setFormKind(null); }
  }
  async function createCase(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (await submit('/intelligence/cases', { ...caseForm, tenantId: selectedTenantId }, 'Case berhasil dibuat.')) { setCaseForm(emptyCase); setFormKind(null); }
  }
  async function createAlert(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (await submit('/intelligence/alerts', { ...alertForm, tenantId: selectedTenantId, caseId: alertForm.caseId || undefined }, 'Alert berhasil dibuat.')) { setAlertForm(emptyAlert); setFormKind(null); }
  }
  async function updateStatus(path: string, status: string): Promise<void> {
    setError(''); setSuccess('');
    const response = await request(path, { method: 'PATCH', body: JSON.stringify({ tenantId: selectedTenantId, status }) });
    if (!response.ok) { setError('Status tidak dapat diperbarui.'); return; }
    setSuccess('Status berhasil diperbarui.'); await load();
  }
  async function logout(): Promise<void> { await request('/auth/logout', { method: 'POST' }); router.replace('/'); }

  return <div className="app"><Sidebar role={user?.role} onLogout={logout} /><section className="main"><header className="topbar"><strong>Intelligence Hub</strong><span>{user?.email}</span></header><main className="content"><div className="header"><div><h1>CTI Core</h1><p className="muted">Source/feed, adversary, campaign, malware, tool, CVE, hubungan, case, alert, dan IOC.</p></div>{canManage && <label>Tenant<select aria-label="Tenant CTI" value={selectedTenantId} onChange={event => { setSelectedTenantId(event.target.value); load(event.target.value).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Gagal memuat tenant.')); }}>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>}{canManage && selectedTenantId && <div className="ioc-actions"><Button view="action" onClick={() => begin('entity')}>Tambah entitas</Button><Button view="outlined" onClick={() => begin('relationship')}>Tambah relasi</Button><Button view="outlined" onClick={() => begin('case')}>Buat case</Button><Button view="outlined" onClick={() => begin('alert')}>Buat alert</Button></div>}</div>{error && <p className="error" role="alert">{error}</p>}{success && <p className="success" role="status">{success}</p>}{formKind === 'entity' && <FormCard title="Tambah entitas" onCancel={() => setFormKind(null)}><form className="ioc-form" onSubmit={createEntity}><label>Jenis<Select values={entityTypes} value={entityForm.type} onChange={value => setEntityForm({ ...entityForm, type: value })} /></label><label>Nama<input value={entityForm.name} onChange={event => setEntityForm({ ...entityForm, name: event.target.value })} required /></label><label>Severity<Select values={severities} value={entityForm.severity} onChange={value => setEntityForm({ ...entityForm, severity: value })} /></label><label>Confidence<input type="number" min="0" max="100" value={entityForm.confidence} onChange={event => setEntityForm({ ...entityForm, confidence: event.target.value })} required /></label><label className="ioc-wide">Deskripsi<textarea value={entityForm.description} onChange={event => setEntityForm({ ...entityForm, description: event.target.value })} /></label><SubmitActions /></form></FormCard>}{formKind === 'relationship' && <FormCard title="Tambah relasi" onCancel={() => setFormKind(null)}><form className="ioc-form" onSubmit={createRelationship}><EntitySelect label="Sumber" value={relationshipForm.sourceId} entities={overview.entities} onChange={value => setRelationshipForm({ ...relationshipForm, sourceId: value })} /><EntitySelect label="Target" value={relationshipForm.targetId} entities={overview.entities} onChange={value => setRelationshipForm({ ...relationshipForm, targetId: value })} /><label>Tipe relasi<input value={relationshipForm.relationshipType} onChange={event => setRelationshipForm({ ...relationshipForm, relationshipType: event.target.value })} required /></label><label className="ioc-wide">Deskripsi<textarea value={relationshipForm.description} onChange={event => setRelationshipForm({ ...relationshipForm, description: event.target.value })} /></label><SubmitActions /></form></FormCard>}{formKind === 'case' && <FormCard title="Buat case" onCancel={() => setFormKind(null)}><form className="ioc-form" onSubmit={createCase}><label>Judul<input value={caseForm.title} onChange={event => setCaseForm({ ...caseForm, title: event.target.value })} required /></label><label>Severity<Select values={severities} value={caseForm.severity} onChange={value => setCaseForm({ ...caseForm, severity: value })} /></label><EntityMultiSelect value={caseForm.entityIds} entities={overview.entities} onChange={entityIds => setCaseForm({ ...caseForm, entityIds })} /><label className="ioc-wide">Deskripsi<textarea value={caseForm.description} onChange={event => setCaseForm({ ...caseForm, description: event.target.value })} /></label><SubmitActions /></form></FormCard>}{formKind === 'alert' && <FormCard title="Buat alert" onCancel={() => setFormKind(null)}><form className="ioc-form" onSubmit={createAlert}><label>Judul<input value={alertForm.title} onChange={event => setAlertForm({ ...alertForm, title: event.target.value })} required /></label><label>Severity<Select values={severities} value={alertForm.severity} onChange={value => setAlertForm({ ...alertForm, severity: value })} /></label><label>Case<select value={alertForm.caseId} onChange={event => setAlertForm({ ...alertForm, caseId: event.target.value })}><option value="">Tanpa case</option>{overview.cases.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><EntityMultiSelect value={alertForm.entityIds} entities={overview.entities} onChange={entityIds => setAlertForm({ ...alertForm, entityIds })} /><label className="ioc-wide">Deskripsi<textarea value={alertForm.description} onChange={event => setAlertForm({ ...alertForm, description: event.target.value })} /></label><SubmitActions /></form></FormCard>}<div className="grid"><Metric label="Entities" value={overview.entities.length} /><Metric label="Linked IOCs" value={overview.entities.reduce((total, item) => total + item.indicators.length, 0)} /><Metric label="Open cases" value={overview.cases.filter(item => item.status !== 'CLOSED').length} /><Metric label="Open alerts" value={overview.alerts.filter(item => item.status !== 'CLOSED').length} /></div><Section title="Entities"><Table data={[...overview.entities]} columns={[{ id: 'name', name: 'Nama', template: (item: Entity) => item.name }, { id: 'type', name: 'Jenis', template: (item: Entity) => item.type }, { id: 'severity', name: 'Severity', template: (item: Entity) => item.severity }, { id: 'indicators', name: 'IOC terkait', template: (item: Entity) => item.indicators.map(indicator => indicator.value).join(', ') || '-' }, { id: 'confidence', name: 'Confidence', template: (item: Entity) => `${item.confidence}%` }]} /></Section><Section title="Relationships"><Table data={[...overview.relationships]} columns={[{ id: 'source', name: 'Sumber', template: (item: Link) => item.source.name }, { id: 'relationshipType', name: 'Relasi', template: (item: Link) => item.relationshipType }, { id: 'target', name: 'Target', template: (item: Link) => item.target.name }]} /></Section><Section title="Cases"><Table data={[...overview.cases]} columns={[{ id: 'title', name: 'Case', template: (item: CaseItem) => item.title }, { id: 'severity', name: 'Severity', template: (item: CaseItem) => item.severity }, { id: 'status', name: 'Status', template: (item: CaseItem) => canManage ? <StatusSelect values={caseStatuses} value={item.status} onChange={status => updateStatus(`/intelligence/cases/${item.id}/status`, status)} /> : item.status }, { id: 'alerts', name: 'Alerts', template: (item: CaseItem) => item._count.alerts }]} /></Section><Section title="Alerts"><Table data={[...overview.alerts]} columns={[{ id: 'title', name: 'Alert', template: (item: Alert) => item.title }, { id: 'severity', name: 'Severity', template: (item: Alert) => item.severity }, { id: 'status', name: 'Status', template: (item: Alert) => canManage ? <StatusSelect values={alertStatuses} value={item.status} onChange={status => updateStatus(`/intelligence/alerts/${item.id}/status`, status)} /> : item.status }, { id: 'case', name: 'Case', template: (item: Alert) => item.case?.title ?? '-' }]} /></Section></main></section></div>;
}

function Select({ values, value, onChange }: { readonly values: readonly string[]; readonly value: string; readonly onChange: (value: string) => void }) { return <select value={value} onChange={event => onChange(event.target.value)}>{values.map(item => <option key={item} value={item}>{item}</option>)}</select>; }
function StatusSelect({ values, value, onChange }: { readonly values: readonly string[]; readonly value: string; readonly onChange: (value: string) => void }) { return <select aria-label="Perbarui status" value={value} onChange={event => onChange(event.target.value)}>{values.map(item => <option key={item} value={item}>{item}</option>)}</select>; }
function EntitySelect({ label, value, entities, onChange }: { readonly label: string; readonly value: string; readonly entities: readonly Entity[]; readonly onChange: (value: string) => void }) { return <label>{label}<select value={value} onChange={event => onChange(event.target.value)} required><option value="" disabled>Pilih entitas</option>{entities.map(item => <option key={item.id} value={item.id}>{item.name} ({item.type})</option>)}</select></label>; }
function EntityMultiSelect({ value, entities, onChange }: { readonly value: readonly string[]; readonly entities: readonly Entity[]; readonly onChange: (value: readonly string[]) => void }) { return <label>Entitas terkait<select multiple value={value} onChange={event => onChange(Array.from(event.currentTarget.selectedOptions, option => option.value))}>{entities.map(item => <option key={item.id} value={item.id}>{item.name} ({item.type})</option>)}</select></label>; }
function FormCard({ title, children, onCancel }: { readonly title: string; readonly children: ReactNode; readonly onCancel: () => void }) { return <Card view="outlined" style={{ padding: 24, marginBottom: 20 }}><div className="header"><h2>{title}</h2><Button view="outlined" type="button" onClick={onCancel}>Batal</Button></div>{children}</Card>; }
function SubmitActions() { return <div className="ioc-actions"><Button view="action" type="submit">Simpan</Button></div>; }
function Metric({ label, value }: { readonly label: string; readonly value: number }) { return <div className="card"><div className="card-title">{label}</div><div className="metric">{value}</div></div>; }
function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) { return <section className="section"><h2>{title}</h2><Card view="outlined" style={{ padding: 18 }}>{children}</Card></section>; }
