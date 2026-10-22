'use client';

import { FormEvent, useRef, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Item = { readonly id: string; readonly title: string; readonly subtitle: string; readonly route: string };
type Group = { readonly source: string; readonly items: readonly Item[]; readonly hasMore: boolean };
type SearchResult = { readonly groups: readonly Group[]; readonly partialFailures: readonly string[] };
const labels: Record<string, string> = { INDICATOR: 'Indicators', ASSET: 'ASM Assets', CASE: 'Cases', APPLICATION: 'AppSec Applications', APPSEC_FINDING: 'AppSec Findings' };

export function DashboardSearch({ role, tenantId }: { readonly role: Role; readonly tenantId: string }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const ready = role !== 'SUPER_ADMIN' || Boolean(tenantId);

  async function run(event?: FormEvent) {
    event?.preventDefault();
    const q = query.trim();
    if (!ready) return;
    if (q.length < 2 || q.length > 120) { setResult(null); setError('Masukkan 2–120 karakter.'); return; }
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setLoading(true); setError(''); setResult(null);
    const params = new URLSearchParams({ q });
    if (role === 'SUPER_ADMIN') params.set('tenantId', tenantId);
    try {
      const response = await fetch(`${API}/dashboard/search?${params}`, { credentials: 'include', cache: 'no-store', signal: request.signal });
      if (!response.ok) throw new Error('Pencarian tidak tersedia. Coba lagi.');
      const data: SearchResult = await response.json();
      if (!request.signal.aborted) setResult(data);
    } catch (cause) { if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : 'Pencarian gagal.'); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }

  const count = result?.groups.reduce((total, group) => total + group.items.length, 0) ?? 0;
  return <section className="dashboard-search" aria-label="Cari di workspace">
    <form className="dashboard-search-form" onSubmit={event => void run(event)}>
      <label className="sr-only" htmlFor="dashboard-search-input">Cari indikator, aset, case, aplikasi, atau finding</label>
      <input id="dashboard-search-input" type="search" value={query} maxLength={120} disabled={!ready} placeholder={ready ? 'Search indicators, assets, cases...' : 'Pilih tenant untuk mencari'} onChange={event => { setQuery(event.target.value); setResult(null); setError(''); controller.current?.abort(); setLoading(false); }} />
      <button type="submit" disabled={!ready || loading} aria-label="Search" title="Search"><Search size={19} aria-hidden="true" /></button>
    </form>
    {!ready && <p className="dashboard-discovery-note">Pilih tenant untuk menggunakan pencarian.</p>}
    {loading && <p className="dashboard-discovery-note" role="status">Mencari...</p>}
    {error && <div className="dashboard-discovery-message" role="alert">{error} <button type="button" onClick={() => void run()}>Coba lagi</button></div>}
    {result && <div className="dashboard-search-results" aria-live="polite">
      {count === 0 && result.partialFailures.length === 0 && <p>Tidak ada hasil.</p>}
      {result.groups.filter(group => group.items.length > 0).map(group => <section key={group.source} aria-label={labels[group.source] ?? group.source}>
        <h3>{labels[group.source] ?? group.source}</h3>
        <ul>{group.items.map(item => <li key={item.id}><Link href={item.route}><strong>{item.title}</strong><small>{item.subtitle}</small></Link></li>)}</ul>
        {group.hasMore && <small>Hasil lain tersedia di modul terkait.</small>}
      </section>)}
      {result.partialFailures.length > 0 && <div className="dashboard-discovery-message" role="status">Sebagian sumber belum tersedia: {result.partialFailures.map(source => labels[source] ?? source).join(', ')}. <button type="button" onClick={() => void run()}>Coba lagi</button></div>}
    </div>}
  </section>;
}
