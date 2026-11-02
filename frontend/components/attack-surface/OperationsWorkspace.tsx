'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useAttackSurface } from './AttackSurfaceShell';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const summarySchema = z.object({ tenantId: z.string(), asOf: z.string(), evaluatorVersion: z.string(),
  metrics: z.object({ totalAssets: z.number(), correlations: z.object({ total: z.number(), pending: z.number(), accepted: z.number(), rejected: z.number(), reviewRequired: z.number(), active: z.number(), stale: z.number(), awaitingReview: z.number(), currentlyReviewable: z.number(), fresh: z.number(), expired: z.number(), future: z.number() }), actionableCorrelations: z.number(), highPriorityAssets: z.number(), notAssessedAssets: z.number(), staleSourceExclusions: z.number(), limitExceededAssets: z.number() }),
  definitions: z.record(z.string(), z.string()), limitations: z.array(z.string()) });
const assetsSchema = z.object({ tenantId: z.string(), asOf: z.string(), total: z.number(), limit: z.number(), nextCursor: z.string().nullable(),
  items: z.array(z.object({ assetId: z.string(), name: z.string(), value: z.string(), type: z.string(), criticality: z.string(), priority: z.string(), score: z.number().nullable(), eligibleCount: z.number(), missing: z.array(z.string()), excluded: z.record(z.string(), z.number()), mainEvidence: z.object({ correlationId: z.string(), cveId: z.string(), serviceObservedAt: z.string() }).nullable() })) });
type Summary = z.infer<typeof summarySchema>;
type Assets = z.infer<typeof assetsSchema>;
const detailHref = (assetId: string, tenantQuery: string, correlationId?: string) => `/attack-surface/assets?${tenantQuery ? `${tenantQuery}&` : ''}assetId=${encodeURIComponent(assetId)}${correlationId ? `&correlationId=${encodeURIComponent(correlationId)}` : ''}#${correlationId ? 'asm-vulnerabilities' : 'asm-risk-posture'}`;

