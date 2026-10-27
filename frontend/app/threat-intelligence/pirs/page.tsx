'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ThreatIntelligenceShell } from '@/components/intelligence/ThreatIntelligenceShell';
import { PirsWorkspace } from '@/components/intelligence/pirs/PirsWorkspace';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
export default function PirsPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  useEffect(() => { fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' }).then(async response => { if (!response.ok) { router.replace('/login'); return; } const user: { role: Role } = await response.json(); setRole(user.role); }).catch(() => router.replace('/login')); }, [router]);
  return <ThreatIntelligenceShell title="Priority Intelligence Requirements">{role ? <PirsWorkspace role={role} /> : <p role="status">Loading PIR workspace...</p>}</ThreatIntelligenceShell>;
}
