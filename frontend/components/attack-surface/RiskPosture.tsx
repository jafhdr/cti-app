'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Asset } from './types';
import { ContextualPriority } from './ContextualPriority';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Snapshot = { readonly score: number; readonly critical: number; readonly high: number; readonly medium: number; readonly low: number; readonly total: number; readonly trend: 'BASELINE' | 'INCREASED' | 'DECREASED' | 'UNCHANGED'; readonly evaluatedAt: string };
type History = { readonly current: Snapshot | null; readonly previous: Snapshot | null };

export function RiskPosture({ asset, tenantQuery, refresh }: { readonly asset: Asset; readonly tenantQuery: string; readonly refresh: number }) {
  const [posture, setPosture] = useState<History | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadedScope, setLoadedScope] = useState('');
  const url = `${API}/attack-surface/assets/${asset.id}/risk-posture${tenantQuery ? `?${tenantQuery}` : ''}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(''); setPosture(null); setLoadedScope('');
    try {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal });
      if (!response.ok) throw new Error('Failed to load risk posture.');
      const data = await response.json() as History;
      if (!signal?.aborted) { setPosture(data); setLoadedScope(`${asset.id}:${tenantQuery}`); }
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Failed to load risk posture.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [url, asset.id, tenantQuery]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, refresh]);
  return <><section className="asm-intelligence-section" aria-label="V1 risk posture">
    <div className="asm-section-heading"><span className="source-eyebrow">RISK / HISTORY</span><h3>Risk posture</h3></div>
    {loading && <p role="status">Loading risk posture...</p>}
    {error && <p className="error" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
    {!loading && !error && loadedScope === `${asset.id}:${tenantQuery}` && (!posture?.current ? <p>No risk baseline yet. Run discovery to record the first snapshot.</p> : <>
      <dl className="asm-service-metrics"><div><dt>Current score</dt><dd>{posture.current.score}</dd></div><div><dt>Previous score</dt><dd>{posture.previous?.score ?? '—'}</dd></div><div><dt>Trend</dt><dd>{posture.current.trend.toLowerCase()}</dd></div></dl>
      <p className="asm-discovery-context">Active findings: {posture.current.total} · Critical {posture.current.critical} · High {posture.current.high} · Medium {posture.current.medium} · Low {posture.current.low} · Evaluated {new Date(posture.current.evaluatedAt).toLocaleString('id-ID')}</p>
    </>)}
  </section><ContextualPriority asset={asset} tenantQuery={tenantQuery} refresh={refresh} /></>;
}
