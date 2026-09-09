'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MitreWorkspace } from '@/components/intelligence/mitre/MitreWorkspace';
import { ThreatIntelligenceShell } from '@/components/intelligence/ThreatIntelligenceShell';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
export default function MitreAttackPage() { const router = useRouter(); const [role, setRole] = useState<Role | null>(null); useEffect(() => { fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' }).then(async response => { if (!response.ok) { router.replace('/'); return; } const user: { readonly role: Role } = await response.json(); setRole(user.role); }).catch(() => router.replace('/')); }, [router]); return <ThreatIntelligenceShell title="MITRE ATT&CK">{role ? <MitreWorkspace role={role}/> : <div className="source-state">Loading MITRE ATT&amp;CK workspace...</div>}</ThreatIntelligenceShell>; }
