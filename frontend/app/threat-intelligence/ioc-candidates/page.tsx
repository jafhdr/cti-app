'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { IocCandidatesWorkspace } from '@/components/intelligence/ioc-candidates/IocCandidatesWorkspace';
import { ThreatIntelligenceShell } from '@/components/intelligence/ThreatIntelligenceShell';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

export default function IocCandidatesPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  useEffect(() => { fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' }).then(async response => { if (!response.ok) { router.replace('/'); return; } const user: { readonly role: Role } = await response.json(); if (user.role === 'USER') { router.replace('/threat-intelligence'); return; } setRole(user.role); }).catch(() => router.replace('/')); }, [router]);
  return <ThreatIntelligenceShell title="IOC Candidates">{role ? <IocCandidatesWorkspace role={role} /> : <div className="source-state">Loading IOC candidate review...</div>}</ThreatIntelligenceShell>;
}
