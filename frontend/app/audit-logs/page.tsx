'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, type TableColumn } from '@/components/ui/table';
import { useRouter } from 'next/navigation';
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

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  LOGIN: { label: '🔑 Login', color: '#0070f3' },
  SIGNUP: { label: '📝 Registrasi', color: '#10b981' },
  USER_CREATED: { label: '👤 User Dibuat', color: '#10b981' },
  USER_UPDATED: { label: '✏️ User Diperbarui', color: '#6366f1' },
  USER_ROLE_UPDATED: { label: '🛡️ Role Diubah', color: '#f59e0b' },
  USER_PASSWORD_RESET_BY_ADMIN: { label: '🔒 Reset Password Admin', color: '#ec4899' },
  USER_ACTIVATED: { label: '✅ User Diaktifkan', color: '#10b981' },
  USER_DEACTIVATED: { label: '⛔ User Dinonaktifkan', color: '#ef4444' },
  USER_MODULE_ACCESS_REPLACED: { label: '📦 Modul Akses Diganti', color: '#8b5cf6' },
  USER_MODULE_ACCESS_BULK_REPLACED: { label: '📦 Modul Akses Massal', color: '#8b5cf6' },
  TENANT_CREATED: { label: '🏢 Tenant Dibuat', color: '#10b981' },
  TENANT_ACTIVATED: { label: '✅ Tenant Diaktifkan', color: '#10b981' },
  TENANT_DEACTIVATED: { label: '⛔ Tenant Dinonaktifkan', color: '#ef4444' },
  SUBSCRIPTION_UPDATED: { label: '💳 Langganan Diperbarui', color: '#3b82f6' },
  INDICATOR_CREATED: { label: '🎯 Indikator Dibuat', color: '#10b981' },
  INDICATOR_UPDATED: { label: '✏️ Indikator Diperbarui', color: '#6366f1' },
  INDICATOR_DEACTIVATED: { label: '⛔ Indikator Dinonaktifkan', color: '#ef4444' },
  INTELLIGENCE_ENTITY_CREATED: { label: '🌐 Entitas Intelijen Dibuat', color: '#10b981' },
  INTELLIGENCE_RELATIONSHIP_CREATED: { label: '🔗 Relasi Intelijen Dibuat', color: '#6366f1' },
  CASE_CREATED: { label: '📁 Kasus Dibuat', color: '#10b981' },
  CASE_STATUS_UPDATED: { label: '🔄 Status Kasus Diperbarui', color: '#f59e0b' },
  ALERT_CREATED: { label: '🚨 Alert Dibuat', color: '#ef4444' },
  ALERT_STATUS_UPDATED: { label: '🔄 Status Alert Diperbarui', color: '#f59e0b' },
};

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

        await loadLogs(1, '', '');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Terjadi kesalahan inisialisasi.');
      } finally {
        setLoading(false);
      }
    })();
  }, [router, loadLogs]);

  async function handleFilterChange(newTenant: string, newAction: string) {
    setSelectedTenant(newTenant);
    setActionFilter(newAction);
    setPage(1);
    await loadLogs(1, newTenant, newAction);
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

  const columns: TableColumn<AuditLog>[] = [
    {
      id: 'createdAt',
      name: 'Waktu',
      template: (log: AuditLog) => (
        <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
          {new Date(log.createdAt).toLocaleString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
      ),
    },
    ...(isSuperAdmin
      ? [
          {
            id: 'tenant',
            name: 'Tenant',
            template: (log: AuditLog) =>
              log.tenant ? (
                <div>
                  <strong style={{ fontSize: 13 }}>{log.tenant.name}</strong>
                  <br />
                  <span
                    style={{
                      display: 'inline-block',
                      fontSize: 11,
                      padding: '1px 6px',
                      background: 'rgba(99, 102, 241, 0.1)',
                      color: '#4f46e5',
                      borderRadius: 4,
                      marginTop: 2,
                    }}
                  >
                    {log.tenant.slug}
                  </span>
                </div>
              ) : (
                <span style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
                  🌐 Platform / Global
                </span>
              ),
          },
        ]
      : []),
    {
      id: 'user',
      name: 'Aktor / User',
      template: (log: AuditLog) =>
        log.user ? (
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{log.user.name}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{log.user.email}</div>
            <span
              style={{
                display: 'inline-block',
                fontSize: 10,
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: 4,
                marginTop: 2,
                background:
                  log.user.role === 'SUPER_ADMIN'
                    ? '#ede9fe'
                    : log.user.role === 'ADMIN'
                    ? '#dbeafe'
                    : '#f1f5f9',
                color:
                  log.user.role === 'SUPER_ADMIN'
                    ? '#6d28d9'
                    : log.user.role === 'ADMIN'
                    ? '#1d4ed8'
                    : '#475569',
              }}
            >
              {log.user.role}
            </span>
          </div>
        ) : log.userId ? (
          <span style={{ fontSize: 12, color: '#64748b' }}>User ID: {log.userId}</span>
        ) : (
          <span style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>Sistem</span>
        ),
    },
    {
      id: 'action',
      name: 'Aktivitas',
      template: (log: AuditLog) => {
        const item = ACTION_LABELS[log.action];
        return (
          <span
            style={{
              display: 'inline-block',
              fontSize: 12,
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: 6,
              background: item ? `${item.color}15` : '#f1f5f9',
              color: item ? item.color : '#334155',
              border: item ? `1px solid ${item.color}30` : '1px solid #e2e8f0',
            }}
          >
            {item ? item.label : log.action}
          </span>
        );
      },
    },
    {
      id: 'metadata',
      name: 'Detail',
      template: (log: AuditLog) => {
        if (!log.metadata || Object.keys(log.metadata).length === 0) {
          return <span style={{ color: '#94a3b8', fontSize: 12 }}>-</span>;
        }
        return (
          <details style={{ cursor: 'pointer', fontSize: 12 }}>
            <summary style={{ color: '#4f46e5', userSelect: 'none' }}>
              Lihat Detail ({Object.keys(log.metadata).length} field)
            </summary>
            <pre
              style={{
                marginTop: 6,
                padding: 8,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 4,
                fontSize: 11,
                maxHeight: 180,
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {JSON.stringify(log.metadata, null, 2)}
            </pre>
          </details>
        );
      },
    },
  ];

  return (
    <div className="app">
      <Sidebar role={currentUser?.role} moduleAccess={currentUser?.moduleAccess ?? []} onLogout={logout} />

      <section className="main">
        <header className="topbar">
          <div style={{ fontWeight: 600 }}>📋 Audit Log</div>
          <span style={{ fontSize: 13, color: '#687386' }}>
            {currentUser?.email} ·{' '}
            <strong style={{ color: isSuperAdmin ? '#6d28d9' : '#1d4ed8' }}>
              {currentUser?.role}
            </strong>
          </span>
        </header>

        <main className="content">
          <div className="cti-title-row" style={{ marginBottom: 20 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 6px' }}>
                {isSuperAdmin ? '🌐 Audit Log Seluruh Platform' : '📋 Audit Log Tenant'}
              </h1>
              <p style={{ color: '#687386', margin: 0, fontSize: 14 }}>
                {isSuperAdmin
                  ? 'Memantau seluruh aktivitas log dan perubahan dari semua tenant dan pengguna sistem.'
                  : `Riwayat aktivitas pengelolaan akun dan operasional pada tenant ${
                      currentUser?.tenant?.name ? `"${currentUser.tenant.name}"` : 'Anda'
                    }.`}
              </p>
            </div>
          </div>

          {/* Filters card */}
          <Card view="outlined" style={{ padding: '16px 20px', marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              {isSuperAdmin && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label htmlFor="tenant-filter" style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
                    Filter Tenant
                  </label>
                  <select
                    id="tenant-filter"
                    value={selectedTenant}
                    onChange={(e) => handleFilterChange(e.target.value, actionFilter)}
                    style={{
                      height: 36,
                      padding: '0 12px',
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      background: '#fff',
                      minWidth: 200,
                    }}
                  >
                    <option value="">Semua Tenant (Global)</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.slug})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label htmlFor="action-filter" style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
                  Filter Aktivitas
                </label>
                <select
                  id="action-filter"
                  value={actionFilter}
                  onChange={(e) => handleFilterChange(selectedTenant, e.target.value)}
                  style={{
                    height: 36,
                    padding: '0 12px',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    fontSize: 13,
                    background: '#fff',
                    minWidth: 220,
                  }}
                >
                  <option value="">Semua Aktivitas</option>
                  {Object.entries(ACTION_LABELS).map(([actionKey, { label }]) => (
                    <option key={actionKey} value={actionKey}>
                      {label} ({actionKey})
                    </option>
                  ))}
                </select>
              </div>

              {(selectedTenant || actionFilter) && (
                <div style={{ alignSelf: 'flex-end' }}>
                  <Button
                    variant="ghost"
                    size="s"
                    onClick={() => handleFilterChange('', '')}
                    style={{ color: '#ef4444', height: 36 }}
                  >
                    ✕ Reset Filter
                  </Button>
                </div>
              )}

              <div style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}>
                <Button
                  variant="outline"
                  size="s"
                  onClick={() => loadLogs(page, selectedTenant, actionFilter)}
                  disabled={refreshing}
                  style={{ height: 36 }}
                >
                  {refreshing ? 'Memuat…' : '🔄 Segarkan'}
                </Button>
              </div>
            </div>
          </Card>

          {error && (
            <Card view="outlined" className="cti-activity" style={{ marginBottom: 16, borderColor: '#fca5a5' }}>
              <p style={{ color: '#dc2626', margin: 0 }}>{error}</p>
            </Card>
          )}

          {/* Data Table */}
          <Card view="outlined" className="cti-activity">
            {logs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#687386' }}>
                <p style={{ fontSize: 16, fontWeight: 500, margin: '0 0 4px' }}>Tidak ada log aktivitas</p>
                <p style={{ fontSize: 13, margin: 0 }}>
                  {selectedTenant || actionFilter
                    ? 'Tidak ditemukan log dengan kriteria filter saat ini.'
                    : 'Belum ada riwayat aktivitas yang tercatat.'}
                </p>
              </div>
            ) : (
              <Table data={logs} columns={columns} />
            )}
          </Card>

          {/* Pagination */}
          {total > 0 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 16,
                padding: '0 8px',
                fontSize: 13,
                color: '#64748b',
              }}
            >
              <div>
                Menampilkan {logs.length} dari total <strong>{total}</strong> riwayat log
                {isSuperAdmin && !selectedTenant && ' (seluruh tenant)'}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button
                  variant="outline"
                  size="s"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1 || refreshing}
                >
                  ← Sebelumnya
                </Button>
                <span style={{ padding: '0 8px', fontWeight: 600 }}>
                  Halaman {page} dari {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="s"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages || refreshing}
                >
                  Selanjutnya →
                </Button>
              </div>
            </div>
          )}
        </main>
      </section>
    </div>
  );
}
