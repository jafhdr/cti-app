'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Asset } from './types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Finding = {
  readonly id: string; readonly title: string; readonly description: string; readonly type: string;
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  readonly source: string; readonly evidence: unknown;
  readonly firstSeenAt: string; readonly lastSeenAt: string;
};
type Risk = { readonly total: number; readonly critical: number; readonly high: number; readonly medium: number; readonly low: number; readonly open: number };
const date = (value: string): string => new Date(value).toLocaleString('id-ID');

export function Findings({ asset, tenantQuery, refresh }: { readonly asset: Asset; readonly tenantQuery: string; readonly refresh: number }) {
  const [items, setItems] = useState<readonly Finding[]>([]);
  const [risk, setRisk] = useState<Risk | null>(null);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const url = `${API}/attack-surface/assets/${asset.id}/findings${tenantQuery ? `?${tenantQuery}` : ''}`;
  const summaryUrl = `${API}/attack-surface/assets/${asset.id}/findings/risk-summary${tenantQuery ? `?${tenantQuery}` : ''}`;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [findingsResponse, riskResponse] = await Promise.all([
        fetch(url, { credentials: 'include', cache: 'no-store' }),
        fetch(summaryUrl, { credentials: 'include', cache: 'no-store' }),
      ]);
      if (!findingsResponse.ok || !riskResponse.ok) throw new Error('Failed to load asset findings.');
      const findings: readonly Finding[] = await findingsResponse.json();
      const summary: Risk = await riskResponse.json();
      setItems(findings); setRisk(summary);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to load asset findings.'); }
    finally { setLoading(false); }
  }, [url, summaryUrl]);
  useEffect(() => { void load(); }, [load, refresh]);

  return <section className="asm-intelligence-section" aria-label="Findings and risk assessment">
    <div className="asm-section-heading"><span className="source-eyebrow">FINDINGS / RISK</span><h3>Findings</h3></div>
    {loading && <p role="status">Loading findings...</p>}
    {error && <p className="error" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
    {!loading && !error && <>
      {risk && <dl className="asm-risk-metrics" aria-label="Risk summary">{([['Total', risk.total], ['Critical', risk.critical], ['High', risk.high], ['Medium', risk.medium], ['Low', risk.low], ['Open', risk.open]] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>}
      {items.length === 0 ? <p>No findings recorded for this asset.</p> : <div className="asm-port-scroll"><table className="asm-service-table asm-findings-table"><thead><tr><th>Title</th><th>Severity</th><th>Status</th><th>Type</th><th>Source</th><th>First seen</th><th>Last seen</th><th>Detail</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td>{item.title}</td><td><span className={`ioc-severity severity-${item.severity.toLowerCase()}`}>{item.severity}</span></td><td>{item.status}</td><td>{item.type}</td><td>{item.source}</td><td>{date(item.firstSeenAt)}</td><td>{date(item.lastSeenAt)}</td><td><button type="button" onClick={() => setSelected(selected?.id === item.id ? null : item)}>{selected?.id === item.id ? 'Hide' : 'View'}</button></td></tr>)}</tbody></table></div>}
      {selected && <div className="asm-finding-detail" aria-label="Finding detail"><h4>{selected.title}</h4><p>{selected.description}</p><p>Source: {selected.source}</p><pre>{JSON.stringify(selected.evidence, null, 2)}</pre></div>}
    </>}
  </section>;
}
