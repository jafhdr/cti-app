'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/dashboard/Sidebar';
import type { ModuleAccess } from '../../lib/module-access';
import { CaseMutationAccessContext, CaseTenantContext } from './case-access';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

type CurrentUser = {
  readonly email: string;
  readonly role: Role;
  readonly moduleAccess: readonly ModuleAccess[];
};
type Tenant = { readonly id: string; readonly name: string };

export default function CasesLayout({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<readonly Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadUser(): Promise<void> {
      try {
        const response = await fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) {
          router.replace('/login');
          return;
        }

        const currentUser: CurrentUser = await response.json();
        if (!cancelled) setUser(currentUser);
        if (currentUser.role === 'SUPER_ADMIN') {
          const tenantResponse = await fetch(`${API}/users/tenants`, { credentials: 'include', cache: 'no-store' });
          if (!tenantResponse.ok) throw new Error('Gagal memuat tenant.');
          const available: readonly Tenant[] = await tenantResponse.json();
          if (!cancelled) setTenants(available);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadUser();
    return () => { cancelled = true; };
  }, [router]);

  async function logout(): Promise<void> {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/login');
  }

  if (loading || !user) {
    return (
      <div className="app">
        <aside className="sidebar"><div className="brand">CTI Platform</div></aside>
        <section className="main"><div className="content">Memuat Case Management...</div></section>
      </div>
    );
  }

  const canAccessCases = user.moduleAccess.some(module => module.accessible === true && module.moduleSlug === 'case-management' && module.featureKeys.includes('case-workflow'));

  return (
    <div className="app">
      <Sidebar role={user.role} moduleAccess={user.moduleAccess} onLogout={logout} />
      <section className="main">
        <header className="topbar">
          <strong>Case Management</strong>
          <span>{user.role === 'SUPER_ADMIN' && <select aria-label="Tenant Case Management" value={tenantId} onChange={event => setTenantId(event.target.value)}><option value="">Pilih tenant</option>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select>}{user.email} · {user.role}</span>
        </header>
        {canAccessCases ? (
          <CaseTenantContext.Provider key={tenantId} value={{ tenantId, ready: user.role !== 'SUPER_ADMIN' || Boolean(tenantId), role: user.role }}>
            <CaseMutationAccessContext.Provider value={user.role === 'SUPER_ADMIN' || user.role === 'ADMIN'}>{user.role === 'SUPER_ADMIN' && !tenantId ? <main className="content" role="status">Pilih tenant untuk membuka Case Management.</main> : children}</CaseMutationAccessContext.Provider>
          </CaseTenantContext.Provider>
        ) : (
          <main className="content">
            <div className="error">Anda tidak memiliki akses ke modul Case Management.</div>
            <Link href="/dashboard">Kembali ke Dashboard</Link>
          </main>
        )}
      </section>
    </div>
  );
}
