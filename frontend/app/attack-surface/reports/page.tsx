'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AttackSurfaceShell, useAttackSurface } from '@/components/attack-surface/AttackSurfaceShell';
import { NotificationPreferences } from '@/components/attack-surface/NotificationPreferences';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Period = '24h' | '7d' | '30d';
type Report = { readonly assetCount: number; readonly newAssets: number; readonly newPorts: number; readonly findings: Readonly<Record<string, number>>; readonly confirmedVulnerabilities: number; readonly openAlerts: number; readonly acknowledgedAlerts: number; readonly resolvedAlerts: number; readonly linkedCases: number; readonly currentRiskScore: number; readonly riskTrend: readonly { readonly id: string; readonly assetId: string; readonly score: number; readonly evaluatedAt: string }[]; readonly importantChanges: readonly { readonly id: string; readonly assetId: string; readonly type: string; readonly detectedAt: string; readonly currentValue: string | null }[] };
type Notice = { readonly id: string; readonly readAt: string | null; readonly alert: { readonly id: string; readonly title: string; readonly severity: string; readonly source: string; readonly assetId: string | null; readonly caseId: string | null; readonly firstSeenAt: string } };

function ReportsContent() {
  const { tenantId, ready } = useAttackSurface();
  const [period, setPeriod] = useState<Period>('7d');
  const [report, setReport] = useState<Report | null>(null);
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const query = tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : '';
  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true); setError('');
    try {
      const [summary, notifications] = await Promise.all([
        fetch(`${API}/attack-surface/reports/summary?period=${period}${query}`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${API}/attack-surface/notifications?${query.slice(1)}`, { credentials: 'include', cache: 'no-store' }),
      ]);
      if (!summary.ok || !notifications.ok) throw new Error('Unable to load ASM report.');
      setReport(await summary.json() as Report);
      setNotices(await notifications.json() as readonly Notice[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load ASM report.'); }
    finally { setLoading(false); }
  }, [period, query, ready]);
  useEffect(() => { void load(); }, [load]);
  async function markRead(id: string) {
    const response = await fetch(`${API}/attack-surface/notifications/${id}/read?${query.slice(1)}`, { method: 'PATCH', credentials: 'include' });
    if (response.ok) setNotices(items => items.map(item => item.id === id ? { ...item, readAt: new Date().toISOString() } : item));
    else setError('Unable to mark notification as read.');
  }
  function exportChanges() {
    if (!report) return;
    const rows = [['Type', 'Asset ID', 'Detected at', 'Current value'], ...report.importantChanges.map(item => [item.type, item.assetId, item.detectedAt, item.currentValue ?? ''])];
    const csv = rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `asm-changes-${period}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }
  const metrics = report ? [['Current assets', report.assetCount], ['New assets', report.newAssets], ['New exposed ports', report.newPorts], ['Confirmed vulnerabilities', report.confirmedVulnerabilities], ['Open alerts', report.openAlerts], ['Acknowledged alerts', report.acknowledgedAlerts], ['Resolved alerts', report.resolvedAlerts], ['Linked cases', report.linkedCases], ['Current risk score', report.currentRiskScore]] as const : [];
  return <main className="content asm-posture-report">
    <header className="editorial-heading"><span className="source-eyebrow">ATTACK SURFACE / REPORTS</span><h1>Posture report</h1><p>Exposure, findings, and risk history from recorded ASM activity.</p></header>
    <div className="asm-schedule-controls"><label>Period<select value={period} onChange={event => setPeriod(event.target.value as Period)}><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label><button type="button" onClick={() => void load()}>Refresh</button><button type="button" onClick={exportChanges} disabled={!report}>Export changes CSV</button></div>
    {loading && <p role="status">Loading report...</p>}{error && <p role="alert" className="error">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
    {!loading && !error && report && <><dl className="asm-service-metrics">{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <section className="asm-intelligence-section"><h2>New findings by severity</h2><p>{['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(level => `${level}: ${report.findings[level] ?? 0}`).join(' · ')}</p></section>
      <section className="asm-intelligence-section"><h2>Risk trend</h2>{report.riskTrend.length ? <ul className="asm-change-list">{report.riskTrend.map(point => <li key={point.id}><Link href={`/attack-surface/assets?assetId=${point.assetId}${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ''}`}>Asset {point.assetId}</Link><span>Score {point.score} · {new Date(point.evaluatedAt).toLocaleString('id-ID')}</span></li>)}</ul> : <p>No risk snapshots in this period.</p>}</section>
      <section className="asm-intelligence-section"><h2>Important changes</h2>{report.importantChanges.length ? <ul className="asm-change-list">{report.importantChanges.map(change => <li key={change.id}><strong>{change.type.replaceAll('_', ' ')}</strong><span>{change.currentValue ?? '—'} · {new Date(change.detectedAt).toLocaleString('id-ID')}</span><Link href={`/attack-surface/assets?assetId=${change.assetId}${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ''}`}>View asset</Link></li>)}</ul> : <p>No important changes in this period.</p>}</section>
      <section className="asm-intelligence-section"><h2>Notifications</h2>{notices.length ? <ul className="asm-change-list">{notices.map(item => <li key={item.id}><strong>{item.alert.severity} · {item.alert.source} / {item.alert.title}</strong><small>{new Date(item.alert.firstSeenAt).toLocaleString('id-ID')} · {item.readAt ? 'Read' : 'Unread'}</small><div className="asm-alert-actions">{item.alert.assetId && <Link href={`/attack-surface/assets?assetId=${item.alert.assetId}${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ''}`}>Asset / Alert</Link>}{item.alert.caseId && <Link href={`/cases/${item.alert.caseId}`}>Case</Link>}{!item.readAt && <button type="button" onClick={() => void markRead(item.id)}>Mark read</button>}</div></li>)}</ul> : <p>No notifications yet.</p>}</section>
    </>}
    <NotificationPreferences />
  </main>;
}
export default function AttackSurfaceReportsPage() { return <AttackSurfaceShell><ReportsContent /></AttackSurfaceShell>; }
