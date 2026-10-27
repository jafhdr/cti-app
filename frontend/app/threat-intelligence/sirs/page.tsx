'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ThreatIntelligenceShell } from '@/components/intelligence/ThreatIntelligenceShell';
import { SirsWorkspace } from '@/components/intelligence/sirs/SirsWorkspace';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
export default function SirsPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  useEffect(() => { fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' }).then(async response => { if (!response.ok) { router.replace('/login'); return; } const user: { role: Role } = await response.json(); setRole(user.role); }).catch(() => router.replace('/login')); }, [router]);
  return <ThreatIntelligenceShell title="Specific Intelligence Requirements">{role ? <SirsWorkspace role={role} /> : <p role="status">Loading SIR workspace...</p>}</ThreatIntelligenceShell>;
}
