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

import type { ModuleAccess } from '../../lib/module-access';

type Me = {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenant: { id: string; name: string; slug: string } | null;
  moduleAccess: ModuleAccess[];
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

function CommandOverview({ summary, user }: { summary: Summary; user: Me }) {
  const actions = [
    { label: 'Cari indicator', href: '/indicators', enabled: user.moduleAccess.some(module => module.moduleSlug === 'threat-intelligence' && module.accessible && module.featureKeys.includes('indicator-management')) },
    { label: 'Lihat asset', href: '/attack-surface/assets', enabled: user.moduleAccess.some(module => module.moduleSlug === 'attack-surface-management' && module.accessible && module.featureKeys.includes('asset-management')) },
    { label: 'Buka cases', href: '/cases', enabled: user.moduleAccess.some(module => module.moduleSlug === 'case-management' && module.accessible && module.featureKeys.includes('case-workflow')) },
  ];
  const metrics = [
    { label: 'Indicators monitored', value: summary.indicators },
    { label: 'High risk indicators', value: summary.highRiskIndicators },
    { label: 'Open investigations', value: summary.openCases },
    { label: 'Active alerts', value: summary.activeAlerts },
  ];
  return <section className="command-overview" aria-label="Ringkasan command center">
    <div className="command-hero"><div className="command-hero-copy"><span className="command-eyebrow">CTI / {summary.dashboardMode.replace('_', ' ')}</span><h2>Security visibility,<br /><span>in one place.</span></h2><p>{summary.tenantName ?? 'Platform'} · Intelligence, exposure, and investigations in one operational view.</p><div className="command-actions">{actions.filter(action => action.enabled).map(action => <Link className="quick-action is-info" key={action.href} href={action.href}>{action.label} ↗</Link>)}</div></div><div className="command-visual" aria-label="Live summary of available intelligence"><div className="command-visual-top"><span>LIVE WORKSPACE</span><span>● CONNECTED</span></div><div className="command-visual-center"><small>INTELLIGENCE SIGNALS</small><strong>{summary.indicators}</strong><span>Indicators in scope</span></div><div className="command-visual-bottom"><span>HIGH RISK <b>{summary.highRiskIndicators}</b></span><span>OPEN CASES <b>{summary.openCases}</b></span></div></div></div>
    <div className="command-kpis">{metrics.map(metric => <article className="command-metric" key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></article>)}</div>
    <div className="command-detail-grid"><article className="command-story"><span className="command-eyebrow">01 / RISK POSTURE</span><h3>Focus on what needs attention.</h3><p>High risk indicators are drawn from the current dashboard summary. Explore the accessible modules to investigate the underlying records.</p><div className="command-risk"><span>High risk indicators</span><strong>{summary.highRiskIndicators}</strong></div></article><article className="command-story command-story-secondary"><span className="command-eyebrow">02 / WORKFLOW</span><h3>Move from signal to investigation.</h3><p>Review intelligence, inspect your attack surface, and continue open cases in the same workspace.</p><div className="command-actions">{actions.filter(action => action.enabled).map(action => <Link className="quick-action is-info" key={action.href} href={action.href}>{action.label} ↗</Link>)}{actions.every(action => !action.enabled) && <p className="muted">Tidak ada modul yang dapat diakses.</p>}</div></article></div>
  </section>;
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

      <div className="section card" style={{ marginTop: 20, marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 14px' }}>⚡ Quick Actions</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/tenants" className="quick-action is-info">Kelola Tenant</Link>
          <Link href="/users" className="quick-action is-success">Kelola User</Link>
          <Link href="/audit-logs" className="quick-action is-warning">Audit Log Global</Link>
        </div>
      </div>

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
        if (!me.ok) { router.replace('/login'); return; }
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
    router.replace('/login');
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
      <Sidebar role={user.role} moduleAccess={user.moduleAccess} onLogout={logout} />

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
          <div className="header dashboard-heading">
            <div>
              <h1>Dashboard</h1>
              <div className="tenant">{subTitle}</div>
            </div>
          </div>

          <CommandOverview summary={summary} user={user} />

          <section className="dashboard-secondary" aria-label="Additional workspace metrics"><div className="dashboard-section-title"><span className="command-eyebrow">WORKSPACE / COVERAGE</span><h2>More of the picture.</h2></div><div className="dashboard-secondary-grid"><StatCard title="Sources" value={summary.sources} /><StatCard title="Campaigns" value={summary.campaigns} /><StatCard title="Users" value={summary.users} /><StatCard title="Indicators you created" value={summary.myIndicatorsCreated} /></div>{user.role !== 'USER' && <div className="command-actions dashboard-admin-actions"><Link className="quick-action is-info" href="/users">Kelola user ↗</Link><Link className="quick-action is-info" href="/audit-logs">Audit log ↗</Link>{user.role === 'SUPER_ADMIN' && <Link className="quick-action is-info" href="/tenants">Kelola tenant ↗</Link>}</div>}</section>

          <section className="dashboard-activity"><div className="dashboard-section-title"><span className="command-eyebrow">WORKSPACE / RECENT</span><h2>Activity in context.</h2></div><ActivityLog items={summary.recentActivity} /></section>
          {summary.dashboardMode === 'GLOBAL' && summary.tenantOverview.length > 0 && <section className="dashboard-tenants"><div className="dashboard-section-title"><span className="command-eyebrow">PLATFORM / TENANTS</span><h2>Tenant overview.</h2></div><div className="card"><div className="dashboard-tenant-link"><Link href="/tenants">Kelola semua tenant ↗</Link></div><div className="dashboard-table-scroll"><table><thead><tr><th>Tenant</th><th>Slug</th><th>Users</th><th>Indicators</th></tr></thead><tbody>{summary.tenantOverview.map(tenant => <tr key={tenant.id}><td>{tenant.name}</td><td>{tenant.slug}</td><td>{tenant._count.users}</td><td>{tenant._count.indicators}</td></tr>)}</tbody></table></div></div></section>}
        </main>
      </section>
    </div>
  );
}
