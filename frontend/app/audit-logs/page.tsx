'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, type TableColumn } from '@/components/ui/table';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import './audit-log-visual.css';
import Sidebar from '../../components/dashboard/Sidebar';
import type { ModuleAccess } from '../../lib/module-access';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

type AuditLogUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

type AuditLogTenant = {
  id: string;
  name: string;
  slug: string;
};

type AuditLog = {
  id: string;
  userId: string | null;
  tenantId: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  user?: AuditLogUser | null;
  tenant?: AuditLogTenant | null;
};

type TenantOption = {
  id: string;
  name: string;
  slug: string;
};

type CurrentUser = {
  id: string;
  role: Role;
  name: string;
  email: string;
  tenant?: { id: string; name: string; slug: string } | null;
  moduleAccess: ModuleAccess[];
};

const ACTION_LABELS: Record<string, { label: string; tone: string }> = {
  LOGIN: { label: 'Login', tone: 'info' }, SIGNUP: { label: 'Registration', tone: 'success' },
  USER_CREATED: { label: 'User created', tone: 'success' }, USER_UPDATED: { label: 'User updated', tone: 'info' },
  USER_ROLE_UPDATED: { label: 'Role updated', tone: 'warning' }, USER_PASSWORD_RESET_BY_ADMIN: { label: 'Password reset', tone: 'warning' },
  USER_ACTIVATED: { label: 'User activated', tone: 'success' }, USER_DEACTIVATED: { label: 'User deactivated', tone: 'danger' },
  USER_MODULE_ACCESS_REPLACED: { label: 'Module access updated', tone: 'info' },
  USER_MODULE_ACCESS_BULK_REPLACED: { label: 'Bulk module access updated', tone: 'info' },
  TENANT_CREATED: { label: 'Tenant created', tone: 'success' }, TENANT_ACTIVATED: { label: 'Tenant activated', tone: 'success' },
  TENANT_DEACTIVATED: { label: 'Tenant deactivated', tone: 'danger' },
  SUBSCRIPTION_UPDATED: { label: 'Subscription updated', tone: 'info' },
  INDICATOR_CREATED: { label: 'Indicator created', tone: 'success' },
  INDICATOR_UPDATED: { label: 'Indicator updated', tone: 'info' },
  INDICATOR_DEACTIVATED: { label: 'Indicator deactivated', tone: 'danger' },
  INTELLIGENCE_ENTITY_CREATED: { label: 'Intelligence entity created', tone: 'success' },
  INTELLIGENCE_RELATIONSHIP_CREATED: { label: 'Intelligence relationship created', tone: 'info' },
  CASE_CREATED: { label: 'Case created', tone: 'success' }, CASE_STATUS_UPDATED: { label: 'Case status updated', tone: 'warning' },
  ALERT_CREATED: { label: 'Alert created', tone: 'danger' }, ALERT_STATUS_UPDATED: { label: 'Alert status updated', tone: 'warning' },
};

function activityLabel(action: string): { label: string; tone: string } {
  return ACTION_LABELS[action] ?? { label: action.toLowerCase().replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase()), tone: 'neutral' };
}

