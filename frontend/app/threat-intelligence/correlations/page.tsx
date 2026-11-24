'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ThreatIntelligenceShell } from '@/components/intelligence/ThreatIntelligenceShell';
import { CorrelationWorkspace } from '@/components/intelligence/correlations/CorrelationWorkspace';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

export default function CorrelationsPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  useEffect(() => {
    fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' }).then(async response => {
      if (!response.ok) { router.replace('/login'); return; }
      const user: { readonly role: Role } = await response.json();
      setRole(user.role);
    }).catch(() => router.replace('/login'));
  }, [router]);
  return <ThreatIntelligenceShell title="Correlations">{role ? <CorrelationWorkspace role={role} /> : <div className="source-state">Loading correlations...</div>}</ThreatIntelligenceShell>;
}
