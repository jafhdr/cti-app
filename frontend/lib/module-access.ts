'use client';

import { useEffect, useState } from 'react';

export type ModuleAccess = {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly moduleSlug: string;
  readonly assigned: boolean;
  readonly accessible?: boolean;
  readonly featureKeys: readonly string[];
};

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function useModuleAccess(role: 'SUPER_ADMIN' | 'ADMIN' | 'USER') {
  const [moduleAccess, setModuleAccess] = useState<readonly ModuleAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role !== 'USER') {
      setModuleAccess([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const res = await fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) throw new Error('Gagal memuat data akses modul');
        const data = await res.json();
        if (cancelled) return;
        const access: ModuleAccess[] = data.moduleAccess ?? [];
        setModuleAccess(access);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Gagal memuat akses modul');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [role]);

  return { moduleAccess, loading, error };
}
