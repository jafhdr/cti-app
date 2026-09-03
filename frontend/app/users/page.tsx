'use client';

import { Suspense, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import SharedSidebar from '../../components/dashboard/Sidebar';
import ModuleAccessPanel from '../../components/users/ModuleAccessPanel';

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

  // Messages
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  /* ── Load users ── */
  async function loadUsers() {
    try {
      setError('');
      const params = new URLSearchParams();
      if (filterTenantId) params.set('tenantId', filterTenantId);
      const res = await fetch(`${API}/users?${params}`, { credentials: 'include', cache: 'no-store' });
      if (res.status === 401) { router.replace('/'); return; }
      if (res.status === 403) { router.replace('/dashboard'); return; }
      if (!res.ok) throw new Error('Gagal mengambil data user.');
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : data.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan saat mengambil user.');
    }
  }

  async function loadCurrentUser() {
    const res = await fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' });
    if (res.status === 401) { router.replace('/'); return; }
    if (!res.ok) throw new Error('Gagal memuat sesi pengguna.');
    setCurrentUser(await res.json());
  }

  async function loadTenants() {
    try {
      const res = await fetch(`${API}/users/tenants`, { credentials: 'include', cache: 'no-store' });
      if (res.status === 401) { router.replace('/'); return; }
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
    router.replace('/');
  }

  function resetForm() { setName(''); setEmail(''); setPassword(''); setRole('USER'); setTenantId(''); }
  function openAddForm() { setError(''); setSuccess(''); resetForm(); setShowAddForm(true); }
  function closeAddForm() { if (saving) return; resetForm(); setError(''); setShowAddForm(false); }

  /* ── Create user ── */
  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      if (res.status === 401) { router.replace('/'); return; }
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
    if (res.status === 401) { router.replace('/'); return null; }
    if (!res.ok) throw new Error(data.message || 'Gagal memperbarui user.');
    return data;
  }

  async function editUser(user: User) {
    const nextName = window.prompt('Nama pengguna', user.name);
    if (nextName === null) return;
    const nextEmail = window.prompt('Email pengguna', user.email);
    if (nextEmail === null) return;
    try {
      await userRequest(`/users/${user.id}`, 'PATCH', { name: nextName, email: nextEmail });
      setSuccess('Data pengguna berhasil diperbarui.');
      await loadUsers();
    } catch (err) { setError(err instanceof Error ? err.message : 'Gagal memperbarui user.'); }
  }

  async function resetUserPassword(user: User) {
    const nextPassword = window.prompt(`Password baru untuk ${user.email} (minimal 8 karakter)`);
    if (nextPassword === null) return;
    if (nextPassword.length < 8) { setError('Password minimal 8 karakter.'); return; }
    try {
      await userRequest(`/users/${user.id}/password`, 'PATCH', { password: nextPassword });
      setSuccess(`Password ${user.email} berhasil direset.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Gagal mereset password.'); }
  }

  async function toggleUserStatus(user: User) {
    const action = user.isActive ? 'menonaktifkan' : 'mengaktifkan';
    if (!window.confirm(`Yakin ingin ${action} ${user.email}?`)) return;
    try {
      await userRequest(`/users/${user.id}/status`, 'PATCH', { isActive: !user.isActive });
      setSuccess(`User ${user.isActive ? 'dinonaktifkan' : 'diaktifkan'}.`);
      await loadUsers();
    } catch (err) { setError(err instanceof Error ? err.message : 'Gagal mengubah status user.'); }
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

  if (loading) {
    return (
      <div className="app">
        <aside className="sidebar"><div className="brand">CTI Platform</div></aside>
        <section className="main"><div className="content" style={{ paddingTop: 60, textAlign: 'center', color: '#687386' }}>Memuat user…</div></section>
      </div>
    );
  }

  return (
    <div className="app">
      <SharedSidebar role={currentUser?.role ?? 'USER'} onLogout={logout} />

      <section className="main">
        <header className="topbar">
          <div style={{ fontWeight: 600 }}>👥 User Management</div>
          <span style={{ fontSize: 13, color: '#687386' }}>{currentUser?.role}</span>
        </header>

        <main className="content">
          {/* Context banner */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28,
          }}>
            <div>
              <h1 style={{ margin: '0 0 6px' }}>User Management</h1>
              <p style={{ margin: 0, color: '#687386', fontSize: 15 }}>
                {currentUser?.role === 'SUPER_ADMIN'
                  ? `Scope: ${scopeLabel} — Mengelola semua pengguna platform`
                  : `Scope: ${scopeLabel} — Mengelola pengguna dalam tenant Anda`}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {currentUser?.role === 'SUPER_ADMIN' && filterTenantId && (
                <Link href="/users" style={{ fontSize: 13, color: '#4155d8' }}>← Semua Tenant</Link>
              )}
              {currentUser && (
                <Button view="action" size="l" onClick={openAddForm}>+ Add User</Button>
              )}
            </div>
          </div>

          {/* Role badge */}
          {currentUser?.role === 'ADMIN' && currentUser.tenant && (
            <div className="context-note" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--soc-blue-tint)', borderRadius: 6, padding: '8px 14px', marginBottom: 20, fontSize: 13 }}>
              <span>🏢</span>
              <span>Anda adalah <strong>Admin</strong> dari tenant <strong>{currentUser.tenant.name}</strong>. Anda hanya dapat mengelola user dalam tenant ini.</span>
            </div>
          )}

          {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}
          {success && <div className="success" style={{ marginBottom: 16 }}>{success}</div>}

          {/* Add user form */}
          {showAddForm && (
            <Card view="outlined" style={{ padding: 28, marginBottom: 24 }}>
              <h2 style={{ margin: '0 0 20px' }}>Tambah User</h2>
              <form onSubmit={createUser} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e6eaf0', color: '#687386' }}>
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
                  <div style={{ background: '#f0f9ff', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#0369a1' }}>
                    User akan dibuat dalam tenant: <strong>{currentUser.tenant.name}</strong>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <Button type="submit" view="action" size="l" disabled={saving}>{saving ? 'Creating...' : 'Create User'}</Button>
                  <Button type="button" view="outlined" size="l" onClick={closeAddForm} disabled={saving}>Cancel</Button>
                </div>
              </form>
            </Card>
          )}

          {/* User table */}
          <Card view="outlined" style={{ padding: 24 }}>
            <h2 style={{ margin: '0 0 20px' }}>Users ({users.length})</h2>
            {users.length === 0 ? (
              <p style={{ color: '#687386' }}>Belum ada user.</p>
            ) : (
              <Table
                data={users}
                columns={[
                  { id: 'name', name: 'Nama', template: (u: User) => <div><div style={{ fontWeight: 600 }}>{u.name}</div><div style={{ fontSize: 12, color: '#687386' }}>{u.email}</div></div> },
                  { id: 'role', name: 'Role', template: (u: User) => {
                    if (u.role === 'SUPER_ADMIN') return <span style={{ fontWeight: 700, color: '#6366f1' }}>SUPER_ADMIN</span>;
                    if (canChangeRole() && u.id !== currentUser?.id && !(currentUser?.role === 'ADMIN' && u.role === 'ADMIN')) {
                      const opts: Array<'ADMIN' | 'USER'> = currentUser?.role === 'SUPER_ADMIN' ? ['USER', 'ADMIN'] : ['USER'];
                      return (
                        <select value={u.role} onChange={e => changeRole(u, e.target.value as 'ADMIN' | 'USER')} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e6eaf0' }}>
                          {opts.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      );
                    }
                    return <span>{u.role}</span>;
                  }},
                  { id: 'status', name: 'Status', template: (u: User) => (
                    <span className={`status-pill ${u.isActive ? 'is-active' : 'is-inactive'}`} style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: u.isActive ? '#e9f8ef' : '#fff0f0', color: u.isActive ? '#18794e' : '#b42318' }}>
                      {u.isActive ? 'Aktif' : 'Nonaktif'}
                    </span>
                  )},
                  ...(currentUser?.role === 'SUPER_ADMIN' ? [{ id: 'tenant', name: 'Tenant', template: (u: User) => u.tenant?.name ?? <span style={{ color: '#687386' }}>-</span> }] : []),
                  { id: 'createdAt', name: 'Dibuat', template: (u: User) => u.createdAt ? new Date(u.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-' },
                  { id: 'actions', name: 'Aksi', template: (u: User) => {
                    const cannotManage = u.id === currentUser?.id || u.role === 'SUPER_ADMIN' || (currentUser?.role === 'ADMIN' && u.role === 'ADMIN');
                    return (
                      <div style={{ display: 'flex', gap: 8 }}>
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
          {accessUser && <ModuleAccessPanel target={accessUser} onClose={() => setAccessUser(null)} onError={setError} onSaved={setSuccess} onUnauthorized={() => router.replace('/')} />}
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
