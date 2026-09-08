'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import Sidebar from '../dashboard/Sidebar';
import type { ModuleAccess } from '../../lib/module-access';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type CurrentUser = { readonly role: 'SUPER_ADMIN' | 'ADMIN' | 'USER'; readonly email: string; readonly moduleAccess: readonly ModuleAccess[] };
type Tenant = { readonly id: string; readonly name: string };
type TenantContextValue = { readonly tenantId: string; readonly ready: boolean };
const TenantContext = createContext<TenantContextValue>({ tenantId: '', ready: false });

export function useThreatIntelligenceTenant(): TenantContextValue { return useContext(TenantContext); }

export function ThreatIntelligenceShell({ children, title }: { readonly children: ReactNode; readonly title: string }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [tenants, setTenants] = useState<readonly Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' }).then(async response => {
      if (response.status === 401) { router.replace('/'); return; }
      if (!response.ok) throw new Error('Gagal memuat sesi pengguna.');
      const currentUser: CurrentUser = await response.json();
      setUser(currentUser);
      if (currentUser.role === 'SUPER_ADMIN') {
        const tenantResponse = await fetch(`${API}/users/tenants`, { credentials: 'include', cache: 'no-store' });
        if (!tenantResponse.ok) throw new Error('Gagal memuat daftar tenant.');
        const availableTenants: readonly Tenant[] = await tenantResponse.json();
        setTenants(availableTenants);
        setTenantId(availableTenants[0]?.id ?? '');
      }
      setReady(true);
    }).catch(() => router.replace('/'));
  }, [router]);

  async function logout(): Promise<void> {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/');
  }

  return <TenantContext.Provider value={{ tenantId, ready }}><div className="app"><Sidebar role={user?.role} moduleAccess={user?.moduleAccess ?? []} onLogout={logout} /><section className="main"><header className="topbar"><strong>Threat Intelligence / {title}</strong><span>{user?.role === 'SUPER_ADMIN' && <select aria-label="Tenant Threat Intelligence" value={tenantId} onChange={event => setTenantId(event.target.value)}>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select>}{user?.email}</span></header><main className="content"><nav className="ti-section-tabs" aria-label="Threat Intelligence"><Link href="/threat-intelligence">Overview</Link><Link href="/threat-intelligence/indicators">Indicators</Link><Link href="/threat-intelligence/hub">Intelligence Hub</Link></nav>{children}</main></section></div></TenantContext.Provider>;
}