export function OperationsWorkspace() {
  const { role, tenantId, ready } = useAttackSurface();
  const tenantQuery = role === 'SUPER_ADMIN' ? `tenantId=${encodeURIComponent(tenantId)}` : '';
  const scope = `${role}:${tenantId}`;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [loadedScope, setLoadedScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [priority, setPriority] = useState('');
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { setPriority(''); setDraft(''); setQ(''); setCursors([null]); setPage(0); setSummary(null); setAssets(null); setLoadedScope(''); }, [scope]);
  useEffect(() => {
    if (!ready || process.env.NEXT_PUBLIC_ASM_V2_OPERATIONS_ENABLED !== 'true') return;
    const controller = new AbortController();
    setSummary(null); setAssets(null); setLoadedScope(''); setError(''); setDenied(false); setLoading(true);
    const params = new URLSearchParams(tenantQuery);
    params.set('limit', '10');
    if (priority) params.set('priority', priority);
    if (q) params.set('q', q);
    const cursor = cursors[page];
    if (cursor) params.set('cursor', cursor);
    void Promise.all([
      fetch(`${API}/attack-surface/v2/operations/summary${tenantQuery ? `?${tenantQuery}` : ''}`, { credentials: 'include', cache: 'no-store', signal: controller.signal }),
      fetch(`${API}/attack-surface/v2/operations/assets?${params}`, { credentials: 'include', cache: 'no-store', signal: controller.signal }),
    ]).then(async ([summaryResponse, assetsResponse]) => {
      if (summaryResponse.status === 403 || assetsResponse.status === 403) { if (!controller.signal.aborted) setDenied(true); return; }
      if (!summaryResponse.ok || !assetsResponse.ok) throw new Error('Could not load operational reporting.');
      const [nextSummary, nextAssets] = await Promise.all([summarySchema.parse(await summaryResponse.json()), assetsSchema.parse(await assetsResponse.json())]);
      if (!controller.signal.aborted && nextSummary.tenantId === nextAssets.tenantId) { setSummary(nextSummary); setAssets(nextAssets); setLoadedScope(scope); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load operational reporting.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ready, scope, tenantQuery, priority, q, page, cursors, refresh]);
  function filterPriority(value: string) { setPriority(value); setCursors([null]); setPage(0); }
  function search() { setQ(draft.trim()); setCursors([null]); setPage(0); }
  function next() { if (!assets?.nextCursor) return; setCursors(previous => [...previous.slice(0, page + 1), assets.nextCursor]); setPage(value => value + 1); }
  if (process.env.NEXT_PUBLIC_ASM_V2_OPERATIONS_ENABLED !== 'true') return <main className="asm-operations"><div className="asm-state" role="status"><strong>ASM operations unavailable</strong><span>Operational reporting is disabled.</span></div></main>;
  return <main className="asm-operations" aria-label="ASM V2 operations">
    <header className="asm-operations-head"><div><span className="source-eyebrow">ATTACK SURFACE / V2 OPERATIONS</span><h1>Reviewed exposure, in context.</h1><p>Track candidate review, current relevance and asset priority separately from V1 risk history.</p></div><button type="button" onClick={() => setRefresh(value => value + 1)} disabled={!ready || loading}>Refresh report</button></header>
    {!ready && <p role="status">Select a tenant to view operations.</p>}
    {loading && ready && <p role="status">Loading operational report...</p>}
    {denied && <p role="alert">Operational reporting is unavailable for this tenant or account.</p>}
    {error && <p className="error" role="alert">{error} <button type="button" onClick={() => setRefresh(value => value + 1)}>Retry</button></p>}
    {!loading && !error && !denied && loadedScope === scope && summary && assets && <>
      <p className="asm-discovery-context">Summary as of {new Date(summary.asOf).toLocaleString('id-ID')} · {summary.evaluatorVersion}. Asset list as of {new Date(assets.asOf).toLocaleString('id-ID')}.</p>
      <section className="asm-intelligence-section" aria-label="Operational summary"><div className="asm-section-heading"><span className="source-eyebrow">01 / SUMMARY</span><h2>Current workload</h2></div>
        <div className="asm-operations-grid">{[
          ['Awaiting review', summary.metrics.correlations.awaitingReview, `${summary.metrics.correlations.currentlyReviewable} active and reviewable`],
          ['Pending', summary.metrics.correlations.pending, 'Candidate matches'], ['Accepted', summary.metrics.correlations.accepted, 'Not all are actionable'],
          ['Rejected', summary.metrics.correlations.rejected, 'Excluded from priority'], ['Review required', summary.metrics.correlations.reviewRequired, 'Changed or challenged evidence'],
          ['Stale observations', summary.metrics.correlations.stale, 'Separate from review state'], ['Current actionable relevance', summary.metrics.actionableCorrelations, 'Accepted and current evidence'],
          ['HIGH / CRITICAL assets', summary.metrics.highPriorityAssets, 'From P1-C priority'], ['Not assessed assets', summary.metrics.notAssessedAssets, 'Unknown, separate from LOW'],
        ].map(([label, count, note]) => <div key={label}><span>{label}</span><strong>{count}</strong><small>{note}</small></div>)}</div>
        <p className="asm-discovery-context">{summary.metrics.correlations.total} distinct V2 correlations across {summary.metrics.totalAssets} assets. Review and observation counts overlap; do not add them together.</p>
      </section>
      <section className="asm-intelligence-section" aria-label="Review workload"><div className="asm-section-heading"><span className="source-eyebrow">02 / REVIEW</span><h2>Review workload</h2></div><p>Use the existing correlation queue to filter candidate evidence. Decisions require the narrow reviewer grant.</p><div className="asm-operations-links"><Link href="/attack-surface/review?review=PENDING">Pending queue</Link><Link href="/attack-surface/review?review=REVIEW_REQUIRED">Re-review queue</Link><Link href="/attack-surface/review?review=ACCEPTED">Accepted queue</Link><Link href="/attack-surface/review?review=REJECTED">Rejected queue</Link></div></section>
      <section className="asm-intelligence-section" aria-label="Prioritized assets"><div className="asm-section-heading"><span className="source-eyebrow">03 / ASSETS</span><h2>Asset priorities</h2></div>
        <form className="asm-operations-filters" onSubmit={event => { event.preventDefault(); search(); }}><label>Priority <select value={priority} onChange={event => filterPriority(event.target.value)}><option value="">All priorities</option><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option><option value="NOT_ASSESSED">Not assessed</option></select></label><label>Asset name or value <input value={draft} maxLength={80} onChange={event => setDraft(event.target.value)} /></label><button type="submit">Search assets</button></form>
        {assets.items.length === 0 ? <p>No assets match these filters.</p> : <div className="asm-port-scroll"><table className="asm-operations-table"><thead><tr><th>Asset</th><th>Criticality</th><th>V2 priority</th><th>Current evidence</th><th>Uncertainty</th></tr></thead><tbody>{assets.items.map(item => <tr key={item.assetId}>
          <td><span className="asm-operations-cell-label">Asset</span><Link href={detailHref(item.assetId, tenantQuery)}>{item.name}</Link><br /><small>{item.type} · {item.value}</small></td><td><span className="asm-operations-cell-label">Criticality</span>{item.criticality}</td><td><span className="asm-operations-cell-label">V2 priority</span><strong>{item.priority.replace('_', ' ')}</strong>{item.score !== null && <> · score {item.score}</>}</td>
          <td><span className="asm-operations-cell-label">Current evidence</span>{item.mainEvidence ? <><Link href={detailHref(item.assetId, tenantQuery, item.mainEvidence.correlationId)}>{item.mainEvidence.cveId}</Link><br /><small>Observed {new Date(item.mainEvidence.serviceObservedAt).toLocaleString('id-ID')}</small></> : 'No current accepted relevance'}</td>
          <td><span className="asm-operations-cell-label">Uncertainty</span>{item.missing.length ? item.missing.map(value => value.replaceAll('_', ' ').toLowerCase()).join(', ') : 'No marked gap'}{Object.keys(item.excluded).length > 0 && <><br /><small>Excluded: {Object.entries(item.excluded).map(([reason, count]) => `${reason.replaceAll('_', ' ').toLowerCase()} ${count}`).join(', ')}</small></>}</td>
        </tr>)}</tbody></table></div>}
        <div className="asm-operations-pager"><span>{assets.total} matching assets · page {page + 1}</span><button type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button><button type="button" disabled={!assets.nextCursor} onClick={next}>Next</button></div>
      </section>
      <section className="asm-intelligence-section" aria-label="Uncertainty and exceptions"><div className="asm-section-heading"><span className="source-eyebrow">04 / QUALITY</span><h2>Uncertainty and exceptions</h2></div>
        <dl className="asm-service-metrics"><div><dt>Fresh observations</dt><dd>{summary.metrics.correlations.fresh}</dd></div><div><dt>Expired observation age</dt><dd>{summary.metrics.correlations.expired}</dd></div><div><dt>Future timestamps</dt><dd>{summary.metrics.correlations.future}</dd></div><div><dt>Stale source exclusions</dt><dd>{summary.metrics.staleSourceExclusions}</dd></div><div><dt>Assets over evaluation limit</dt><dd>{summary.metrics.limitExceededAssets}</dd></div></dl>
        <p className="asm-discovery-context">Freshness uses a 30-day observation window. OPEN is an observed open service, not proven public reachability. Review confirms relevance, not exploitation. V1 Findings and Risk Posture remain separate.</p>
        <details><summary>Metric definitions and limitations</summary><dl>{Object.entries(summary.definitions).map(([name, definition]) => <div key={name}><dt>{name}</dt><dd>{definition}</dd></div>)}</dl><ul>{summary.limitations.map(item => <li key={item}>{item}</li>)}</ul></details>
      </section>
    </>}
  </main>;
}
