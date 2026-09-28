'use client';

import { useEffect, useState } from 'react';
import type { Asset } from './types';
import { formatDate } from './AssetPanel';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type RelatedAsset = { readonly id: string; readonly type: string; readonly value: string };
type Relationship = {
  readonly id: string;
  readonly type: 'DISCOVERED_SUBDOMAIN' | 'RESOLVES_TO';
  readonly source: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly rootAsset: RelatedAsset;
  readonly relatedAsset: RelatedAsset;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
};
type Response = { readonly relationships: readonly Relationship[]; readonly message?: string };

export function DiscoveryRelationships({ asset, tenantQuery, discoveryRun }: { readonly asset: Asset; readonly tenantQuery: string; readonly discoveryRun: number }) {
  const [relationships, setRelationships] = useState<readonly Relationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`${API}/attack-surface/assets/${asset.id}/relationships${tenantQuery ? `?${tenantQuery}` : ''}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body: Response = await response.json();
        if (!response.ok) throw new Error(body.message || 'Failed to load discovery relationships.');
        setRelationships(body.relationships);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Failed to load discovery relationships.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [asset.id, tenantQuery, discoveryRun]);

  return <section className="asm-ports" aria-label="Discovery Relationships">
    <header><div><span className="source-eyebrow">DISCOVERY / NETWORK</span><h3>Connected assets</h3><p>{relationships.length} recorded relationships for {asset.value}</p></div></header>
    {loading ? <p role="status">Loading discovery relationships...</p> : error ? <p className="error" role="alert">{error}</p> : relationships.length === 0 ? <p>No DNS or asset relationships have been recorded for this asset.</p> : <div className="asm-relationship-list">{relationships.map(link => <article className="asm-relationship-card" key={link.id}><div className="asm-relationship-node"><span>{link.rootAsset.type.replaceAll('_', ' ')}</span><strong>{link.rootAsset.value}</strong></div><div className="asm-relationship-edge"><span>{link.type.replaceAll('_', ' ')}</span></div><div className="asm-relationship-node"><span>{link.relatedAsset.type.replaceAll('_', ' ')}</span><strong>{link.relatedAsset.value}</strong></div><footer>{link.direction === 'incoming' ? 'Incoming' : 'Outgoing'} · {link.source} · First seen {formatDate(link.firstSeenAt)} · Last seen {formatDate(link.lastSeenAt)}</footer></article>)}</div>}
  </section>;
}
