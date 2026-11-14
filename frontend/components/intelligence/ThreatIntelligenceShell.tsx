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
  const [sessionError, setSessionError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' }).then(async response => {
      if (response.status === 401) { router.replace('/login'); return; }
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
    }).catch((cause: unknown) => { setSessionError(cause instanceof Error ? cause.message : 'Gagal memuat akses modul.'); setReady(true); });
  }, [router]);

  async function logout(): Promise<void> {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/login');
  }

  if (!ready) return <div className="app"><main className="content">Loading Threat Intelligence...</main></div>;
  if (sessionError) return <div className="app"><Sidebar moduleAccess={[]} /><main className="content"><p className="error" role="alert">{sessionError}</p><Link href="/dashboard">Kembali ke Dashboard</Link></main></div>;
  const requiredFeature = ['Overview', 'Indicators', 'IOC Candidates', 'Feeds', 'Threat Feeds', 'Correlations', 'Playbooks'].includes(title) ? 'indicator-management' : 'intelligence-hub';
  if (!user?.moduleAccess.some(module => module.moduleSlug === 'threat-intelligence' && module.accessible === true && module.featureKeys.includes(requiredFeature))) {
    return <div className="app"><Sidebar role={user?.role} moduleAccess={user?.moduleAccess ?? []} onLogout={logout} /><main className="content"><h1>Akses modul dibatasi</h1><div className="error" role="alert">Anda tidak memiliki akses ke modul Threat Intelligence.</div><Link href="/dashboard">Kembali ke Dashboard</Link></main></div>;
  }
  return <TenantContext.Provider value={{ tenantId, ready }}><div className="app"><Sidebar role={user?.role} moduleAccess={user?.moduleAccess ?? []} onLogout={logout} /><section className="main"><header className="topbar"><strong>Threat Intelligence / {title}</strong><span>{user?.role === 'SUPER_ADMIN' && <select aria-label="Tenant Threat Intelligence" value={tenantId} onChange={event => setTenantId(event.target.value)}>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select>}{user?.email}</span></header><main className="content">{children}</main></section></div></TenantContext.Provider>;
}