export default function AuditLogsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 25;

  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [availableActions, setAvailableActions] = useState<string[]>([]);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadLogs = useCallback(async (targetPage: number, tenantId: string, action: string) => {
    try {
      setRefreshing(true);
      setError('');
      const params = new URLSearchParams({
        page: String(targetPage),
        limit: String(limit),
      });
      if (tenantId) params.set('tenantId', tenantId);
      if (action) params.set('action', action);

      const res = await fetch(`${API}/audit-logs?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
      });

      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (res.status === 403) {
        router.replace('/dashboard');
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || 'Gagal memuat audit log.');
        return;
      }

      setLogs(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan saat memuat log.');
    } finally {
      setRefreshing(false);
    }
  }, [router]);

  const loadActions = useCallback(async (tenantId: string) => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    const response = await fetch(`${API}/audit-logs/actions?${params}`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('Gagal memuat pilihan aktivitas.');
    const actions: string[] = await response.json();
    setAvailableActions(actions);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const meRes = await fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' });
        if (!meRes.ok) return router.replace('/login');
        const user: CurrentUser = await meRes.json();

        // Strict role access guard: USER cannot access audit logs
        if (user.role === 'USER') {
          router.replace('/dashboard');
          return;
        }

        setCurrentUser(user);

        // If Super Admin, fetch list of tenants for the filter
        if (user.role === 'SUPER_ADMIN') {
          try {
            const tenantsRes = await fetch(`${API}/users/tenants`, { credentials: 'include', cache: 'no-store' });
            if (tenantsRes.ok) {
              const tenantsData = await tenantsRes.json();
              setTenants(Array.isArray(tenantsData) ? tenantsData : tenantsData.tenants || []);
            }
          } catch {
            // non-fatal
          }
        }

        await Promise.all([loadLogs(1, '', ''), loadActions('')]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Terjadi kesalahan inisialisasi.');
      } finally {
        setLoading(false);
      }
    })();
  }, [router, loadLogs, loadActions]);

  async function handleFilterChange(newTenant: string, newAction: string) {
    setSelectedTenant(newTenant);
    setActionFilter(newAction);
    setPage(1);
    try {
      await Promise.all([loadLogs(1, newTenant, newAction), loadActions(newTenant)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat pilihan aktivitas.');
    }
  }

  async function handlePageChange(newPage: number) {
    setPage(newPage);
    await loadLogs(newPage, selectedTenant, actionFilter);
  }

  async function logout() {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/login');
  }

  if (loading) {
    return (
      <div className="app">
        <aside className="sidebar"><div className="brand">CTI Platform</div></aside>
        <section className="main">
          <div className="content" style={{ paddingTop: 20, textAlign: 'center', color: '#687386' }}>
            Memuat audit logs…
          </div>
        </section>
      </div>
    );
  }

  // Fallback if regular user somehow remains on page
  if (currentUser?.role === 'USER') {
    return (
      <div className="app">
        <aside className="sidebar"><div className="brand">CTI Platform</div></aside>
        <section className="main">
          <div className="content" style={{ paddingTop: 40, textAlign: 'center' }}>
            <Card view="outlined" style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
              <h2 style={{ color: '#ef4444', marginBottom: 12 }}>⛔ Akses Ditolak</h2>
              <p style={{ color: '#687386', marginBottom: 20 }}>
                Halaman Audit Log hanya dapat diakses oleh Administrator tenant dan Super Admin.
              </p>
              <Button onClick={() => router.replace('/dashboard')}>Kembali ke Dashboard</Button>
            </Card>
          </div>
        </section>
      </div>
    );
  }

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const totalPages = Math.max(Math.ceil(total / limit), 1);

  const tenantName = isSuperAdmin ? tenants.find(tenant => tenant.id === selectedTenant)?.name : currentUser?.tenant?.name;
  const tenantScoped = !isSuperAdmin || Boolean(selectedTenant);
  const columns: TableColumn<AuditLog>[] = [
    { id: 'createdAt', name: 'Time', template: log => <time className="audit-time" dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time> },
    ...(!tenantScoped ? [{ id: 'tenant', name: 'Tenant', template: (log: AuditLog) => log.tenant ? <div className="audit-tenant-cell"><strong>{log.tenant.name}</strong><small>{log.tenant.slug}</small></div> : <span className="audit-muted">Platform / Global</span> }] : []),
    { id: 'user', name: 'Actor / User', template: log => log.user ? <div className="audit-actor"><div><strong>{log.user.name}</strong><span className={`audit-role audit-role-${log.user.role.toLowerCase()}`}>{log.user.role}</span></div><small>{log.user.email}</small></div> : <span className="audit-muted">{log.userId ? `User ID: ${log.userId}` : 'System'}</span> },
    { id: 'action', name: 'Activity', template: log => { const activity = activityLabel(log.action); return <span className={`audit-activity audit-activity-${activity.tone}`}><span aria-hidden="true" />{activity.label}</span>; } },
    { id: 'metadata', name: 'Details', template: log => !log.metadata || Object.keys(log.metadata).length === 0 ? <span className="audit-muted">—</span> : <details className="audit-details"><summary>View details</summary><pre>{JSON.stringify(log.metadata, null, 2)}</pre></details> },
  ];

  return (
    <div className="app audit-log-shell">
      <Sidebar role={currentUser?.role} moduleAccess={currentUser?.moduleAccess ?? []} dashboardPresentation onLogout={logout} />
      <section className="main">
        <header className="topbar audit-topbar"><div className="audit-profile"><span className="audit-avatar" aria-hidden="true">{(currentUser?.name ?? currentUser?.email ?? '').split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}</span><span><strong>{currentUser?.name ?? currentUser?.email}</strong><small>{currentUser?.role?.replaceAll('_', ' ')}</small></span><button type="button" aria-label="Keluar dari Audit Log" onClick={() => void logout()}><LogOut size={20} aria-hidden="true" /></button></div></header>
        <main className="content audit-log-page">
          <div className="audit-heading"><span className="source-eyebrow">AUDIT LOG</span><h1>{tenantScoped ? 'Tenant audit log' : 'Platform audit log'}</h1><p>{tenantScoped ? `History of account management and operational activity for tenant “${tenantName ?? 'Current tenant'}”.` : 'History of account management and operational activity across the platform.'}</p></div>
          <Card view="outlined" className="audit-filter-card"><div className="audit-filter-row">
            {isSuperAdmin && <div className="audit-filter-field"><label htmlFor="tenant-filter">TENANT</label><select id="tenant-filter" value={selectedTenant} onChange={event => void handleFilterChange(event.target.value, '')}><option value="">All tenants (global)</option>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.slug})</option>)}</select></div>}
            <div className="audit-filter-field"><label htmlFor="action-filter">ACTIVITY TYPE</label><select id="action-filter" value={actionFilter} onChange={event => void handleFilterChange(selectedTenant, event.target.value)}><option value="">All activities</option>{availableActions.map(action => <option key={action} value={action}>{activityLabel(action).label} ({action})</option>)}</select></div>
            <Button variant="outline" size="s" className="audit-refresh" onClick={() => Promise.all([loadLogs(page, selectedTenant, actionFilter), loadActions(selectedTenant)]).catch(() => setError('Gagal memuat pilihan aktivitas.'))} disabled={refreshing}>{refreshing ? 'Loading…' : 'Refresh'}</Button>
            {(selectedTenant || actionFilter) && <Button variant="ghost" size="s" className="audit-reset" onClick={() => void handleFilterChange('', '')}>Reset filters</Button>}
          </div></Card>
          {error && <Card view="outlined" className="audit-error" role="alert">{error}</Card>}
          <Card view="outlined" className="audit-table-card">{logs.length === 0 ? <div className="audit-empty"><strong>No activity logs</strong><p>{selectedTenant || actionFilter ? 'No logs match the current filters.' : 'No activity has been recorded yet.'}</p></div> : <Table data={logs} columns={columns} />}
            {total > 0 && <div className="audit-pagination"><span>Showing {logs.length} of {total} log entries{isSuperAdmin && !selectedTenant ? ' across all tenants' : ''}</span><div className="audit-pagination-controls"><Button variant="outline" size="s" onClick={() => void handlePageChange(page - 1)} disabled={page <= 1 || refreshing}>Previous</Button><span>Page {page} of {totalPages}</span><Button variant="outline" size="s" onClick={() => void handlePageChange(page + 1)} disabled={page >= totalPages || refreshing}>Next</Button></div></div>}
          </Card>
        </main>
      </section>
    </div>
  );
}
