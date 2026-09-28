'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { VulnerabilitiesWorkspace } from '@/components/intelligence/vulnerabilities/VulnerabilitiesWorkspace';
import { ThreatIntelligenceShell } from '@/components/intelligence/ThreatIntelligenceShell';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER'; const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
export default function VulnerabilitiesPage() { const router = useRouter(); const [role, setRole] = useState<Role | null>(null); useEffect(() => { fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' }).then(async response => { if (!response.ok) { router.replace('/login'); return; } const user: { readonly role: Role } = await response.json(); setRole(user.role); }).catch(() => router.replace('/login')); }, [router]); return <ThreatIntelligenceShell title="Vulnerabilities">{role ? <VulnerabilitiesWorkspace role={role} /> : <div className="source-state">Loading vulnerabilities...</div>}</ThreatIntelligenceShell>; }
