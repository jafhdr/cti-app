'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAppSec } from './AppSecShell';
import { appsecUrl, errorMessage, type Asset, type Finding, type ListResponse } from './types';

type Vulnerability = { readonly id: string; readonly cveId: string; readonly name: string; readonly severity: string; readonly cvssScore: number | null; readonly description: string | null };
type IntegrationKey = 'ti' | 'asm' | 'case';
type LoadState = 'loading' | 'ready' | 'error';
type IntegrationStates = Record<IntegrationKey, LoadState>;
type CaseSummary = { readonly id: string; readonly caseNumber: string; readonly title: string; readonly status: string };

export function FindingIntegrations({ finding }: { readonly finding: Finding }) {
  const { role, tenantId, canManage, canViewTi, canViewAssets, canViewCase } = useAppSec();
  const [vulnerability, setVulnerability] = useState<Vulnerability | null>(null);
  const [options, setOptions] = useState<readonly Vulnerability[]>([]);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [assets, setAssets] = useState<readonly Asset[]>([]);
  const [linkedCase, setLinkedCase] = useState<CaseSummary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [states, setStates] = useState<IntegrationStates>({ ti: 'loading', asm: 'loading', case: 'loading' });
  const path = `/appsec/findings/${finding.id}`;
  const request = useCallback(async <T,>(suffix: string, init?: RequestInit, params?: URLSearchParams): Promise<T> => {
    const response = await fetch(appsecUrl(`${path}${suffix}`, role, tenantId, params), { credentials: 'include', cache: 'no-store', ...init });
    const raw = await response.text();
    const body: T & { readonly message?: string | readonly string[] } = raw ? JSON.parse(raw) : null;
    if (!response.ok) throw new Error(errorMessage(body ?? {}, 'Gagal memuat konteks integrasi.', response.status));
    return body;
  }, [path, role, tenantId]);
  useEffect(() => {
    let active = true;
    setVulnerability(null); setOptions([]); setAssets([]); setLinkedCase(null); setError(''); setSelected(''); setSearch('');
    setStates({ ti: 'loading', asm: 'loading', case: 'loading' });
    const load = (key: IntegrationKey, job: Promise<void>) => {
      void job.then(() => { if (active) setStates(current => ({ ...current, [key]: 'ready' })); })
        .catch(cause => { if (active) { setStates(current => ({ ...current, [key]: 'error' })); setError(cause instanceof Error ? cause.message : 'Gagal memuat konteks integrasi.'); } });
    };
    if (canViewTi) load('ti', Promise.all([
      request<Vulnerability | null>('/vulnerability').then(value => { if (active) setVulnerability(value); }),
      ...(canManage ? [request<ListResponse<Vulnerability>>('/vulnerabilities/available').then(value => { if (active) setOptions(value.items); })] : []),
    ]).then(() => undefined));
    if (canViewAssets) load('asm', request<readonly Asset[]>('/exposure').then(value => { if (active) setAssets(value); }));
    if (canViewCase) load('case', request<CaseSummary | null>('/case').then(value => { if (active) setLinkedCase(value); }));
    return () => { active = false; };
  }, [request, canViewTi, canViewAssets, canViewCase, canManage]);
  async function searchVulnerabilities() {
    setBusy(true); setError(''); setSelected('');
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      const result = await request<ListResponse<Vulnerability>>('/vulnerabilities/available', undefined, params);
      setOptions(result.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Gagal mencari Vulnerability.'); }
    finally { setBusy(false); }
  }
  async function changeVulnerability(method: 'POST' | 'DELETE') {
    setBusy(true); setError('');
    try {
      await request('/vulnerability', { method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vulnerabilityId: selected }) } : {}) });
      setVulnerability(await request<Vulnerability | null>('/vulnerability')); setSelected('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Gagal mengubah Vulnerability.'); }
    finally { setBusy(false); }
  }
  async function createCase() {
    setBusy(true); setError('');
    try { setLinkedCase(await request<CaseSummary>('/case', { method: 'POST' })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Gagal membuat Case.'); }
    finally { setBusy(false); }
  }
  return <div className="appsec-integrations">
    {error && <p role="alert">{error}</p>}
    {canViewTi && <section className="appsec-assets"><div className="appsec-section-head"><div><span className="source-eyebrow">THREAT INTELLIGENCE</span><h2>Threat / Vulnerability Context</h2></div></div>
      {states.ti === 'loading' ? <p role="status">Loading vulnerability context...</p> : states.ti === 'error' ? <p>Vulnerability context unavailable.</p> : vulnerability ? <><dl className="appsec-remediation"><div><dt>CVE</dt><dd>{vulnerability.cveId}</dd></div><div><dt>Name</dt><dd>{vulnerability.name}</dd></div><div><dt>Severity / CVSS</dt><dd>{vulnerability.severity}{vulnerability.cvssScore === null ? '' : ` / ${vulnerability.cvssScore}`}</dd></div><div><dt>Description</dt><dd>{vulnerability.description || '—'}</dd></div></dl>{canManage && <Button view="outlined" disabled={busy} onClick={() => void changeVulnerability('DELETE')}>Unlink vulnerability</Button>}</> : <><p>No linked vulnerability.</p>{canManage && <div className="appsec-transition"><label>Search CVE<input aria-label="Search CVE" value={search} onChange={event => setSearch(event.target.value)} /></label><Button view="outlined" disabled={busy} onClick={() => void searchVulnerabilities()}>Search CVE</Button><label>Vulnerability<select aria-label="Vulnerability" value={selected} onChange={event => setSelected(event.target.value)}><option value="">Select existing CVE</option>{options.map(item => <option value={item.id} key={item.id}>{item.cveId} — {item.name}</option>)}</select></label><Button disabled={!selected || busy} onClick={() => void changeVulnerability('POST')}>Link vulnerability</Button></div>}</>}
    </section>}
    {canViewAssets && <section className="appsec-assets"><div className="appsec-section-head"><div><span className="source-eyebrow">ATTACK SURFACE</span><h2>Application Exposure</h2></div></div>{states.asm === 'loading' ? <p role="status">Loading application exposure...</p> : states.asm === 'error' ? <p>Application exposure unavailable.</p> : assets.length ? <div className="appsec-asset-list">{assets.map(asset => <article key={asset.id}><div><strong>{asset.name || asset.value}</strong><code>{asset.value}</code></div><span className="appsec-asset-badges"><span>{asset.type}</span><span>{asset.status}</span><span>{asset.criticality}</span></span></article>)}</div> : <p>No linked ASM assets.</p>}</section>}
    {canViewCase && <section className="appsec-assets"><div className="appsec-section-head"><div><span className="source-eyebrow">INVESTIGATION</span><h2>Investigation Case</h2></div></div>{states.case === 'loading' ? <p role="status">Loading investigation case...</p> : states.case === 'error' ? <p>Investigation case unavailable.</p> : linkedCase ? <p><Link href={`/cases/${linkedCase.id}`}>Open Case: {linkedCase.caseNumber}</Link> · {linkedCase.status}</p> : canManage ? <Button disabled={busy} onClick={() => void createCase()}>Create Case</Button> : <p>No linked Case.</p>}</section>}
  </div>;
}
