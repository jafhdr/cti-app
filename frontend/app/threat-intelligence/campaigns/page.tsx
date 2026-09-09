'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CampaignsWorkspace } from '@/components/intelligence/campaigns/CampaignsWorkspace';
import { ThreatIntelligenceShell } from '@/components/intelligence/ThreatIntelligenceShell';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
export default function CampaignsPage() { const router = useRouter(); const [role, setRole] = useState<Role | null>(null); useEffect(() => { fetch(`${API}/auth/me`, { credentials: 'include', cache: 'no-store' }).then(async response => { if (!response.ok) { router.replace('/'); return; } const user: { readonly role: Role } = await response.json(); setRole(user.role); }).catch(() => router.replace('/')); }, [router]); return <ThreatIntelligenceShell title="Campaigns">{role ? <CampaignsWorkspace role={role}/> : <div className="source-state">Loading campaign workspace...</div>}</ThreatIntelligenceShell>; }
