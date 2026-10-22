'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Activity, Building2, Globe2, LogOut, UserRound } from 'lucide-react';
import Sidebar from '../../components/dashboard/Sidebar';
import { DashboardSearch } from '../../components/dashboard/DashboardSearch';
import { DashboardBell } from '../../components/dashboard/DashboardBell';

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
  indicators: number | null;
  highRiskIndicators: number | null;
  activeAlerts: number | null;
  openCases: number | null;
  users: number | null;
  myIndicatorsCreated: number | null;
  sources: number | null;
  campaigns: number | null;
  subscription: { plan: string | null; status: string; persistedStatus: string | null };
  activityAvailable: boolean;
  recentActivity: ActivityItem[];
  tenantOverview: TenantRow[];
};

/* ─────────────────────────────────────────────
   Helper — stat card
───────────────────────────────────────────── */
function StatCard({ title, value }: { title: string; value: number | string | null }) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div className="metric">{value ?? "—"}</div>
    </div>
  );
}

function CommandOverview({ summary, user }: { summary: Summary; user: Me }) {
  const actions = [
    { label: 'Cari indicator', href: '/indicators', enabled: user.moduleAccess.some(module => module.moduleSlug === 'threat-intelligence' && module.accessible && module.featureKeys.includes('indicator-management')) },
    { label: 'Lihat asset', href: '/attack-surface/assets', enabled: user.moduleAccess.some(module => module.moduleSlug === 'attack-surface-management' && module.accessible && module.featureKeys.includes('asset-management')) },
    { label: 'Buka cases', href: '/cases', enabled: user.moduleAccess.some(module => module.moduleSlug === 'case-management' && module.accessible && module.featureKeys.includes('case-workflow')) },
  ].filter(action => action.enabled);
  const metrics = [
    { label: 'Indicators monitored', value: summary.indicators },
    { label: 'High risk indicators', value: summary.highRiskIndicators },
    { label: 'Open investigations', value: summary.openCases },
    { label: 'Active alerts', value: summary.activeAlerts },
  ].filter((metric): metric is { label: string; value: number } => metric.value !== null);
  const hasSignals = summary.indicators !== null;
  return <section className="command-overview" aria-label="Ringkasan command center">
    <div className={`command-hero${hasSignals ? '' : ' command-hero-empty'}`}>
      <div className="command-hero-copy">
        <span className="command-eyebrow">CTI / {summary.dashboardMode.replace('_', ' ')}</span>
        <h2>Security visibility,<br /><span>in one place.</span></h2>
        <p>{summary.tenantName ?? 'Platform'} · Ringkasan kondisi saat ini, bukan tren historis.</p>
        {summary.dashboardMode !== 'GLOBAL' && <p>Subscription: {summary.subscription.plan ? `${summary.subscription.plan} · ` : ''}{summary.subscription.status}</p>}
        <div className="command-actions">{actions.map(action => <Link className="quick-action is-info" key={action.href} href={action.href}>{action.label} ↗</Link>)}</div>
      </div>
      {hasSignals && <div className="command-visual" aria-label="Ringkasan intelligence saat ini">
        <div className="command-visual-top"><span>WORKSPACE SNAPSHOT</span><span>● TERSEDIA</span></div>
        <div className="command-visual-center"><small>INTELLIGENCE SIGNALS</small><strong>{summary.indicators}</strong><span>Indicators in scope</span></div>
        <div className="command-visual-bottom">
          {summary.highRiskIndicators !== null && <span>HIGH RISK <b>{summary.highRiskIndicators}</b></span>}
          {summary.openCases !== null && <span>OPEN CASES <b>{summary.openCases}</b></span>}
        </div>
      </div>}
    </div>
    {metrics.length > 0 ? <div className="command-kpis">{metrics.map(metric => <article className="command-metric" key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></article>)}</div> : <p className="muted">Tidak ada statistik modul yang dapat diakses.</p>}
    <div className={`command-detail-grid${summary.highRiskIndicators === null ? ' command-detail-empty' : ''}`}>
      {summary.highRiskIndicators !== null && <article className="command-story"><span className="command-eyebrow">01 / RISK POSTURE</span><h3>Focus on what needs attention.</h3><p>High risk indicators are drawn from the current dashboard summary. Explore the accessible modules to investigate the underlying records.</p><div className="command-risk"><span>High risk indicators</span><strong>{summary.highRiskIndicators}</strong></div></article>}
      <article className="command-story command-story-secondary"><span className="command-eyebrow">02 / WORKFLOW</span><h3>Move from signal to investigation.</h3><p>Review the modules available in this workspace.</p><div className="command-actions">{actions.map(action => <Link className="quick-action is-info" key={action.href} href={action.href}>{action.label} ↗</Link>)}{actions.length === 0 && <p className="muted">Tidak ada modul yang dapat diakses.</p>}</div></article>
    </div>
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
  return map[action] ?? action.toLowerCase().replaceAll('_', ' ').replace(/^\p{L}/u, letter => letter.toUpperCase());
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || 'U';
}

