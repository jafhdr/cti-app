'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/dashboard/Sidebar';
import type { ModuleAccess } from '../../lib/module-access';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Session = { readonly role: 'SUPER_ADMIN' | 'ADMIN' | 'USER'; readonly moduleAccess: readonly ModuleAccess[] };
type Summary = { readonly users: number | null; readonly organizations: number | null; readonly modules: number | null; readonly activeAccess: number | null };

export default function AdministrationPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [summary, setSummary] = useState<Summary>({ users: null, organizations: null, modules: null, activeAccess: null });
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    async function get(path: string): Promise<Response> { return fetch(`${API}${path}`, { credentials: 'include', cache: 'no-store' }); }
    async function load() {
      try {
        const meResponse = await get('/auth/me');
        if (meResponse.status === 401) { router.replace('/login'); return; }
        if (!meResponse.ok) throw new Error('Could not load your session.');
        const me: Session = await meResponse.json();
        if (!active) return;
        setSession(me);
        if (me.role === 'USER') { setState('forbidden'); return; }
        const [usersResponse, tenantsResponse, modulesResponse] = await Promise.all([
          get('/users'), me.role === 'SUPER_ADMIN' ? get('/tenants') : Promise.resolve(null),
          me.role === 'ADMIN' ? get('/modules/configuration') : get('/modules'),
        ]);
        if (usersResponse.status === 403 || modulesResponse.status === 403) { setState('forbidden'); return; }
        if (!usersResponse.ok || (tenantsResponse && !tenantsResponse.ok) || !modulesResponse.ok) throw new Error('Platform summary is unavailable.');
        const users: unknown = await usersResponse.json();
        const organizations: unknown = tenantsResponse ? await tenantsResponse.json() : null;
        const modules: unknown = await modulesResponse.json();
        if (active) {
          setSummary({ users: Array.isArray(users) ? users.length : null, organizations: Array.isArray(organizations) ? organizations.length : null, modules: Array.isArray(modules) ? modules.length : null, activeAccess: null });
          setState('ready');
        }
      } catch { if (active) setState('error'); }
    }
    void load();
    return () => { active = false; };
  }, [router]);

  const metrics = [
    ['Users', summary.users], ['Organizations', summary.organizations],
    ['Active modules', summary.modules], ['Active access', summary.activeAccess],
  ] as const;
  const destinations = [
    { title: 'Users', description: 'Accounts, roles, and assigned access.', href: '/users' },
    ...(session?.role === 'SUPER_ADMIN' ? [{ title: 'Organizations', description: 'Tenant status and membership.', href: '/tenants' }] : []),
    { title: 'Modules', description: 'Platform capability policies.', href: '/modules' },
    { title: 'Access', description: 'Assignments and effective access.', href: '/module-access' },
  ];
  return <div className="app"><Sidebar role={session?.role} moduleAccess={session?.moduleAccess} /><section className="main"><header className="topbar"><strong>Administration</strong><span>{session?.role?.replace('_', ' ')}</span></header><main className="content editorial-module admin-workspace">
    <header className="admin-heading"><span className="source-eyebrow">ADMINISTRATION</span><h1>Platform administration.</h1><p>Manage users, organizations, access, and platform configuration.</p></header>
    {state === 'loading' && <p className="admin-state" role="status">Loading administration…</p>}
    {state === 'forbidden' && <p className="admin-state" role="alert">You don’t have permission to access this area.</p>}
    {state === 'error' && <p className="admin-state" role="alert">Administration could not be loaded. Refresh to try again.</p>}
    {state === 'ready' && <><section aria-label="Platform summary"><div className="editorial-section-heading"><span className="source-eyebrow">PLATFORM SUMMARY</span><h2>At a glance</h2></div><div className="editorial-metrics">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong className={value === null ? 'editorial-text-metric' : ''}>{value ?? 'Not available'}</strong></div>)}</div></section><section aria-label="Administration workspace"><div className="editorial-section-heading"><span className="source-eyebrow">ADMINISTRATION WORKSPACE</span><h2>Choose a workspace</h2></div><div className="admin-links">{destinations.map(item => <Link href={item.href} key={item.href}><span>{item.title}</span><p>{item.description}</p><b aria-hidden="true">↗</b></Link>)}</div></section></>}
  </main></section></div>;
}
