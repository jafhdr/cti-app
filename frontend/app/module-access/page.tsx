'use client';

import { KeyRound, Layers3, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/dashboard/Sidebar';
import type { ModulePolicy, UserModuleAccess } from '../../lib/access-policy';
import type { ModuleAccess } from '../../lib/module-access';
import ModuleAccessPanel from '../../components/users/ModuleAccessPanel';
import { ConfirmationModal } from '@/components/ui/modal-patterns';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Tenant = { readonly id: string; readonly name: string; readonly slug?: string };
type Feature = { readonly id: string; readonly key: string; readonly name: string };
type Module = ModulePolicy;
type Assignment = { readonly moduleId: string; readonly featureKeys: readonly string[] };
type AccessUser = { readonly id: string; readonly name: string; readonly email: string; readonly role: Role; readonly isActive: boolean; readonly moduleAccessDetails: readonly UserModuleAccess[]; readonly moduleAccess: readonly Assignment[] };
type CurrentUser = { readonly moduleAccess: readonly ModuleAccess[]; readonly role: Role; readonly tenant: Tenant | null };
type Overview = { readonly tenant: Tenant; readonly modules: readonly Module[]; readonly users: readonly AccessUser[] };
type ModuleView = { readonly users: ReadonlyArray<Omit<AccessUser, 'moduleAccess'> & { readonly featureKeys: readonly string[]; readonly accessible: boolean; readonly reason: string | null }> };

export default function ModuleAccessPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [tenants, setTenants] = useState<readonly Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [moduleId, setModuleId] = useState('');
  const [moduleUsers, setModuleUsers] = useState<ModuleView['users']>([]);
  const [editingUser, setEditingUser] = useState<AccessUser | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<readonly string[]>([]);
  const [bulkModuleId, setBulkModuleId] = useState('');
  const [bulkFeatures, setBulkFeatures] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [message, setMessage] = useState('');

  async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
    const response = await fetch(`${API}${path}`, { credentials: 'include', cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
    if (response.status === 401) { router.replace('/login'); return null; }
    if (response.status === 403) throw new Error('Anda tidak memiliki izin untuk tenant atau user tersebut.');
    const data: T & { readonly message?: string } = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message ?? 'Permintaan akses modul gagal.');
    return data;
  }

  async function loadOverview(nextTenantId: string) {
    if (!nextTenantId) { setOverview(null); return; }
    setOverview(null);
    const data = await request<Overview>(`/users/tenant/${encodeURIComponent(nextTenantId)}/module-access`);
    if (!data) return;
    const session = await request<CurrentUser>('/auth/me'); if (session) setCurrentUser(session);
    setOverview(data); setSelectedUsers([]); setModuleId(''); setModuleUsers([]);
    const firstModule = data.modules[0];
    setBulkModuleId(firstModule?.id ?? ''); setBulkFeatures([]);
  }

  useEffect(() => { void (async () => {
    try {
      const me = await request<CurrentUser>('/auth/me');
      if (!me) return;
      if (me.role === 'USER') { router.replace('/dashboard'); return; }
      setCurrentUser(me);
      if (me.role === 'SUPER_ADMIN') {
        const list = await request<readonly Tenant[]>('/users/tenants') ?? [];
        setTenants(list); setTenantId(list[0]?.id ?? '');
        if (list[0]) await loadOverview(list[0].id);
      } else if (me.tenant) { setTenantId(me.tenant.id); await loadOverview(me.tenant.id); }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Data akses modul gagal dimuat.'); }
  })(); }, [router]);

  const selectedBulkModule = overview?.modules.find((module) => module.id === bulkModuleId);
  const bulkDenials = overview?.users.filter(user => selectedUsers.includes(user.id)).flatMap(user => { const access = user.moduleAccessDetails.find(module => module.id === bulkModuleId); return access?.assignable ? [] : [`${user.name}: ${access?.reason ?? 'Modul tidak tersedia'}`]; }) ?? [];
  const assignmentNames = useMemo(() => new Map(overview?.modules.map((module) => [module.id, module.name]) ?? []), [overview]);

  async function selectModule(nextModuleId: string) {
    setModuleId(nextModuleId);
    if (!nextModuleId || !tenantId) { setModuleUsers([]); return; }
    try {
      const data = await request<ModuleView>(`/modules/${encodeURIComponent(nextModuleId)}/user-access?tenantId=${encodeURIComponent(tenantId)}`);
      setModuleUsers(data?.users ?? []);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Daftar user modul gagal dimuat.'); }
  }

  function chooseBulkModule(nextModuleId: string) {
    setBulkModuleId(nextModuleId);
    setBulkFeatures([]);
  }

  function applyBulk() {
    if (!overview || !selectedUsers.length || !bulkModuleId || bulkDenials.length) return;
    setConfirmBulk(true);
  }
  async function commitBulk() {
    if (!overview || !selectedUsers.length || !bulkModuleId || bulkDenials.length || busy) return;
    setBusy(true); setMessage('');
    try {
      await request<Overview>(`/users/tenant/${encodeURIComponent(tenantId)}/module-access`, { method: 'PATCH', body: JSON.stringify({ assignments: selectedUsers.map((userId) => ({ userId, access: [{ moduleId: bulkModuleId, featureKeys: bulkFeatures }] })) }) });
      setMessage(`Akses ${selectedUsers.length} user berhasil diganti.`); await loadOverview(tenantId); setConfirmBulk(false);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Bulk update gagal.'); }
    finally { setBusy(false); }
  }

  async function logout() { await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' }); router.replace('/login'); }
  return <div className="app"><Sidebar role={currentUser?.role} moduleAccess={currentUser?.moduleAccess} onLogout={() => void logout()} /><section className="main"><header className="topbar"><div className="module-access-topbar"><span>IDENTITY & ENTITLEMENTS</span><strong>Akses Modul</strong></div><span>{currentUser?.role?.replace('_', ' ')}</span></header><main className="content module-access-page editorial-module">
    <div className="module-access-heading"><div><span className="module-access-kicker"><KeyRound size={13} /> ACCESS CONTROL</span><h1>Access at every layer.</h1><p>Manage assigned modules and features for each user in the selected tenant.</p></div>{currentUser?.role === 'SUPER_ADMIN' && <label className="module-access-tenant"><span>Tenant</span><select aria-label="Pilih tenant" value={tenantId} onChange={(event) => { setTenantId(event.target.value); setEditingUser(null); setSelectedUsers([]); void loadOverview(event.target.value).catch(cause => setMessage(cause instanceof Error ? cause.message : 'Gagal memuat tenant.')); }}>{tenants.map((tenant) => <option value={tenant.id} key={tenant.id}>{tenant.name}</option>)}</select></label>}</div>
    <ConfirmationModal open={confirmBulk} onOpenChange={setConfirmBulk} title="Ganti assignment user" target={`${selectedUsers.length} user terpilih`} consequence="Assignment dan fitur lama yang tidak dipilih akan dihapus." confirmLabel="Ganti assignment" destructive loading={busy} error={confirmBulk && message && !message.includes('berhasil') ? message : ''} onConfirm={commitBulk} />
    {message && <div className={message.includes('berhasil') ? 'success module-access-message' : 'error module-access-message'} role="status">{message}</div>}
    {!overview && !message && <section className="module-access-loading" role="status"><KeyRound size={20} /><div><strong>Memuat data akses…</strong><span>Mengambil user, modul, dan assignment tenant.</span></div></section>}
    {overview && <section className="module-access-stats" aria-label="Ringkasan akses"><article><UsersRound size={18} /><span>User dalam tenant</span><strong>{overview.users.length}</strong></article><article><Layers3 size={18} /><span>Module Included</span><strong>{overview.modules.filter(module => module.subscriptionIncluded).length}</strong></article><article><KeyRound size={18} /><span>User Assigned</span><strong>{overview.users.reduce((total, user) => total + user.moduleAccess.length, 0)}</strong></article></section>}
    {overview && <section className="editorial-metrics" aria-label="Access summary"><div><span>Users</span><strong>{overview.users.length}</strong></div><div><span>Modules</span><strong>{overview.modules.length}</strong></div><div><span>Active users</span><strong>{overview.users.filter(user => user.isActive).length}</strong></div><div><span>Assigned users</span><strong>{overview.users.filter(user => user.moduleAccess.length > 0).length}</strong></div></section>}
    <div className="editorial-section-heading"><span className="source-eyebrow">USER ASSIGNMENTS</span><h2>Entitlements</h2></div>
    {overview && <section className="module-access-card"><div className="module-access-card-heading"><div><h2>Assignment per user</h2><p>Centang user untuk menerapkan modul dan fitur yang sama secara bulk.</p></div></div>
      <div className="cti-table-wrap"><table className="cti-table"><thead><tr><th><span className="sr-only">Pilih</span></th><th>User</th><th>Role / Status</th><th>Modul & fitur</th><th>Aksi</th></tr></thead><tbody>{overview?.users.map((user) => { const canManage = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'ADMIN'; const assignedIds = new Set(user.moduleAccess.map((entry) => entry.moduleId)); const available = user.moduleAccessDetails.filter((module) => !assignedIds.has(module.id) && module.assignable); return <tr key={user.id}><td data-label="Pilih"><input aria-label={`Pilih ${user.email}`} type="checkbox" disabled={!canManage} checked={selectedUsers.includes(user.id)} onChange={() => setSelectedUsers((current) => current.includes(user.id) ? current.filter((id) => id !== user.id) : [...current, user.id])} /></td><td data-label="User"><strong>{user.name}</strong><small>{user.email}</small></td><td data-label="Role / Status"><span className="module-access-role">{user.role}</span><span className={`status-pill ${user.isActive ? 'is-active' : 'is-inactive'}`}>{user.isActive ? 'Aktif' : 'Nonaktif'}</span></td><td data-label="Modul & fitur"><div className="assignment-list">{user.moduleAccess.length ? user.moduleAccess.map((entry) => <span key={entry.moduleId}><b>{assignmentNames.get(entry.moduleId) ?? entry.moduleId}</b><small>User Assigned · {user.moduleAccessDetails.find(module => module.id === entry.moduleId)?.accessible ? 'Accessible' : 'Not Accessible'}</small><small>{user.moduleAccessDetails.find(module => module.id === entry.moduleId)?.reason}</small><small>{entry.featureKeys.length ? entry.featureKeys.join(' · ') : 'Belum ada fitur diberikan'}</small></span>) : <em>Belum ada akses</em>}</div>{available.length > 0 && <small className="available-modules">Tersedia: {available.map((module) => module.name).join(' · ')}</small>}</td><td data-label="Aksi"><button className="module-access-edit" disabled={!canManage} onClick={() => setEditingUser(user)}>Atur akses</button></td></tr>; })}</tbody></table></div>
      {!overview?.users.length && <p className="module-access-empty">Belum ada user dalam tenant ini.</p>}
    </section>}
    {selectedUsers.length > 0 && <section className="bulk-access"><div><strong>Bulk assignment · {selectedUsers.length} user</strong><p>Operasi ini mengganti seluruh assignment user terpilih dengan modul berikut.</p></div><label><span>Modul</span><select aria-label="Modul bulk" value={bulkModuleId} onChange={(event) => chooseBulkModule(event.target.value)}>{overview?.modules.map((module) => <option value={module.id} key={module.id}>{module.name}</option>)}</select></label><fieldset disabled={Boolean(bulkDenials.length) || busy}><legend>Feature Access</legend>{selectedBulkModule?.features.map((feature) => <label key={feature.id}><input type="checkbox" checked={bulkFeatures.includes(feature.key)} onChange={() => setBulkFeatures((current) => current.includes(feature.key) ? current.filter((key) => key !== feature.key) : [...current, feature.key])} />{feature.name}</label>)}</fieldset>{bulkDenials.map(reason => <p className="error" key={reason}>{reason}</p>)}<button className="module-access-primary" disabled={busy || !bulkModuleId || Boolean(bulkDenials.length)} onClick={() => void applyBulk()}>{busy ? 'Menerapkan…' : 'Terapkan ke user terpilih'}</button></section>}
    {overview && <section className="module-access-card module-view"><div><h2>Lihat dari sisi modul</h2><p>Pilih modul untuk melihat User Assigned dan status Accessible yang tersimpan.</p></div><label><span>Modul</span><select aria-label="Lihat akses modul" value={moduleId} onChange={(event) => void selectModule(event.target.value)}><option value="">Pilih modul…</option>{overview.modules.map((module) => <option value={module.id} key={module.id}>{module.name}</option>)}</select></label>{moduleId && <div className="module-user-grid">{moduleUsers.map((user) => <article key={user.id}><strong>{user.name}</strong><span>{user.email}</span><small>User Assigned · {user.accessible ? 'Accessible' : 'Not Accessible'}</small>{user.reason && <p>{user.reason}</p>}<small>{user.featureKeys.length ? user.featureKeys.join(' · ') : 'Belum ada fitur diberikan'}</small></article>)}{moduleUsers.length === 0 && <p>Tidak ada user yang memiliki akses ke modul ini.</p>}</div>}</section>}
    {editingUser && <ModuleAccessPanel target={editingUser} onClose={() => setEditingUser(null)} onUnauthorized={() => router.replace('/login')} onError={setMessage} onSaved={(nextMessage) => { setMessage(nextMessage); void loadOverview(tenantId); }} />}
  </main></section></div>;
}
