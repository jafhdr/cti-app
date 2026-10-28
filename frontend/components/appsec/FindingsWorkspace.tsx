'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import { useAppSec } from './AppSecShell';
import { FindingForm } from './FindingForm';
import { appsecUrl, errorMessage, findingSeverities, findingStatuses, type Finding, type ListResponse } from './types';

type Option = { readonly id: string; readonly name: string };
export function FindingsWorkspace() {
  const { role, tenantId, canManage, canViewApplications } = useAppSec();
  const latest = useRef(0);
  const [items, setItems] = useState<readonly Finding[]>([]);
  const [options, setOptions] = useState<readonly Option[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const limit = 10;
  const pages = Math.max(1, Math.ceil(total / limit));
  useEffect(() => {
    let cancelled = false;
    async function loadOptions(): Promise<void> {
      try {
        const response = await fetch(appsecUrl('/appsec/findings/applications', role, tenantId), { credentials: 'include', cache: 'no-store' });
        if (!response.ok) return;
        const body: readonly Option[] = await response.json();
        if (!cancelled) setOptions(body);
      } catch (cause) { if (!(cause instanceof Error)) throw cause; }
    }
    void loadOptions(); return () => { cancelled = true; };
  }, [role, tenantId]);
  const load = useCallback(async () => {
    const requestId = ++latest.current;
    setLoading(true); setError('');
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search.trim()) params.set('search', search.trim());
    if (applicationId) params.set('applicationId', applicationId);
    if (severity) params.set('severity', severity);
    if (status) params.set('status', status);
    try {
      const response = await fetch(appsecUrl('/appsec/findings', role, tenantId, params), { credentials: 'include', cache: 'no-store' });
      const body: ListResponse<Finding> & { readonly message?: string | readonly string[] } = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal memuat Findings.', response.status));
      if (requestId === latest.current) { setItems(body.items); setTotal(body.total); }
    } catch (cause) { if (requestId === latest.current) { setItems([]); setTotal(0); setError(cause instanceof Error ? cause.message : 'Gagal memuat Findings.'); } }
    finally { if (requestId === latest.current) setLoading(false); }
  }, [applicationId, page, role, search, severity, status, tenantId]);
  useEffect(() => { void load(); return () => { latest.current += 1; }; }, [load]);
  return <main className="content editorial-module appsec-workspace appsec-findings-list"><Link className="appsec-back" href="/appsec">← Overview</Link><header className="editorial-heading appsec-heading"><div><span className="source-eyebrow">APPSEC / MANUAL FINDINGS</span><h1>Finding in focus</h1><p>Track remediation and lifecycle decisions for tenant applications.</p></div>{canManage && <Button onClick={() => setFormOpen(true)}>Create finding</Button>}</header>
    <p><Link href="/appsec/findings/operations">View operational report →</Link></p>
    <section className="editorial-metrics appsec-finding-metrics" aria-label="Finding summary"><div><span>Total findings</span><strong>{loading ? '—' : total}</strong></div><div><span>Visible on page</span><strong>{loading ? '—' : items.length}</strong></div><div><span>Current page</span><strong>{page}</strong></div></section>
    {notice && <div className="success" role="status">{notice}</div>}
    <Card view="outlined" className="appsec-card"><div className="appsec-filters"><label><input aria-label="Search findings" placeholder="Search title" value={search} onChange={event => { setPage(1); setSearch(event.target.value); }} /></label><select aria-label="Filter application" value={applicationId} onChange={event => { setPage(1); setApplicationId(event.target.value); }}><option value="">All applications</option>{options.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Filter severity" value={severity} onChange={event => { setPage(1); setSeverity(event.target.value); }}><option value="">All severity</option>{findingSeverities.map(value => <option key={value}>{value}</option>)}</select><select aria-label="Filter status" value={status} onChange={event => { setPage(1); setStatus(event.target.value); }}><option value="">All status</option>{findingStatuses.map(value => <option key={value}>{value}</option>)}</select></div>
      {loading ? <div className="appsec-state" role="status">Loading findings...</div> : error ? <div className="appsec-state" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></div> : items.length === 0 ? <div className="appsec-state"><strong>No findings found</strong><span>Adjust filters or record a manual finding.</span></div> : <Table data={items} columns={[{ id: 'title', name: 'Finding', template: item => <Link className="source-name" href={`/appsec/findings/${item.id}`}>{item.title}</Link> }, { id: 'application', name: 'Application', template: item => canViewApplications ? <Link href={`/appsec/applications/${item.applicationId}`}>{item.application?.name ?? '—'}</Link> : item.application?.name ?? '—' }, { id: 'severity', name: 'Severity', template: item => <span className={`ioc-severity severity-${item.severity.toLowerCase()}`}>{item.severity}</span> }, { id: 'priority', name: 'Priority', template: item => item.priority ?? '?' }, { id: 'owner', name: 'Owner', template: item => item.assigneeId ?? 'Unassigned' }, { id: 'status', name: 'Status', template: item => <span className="cti-status">{item.status.replaceAll('_', ' ')}</span> }, { id: 'source', name: 'Source', template: item => item.source }, { id: 'category', name: 'Category / CWE', template: item => [item.category, item.cweId].filter(Boolean).join(' / ') || '—' }, { id: 'due', name: 'Due', template: item => item.dueDate ? new Date(item.dueDate).toLocaleDateString() : '—' }, { id: 'updated', name: 'Updated', template: item => new Date(item.updatedAt).toLocaleDateString() }]} />}
      <div className="appsec-pagination"><span>{total} findings · Page {page} of {pages}</span><div><Button view="outlined" size="s" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</Button><Button view="outlined" size="s" disabled={page >= pages || loading} onClick={() => setPage(value => value + 1)}>Next</Button></div></div>
    </Card>
    <FindingForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => { setNotice('Finding created.'); setPage(1); void load(); }} />
  </main>;
}
