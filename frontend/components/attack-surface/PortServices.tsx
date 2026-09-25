'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Asset, PortDiscoverySummary, PortService } from './types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const formatDate = (value: string): string => new Date(value).toLocaleString('id-ID');

export function PortServices({ asset, tenantQuery }: { readonly asset: Asset; readonly tenantQuery: string }) {
  const [services, setServices] = useState<readonly PortService[]>([]);
  const [summary, setSummary] = useState<PortDiscoverySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState('');
  const url = `${API}/attack-surface/assets/${asset.id}/port-services${tenantQuery ? `?${tenantQuery}` : ''}`;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
      const body: readonly PortService[] | { message?: string } = await response.json();
      if (!response.ok) throw new Error('message' in body ? body.message || 'Failed to load port services.' : 'Failed to load port services.');
      if (!Array.isArray(body)) throw new Error('Invalid port service response.');
      setServices(body as readonly PortService[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to load port services.'); }
    finally { setLoading(false); }
  }, [url]);
  useEffect(() => { void load(); }, [load]);

  async function discover(): Promise<void> {
    setDiscovering(true); setError(''); setSummary(null);
    try {
      const response = await fetch(`${API}/attack-surface/assets/${asset.id}/port-services/discover${tenantQuery ? `?${tenantQuery}` : ''}`, { method: 'POST', credentials: 'include' });
      const body: PortDiscoverySummary & { message?: string } = await response.json();
      if (!response.ok) throw new Error(body.message || 'Port discovery failed.');
      setSummary(body);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Port discovery failed.'); }
    finally { setDiscovering(false); }
  }

  return <section className="asm-ports" aria-label="Port and services">
    <header><div><span className="source-eyebrow">PORT &amp; SERVICE</span><h3>{asset.value}</h3></div><Button view="outlined" size="s" disabled={discovering} onClick={() => void discover()}>{discovering ? 'Discovering ports...' : 'Discover ports'}</Button></header>
    {discovering && <p role="status">Scanning common TCP ports. This may take a moment...</p>}
    {error && <p className="error" role="alert">{error} <button type="button" onClick={() => void load()}>Retry list</button></p>}
    {summary && <div className="asm-port-result" aria-label="Port discovery results"><p>Scan complete for {summary.target}: {summary.scanned} ports</p><dl>{([['Open', summary.open], ['Closed', summary.closed], ['Timeout', summary.timeout], ['Failed', summary.failed]] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl><div className="asm-port-scroll"><table><thead><tr><th>Port</th><th>Protocol</th><th>Service</th><th>Result</th></tr></thead><tbody>{summary.results.map(result => <tr key={`${result.protocol}-${result.port}`}><td>{result.port}</td><td>{result.protocol}</td><td>{result.service || '-'}</td><td title={result.error}>{result.status.toUpperCase()}</td></tr>)}</tbody></table></div></div>}
    {loading ? <p role="status">Loading port services...</p> : services.length === 0 ? <p>No port services recorded for this IP.</p> : <div className="asm-port-scroll"><table><thead><tr><th>Port</th><th>Protocol</th><th>Service</th><th>Status</th><th>First seen</th><th>Last seen</th></tr></thead><tbody>{services.map(service => <tr key={service.id}><td>{service.port}</td><td>{service.protocol}</td><td>{service.service || '-'}</td><td>{service.status}</td><td>{formatDate(service.firstSeenAt)}</td><td>{formatDate(service.lastSeenAt)}</td></tr>)}</tbody></table></div>}
  </section>;
}
