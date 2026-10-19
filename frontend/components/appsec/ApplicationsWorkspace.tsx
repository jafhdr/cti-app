'use client';

import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import { useAppSec } from './AppSecShell';
import { ApplicationForm } from './ApplicationForm';
import { appsecUrl, errorMessage, type Application, type ListResponse } from './types';

const criticalities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const statuses = ['ACTIVE', 'INACTIVE'] as const;

export function ApplicationsWorkspace() {
  const { role, tenantId, canManage } = useAppSec();
  const latest = useRef(0);
  const [items, setItems] = useState<readonly Application[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [criticality, setCriticality] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const limit = 10;
  const pages = Math.max(1, Math.ceil(total / limit));

  const load = useCallback(async () => {
    const requestId = ++latest.current;
    setLoading(true); setError('');
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    if (criticality) params.set('criticality', criticality);
    try {
      const response = await fetch(appsecUrl('/appsec/applications', role, tenantId, params), { credentials: 'include', cache: 'no-store' });
      const body: ListResponse<Application> & { readonly message?: string | readonly string[] } = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal memuat aplikasi.', response.status));
      if (requestId === latest.current) { setItems(body.items); setTotal(body.total); }
    } catch (cause) { if (requestId === latest.current) { setItems([]); setTotal(0); setError(cause instanceof Error ? cause.message : 'Gagal memuat aplikasi.'); } }
    finally { if (requestId === latest.current) setLoading(false); }
  }, [criticality, page, role, search, status, tenantId]);
  useEffect(() => { void load(); return () => { latest.current += 1; }; }, [load]);
  const visibleCritical = items.filter(item => item.criticality === 'CRITICAL').length;
  const visibleActive = items.filter(item => item.status === 'ACTIVE').length;
  return <main className="content editorial-module appsec-workspace appsec-applications-list">
    <header className="editorial-heading appsec-heading"><div><span className="source-eyebrow">APPSEC / APPLICATION INVENTORY</span><h1>Applications in focus.</h1><p>Keep ownership, criticality, and deployment links in one place.</p></div>{canManage && <Button size="l" onClick={() => setFormOpen(true)}><Plus size={16} aria-hidden="true" /> Create application</Button>}</header>
    <section className="editorial-metrics appsec-application-metrics" aria-label="Application summary"><div><span>Total applications</span><strong>{loading ? '—' : total}</strong></div><div><span>Active on this page</span><strong>{loading ? '—' : visibleActive}</strong></div><div><span>Critical on this page</span><strong>{loading ? '—' : visibleCritical}</strong></div><div><span>Current page</span><strong>{page}</strong></div></section>
    <div className="editorial-section-heading"><span className="source-eyebrow">DIRECTORY</span><h2>Application inventory</h2><p>Search and filter applications in the selected workspace.</p></div>
    {notice && <div className="success" role="status">{notice}</div>}
    <Card view="outlined" className="appsec-card"><div className="appsec-filters"><label><Search size={16} aria-hidden="true" /><input aria-label="Search applications" placeholder="Search name" value={search} onChange={event => { setPage(1); setSearch(event.target.value); }} /></label><select aria-label="Filter status" value={status} onChange={event => { setPage(1); setStatus(event.target.value); }}><option value="">All status</option>{statuses.map(value => <option key={value}>{value}</option>)}</select><select aria-label="Filter criticality" value={criticality} onChange={event => { setPage(1); setCriticality(event.target.value); }}><option value="">All criticality</option>{criticalities.map(value => <option key={value}>{value}</option>)}</select></div>
      {loading ? <div className="appsec-state" role="status">Loading applications...</div> : error ? <div className="appsec-state" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></div> : items.length === 0 ? <div className="appsec-state"><strong>No applications found</strong><span>{canManage ? 'Adjust the filters or create an application.' : 'Adjust the filters or contact an administrator.'}</span></div> : <Table data={items} columns={[{ id: 'name', name: 'Application', template: item => <Link className="source-name" href={`/appsec/applications/${item.id}`}>{item.name}</Link> }, { id: 'criticality', name: 'Criticality', template: item => <span className={`ioc-severity severity-${item.criticality.toLowerCase()}`}>{item.criticality}</span> }, { id: 'status', name: 'Status', template: item => <span className={`cti-status is-${item.status.toLowerCase()}`}>{item.status}</span> }, { id: 'owner', name: 'Owner', template: item => item.owner || '—' }, { id: 'assets', name: 'Linked assets', template: item => item.linkedAssetCount ?? '—' }, { id: 'updated', name: 'Updated', template: item => new Date(item.updatedAt).toLocaleDateString() }, { id: 'open', name: 'Action', template: item => <Link href={`/appsec/applications/${item.id}`}>Detail</Link> }]} />}
      <div className="appsec-pagination"><span>{total} applications · Page {page} of {pages}</span><div><Button view="outlined" size="s" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</Button><Button view="outlined" size="s" disabled={page >= pages || loading} onClick={() => setPage(value => value + 1)}>Next</Button></div></div>
    </Card>
    <ApplicationForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => { setNotice('Application created.'); setPage(1); void load(); }} />
  </main>;
}
