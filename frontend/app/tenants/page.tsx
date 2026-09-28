'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import SharedSidebar from '../../components/dashboard/Sidebar';
import type { ModulePolicy } from '../../lib/access-policy';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type Tenant = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  deactivatedAt: string | null;
  createdAt: string;
  _count: { users: number; indicators: number };
};

type CurrentUser = {
  id: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER';
  tenant: { id: string; name: string } | null;
};

function LegacySidebar({ role, onLogout }: { role: string; onLogout: () => void }) {
  const items = [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Indicators', href: '/indicators' },
    { label: 'Threat Actors', href: '#' },
    { label: 'Campaigns', href: '#' },
    { label: 'Cases', href: '#' },
    { label: 'Reports', href: '#' },
    { label: 'Sources', href: '#' },
    { label: 'Alerts', href: '#' },
    ...(role === 'SUPER_ADMIN'
      ? [
          { label: 'ADMIN', href: '', divider: true },
          { label: 'Tenant Management', href: '/tenants' },
          { label: '👥 User Management', href: '/users' },
          { label: '📋 Audit Log', href: '/audit-logs' },
        ]
      : role === 'ADMIN'
      ? [
          { label: 'ADMIN', href: '', divider: true },
          { label: '👥 User Management', href: '/users' },
          { label: '📋 Audit Log', href: '/audit-logs' },
        ]
      : []),
  ];

  return (
    <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="brand">CTI Platform</div>
      <nav className="nav" style={{ flex: 1 }}>
        {items.map((item) =>
          (item as any).divider ? (
            <div key={item.label} style={{ fontSize: 10, color: '#64748b', padding: '14px 12px 4px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {item.label}
            </div>
          ) : (
            <Link
              key={item.label}
              href={item.href}
              className={`nav-item${item.href === '/tenants' ? ' active' : ''}`}
            >
              {item.label}
            </Link>
          )
        )}
      </nav>
      <button onClick={onLogout} className="logout" style={{ margin: '16px 0 0', width: '100%', textAlign: 'center' }}>
        Logout
      </button>
    </aside>
  );
}

export default function TenantsPage() {
  const router = useRouter();

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [tenantModules, setTenantModules] = useState<readonly ModulePolicy[]>([]);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const detailSequence = useRef(0);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', adminName: '', adminEmail: '', adminPassword: '' });

  async function loadCurrentUser() {
    const res = await fetch(API + '/auth/me', { credentials: 'include', cache: 'no-store' });
    if (res.status === 401) { router.replace('/login'); return null; }
    if (!res.ok) return null;
    return res.json() as Promise<CurrentUser>;
  }

  async function loadTenants() {
    const res = await fetch(API + '/tenants', { credentials: 'include', cache: 'no-store' });
    if (res.status === 401) { router.replace('/login'); return []; }
    if (res.status === 403) { setForbidden(true); return []; }
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  useEffect(() => {
    (async () => {
      const [user, list] = await Promise.all([loadCurrentUser(), loadTenants()]);
      if (!user) return;
      if (user.role !== 'SUPER_ADMIN') { setCurrentUser(user); setForbidden(true); setLoading(false); return; }
      setCurrentUser(user);
      setTenants(list);
      setLoading(false);
    })();
  }, []);

  async function logout() {
    await fetch(API + '/auth/logout', { method: 'POST', credentials: 'include' });
    router.replace('/login');
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!form.name || !form.slug || !form.adminName || !form.adminEmail || !form.adminPassword) { setError('Semua field wajib diisi.'); return; }
    if (form.adminPassword.length < 8) { setError('Password minimal 8 karakter.'); return; }
    if (!/^[a-z0-9-]+/.test(form.slug)) { setError('Slug hanya boleh huruf kecil, angka, dan tanda hubung.'); return; }
    try {
      setSaving(true);
      const res = await fetch(API + '/tenants', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { router.replace('/login'); return; }
      if (!res.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message || 'Gagal membuat tenant.');
      setSuccess('Tenant "' + data.tenant?.name + '" berhasil dibuat. Admin: ' + data.admin?.email);
      setForm({ name: '', slug: '', adminName: '', adminEmail: '', adminPassword: '' });
      setShowForm(false);
      setTenants(await loadTenants());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat tenant.');
    } finally { setSaving(false); }
  }

  async function toggleStatus(tenant: Tenant) {
    if (!window.confirm('Yakin ingin ' + (tenant.isActive ? 'menonaktifkan' : 'mengaktifkan') + ' tenant "' + tenant.name + '"?')) return;
    setError(''); setSuccess('');
    try {
      const res = await fetch(API + '/tenants/' + tenant.id + '/status', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !tenant.isActive }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Gagal mengubah status tenant.');
      setSuccess('Tenant "' + tenant.name + '" berhasil ' + (tenant.isActive ? 'dinonaktifkan' : 'diaktifkan') + '.');
      setTenants(await loadTenants());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah status tenant.');
    }
  }

  async function viewTenant(tenant: Tenant) {
    const sequence = ++detailSequence.current;
    setSelectedTenant(tenant); setTenantModules([]); setDetailError(''); setDetailLoading(true);
    try {
      const response = await fetch(`${API}/modules/configuration?tenantId=${encodeURIComponent(tenant.id)}`, { credentials: 'include', cache: 'no-store' });
      if (response.status === 401) { router.replace('/login'); return; }
      if (!response.ok) throw new Error('Module policy could not be loaded.');
      const policy: readonly ModulePolicy[] = await response.json();
      if (sequence === detailSequence.current) setTenantModules(policy);
    } catch (cause) { if (sequence === detailSequence.current) setDetailError(cause instanceof Error ? cause.message : 'Module policy could not be loaded.'); }
    finally { if (sequence === detailSequence.current) setDetailLoading(false); }
  }

  if (loading) {
    return (
      <div className="app">
        <aside className="sidebar"><div className="brand">CTI Platform</div></aside>
        <section className="main"><div className="content" style={{ paddingTop: 60, textAlign: 'center', color: 'var(--soc-muted)' }}>Memuat tenant…</div></section>
      </div>
    );
  }

  if (forbidden) return <div className="app"><SharedSidebar role={currentUser?.role ?? 'USER'} onLogout={logout} /><section className="main"><main className="content admin-workspace"><p className="admin-state" role="alert">You don’t have permission to access this area.</p></main></section></div>;

  return (
    <div className="app">
      <SharedSidebar role={currentUser?.role ?? 'USER'} onLogout={logout} />
      <section className="main">
        <header className="topbar">
          <div style={{ fontWeight: 600 }}>Tenant Management</div>
          <span style={{ fontSize: 13, color: 'var(--soc-muted)' }}>{currentUser?.role}</span>
        </header>
        <main className="content editorial-module admin-workspace">
          <Link className="admin-back-link" href="/administration">← Administration overview</Link>
          <div className="admin-heading-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
            <div>
              <span className="source-eyebrow">TENANT MANAGEMENT</span><h1>Organizations in your platform.</h1>
              <p>Manage tenant status, users and access to the platform.</p>
            </div>
            <Button view="action" size="l" onClick={() => { setError(''); setSuccess(''); setShowForm(true); }}>+ Buat Tenant Baru</Button>
          </div>

          <section className="editorial-metrics" aria-label="Tenant summary"><div><span>Total tenants</span><strong>{tenants.length}</strong></div><div><span>Active</span><strong>{tenants.filter(tenant => tenant.isActive).length}</strong></div><div><span>Users</span><strong>{tenants.reduce((count, tenant) => count + tenant._count.users, 0)}</strong></div><div><span>Indicators</span><strong>{tenants.reduce((count, tenant) => count + tenant._count.indicators, 0)}</strong></div></section>
          <div className="editorial-section-heading"><span className="source-eyebrow">TENANT OPERATIONS</span><h2>Organization directory</h2></div>
          {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}
          {success && <div className="success" style={{ marginBottom: 16 }}>{success}</div>}

          {showForm && (
            <Card view="outlined" style={{ padding: 28, marginBottom: 24 }}>
              <h2 style={{ margin: '0 0 20px' }}>Buat Tenant Baru</h2>
              <form onSubmit={handleCreate}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="field">
                    <label>Nama Organisasi *</label>
                    <input type="text" value={form.name} onChange={e => { const n = e.target.value; const s = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); setForm(f => ({ ...f, name: n, slug: s })); }} placeholder="Contoh: PT Maju Jaya" required />
                  </div>
                  <div className="field">
                    <label>Slug *</label>
                    <input type="text" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="pt-maju-jaya" required />
                    <small style={{ color: 'var(--soc-muted)', fontSize: 12 }}>Huruf kecil, angka, tanda hubung</small>
                  </div>
                </div>
                <div style={{ marginTop: 20, marginBottom: 8, fontWeight: 600, fontSize: 14, borderTop: '1px solid var(--soc-border)', paddingTop: 16 }}>Akun Administrator Tenant</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="field">
                    <label>Nama Admin *</label>
                    <input type="text" value={form.adminName} onChange={e => setForm(f => ({ ...f, adminName: e.target.value }))} placeholder="Nama lengkap admin" required />
                  </div>
                  <div className="field">
                    <label>Email Admin *</label>
                    <input type="email" value={form.adminEmail} onChange={e => setForm(f => ({ ...f, adminEmail: e.target.value }))} placeholder="admin@tenant.com" required />
                  </div>
                  <div className="field">
                    <label>Password Admin * (min. 8 karakter)</label>
                    <input type="password" value={form.adminPassword} onChange={e => setForm(f => ({ ...f, adminPassword: e.target.value }))} placeholder="Minimal 8 karakter" minLength={8} required />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                  <Button type="submit" view="action" size="l" disabled={saving}>{saving ? 'Membuat…' : 'Buat Tenant'}</Button>
                  <Button type="button" view="outlined" size="l" disabled={saving} onClick={() => { setShowForm(false); setForm({ name: '', slug: '', adminName: '', adminEmail: '', adminPassword: '' }); }}>Batal</Button>
                </div>
              </form>
            </Card>
          )}

          <Card view="outlined" className="admin-directory" style={{ padding: 24 }}>
            <h2 style={{ margin: '0 0 20px' }}>Daftar Tenant ({tenants.length})</h2>
            {tenants.length === 0 ? (
              <p style={{ color: 'var(--soc-muted)' }}>Belum ada tenant terdaftar.</p>
            ) : (
              <Table
                data={tenants}
                columns={[
                  { id: 'name', name: 'Nama Tenant', template: (t: Tenant) => <div><div style={{ fontWeight: 600 }}>{t.name}</div><div style={{ fontSize: 12, color: 'var(--soc-muted)' }}>{t.slug}</div></div> },
                  { id: 'status', name: 'Status', template: (t: Tenant) => <span className={`status-pill ${t.isActive ? 'is-active' : 'is-inactive'}`}>{t.isActive ? 'Aktif' : 'Nonaktif'}</span> },
                  { id: 'users', name: 'User', template: (t: Tenant) => t._count.users },
                  { id: 'indicators', name: 'Indicators', template: (t: Tenant) => t._count.indicators },
                  { id: 'createdAt', name: 'Dibuat', template: (t: Tenant) => new Date(t.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) },
                  { id: 'actions', name: 'Aksi', template: (t: Tenant) => (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button view="flat" size="s" onClick={() => void viewTenant(t)}>View</Button>
                      <Button view={t.isActive ? 'flat-danger' : 'flat'} size="s" onClick={() => toggleStatus(t)}>{t.isActive ? 'Nonaktifkan' : 'Aktifkan'}</Button>
                      <Button view="flat" size="s" onClick={() => router.push('/users?tenantId=' + t.id)}>Lihat User</Button>
                    </div>
                  )},
                ]}
              />
            )}
          </Card>
          {selectedTenant && <section className="admin-detail" aria-label={`Organization detail ${selectedTenant.name}`}><div className="admin-detail-head"><div><span className="source-eyebrow">ORGANIZATION WORKSPACE</span><h2>{selectedTenant.name}</h2></div><button type="button" onClick={() => { detailSequence.current += 1; setSelectedTenant(null); }}>Close</button></div><dl><div><dt>Status</dt><dd>{selectedTenant.isActive ? 'Active' : 'Inactive'}</dd></div><div><dt>Users</dt><dd>{selectedTenant._count.users}</dd></div><div><dt>Created</dt><dd>{new Date(selectedTenant.createdAt).toLocaleDateString('id-ID')}</dd></div><div><dt>Slug</dt><dd>{selectedTenant.slug}</dd></div></dl><div className="admin-detail-actions"><Link href={`/users?tenantId=${encodeURIComponent(selectedTenant.id)}`}>View organization users ↗</Link></div><h3>Module access</h3><p>Tenant policy determines eligibility. Individual accessibility is evaluated for each user by the backend.</p>{detailError && <p role="alert" className="error">{detailError}</p>}{detailLoading && <p className="muted" role="status">Loading module policies…</p>}{!detailLoading && !detailError && tenantModules.length === 0 && <p className="muted">No module policies available.</p>}{tenantModules.length > 0 && <div className="admin-policy-list">{tenantModules.map(module => <div key={module.id}><strong>{module.name}</strong><span>Global: {module.isActive ? 'Active' : 'Inactive'} · Tenant: {module.tenantEnabled ? 'Enabled' : 'Disabled'} · Included: {module.subscriptionIncluded ? 'Yes' : 'No'}</span></div>)}</div>}</section>}
        </main>
      </section>
    </div>
  );
}
