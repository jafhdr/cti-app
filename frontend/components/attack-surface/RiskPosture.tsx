'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Asset } from './types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Snapshot = { readonly score: number; readonly critical: number; readonly high: number; readonly medium: number; readonly low: number; readonly total: number; readonly trend: 'BASELINE' | 'INCREASED' | 'DECREASED' | 'UNCHANGED'; readonly evaluatedAt: string };
type History = { readonly current: Snapshot | null; readonly previous: Snapshot | null };

export function RiskPosture({ asset, tenantQuery, refresh }: { readonly asset: Asset; readonly tenantQuery: string; readonly refresh: number }) {
  const [posture, setPosture] = useState<History | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const url = `${API}/attack-surface/assets/${asset.id}/risk-posture${tenantQuery ? `?${tenantQuery}` : ''}`;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('Failed to load risk posture.');
      setPosture(await response.json() as History);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to load risk posture.'); }
    finally { setLoading(false); }
  }, [url]);
  useEffect(() => { void load(); }, [load, refresh]);
  return <section className="asm-intelligence-section" aria-label="Risk posture">
    <div className="asm-section-heading"><span className="source-eyebrow">RISK / HISTORY</span><h3>Risk posture</h3></div>
    {loading && <p role="status">Loading risk posture...</p>}
    {error && <p className="error" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
    {!loading && !error && (!posture?.current ? <p>No risk baseline yet. Run discovery to record the first snapshot.</p> : <>
      <dl className="asm-service-metrics"><div><dt>Current score</dt><dd>{posture.current.score}</dd></div><div><dt>Previous score</dt><dd>{posture.previous?.score ?? '—'}</dd></div><div><dt>Trend</dt><dd>{posture.current.trend.toLowerCase()}</dd></div></dl>
      <p className="asm-discovery-context">Active findings: {posture.current.total} · Critical {posture.current.critical} · High {posture.current.high} · Medium {posture.current.medium} · Low {posture.current.low} · Evaluated {new Date(posture.current.evaluatedAt).toLocaleString('id-ID')}</p>
    </>)}
  </section>;
}
