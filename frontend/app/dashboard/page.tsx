'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '../../components/dashboard/Sidebar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

type Me = {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenant: { id: string; name: string; slug: string } | null;
};

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  _count: { users: number; indicators: number };
};

type ActivityItem = {
  id: string;
  action: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

type Summary = {
  dashboardMode: 'GLOBAL' | 'TENANT_ADMIN' | 'PERSONAL';
  tenantName: string | null;
  totalTenants: number | null;
  indicators: number;
  highRiskIndicators: number;
  activeAlerts: number;
  openCases: number;
  users: number;
  myIndicatorsCreated: number;
  sources: number;
  campaigns: number;
  subscription: { plan: string; status: string };
  recentActivity: ActivityItem[];
  tenantOverview: TenantRow[];
};

/* ─────────────────────────────────────────────
   Helper — stat card
───────────────────────────────────────────── */
function StatCard({ title, value, accent }: { title: string; value: number | string; accent?: string }) {
  return (
    <div className="card" style={{ borderTop: accent ? `3px solid ${accent}` : undefined }}>
      <div className="card-title">{title}</div>
      <div className="metric">{value}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Helper — activity label
───────────────────────────────────────────── */
function actionLabel(action: string) {
  const map: Record<string, string> = {
    LOGIN: 'Login',
    SIGNUP: 'Registrasi',
    USER_CREATED: 'User dibuat',
    USER_UPDATED: 'User diperbarui',
    USER_ROLE_UPDATED: 'Role diubah',
    USER_ACTIVATED: 'User diaktifkan',
    USER_DEACTIVATED: 'User dinonaktifkan',
    USER_PASSWORD_RESET_BY_ADMIN: 'Password direset',
    TENANT_CREATED: 'Tenant dibuat',
    TENANT_ACTIVATED: 'Tenant diaktifkan',
    TENANT_DEACTIVATED: 'Tenant dinonaktifkan',
    PASSWORD_RESET: 'Reset password',
  };
  return map[action] ?? action;
}

/* ─────────────────────────────────────────────
   Shared — Activity Log
───────────────────────────────────────────── */
function ActivityLog({ items }: { items: ActivityItem[] }) {
  return (
    <div className="section card">
      <h3 style={{ margin: '0 0 14px' }}>📜 Aktivitas Terbaru</h3>
      {items.length === 0 ? (
        <p className="muted">Belum ada aktivitas tercatat.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {items.map((item) => (
            <div
              key={item.id}
              className="activity-row"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '1px 1px',
                background: 'var(--soc-nav)',
                borderRadius: 8,
                fontSize: 14,
              }}
            >
              <span>{actionLabel(item.action)}</span>
              <span style={{ color: 'var(--soc-muted)', fontSize: 12 }}>
                {new Date(item.createdAt).toLocaleString('id-ID', {
                  day: '2-digit', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Dashboard — SUPER_ADMIN (GLOBAL)
───────────────────────────────────────────── */
function GlobalDashboard({ summary }: { summary: Summary }) {
  return (
    <>
      <div style={{ background: 'var(--soc-banner-global)', color: 'var(--soc-ink)', borderRadius: 6, padding: '10px 12px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mode</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>🌐 Platform Overview — Super Admin</div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>Anda melihat data seluruh platform secara global</div>
        </div>
        <span className="badge">{summary.subscription.status}</span>
      </div>

      <div className="grid" style={{ marginBottom: 20 }}>
        <StatCard title="Total Tenant Aktif" value={summary.totalTenants ?? 0} accent="var(--soc-violet)" />
        <StatCard title="Total User Platform" value={summary.users} accent="var(--soc-blue)" />
        <StatCard title="Total Indicators" value={summary.indicators} accent="var(--soc-yellow)" />
        <StatCard title="High Risk Indicators" value={summary.highRiskIndicators} accent="var(--soc-red)" />
      </div>

      <div className="grid" style={{ marginBottom: 10 }}>
        <StatCard title="Active Alerts" value={summary.activeAlerts} />
        <StatCard title="Open Cases" value={summary.openCases} />
        <StatCard title="Campaigns" value={summary.campaigns} />
        <StatCard title="Sources" value={summary.sources} />
      </div>

      {summary.tenantOverview.length > 0 && (
        <div className="section card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>🏢 Tenant Aktif</h3>
            <Link href="/tenants" style={{ fontSize: 13, color: '#4155d8', fontWeight: 600 }}>Kelola Semua Tenant →</Link>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Nama Tenant', 'Slug', 'User Aktif', 'Indicators'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '5px 6px', fontSize: 12, fontWeight: 600, color: '#687386', borderBottom: '1px solid #e6eaf0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.tenantOverview.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #e6eaf0' }}>
                  <td style={{ padding: '5px 5px' }}>{t.name}</td>
                  <td style={{ padding: '5px 5px', color: '#687386' }}>{t.slug}</td>
                  <td style={{ padding: '5px 5px' }}>{t._count.users}</td>
                  <td style={{ padding: '5px 5px' }}>{t._count.indicators}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ActivityLog items={summary.recentActivity} />
    </>
  );
}

/* ─────────────────────────────────────────────
   Dashboard — ADMIN (TENANT_ADMIN)
───────────────────────────────────────────── */
function TenantAdminDashboard({ summary, user }: { summary: Summary; user: Me }) {
  return (
    <>
      <div style={{ background: 'var(--soc-banner-admin)', color: 'var(--soc-ink)', borderRadius: 6, padding: '24px 28px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Workspace</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>🏢 {summary.tenantName ?? user.tenant?.name}</div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>Administrator Tenant · {summary.subscription.plan}</div>
        </div>
        <span className="badge">{summary.subscription.status}</span>
      </div>

      <div className="grid" style={{ marginBottom: 20 }}>
        <StatCard title="User Aktif" value={summary.users} accent="var(--soc-blue)" />
        <StatCard title="Total Indicators" value={summary.indicators} accent="var(--soc-yellow)" />
        <StatCard title="High Risk" value={summary.highRiskIndicators} accent="var(--soc-red)" />
        <StatCard title="Indicators Anda" value={summary.myIndicatorsCreated} accent="var(--soc-green)" />
      </div>

      <div className="grid" style={{ marginBottom: 20 }}>
        <StatCard title="Active Alerts" value={summary.activeAlerts} />
        <StatCard title="Open Cases" value={summary.openCases} />
        <StatCard title="Campaigns" value={summary.campaigns} />
        <StatCard title="Sources" value={summary.sources} />
      </div>

      <div className="section card" style={{ marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 14px' }}>⚡ Quick Actions</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/indicators" className="quick-action is-info">+ Tambah Indicator</Link>
          <Link href="/users" className="quick-action is-success">Kelola User</Link>
          <Link href="/audit-logs" className="quick-action is-warning">Audit Log</Link>
        </div>
      </div>

      <ActivityLog items={summary.recentActivity} />
    </>
  );
}

/* ─────────────────────────────────────────────
   Dashboard — USER (PERSONAL)
───────────────────────────────────────────── */
function PersonalDashboard({ summary, user }: { summary: Summary; user: Me }) {
  return (
    <>
      <div style={{ background: 'var(--soc-banner-user)', color: 'var(--soc-ink)', borderRadius: 6, padding: '24px 28px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Workspace</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>👋 Halo, {user.name}!</div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>{summary.tenantName ?? user.tenant?.name} · {summary.subscription.plan}</div>
        </div>
        <span className="badge">{summary.subscription.status}</span>
      </div>

      <div className="grid" style={{ marginBottom: 20 }}>
        <StatCard title="Indicators Anda" value={summary.myIndicatorsCreated} accent="var(--soc-green)" />
        <StatCard title="Total Indicators Tenant" value={summary.indicators} accent="var(--soc-yellow)" />
        <StatCard title="High Risk (Tenant)" value={summary.highRiskIndicators} accent="var(--soc-red)" />
        <StatCard title="Active Alerts" value={summary.activeAlerts} accent="var(--soc-violet)" />
      </div>

      <div className="grid" style={{ marginBottom: 20 }}>
        <StatCard title="Open Cases" value={summary.openCases} />
        <StatCard title="Campaigns" value={summary.campaigns} />
        <StatCard title="Sources" value={summary.sources} />
        <StatCard title="User Aktif (Tenant)" value={summary.users} />
      </div>

      <div className="section card" style={{ marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 14px' }}>⚡ Quick Actions</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/indicators" className="quick-action is-info">+ Tambah Indicator</Link>
          <Link href="/indicators" className="quick-action is-success">Browse Indicators</Link>
        </div>
      </div>

      <ActivityLog items={summary.recentActivity} />
    </>
  );
}

/* ─────────────────────────────────────────────
   Main Page
───────────────────────────────────────────── */
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<Me | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const me = await fetch(`${API}/auth/me`, { credentials: 'include' });
        if (!me.ok) { router.replace('/'); return; }
        const userData: Me = await me.json();
        setUser(userData);

        const dash = await fetch(`${API}/dashboard/summary`, { credentials: 'include' });
        if (!dash.ok) throw new Error('Gagal memuat data dashboard');
        setSummary(await dash.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Terjadi kesalahan');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function logout() {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/');
  }

  if (loading) {
    return (
      <div className="app">
        <aside className="sidebar"><div className="brand">CTI Platform</div></aside>
        <section className="main"><div className="content" style={{ paddingTop: 60, textAlign: 'center', color: '#687386' }}>Memuat dashboard…</div></section>
      </div>
    );
  }

  if (!user || !summary) {
    return (
      <div className="app">
        <aside className="sidebar"><div className="brand">CTI Platform</div></aside>
        <section className="main"><div className="content">{error && <div className="error">{error}</div>}</div></section>
      </div>
    );
  }

  const topbarTitle =
    summary.dashboardMode === 'GLOBAL'
      ? '🌐 Platform Overview'
      : summary.dashboardMode === 'TENANT_ADMIN'
      ? `🏢 ${summary.tenantName}`
      : `👋 ${user.name}`;

  const subTitle =
    summary.dashboardMode === 'GLOBAL'
      ? `Platform Global · ${summary.totalTenants ?? 0} tenant aktif`
      : summary.dashboardMode === 'TENANT_ADMIN'
      ? `${summary.tenantName} · Tenant Admin`
      : `${summary.tenantName ?? user.tenant?.name} · Pengguna`;

  return (
    <div className="app">
      <Sidebar role={user.role} />

      <section className="main">
        <header className="topbar">
          <div style={{ fontWeight: 600 }}>{topbarTitle}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 13, color: '#687386' }}>
              {user.email} · <strong>{user.role}</strong>
            </span>
            <button className="logout" onClick={logout}>Logout</button>
          </div>
        </header>

        <main className="content">
          <div className="header">
            <div>
              <h1>Dashboard</h1>
              <div className="tenant">{subTitle}</div>
            </div>
          </div>

          {summary.dashboardMode === 'GLOBAL' && <GlobalDashboard summary={summary} />}
          {summary.dashboardMode === 'TENANT_ADMIN' && <TenantAdminDashboard summary={summary} user={user} />}
          {summary.dashboardMode === 'PERSONAL' && <PersonalDashboard summary={summary} user={user} />}
        </main>
      </section>
    </div>
  );
}
