'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/dashboard/Sidebar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

type AuditLog = {
  id: string;
  userId: string | null;
  tenantId: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type CurrentUser = {
  role: Role;
  name: string;
  email: string;
};

export default function AuditLogsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const meRes = await fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' });
        if (!meRes.ok) return router.replace('/');
        const user = await meRes.json();
        setCurrentUser(user);

        const res = await fetch(`${API}/audit-logs`, { credentials: 'include', cache: 'no-store' });
        if (res.status === 401) return router.replace('/');
        if (res.status === 403) return router.replace('/dashboard');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return setError(data.message || 'Gagal memuat audit log.');
        setLogs(data.items || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Terjadi kesalahan');
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
        <section className="main"><div className="content" style={{ paddingTop: 10, textAlign: 'center', color: '#687386' }}>Memuat audit logs…</div></section>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar role={currentUser?.role} onLogout={logout} />

      <section className="main">
        <header className="topbar">
          <div style={{ fontWeight: 50 }}>📋 Audit Log</div>
          <span style={{ fontSize: 13, color: '#687386' }}>{currentUser?.email} · <strong>{currentUser?.role}</strong></span>
        </header>

        <main className="content">
          <div className="cti-title-row">
            <div>
              <h1>Audit Log</h1>
              <p>Riwayat aktivitas pengelolaan akun pada tenant Anda.</p>
            </div>
          </div>

          {error && <Card view="outlined" className="cti-activity"><p>{error}</p></Card>}

          <Card view="outlined" className="cti-activity">
            <Table
              data={logs}
              columns={[
                { id: 'createdAt', name: 'Waktu', template: (log: AuditLog) => new Date(log.createdAt).toLocaleString('id-ID') },
                { id: 'action', name: 'Aktivitas', template: (log: AuditLog) => log.action },
                { id: 'userId', name: 'Aktor ID', template: (log: AuditLog) => log.userId || '-' },
                { id: 'metadata', name: 'Detail', template: (log: AuditLog) => log.metadata ? JSON.stringify(log.metadata) : '-' },
              ]}
            />
          </Card>
        </main>
      </section>
    </div>
  );
}
