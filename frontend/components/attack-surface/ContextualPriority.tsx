'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import type { Asset } from './types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const prioritySchema = z.object({
  assetId: z.string(), tenantId: z.string(), asOf: z.string(), evaluatorVersion: z.string(), assetCriticality: z.string().nullable(),
  priority: z.enum(['NOT_ASSESSED', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']), score: z.number().nullable(),
  eligibleCount: z.number(), excluded: z.record(z.string(), z.number()), missing: z.array(z.string()), explanation: z.string(),
  contributing: z.array(z.object({ correlationId: z.string(), serviceId: z.string(), cveId: z.string(),
    severity: z.string(), machineConfidence: z.string(), serviceObservedAt: z.string(), score: z.number(),
    factors: z.object({ assetCriticality: z.number(), cveSeverity: z.number(), observedService: z.number(), tiCvss: z.number().nullable() }),
  })),
});
type Priority = z.infer<typeof prioritySchema>;

export function ContextualPriority({ asset, tenantQuery, refresh }: { readonly asset: Asset; readonly tenantQuery: string; readonly refresh: number }) {
  const [result, setResult] = useState<Priority | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'disabled' | 'denied' | 'error'>('loading');
  const [reload, setReload] = useState(0);
  const [resultScope, setResultScope] = useState('');
  const query = tenantQuery ? `?${tenantQuery}` : '';
  const scope = `${asset.id}:${tenantQuery}`;
  const load = useCallback(async (signal: AbortSignal) => {
    setResult(null); setResultScope(''); setState('loading');
    try {
      const response = await fetch(`${API}/attack-surface/v2/assets/${asset.id}/priority${query}`, { credentials: 'include', cache: 'no-store', signal });
      if (response.status === 403) { if (!signal.aborted) setState('denied'); return; }
      if (response.status === 404) { if (!signal.aborted) setState('disabled'); return; }
      if (!response.ok) throw new Error('Priority request failed');
      const parsed = prioritySchema.parse(await response.json());
      if (!signal.aborted && parsed.assetId === asset.id) { setResult(parsed); setResultScope(`${asset.id}:${tenantQuery}`); setState('ready'); }
    } catch { if (!signal.aborted) setState('error'); }
  }, [asset.id, query, tenantQuery]);
  useEffect(() => { if (process.env.NEXT_PUBLIC_ASM_V2_PRIORITY_ENABLED !== 'true') return; const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, refresh, reload]);
  useEffect(() => {
    const changed = (event: Event) => { if ((event as CustomEvent<{ assetId: string }>).detail?.assetId === asset.id) setReload(value => value + 1); };
    window.addEventListener('asm-v2-review-changed', changed);
    return () => window.removeEventListener('asm-v2-review-changed', changed);
  }, [asset.id]);
  if (process.env.NEXT_PUBLIC_ASM_V2_PRIORITY_ENABLED !== 'true') return <p>Contextual priority is disabled.</p>;
  return <section className="asm-intelligence-section" aria-label="V2 contextual priority" key={scope}>
    <div className="asm-section-heading"><span className="source-eyebrow">V2 / REVIEWED EVIDENCE</span><h3>Contextual priority</h3></div>
    {state === 'loading' && <p role="status">Evaluating reviewed evidence...</p>}
    {state === 'denied' && <p role="alert">Priority is unavailable for this tenant or account.</p>}
    {state === 'disabled' && <p>Priority is unavailable for this asset.</p>}
    {state === 'error' && <p role="alert">Could not evaluate priority. <button type="button" onClick={() => setReload(value => value + 1)}>Retry</button></p>}
    {state === 'ready' && result && resultScope === scope && <>
      <dl className="asm-service-metrics"><div><dt>Reviewed priority</dt><dd>{result.priority.replace('_', ' ')}</dd></div><div><dt>Context score</dt><dd>{result.score ?? '—'}</dd></div><div><dt>Eligible correlations</dt><dd>{result.eligibleCount}</dd></div></dl>
      <p className="asm-discovery-context">{result.explanation}</p>
      {result.priority === 'NOT_ASSESSED' && <p>No current, accepted evidence can support an asset priority.</p>}
      {result.contributing.length > 0 && <ul>{result.contributing.map(item => <li key={item.correlationId}>
        <a href={`?${tenantQuery ? `${tenantQuery}&` : ''}assetId=${encodeURIComponent(asset.id)}&correlationId=${encodeURIComponent(item.correlationId)}#asm-vulnerabilities`}>{item.cveId}</a> · {item.severity} CVE severity · observed service evidence {item.serviceId} · score {item.score}
        <br />Factors: asset criticality {result.assetCriticality ?? 'unavailable'} ({item.factors.assetCriticality}), CVE severity {item.factors.cveSeverity}, observed open service {item.factors.observedService}, CVSS {item.factors.tiCvss ?? 'unavailable'}.
      </li>)}</ul>}
      {Object.keys(result.excluded).length > 0 && <p className="asm-discovery-context">Excluded: {Object.entries(result.excluded).map(([reason, count]) => `${reason.replaceAll('_', ' ').toLowerCase()} ${count}`).join(' · ')}.</p>}
      {result.missing.length > 0 && <p className="asm-discovery-context">Uncertainty: {result.missing.map(item => item.replaceAll('_', ' ').toLowerCase()).join(' · ')}.</p>}
      <p className="asm-discovery-context">OPEN means an observed open service, not proven internet exposure. Review confirms relevance, not exploitation. Evaluated {new Date(result.asOf).toLocaleString('id-ID')} · {result.evaluatorVersion}.</p>
    </>}
  </section>;
}
