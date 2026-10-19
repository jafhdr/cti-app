'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { useAppSec } from './AppSecShell';
import { appsecUrl, errorMessage, type Posture } from './types';

export function PostureOverview() {
  const { role, tenantId, canViewApplications, canManage } = useAppSec();
  const latest = useRef(0);
  const [posture, setPosture] = useState<Posture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const requestId = ++latest.current;
    setLoading(true); setError(''); setPosture(null);
    try {
      const response = await fetch(appsecUrl('/appsec/posture', role, tenantId), { credentials: 'include', cache: 'no-store' });
      const body: Posture & { readonly message?: string | readonly string[] } = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal memuat AppSec posture.', response.status));
      if (requestId === latest.current) setPosture(body);
    } catch (cause) { if (requestId === latest.current) setError(cause instanceof Error ? cause.message : 'Gagal memuat AppSec posture.'); }
    finally { if (requestId === latest.current) setLoading(false); }
  }, [role, tenantId]);
  useEffect(() => { void load(); return () => { latest.current += 1; }; }, [load]);
  const metrics = posture ? [
    ['Applications', posture.applications.total], ['Active Findings', posture.findings.active],
    ['Critical Findings', posture.severity.critical], ['High Findings', posture.severity.high],
    ['Resolved / Closed', posture.findings.resolved],
  ] as const : [];
  const severity = posture ? [['Critical', posture.severity.critical], ['High', posture.severity.high], ['Medium', posture.severity.medium], ['Low', posture.severity.low]] as const : [];
  const status = posture ? [['Open', posture.status.open], ['In progress', posture.status.inProgress], ['Resolved', posture.status.resolved], ['Accepted risk', posture.status.acceptedRisk], ['False positive', posture.status.falsePositive]] as const : [];
  return <main className="content editorial-module appsec-workspace"><Link className="appsec-back" href="/appsec/findings">← Findings</Link><header className="editorial-heading appsec-heading"><div><span className="source-eyebrow">APPSEC / CURRENT STATE</span><h1>Application posture</h1><p>Live application and finding counts for the selected tenant.</p></div></header>
    {loading ? <div className="appsec-state" role="status">Loading posture...</div> : error ? <div className="appsec-state" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></div> : posture && <>
      <section className="appsec-posture-metrics" aria-label="AppSec posture metrics">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
      {posture.applications.total === 0 ? <Card view="outlined" className="appsec-card"><div className="appsec-state"><strong>No applications yet</strong>{canManage && canViewApplications && <Link href="/appsec/applications">Open Applications</Link>}</div></Card> : posture.findings.total === 0 ? <Card view="outlined" className="appsec-card"><div className="appsec-state"><strong>No findings recorded</strong><span>Applications are available, with no findings in this workspace.</span></div></Card> : <div className="appsec-posture-grid">
        <Card view="outlined" className="appsec-card appsec-distribution"><h2>Findings by Severity</h2>{severity.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong><meter min={0} max={posture.findings.total} value={value} aria-label={`${label} findings`} /></div>)}</Card>
        <Card view="outlined" className="appsec-card appsec-distribution"><h2>Findings by Status</h2>{status.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong><meter min={0} max={posture.findings.total} value={value} aria-label={`${label} status`} /></div>)}</Card>
        <Card view="outlined" className="appsec-card appsec-top-applications"><h2>Top Applications with Active Findings</h2>{posture.topApplications.length === 0 ? <p>No active findings.</p> : <ol>{posture.topApplications.map(item => <li key={item.applicationId}><div>{canViewApplications ? <Link href={`/appsec/applications/${item.applicationId}`}>{item.name}</Link> : <strong>{item.name}</strong>}</div><span>{item.activeFindings} active · {item.criticalFindings} critical · {item.highFindings} high</span></li>)}</ol>}</Card>
      </div>}
    </>}
  </main>;
}
