'use client';

import { useEffect, useState } from 'react';
import type { Asset } from './types';
import { formatDate } from './AssetPanel';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type Match = {
  readonly id: string;
  readonly type: string;
  readonly value: string;
  readonly source: string | null;
  readonly confidence: number | null;
  readonly firstSeenAt?: string | null;
  readonly lastSeenAt?: string | null;
  readonly enrichmentSummary: { readonly provider: string; readonly status: string } | null;
};
type Correlation = { readonly matches: readonly Match[] };

export function ThreatIntelligence({ asset, tenantQuery }: { readonly asset: Asset; readonly tenantQuery: string }) {
  const [matches, setMatches] = useState<readonly Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`${API}/attack-surface/assets/${asset.id}/threat-intelligence${tenantQuery ? `?${tenantQuery}` : ''}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body: Correlation & { message?: string } = await response.json();
        if (!response.ok) throw new Error(body.message || 'Failed to load threat intelligence.');
        setMatches(body.matches);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Failed to load threat intelligence.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [asset.id, tenantQuery]);

  return <section className="asm-ports" aria-label="Threat Intelligence">
    <header><div><span className="source-eyebrow">THREAT INTELLIGENCE</span><h3>{matches.length} matched indicators</h3></div></header>
    {loading ? <p role="status">Loading threat intelligence...</p> : error ? <p className="error" role="alert">{error}</p> : matches.length === 0 ? <p>No matching threat intelligence indicators found.</p> : <div className="asm-port-scroll"><table><thead><tr><th>Type</th><th>Value</th><th>Source</th><th>Confidence</th><th>First seen</th><th>Last seen</th><th>Enrichment</th></tr></thead><tbody>{matches.map(match => <tr key={match.id}><td>{match.type}</td><td><code>{match.value}</code></td><td>{match.source || '-'}</td><td>{match.confidence ?? '-'}</td><td>{formatDate(match.firstSeenAt ?? null)}</td><td>{formatDate(match.lastSeenAt ?? null)}</td><td>{match.enrichmentSummary ? `${match.enrichmentSummary.provider}: ${match.enrichmentSummary.status}` : '-'}</td></tr>)}</tbody></table></div>}
  </section>;
}
