'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Asset } from './types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Correlation = {
  readonly id: string;
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly status: 'ACTIVE' | 'STALE';
  readonly matchReason: string;
  readonly service: { readonly port: number; readonly protocol: string; readonly service: string | null; readonly product: string | null; readonly version: string | null };
  readonly vulnerability: { readonly cveId: string; readonly name: string; readonly severity: string; readonly cvssScore: number | null; readonly source: string | null };
};

export function Vulnerabilities({ asset, tenantQuery, canManage, refresh }: { readonly asset: Asset; readonly tenantQuery: string; readonly canManage: boolean; readonly refresh: number }) {
  const [items, setItems] = useState<readonly Correlation[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const url = `${API}/attack-surface/assets/${asset.id}/vulnerability-correlations${tenantQuery ? `?${tenantQuery}` : ''}`;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load vulnerability correlations.');
      const data: readonly Correlation[] = await response.json();
      setItems(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load vulnerability correlations.');
    } finally { setLoading(false); }
  }, [url]);
  useEffect(() => { void load(); }, [load, refresh]);
  async function run() {
    setRunning(true); setError('');
    try {
      const response = await fetch(`${url.replace(/\?.*$/, '')}/refresh${tenantQuery ? `?${tenantQuery}` : ''}`, { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('Correlation refresh failed.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Correlation refresh failed.'); }
    finally { setRunning(false); }
  }
  return <section className="asm-intelligence-section" aria-label="Vulnerabilities">
    <div className="asm-section-heading"><span className="source-eyebrow">VULNERABILITY CORRELATION</span><h3>Vulnerabilities</h3></div>
    {canManage && <Button type="button" view="outlined" size="s" disabled={running} onClick={() => void run()}>{running ? 'Correlating...' : 'Refresh correlations'}</Button>}
    {error && <p className="error" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
    {loading ? <p role="status">Loading vulnerability correlations...</p> : items.length === 0 ? <p>No vulnerability correlations recorded. Product and version fingerprints are required for a confirmed match.</p> : <div className="asm-port-scroll"><table className="asm-vulnerability-table"><thead><tr><th>Vulnerability</th><th>Service</th><th>Product / version</th><th>Severity / CVSS</th><th>Confidence</th><th>Evidence</th><th>Source</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td>{item.vulnerability.cveId}<br />{item.vulnerability.name}</td><td>{item.service.service || 'Service'} · {item.service.protocol} {item.service.port}</td><td>{item.service.product || 'Unknown'} / {item.service.version || 'Unknown'}</td><td>{item.vulnerability.severity} / {item.vulnerability.cvssScore ?? '–'}</td><td><strong>{item.status === 'STALE' ? 'No longer observed' : item.confidence === 'HIGH' ? 'Confirmed match' : 'Candidate · review needed'} ({item.confidence})</strong></td><td>{item.matchReason}</td><td>{item.vulnerability.source || 'Catalog'}</td></tr>)}</tbody></table></div>}
  </section>;
}
