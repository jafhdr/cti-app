'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/dashboard/Sidebar';
import type { ModuleAccess } from '../../lib/module-access';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

type CurrentUser = {
  readonly email: string;
  readonly role: Role;
  readonly moduleAccess: readonly ModuleAccess[];
};

const CaseMutationAccessContext = createContext(false);

export function useCaseMutationAccess(): boolean {
  return useContext(CaseMutationAccessContext);
}

export default function CasesLayout({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadUser(): Promise<void> {
      try {
        const response = await fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) {
          router.replace('/');
          return;
        }

        const currentUser: CurrentUser = await response.json();
        if (!cancelled) setUser(currentUser);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadUser();
    return () => { cancelled = true; };
  }, [router]);

  async function logout(): Promise<void> {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/');
  }

  if (loading || !user) {
    return (
      <div className="app">
        <aside className="sidebar"><div className="brand">CTI Platform</div></aside>
        <section className="main"><div className="content">Memuat Case Management...</div></section>
      </div>
    );
  }

  const canAccessCases = user.role === 'SUPER_ADMIN'
    || user.moduleAccess.some(module => module.assigned && module.moduleSlug === 'case-management');

  return (
    <div className="app">
      <Sidebar role={user.role} moduleAccess={user.moduleAccess} onLogout={logout} />
      <section className="main">
        <header className="topbar">
          <strong>Case Management</strong>
          <span>{user.email} · {user.role}</span>
        </header>
        {canAccessCases ? (
          <CaseMutationAccessContext.Provider value={user.role === 'SUPER_ADMIN' || user.role === 'ADMIN'}>
            {children}
          </CaseMutationAccessContext.Provider>
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
