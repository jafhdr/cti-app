'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Sidebar from '@/components/dashboard/Sidebar';
import type { ModuleAccess } from '@/lib/module-access';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type CurrentUser = { readonly email: string; readonly role: Role; readonly moduleAccess: readonly ModuleAccess[] };
type Tenant = { readonly id: string; readonly name: string };
type ContextValue = { readonly role: Role; readonly tenantId: string; readonly ready: boolean };
const AttackSurfaceContext = createContext<ContextValue | null>(null);

export function useAttackSurface(): ContextValue {
  const value = useContext(AttackSurfaceContext);
  if (!value) throw new Error('Attack Surface context tidak tersedia');
  return value;
}

export function AttackSurfaceShell({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [tenants, setTenants] = useState<readonly Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const response = await fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' });
        if (response.status === 401) { router.replace('/'); return; }
        if (!response.ok) throw new Error('Gagal memuat sesi pengguna.');
        const current: CurrentUser = await response.json();
        if (cancelled) return;
        setUser(current);
        if (current.role === 'SUPER_ADMIN') {
          const tenantResponse = await fetch(`${API}/users/tenants`, { credentials: 'include', cache: 'no-store' });
          if (!tenantResponse.ok) throw new Error('Gagal memuat daftar tenant.');
          const available: readonly Tenant[] = await tenantResponse.json();
          if (!cancelled) { setTenants(available); setTenantId(available[0]?.id ?? ''); }
        }
      } catch (cause) {
        if (!cancelled) setSessionError(cause instanceof Error ? cause.message : 'Gagal memuat sesi pengguna.');
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [router]);

  async function logout(): Promise<void> {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/');
  }

  const hasAccess = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.moduleAccess.some(module => module.assigned && module.moduleSlug === 'attack-surface-management');
  return <div className="app"><Sidebar role={user?.role} moduleAccess={user?.moduleAccess ?? []} onLogout={user ? logout : undefined} /><section className="main"><header className="topbar"><strong>Attack Surface Management / Assets</strong><span>{user?.role === 'SUPER_ADMIN' && <select aria-label="Tenant Attack Surface" value={tenantId} onChange={event => setTenantId(event.target.value)}>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select>}{user?.email}</span></header>
    {loading ? <main className="content"><div className="asm-state" aria-live="polite">Loading Attack Surface Management...</div></main>
      : sessionError ? <main className="content"><div className="asm-state asm-denied" role="alert"><strong>Unable to load Attack Surface Management</strong><span>{sessionError}</span><Link href="/dashboard">Back to Dashboard</Link></div></main>
      : user && hasAccess ? <AttackSurfaceContext.Provider value={{ role: user.role, tenantId, ready: user.role !== 'SUPER_ADMIN' || Boolean(tenantId) }}>{children}</AttackSurfaceContext.Provider>
      : <main className="content"><div className="asm-state asm-denied" role="alert"><strong>Access denied</strong><span>You do not have access to Attack Surface Management.</span><Link href="/dashboard">Back to Dashboard</Link></div></main>}
  </section></div>;
}
