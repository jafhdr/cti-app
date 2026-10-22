'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import Sidebar from '@/components/dashboard/Sidebar';
import type { ModuleAccess } from '@/lib/module-access';
import { API, type Role } from './types';

type CurrentUser = { readonly name?: string; readonly email: string; readonly role: Role; readonly moduleAccess: readonly ModuleAccess[] };
type Tenant = { readonly id: string; readonly name: string };
type TenantPolicy = { readonly slug: string; readonly subscriptionActive: boolean; readonly subscriptionIncluded: boolean; readonly isActive: boolean; readonly tenantEnabled: boolean; readonly features: readonly { readonly key: string }[] };
type Workspace = { readonly role: Role; readonly tenantId: string; readonly canManage: boolean; readonly canViewAssets: boolean; readonly canViewApplications: boolean; readonly canViewTi: boolean; readonly canViewCase: boolean };
const AppSecContext = createContext<Workspace | null>(null);
export function useAppSec(): Workspace {
  const value = useContext(AppSecContext);
  if (!value) throw new Error('AppSec workspace tidak tersedia');
  return value;
}

export function AppSecShell({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [tenants, setTenants] = useState<readonly Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [tenantPolicies, setTenantPolicies] = useState<{ readonly tenantId: string; readonly modules: readonly TenantPolicy[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const response = await fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' });
        if (response.status === 401) { router.replace('/login'); return; }
        if (!response.ok) throw new Error('Gagal memuat sesi.');
        const current: CurrentUser = await response.json();
        if (cancelled) return;
        setUser(current);
        if (current.role === 'SUPER_ADMIN') {
          const tenantResponse = await fetch(`${API}/users/tenants`, { credentials: 'include', cache: 'no-store' });
          if (!tenantResponse.ok) throw new Error('Gagal memuat tenant.');
          const available: readonly Tenant[] = await tenantResponse.json();
          if (cancelled) return;
          setTenants(available);
          const saved = new URLSearchParams(window.location.search).get('tenantId') || sessionStorage.getItem('appsec-workspace-tenant');
          setTenantId(available.find(tenant => tenant.id === saved)?.id ?? '');
        }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Gagal memuat workspace.'); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    if (user?.role !== 'SUPER_ADMIN' || !tenantId) return;
    let cancelled = false;
    async function loadPolicies(): Promise<void> {
      try {
        const response = await fetch(`${API}/modules/configuration?tenantId=${encodeURIComponent(tenantId)}`, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error('Gagal memuat akses modul tenant.');
        const modules: readonly TenantPolicy[] = await response.json();
        if (!cancelled) setTenantPolicies({ tenantId, modules });
      } catch { if (!cancelled) setTenantPolicies(null); }
    }
    void loadPolicies();
    return () => { cancelled = true; };
  }, [tenantId, user?.role]);

  async function logout(): Promise<void> {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/login');
  }

  const feature = pathname.startsWith('/appsec/applications') ? 'application-inventory' : pathname.startsWith('/appsec/findings') ? 'finding-management' : 'posture-overview';
  const access = user?.moduleAccess.find(module => module.accessible && module.moduleSlug === 'appsec-posture');
  const fallback = access?.featureKeys.includes('application-inventory') ? '/appsec/applications'
    : access?.featureKeys.includes('finding-management') ? '/appsec/findings' : null;
  const redirecting = pathname === '/appsec' && !access?.featureKeys.includes('posture-overview') && fallback !== null;
  useEffect(() => { if (redirecting && fallback) router.replace(fallback); }, [fallback, redirecting, router]);
  const appsec = access?.featureKeys.includes(feature) ?? false;
  const canViewApplications = access?.featureKeys.includes('application-inventory') ?? false;
  const asm = user?.moduleAccess.some(module => module.accessible && module.moduleSlug === 'attack-surface-management' && module.featureKeys.includes('asset-management')) ?? false;
  const ti = user?.moduleAccess.some(module => module.accessible && module.moduleSlug === 'threat-intelligence' && module.featureKeys.includes('intelligence-hub')) ?? false;
  const cases = user?.moduleAccess.some(module => module.accessible && module.moduleSlug === 'case-management' && module.featureKeys.includes('case-workflow')) ?? false;
  function tenantCanUse(slug: string, featureKey: string): boolean {
    const policy = tenantPolicies?.tenantId === tenantId ? tenantPolicies.modules.find(module => module.slug === slug) : undefined;
    return !!policy && policy.subscriptionActive && policy.subscriptionIncluded && policy.isActive && policy.tenantEnabled && policy.features.some(feature => feature.key === featureKey);
  }
  const scopedModuleAccess = user?.role === 'SUPER_ADMIN' && tenantId
    ? user.moduleAccess.map(module => {
      if (!['attack-surface-management', 'threat-intelligence', 'case-management'].includes(module.moduleSlug)) return module;
      const policy = tenantPolicies?.tenantId === tenantId ? tenantPolicies.modules.find(entry => entry.slug === module.moduleSlug) : undefined;
      const accessible = !!policy && policy.subscriptionActive && policy.subscriptionIncluded && policy.isActive && policy.tenantEnabled;
      return { ...module, accessible, featureKeys: accessible ? policy.features.map(feature => feature.key) : [] };
    })
    : user?.moduleAccess ?? [];
  const workspace: Workspace | null = user ? { role: user.role, tenantId, canManage: user.role !== 'USER', canViewAssets: user.role === 'SUPER_ADMIN' ? tenantCanUse('attack-surface-management', 'asset-management') : asm, canViewApplications, canViewTi: user.role === 'SUPER_ADMIN' ? tenantCanUse('threat-intelligence', 'intelligence-hub') : ti, canViewCase: user.role === 'SUPER_ADMIN' ? tenantCanUse('case-management', 'case-workflow') : cases } : null;
  const displayName = user?.name || user?.email || '';
  const initials = displayName.split(/[\s@]+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  return <div className="app appsec-shell"><Sidebar role={user?.role} moduleAccess={scopedModuleAccess} onLogout={user ? logout : undefined} dashboardPresentation /><section className="main">
    <header className="topbar appsec-topbar"><div className="appsec-topbar-context">{user?.role === 'SUPER_ADMIN' && <select aria-label="Tenant AppSec" value={tenantId} onChange={event => { setTenantId(event.target.value); sessionStorage.setItem('appsec-workspace-tenant', event.target.value); }}><option value="">Pilih tenant</option>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select>}</div><div className="appsec-identity"><span className="appsec-avatar" aria-hidden="true">{initials}</span><span><strong>{displayName}</strong><small>{user?.role?.replaceAll('_', ' ')}</small></span>{user && <button type="button" aria-label="Logout" onClick={() => void logout()}><LogOut size={20} aria-hidden="true" /></button>}</div></header>
    {loading ? <main className="content" role="status">Memuat AppSec...</main> : error ? <main className="content" role="alert">{error}</main> : redirecting ? <main className="content" role="status">Membuka fitur AppSec yang tersedia...</main> : !appsec ? <main className="content" role="alert">Akses AppSec untuk halaman ini tidak tersedia. <Link href="/dashboard">Kembali ke Dashboard</Link></main> : user?.role === 'SUPER_ADMIN' && !tenantId ? <main className="content" role="status">Pilih tenant untuk membuka AppSec.</main> : workspace && <AppSecContext.Provider key={tenantId} value={workspace}>{children}</AppSecContext.Provider>}
  </section></div>;
}