/* ─────────────────────────────────────────────
   Shared — Activity Log
───────────────────────────────────────────── */
function ActivityLog({ items, available = true }: { items: ActivityItem[]; available?: boolean }) {
  return (
    <div className="section card">
      <h3 className="dashboard-activity-title"><Activity aria-hidden="true" size={20} /> Aktivitas Terbaru</h3>
      {!available ? <p className="muted">Riwayat aktivitas tidak tersedia untuk peran ini.</p> : items.length === 0 ? (
        <p className="muted">Belum ada aktivitas tercatat.</p>
      ) : (
        <div className="dashboard-activity-list">
          {items.map((item) => (
            <div
              key={item.id}
              className="activity-row"
            >
              <span>{actionLabel(item.action)}</span>
              <span className="dashboard-activity-date">
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

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<Me | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTenantId, setSearchTenantId] = useState('');
  const [searchTenants, setSearchTenants] = useState<readonly { readonly id: string; readonly name: string }[]>([]);
  const [tenantError, setTenantError] = useState('');

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

  useEffect(() => {
    if (user?.role !== 'SUPER_ADMIN') return;
    let cancelled = false;
    void fetch(`${API}/users/tenants`, { credentials: 'include', cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Daftar tenant tidak tersedia.');
        return response.json() as Promise<readonly { readonly id: string; readonly name: string }[]>;
      })
      .then(tenants => { if (!cancelled) setSearchTenants(tenants); })
      .catch((cause: unknown) => { if (!cancelled) setTenantError(cause instanceof Error ? cause.message : 'Gagal memuat tenant.'); });
    return () => { cancelled = true; };
  }, [user?.role]);
  async function logout() {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/login');
  }

  if (loading) {
    return (
      <div className="app dashboard-page">
        <aside className="sidebar"><div className="brand">CTI Platform</div></aside>
        <section className="main"><div className="content dashboard-loading" role="status">Memuat dashboard…</div></section>
      </div>
    );
  }

  if (!user || !summary) {
    return (
      <div className="app dashboard-page">
        {user ? <Sidebar role={user.role} moduleAccess={user.moduleAccess} onLogout={logout} /> : <aside className="sidebar"><div className="brand">CTI Platform</div></aside>}
        <section className="main"><main className="content dashboard-error"><div className="card" role="alert"><h1>Dashboard tidak tersedia</h1><p>{error || 'Gagal memuat data dashboard.'}</p><button className="primary" onClick={() => window.location.reload()}>Coba lagi</button></div></main></section>
      </div>
    );
  }

  const topbarTitle = summary.dashboardMode === 'GLOBAL'
    ? 'Platform Overview'
    : summary.dashboardMode === 'TENANT_ADMIN'
      ? summary.tenantName
      : user.name;
  const TopbarIcon = summary.dashboardMode === 'GLOBAL' ? Globe2 : summary.dashboardMode === 'TENANT_ADMIN' ? Building2 : UserRound;

  const subTitle =
    summary.dashboardMode === 'GLOBAL'
      ? `Platform Global · ${summary.totalTenants ?? 0} tenant aktif`
      : summary.dashboardMode === 'TENANT_ADMIN'
      ? `${summary.tenantName} · Tenant Admin`
      : `${summary.tenantName ?? user.tenant?.name} · Pengguna`;

  return (
    <div className="app dashboard-page">
      <Sidebar role={user.role} moduleAccess={user.moduleAccess} onLogout={logout} dashboardPresentation />

      <section className="main">
        <header className="topbar">
          <div className="dashboard-topbar-title"><TopbarIcon aria-hidden="true" size={18} /><span><strong>{topbarTitle}</strong><small>{subTitle}</small></span></div>
          <div className="dashboard-topbar-actions">
            {user.role === 'SUPER_ADMIN' && <label className="dashboard-discovery-tenant"><span className="sr-only">Tenant Search dan Notifications</span><select aria-label="Tenant Search dan Notifications" value={searchTenantId} onChange={event => setSearchTenantId(event.target.value)}><option value="">Pilih tenant</option>{searchTenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>}
            <DashboardBell key={`bell-${searchTenantId}`} role={user.role} tenantId={searchTenantId} />
            <span className="dashboard-profile-avatar" aria-hidden="true">{initials(user.name)}</span>
            <span className="dashboard-topbar-account"><strong>{user.name}</strong><small>{user.role.replaceAll('_', ' ')}</small></span>
            <button className="logout" onClick={logout} aria-label="Keluar dari Dashboard"><LogOut size={19} aria-hidden="true" /></button>
          </div>
        </header>

        {tenantError && <p className="dashboard-discovery-tenant-error" role="alert">{tenantError}</p>}
        <DashboardSearch key={`search-${searchTenantId}`} role={user.role} tenantId={searchTenantId} />
        <main className="content">
          <div className="header dashboard-heading">
            <div>
              <h1>Dashboard</h1>
              <div className="tenant">{subTitle}</div>
            </div>
          </div>

          <CommandOverview summary={summary} user={user} />

          <section className="dashboard-secondary" aria-label="Additional workspace metrics"><div className="dashboard-section-title"><span className="command-eyebrow">WORKSPACE / COVERAGE</span><h2>More of the picture.</h2></div><div className="dashboard-secondary-grid">{summary.sources !== null && <StatCard title="Sources" value={summary.sources} />}{summary.campaigns !== null && <StatCard title="Campaigns" value={summary.campaigns} />}{summary.users !== null && <StatCard title="Users" value={summary.users} />}{summary.myIndicatorsCreated !== null && <StatCard title="Indicators you created" value={summary.myIndicatorsCreated} />}{[summary.sources, summary.campaigns, summary.users, summary.myIndicatorsCreated].every(value => value === null) && <p className="muted dashboard-empty-metric">Tidak ada statistik tambahan yang dapat diakses.</p>}</div>{user.role !== 'USER' && <div className="command-actions dashboard-admin-actions"><Link className="quick-action is-info" href="/users">Kelola user ↗</Link><Link className="quick-action is-info" href="/audit-logs">Audit log ↗</Link>{user.role === 'SUPER_ADMIN' && <Link className="quick-action is-info" href="/tenants">Kelola tenant ↗</Link>}</div>}</section>

          <section className="dashboard-activity"><div className="dashboard-section-title"><span className="command-eyebrow">WORKSPACE / RECENT</span><h2>Activity in context.</h2></div><ActivityLog items={summary.recentActivity} available={summary.activityAvailable} /></section>
          {summary.dashboardMode === 'GLOBAL' && summary.tenantOverview.length > 0 && <section className="dashboard-tenants"><div className="dashboard-section-title"><span className="command-eyebrow">PLATFORM / TENANTS</span><h2>Tenant overview.</h2></div><div className="card"><div className="dashboard-tenant-link"><Link href="/tenants">Kelola semua tenant ↗</Link></div><div className="dashboard-table-scroll"><table><thead><tr><th>Tenant</th><th>Slug</th><th>Users</th><th>Indicators</th></tr></thead><tbody>{summary.tenantOverview.map(tenant => <tr key={tenant.id}><td><span className="dashboard-tenant-avatar" aria-hidden="true">{initials(tenant.name)}</span>{tenant.name}</td><td>{tenant.slug}</td><td>{tenant._count.users}</td><td>{tenant._count.indicators}</td></tr>)}</tbody></table></div></div></section>}
        </main>
      </section>
    </div>
  );
}
