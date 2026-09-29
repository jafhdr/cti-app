'use client';

import { Suspense, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import SharedSidebar from '../../components/dashboard/Sidebar';
import ModuleAccessPanel from '../../components/users/ModuleAccessPanel';
import { ConfirmationModal, FormModal } from '@/components/ui/modal-patterns';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenantId?: string | null;
  tenant?: { id: string; name: string; slug: string } | null;
  createdAt?: string;
  isActive: boolean;
  deactivatedAt?: string | null;
};

type Tenant = {
  id: string;
  name: string;
  slug: string;
};

type CurrentUser = {
  id: string;
  role: Role;
  tenant: Tenant | null;
};

/* ── Sidebar ── */
/* ── Main Page ── */
function UsersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filterTenantId = searchParams.get('tenantId');

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  // Add user form
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'USER'>('USER');
  const [tenantId, setTenantId] = useState('');
  const [saving, setSaving] = useState(false);
  const [accessUser, setAccessUser] = useState<User | null>(null);
  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);
  const [statusTarget, setStatusTarget] = useState<User | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [organizationFilter, setOrganizationFilter] = useState('');

  // Messages
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [forbidden, setForbidden] = useState(false);

  /* ── Load users ── */
  async function loadUsers() {
    try {
      setError('');
      const params = new URLSearchParams();
      if (filterTenantId) params.set('tenantId', filterTenantId);
      const res = await fetch(`${API}/users?${params}`, { credentials: 'include', cache: 'no-store' });
      if (res.status === 401) { router.replace('/login'); return; }
      if (res.status === 403) { setForbidden(true); return; }
      if (!res.ok) throw new Error('Gagal mengambil data user.');
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : data.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan saat mengambil user.');
    }
  }

  async function loadCurrentUser() {
    const res = await fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' });
    if (res.status === 401) { router.replace('/login'); return; }
    if (!res.ok) throw new Error('Gagal memuat sesi pengguna.');
    setCurrentUser(await res.json());
  }

  async function loadTenants() {
    try {
      const res = await fetch(`${API}/users/tenants`, { credentials: 'include', cache: 'no-store' });
      if (res.status === 401) { router.replace('/login'); return; }
      if (res.status === 403) return;
      if (!res.ok) return;
      const data = await res.json();
      setTenants(Array.isArray(data) ? data : data.tenants || []);
    } catch (err) {
      console.error('Gagal mengambil tenant:', err);
    }
  }

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      await Promise.all([loadCurrentUser(), loadUsers(), loadTenants()]);
      setLoading(false);
    }
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/login');
  }

  function resetForm() { setName(''); setEmail(''); setPassword(''); setRole('USER'); setTenantId(''); }
  function openAddForm() { setError(''); setSuccess(''); resetForm(); setShowAddForm(true); }
  function closeAddForm() { if (saving) return; resetForm(); setError(''); setShowAddForm(false); }

  /* ── Create user ── */
  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(''); setSuccess('');
    if (!name.trim()) { setError('Nama wajib diisi.'); return; }
    if (!email.trim()) { setError('Email wajib diisi.'); return; }
    if (password.length < 8) { setError('Password minimal 8 karakter.'); return; }
    if (currentUser?.role === 'SUPER_ADMIN' && !tenantId) { setError('Tenant wajib dipilih.'); return; }
    try {
      setSaving(true);
      const res = await fetch(`${API}/users`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, role, ...(currentUser?.role === 'SUPER_ADMIN' ? { tenantId } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { router.replace('/login'); return; }
      if (res.status === 403) throw new Error('Anda tidak memiliki izin membuat user.');
      if (!res.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message || 'Gagal membuat user.');
      setSuccess(`User ${data.email || email} berhasil dibuat.`);
      resetForm(); setShowAddForm(false);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat user.');
    } finally { setSaving(false); }
  }

  async function userRequest(path: string, method: 'PATCH', body: object) {
    const res = await fetch(`${API}${path}`, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { router.replace('/login'); return null; }
    if (!res.ok) throw new Error(data.message || 'Gagal memperbarui user.');
    return data;
  }

  async function editUser(user: User) {
    setError(''); setName(user.name); setEmail(user.email); setEditTarget(user);
  }

  async function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editTarget || saving) return;
    setSaving(true); setError('');
    try {
      await userRequest(`/users/${editTarget.id}`, 'PATCH', { name, email });
      setSuccess('Data pengguna berhasil diperbarui.');
      await loadUsers();
      setEditTarget(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Gagal memperbarui user.'); }
    finally { setSaving(false); }
  }

  async function resetUserPassword(user: User) {
    setError(''); setPassword(''); setPasswordTarget(user);
  }

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordTarget || saving) return;
    if (password.length < 8) { setError('Password minimal 8 karakter.'); return; }
    setSaving(true); setError('');
    try {
      await userRequest(`/users/${passwordTarget.id}/password`, 'PATCH', { password });
      setSuccess(`Password ${passwordTarget.email} berhasil direset.`); setPasswordTarget(null); setPassword('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Gagal mereset password.'); }
    finally { setSaving(false); }
  }

  async function toggleUserStatus(user: User) {
    setError(''); setStatusTarget(user);
  }

  async function confirmUserStatus() {
    const user = statusTarget;
    if (!user || saving) return;
    setSaving(true); setError('');
    try {
      await userRequest(`/users/${user.id}/status`, 'PATCH', { isActive: !user.isActive });
      setSuccess(`User ${user.isActive ? 'dinonaktifkan' : 'diaktifkan'}.`);
      await loadUsers();
      setStatusTarget(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Gagal mengubah status user.'); }
    finally { setSaving(false); }
  }

  async function changeRole(user: User, nextRole: 'ADMIN' | 'USER') {
    try {
      await userRequest(`/users/${user.id}/role`, 'PATCH', { role: nextRole });
      setSuccess('Role pengguna berhasil diperbarui.');
      await loadUsers();
    } catch (err) { setError(err instanceof Error ? err.message : 'Gagal mengubah role.'); }
  }

  async function openModuleAccess(user: User) {
    setError(''); setSuccess(''); setAccessUser(user);
  }

  /* ── Scope label ── */
  const scopeLabel =
    currentUser?.role === 'SUPER_ADMIN'
      ? filterTenantId
        ? `Filter: ${tenants.find(t => t.id === filterTenantId)?.name ?? filterTenantId}`
        : 'Semua Tenant'
      : currentUser?.tenant
      ? currentUser.tenant.name
      : '';

  /* ── Role dropdown in table ── */
  function canChangeRole() { return currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'ADMIN'; }
  const filteredUsers = users.filter(user => {
    const query = search.trim().toLowerCase();
    return (!query || `${user.name} ${user.email}`.toLowerCase().includes(query))
      && (!roleFilter || user.role === roleFilter)
      && (!statusFilter || (statusFilter === 'active' ? user.isActive : !user.isActive))
      && (!organizationFilter || user.tenantId === organizationFilter);
  });

  if (loading) {
    return (
      <div className="app">
        <aside className="sidebar"><div className="brand">CTI Platform</div></aside>
        <section className="main"><div className="content" style={{ paddingTop: 60, textAlign: 'center', color: 'var(--soc-muted)' }}>Memuat user…</div></section>
      </div>
    );
  }

  if (forbidden || currentUser?.role === 'USER') return <div className="app"><SharedSidebar role={currentUser?.role ?? 'USER'} onLogout={logout} /><section className="main"><main className="content admin-workspace"><p className="admin-state" role="alert">You don’t have permission to access this area.</p></main></section></div>;

  return (
    <div className="app">
      <SharedSidebar role={currentUser?.role ?? 'USER'} onLogout={logout} />

      <section className="main">
        <header className="topbar">
          <div style={{ fontWeight: 600 }}>User Management</div>
          <span style={{ fontSize: 13, color: 'var(--soc-muted)' }}>{currentUser?.role}</span>
        </header>

        <main className="content editorial-module admin-workspace">
          <Link className="admin-back-link" href="/administration">← Administration overview</Link>
          {/* Context banner */}
          <div className="admin-heading-row" style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28,
          }}>
            <div>
              <span className="source-eyebrow">USER MANAGEMENT</span><h1>People and permissions.</h1>
              <p style={{ margin: 0, color: 'var(--soc-muted)', fontSize: 15 }}>Manage users and their organizational access.{' '}
                {currentUser?.role === 'SUPER_ADMIN'
                  ? `Scope: ${scopeLabel} — Mengelola semua pengguna platform`
                  : `Scope: ${scopeLabel} — Mengelola pengguna dalam tenant Anda`}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {currentUser?.role === 'SUPER_ADMIN' && filterTenantId && (
                <Link href="/users" style={{ fontSize: 13, color: 'var(--soc-blue)' }}>← Semua Tenant</Link>
              )}
              {currentUser && (
                <Button view="action" size="l" onClick={openAddForm}>+ Add User</Button>
              )}
            </div>
          </div>

          <section className="editorial-metrics" aria-label="User summary"><div><span>Users shown</span><strong>{users.length}</strong></div><div><span>Active</span><strong>{users.filter(user => user.isActive).length}</strong></div><div><span>Administrators</span><strong>{users.filter(user => user.role === "ADMIN").length}</strong></div><div><span>Standard users</span><strong>{users.filter(user => user.role === "USER").length}</strong></div></section>
          <div className="editorial-section-heading"><span className="source-eyebrow">SEARCH & FILTER</span><h2>Find a user</h2></div>
          <div className="admin-filters"><label className="admin-filter">Search<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or email" /></label>{currentUser?.role === 'SUPER_ADMIN' && <label className="admin-filter">Organization<select value={organizationFilter} onChange={event => setOrganizationFilter(event.target.value)}><option value="">All organizations</option>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>}<label className="admin-filter">Role<select value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="">All roles</option><option value="SUPER_ADMIN">Super Admin</option><option value="ADMIN">Admin</option><option value="USER">User</option></select></label><label className="admin-filter">Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label><button type="button" onClick={() => { setSearch(''); setRoleFilter(''); setStatusFilter(''); setOrganizationFilter(''); }}>Reset</button></div>
          <div className="editorial-section-heading"><span className="source-eyebrow">USER DIRECTORY</span><h2>Manage access</h2></div>
          {/* Role badge */}
          {currentUser?.role === 'ADMIN' && currentUser.tenant && (
            <div className="context-note" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--soc-blue-tint)', borderRadius: 6, padding: '8px 14px', marginBottom: 20, fontSize: 13 }}>
              <span>Anda adalah <strong>Admin</strong> dari tenant <strong>{currentUser.tenant.name}</strong>. Anda hanya dapat mengelola user dalam tenant ini.</span>
            </div>
          )}

          {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}
          {success && <div className="success" style={{ marginBottom: 16 }}>{success}</div>}

          {/* Add user form */}
          <FormModal open={showAddForm} onOpenChange={open => { if (!open) closeAddForm(); }} title="Tambah User" loading={saving} error={showAddForm ? error : ''} submitLabel="Create User" onSubmit={createUser}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="field">
                    <label htmlFor="user-name">Nama *</label>
                    <input id="user-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nama user" autoComplete="name" required />
                  </div>
                  <div className="field">
                    <label htmlFor="user-email">Email *</label>
                    <input id="user-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" autoComplete="email" required />
                  </div>
                  <div className="field">
                    <label htmlFor="user-password">Password * (min. 8 karakter)</label>
                    <input id="user-password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimal 8 karakter" autoComplete="new-password" minLength={8} required />
                  </div>
                  <div className="field">
                    <label htmlFor="user-role">Role</label>
                    {currentUser?.role === 'SUPER_ADMIN' ? (
                      <select id="user-role" value={role} onChange={e => setRole(e.target.value as 'ADMIN' | 'USER')}>
                        <option value="USER">USER</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--soc-elevated)', borderRadius: 8, border: '1px solid var(--soc-border)', color: 'var(--soc-muted)' }}>
                        USER <small>(ADMIN hanya dapat membuat USER)</small>
                      </div>
                    )}
                  </div>
                </div>

                {currentUser?.role === 'SUPER_ADMIN' && (
                  <div className="field">
                    <label htmlFor="user-tenant">Tenant *</label>
                    <select id="user-tenant" value={tenantId} onChange={e => setTenantId(e.target.value)} required>
                      <option value="">Pilih tenant</option>
                      {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    {tenants.length === 0 && <small>Tidak ada tenant tersedia.</small>}
                  </div>
                )}

                {currentUser?.role === 'ADMIN' && currentUser.tenant && (
                  <div style={{ background: 'var(--soc-blue-tint)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--soc-ink)' }}>
                    User akan dibuat dalam tenant: <strong>{currentUser.tenant.name}</strong>
                  </div>
                )}

          </FormModal>
          <FormModal open={Boolean(editTarget)} onOpenChange={open => { if (!open) setEditTarget(null); }} title="Edit User" loading={saving} error={editTarget ? error : ''} submitLabel="Save" onSubmit={event => void submitEdit(event)}>
            <div className="field"><label htmlFor="edit-user-name">Nama</label><input id="edit-user-name" required value={name} onChange={event => setName(event.target.value)} /></div>
            <div className="field"><label htmlFor="edit-user-email">Email</label><input id="edit-user-email" type="email" required value={email} onChange={event => setEmail(event.target.value)} /></div>
          </FormModal>
          <FormModal open={Boolean(passwordTarget)} onOpenChange={open => { if (!open) setPasswordTarget(null); }} title="Reset Password" description={passwordTarget?.email} loading={saving} error={passwordTarget ? error : ''} submitLabel="Reset Password" onSubmit={event => void submitPassword(event)}>
            <div className="field"><label htmlFor="reset-user-password">Password baru (min. 8 karakter)</label><input id="reset-user-password" type="password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} /></div>
          </FormModal>
          <ConfirmationModal open={Boolean(statusTarget)} onOpenChange={open => { if (!open) setStatusTarget(null); }} title={statusTarget?.isActive ? 'Nonaktifkan user' : 'Aktifkan user'} target={statusTarget?.email} consequence="Status akses user akan diperbarui." confirmLabel={statusTarget?.isActive ? 'Nonaktifkan' : 'Aktifkan'} destructive={statusTarget?.isActive} loading={saving} error={statusTarget ? error : ''} onConfirm={confirmUserStatus} />

          {/* User table */}
          <Card view="outlined" className="admin-directory" style={{ padding: 24 }}>
            <h2 style={{ margin: '0 0 20px' }}>Users ({filteredUsers.length})</h2>
            {filteredUsers.length === 0 ? (
              <p style={{ color: 'var(--soc-muted)' }}>{users.length ? 'No users match these filters.' : 'Belum ada user.'}</p>
            ) : (
              <Table
                data={filteredUsers}
                columns={[
                  { id: 'name', name: 'Nama', template: (u: User) => <div><div style={{ fontWeight: 600 }}>{u.name}</div><div style={{ fontSize: 12, color: 'var(--soc-muted)' }}>{u.email}</div></div> },
                  { id: 'role', name: 'Role', template: (u: User) => {
                    if (u.role === 'SUPER_ADMIN') return <span style={{ fontWeight: 700, color: 'var(--soc-blue)' }}>SUPER_ADMIN</span>;
                    if (canChangeRole() && u.id !== currentUser?.id && !(currentUser?.role === 'ADMIN' && u.role === 'ADMIN')) {
                      const opts: Array<'ADMIN' | 'USER'> = currentUser?.role === 'SUPER_ADMIN' ? ['USER', 'ADMIN'] : ['USER'];
                      return (
                        <select value={u.role} onChange={e => changeRole(u, e.target.value as 'ADMIN' | 'USER')} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--soc-border)' }}>
                          {opts.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      );
                    }
                    return <span>{u.role}</span>;
                  }},
                  { id: 'status', name: 'Status', template: (u: User) => (
                    <span className={`status-pill ${u.isActive ? 'is-active' : 'is-inactive'}`}>
                      {u.isActive ? 'Aktif' : 'Nonaktif'}
                    </span>
                  )},
                  ...(currentUser?.role === 'SUPER_ADMIN' ? [{ id: 'tenant', name: 'Tenant', template: (u: User) => u.tenant?.name ?? <span style={{ color: 'var(--soc-muted)' }}>-</span> }] : []),
                  { id: 'createdAt', name: 'Dibuat', template: (u: User) => u.createdAt ? new Date(u.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-' },
                  { id: 'actions', name: 'Aksi', template: (u: User) => {
                    const cannotManage = u.id === currentUser?.id || u.role === 'SUPER_ADMIN' || (currentUser?.role === 'ADMIN' && u.role === 'ADMIN');
                    return (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button view="flat" size="s" onClick={() => setDetailUser(u)}>View</Button>
                        <Button view="flat" size="s" disabled={cannotManage} onClick={() => editUser(u)}>Edit</Button>
                        <Button view="flat" size="s" disabled={cannotManage} onClick={() => resetUserPassword(u)}>Reset PW</Button>
                        <Button view="flat" size="s" disabled={cannotManage || u.role !== 'USER'} onClick={() => openModuleAccess(u)}>Akses Modul</Button>
                        <Button view={u.isActive ? 'flat-danger' : 'flat'} size="s" disabled={cannotManage} onClick={() => toggleUserStatus(u)}>
                          {u.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                        </Button>
                      </div>
                    );
                  }},
                ]}
              />
            )}
          </Card>
          {detailUser && <section className="admin-detail" aria-label={`User detail ${detailUser.name}`}><div className="admin-detail-head"><div><span className="source-eyebrow">USER INTELLIGENCE</span><h2>{detailUser.name}</h2></div><button type="button" onClick={() => setDetailUser(null)}>Close</button></div><dl><div><dt>Email</dt><dd>{detailUser.email}</dd></div><div><dt>Organization</dt><dd>{detailUser.tenant?.name ?? 'Not available'}</dd></div><div><dt>Role</dt><dd>{detailUser.role}</dd></div><div><dt>Status</dt><dd>{detailUser.isActive ? 'Active' : 'Inactive'}</dd></div></dl><div className="admin-detail-actions">{detailUser.role === 'USER' && detailUser.id !== currentUser?.id ? <Button view="outlined" size="s" onClick={() => openModuleAccess(detailUser)}>View assigned and accessible modules</Button> : <span>Module access details are unavailable for this account.</span>}</div></section>}
          {accessUser && <ModuleAccessPanel target={accessUser} onClose={() => setAccessUser(null)} onError={setError} onSaved={setSuccess} onUnauthorized={() => router.replace('/login')} />}
        </main>
      </section>
    </div>
  );
}

export default function UsersPage() {
  return (
    <Suspense fallback={<main className="module-loading">Memuat User Management…</main>}>
      <UsersPageContent />
    </Suspense>
  );
}
