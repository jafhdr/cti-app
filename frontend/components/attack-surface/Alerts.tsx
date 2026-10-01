'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Asset } from './types';
import { useAttackSurface } from './AttackSurfaceShell';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Alert = { readonly id: string; readonly title: string; readonly description: string | null; readonly severity: string; readonly status: string; readonly source: string; readonly firstSeenAt: string; readonly findingId: string | null; readonly riskSnapshotId?: string | null; readonly changeEventId: string | null; readonly vulnerabilityCorrelationId: string | null; readonly case: { readonly id: string; readonly caseNumber: string; readonly status: string } | null };

export function Alerts({ asset, tenantQuery, refresh }: { readonly asset: Asset; readonly tenantQuery: string; readonly refresh: number }) {
  const latestLoad = useRef(0);
  const { canCreateCase, tenantId, role } = useAttackSurface();
  const [items, setItems] = useState<readonly Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const suffix = tenantQuery ? `?${tenantQuery}` : '';
  const load = useCallback(async () => {
    const requestId = ++latestLoad.current;
    setLoading(true); setError(''); setItems([]);
    try {
      const response = await fetch(`${API}/attack-surface/assets/${asset.id}/alerts${suffix}`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('Failed to load alerts.');
      const records: readonly Alert[] = await response.json();
      if (requestId === latestLoad.current) setItems(records);
    } catch (cause) { if (requestId === latestLoad.current) setError(cause instanceof Error ? cause.message : 'Failed to load alerts.'); }
    finally { if (requestId === latestLoad.current) setLoading(false); }
  }, [asset.id, suffix]);
  useEffect(() => { void load(); }, [load, refresh]);
  async function acknowledge(id: string) {
    setBusy(id); setError('');
    try {
      const response = await fetch(`${API}/attack-surface/assets/${asset.id}/alerts/${id}/acknowledge${suffix}`, { method: 'PATCH', credentials: 'include' });
      if (!response.ok) throw new Error('Failed to acknowledge alert.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to acknowledge alert.'); }
    finally { setBusy(''); }
  }
  async function resolve(id: string) {
    setBusy(id); setError('');
    try {
      const response = await fetch(`${API}/attack-surface/assets/${asset.id}/alerts/${id}/resolve${suffix}`, { method: 'PATCH', credentials: 'include' });
      if (!response.ok) throw new Error('Failed to resolve alert.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to resolve alert.'); }
    finally { setBusy(''); }
  }
  async function createCase(id: string) {
    setBusy(id); setError('');
    try {
      const response = await fetch(`${API}/cases/from-asm-alert/${id}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(role === 'SUPER_ADMIN' ? { tenantId } : {}) });
      if (!response.ok) throw new Error('Failed to create case.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to create case.'); }
    finally { setBusy(''); }
  }
  const active = items.filter(item => item.status !== 'CLOSED');
  return <section id="asm-alerts" className="asm-intelligence-section" aria-label="ASM alerts"><div className="asm-section-heading"><span className="source-eyebrow">ALERTS</span><h3>Actionable exposure</h3></div>
    <dl className="asm-service-metrics asm-alert-metrics"><div><dt>Open alerts</dt><dd>{loading ? '—' : active.length}</dd></div><div><dt>Critical</dt><dd>{loading ? '—' : active.filter(item => item.severity === 'CRITICAL').length}</dd></div><div><dt>High</dt><dd>{loading ? '—' : active.filter(item => item.severity === 'HIGH').length}</dd></div><div><dt>Linked cases</dt><dd>{loading ? '—' : items.filter(item => item.case).length}</dd></div></dl>
    {loading ? <p role="status">Loading alerts...</p> : error ? <p role="alert" className="error">{error} <button type="button" onClick={() => void load()}>Retry</button></p> : items.length === 0 ? <p>No actionable alerts for this asset.</p> : <div className="asm-alert-list">{items.map(item => <article className="asm-card" key={item.id}><div><span className={`ioc-severity severity-${item.severity.toLowerCase()}`}>{item.severity}</span> <strong>{item.title}</strong> <span>{item.status}</span></div><p>{asset.value} · {item.source} · Detected {new Date(item.firstSeenAt).toLocaleString('id-ID')}</p><p>{item.description}</p><p>{item.findingId && <a href="#asm-findings">Finding</a>} {item.riskSnapshotId && <a href="#asm-risk-posture">Risk posture</a>} {item.vulnerabilityCorrelationId && <a href="#asm-vulnerabilities">Vulnerability</a>} {item.changeEventId && <a href="#asm-discovery">Change event</a>}</p><div className="asm-alert-actions">{item.status === 'OPEN' && <Button view="outlined" size="s" disabled={busy === item.id} onClick={() => void acknowledge(item.id)}>Acknowledge</Button>}{item.status !== 'CLOSED' && role !== 'USER' && <Button view="outlined" size="s" disabled={busy === item.id} onClick={() => void resolve(item.id)}>Resolve</Button>}{item.case ? <Link href={`/cases/${item.case.id}`}>Open {item.case.caseNumber}</Link> : canCreateCase && <Button view="outlined" size="s" disabled={busy === item.id} onClick={() => void createCase(item.id)}>Create Case</Button>}</div></article>)}</div>}
  </section>;
}
