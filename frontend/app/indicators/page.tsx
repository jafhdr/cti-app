'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import { ConfirmationModal, FormModal } from '@/components/ui/modal-patterns';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '../../components/dashboard/Sidebar';
import type { ModuleAccess } from '../../lib/module-access';
import { IndicatorEnrichmentPanel } from '../../components/indicators/IndicatorEnrichmentPanel';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Indicator = {
  id: string; value: string; type: string; severity: string; confidence: number; status: string;
  tags: string[]; source: string | null; description: string | null; expiresAt: string | null;
  tenant: { id: string; name: string };
  intelligenceEntity: { id: string; name: string; type: string } | null;
};
type Tenant = { id: string; name: string };
type IntelligenceEntity = { id: string; name: string; type: string };
type CurrentUser = {
  role: Role;
  name: string;
  email: string;
  moduleAccess: ModuleAccess[];
};

const emptyForm = { value: '', type: 'DOMAIN', severity: 'MEDIUM', status: 'ACTIVE', confidence: '50', tags: '', source: '', description: '', expiresAt: '', tenantId: '', intelligenceEntityId: '' };

export default function IndicatorsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [items, setItems] = useState<Indicator[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [entities, setEntities] = useState<IntelligenceEntity[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Indicator | null>(null);
  const [selected, setSelected] = useState<Indicator | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState({ type: '', severity: '', status: 'ACTIVE' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState<Indicator | null>(null);
  const canManage = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'ADMIN';
  const canAccessCases = currentUser?.moduleAccess.some(module => module.accessible === true && module.moduleSlug === 'case-management' && module.featureKeys.includes('case-workflow')) === true;

  async function loadIndicators() {
    const params = new URLSearchParams({ limit: '100' });
    if (search.trim()) params.set('search', search.trim());
    Object.entries(filter).forEach(([key, value]) => value && params.set(key, value));
    const res = await fetch(`${API}/indicators?${params}`, { credentials: 'include', cache: 'no-store' });
    if (res.status === 401) return router.replace('/login');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Gagal memuat indicators.');
    setItems(data.items || []);
  }
  async function loadEntities(tenantId = '') {
    const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
    const response = await fetch(`${API}/intelligence/overview${query}`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) { setEntities([]); return; }
    const data: { entities?: IntelligenceEntity[] } = await response.json();
    setEntities(data.entities || []);
  }

  useEffect(() => {
    (async () => {
      try {
        const me = await fetch(`${API}/auth/me`, { credentials: 'include' });
        if (!me.ok) return router.replace('/login');
        const user: CurrentUser = await me.json();
        setCurrentUser(user);
        if (user.role === 'SUPER_ADMIN') {
          const tenantRes = await fetch(`${API}/users/tenants`, { credentials: 'include' });
          if (tenantRes.ok) setTenants(await tenantRes.json());
        } else await loadEntities();
        await loadIndicators();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Gagal memuat halaman.');
      } finally { setLoading(false); }
    })();
  }, []);

  async function logout() {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/login');
  }

  function setField(key: keyof typeof emptyForm, value: string) { setForm(current => ({ ...current, [key]: value })); }
  function openCreate() { setEditing(null); setForm(emptyForm); setShowForm(true); setError(''); setSuccess(''); }
  function openEdit(item: Indicator) {
    setEditing(item);
    setForm({ value: item.value, type: item.type, severity: item.severity, status: item.status, confidence: String(item.confidence), tags: item.tags.join(', '), source: item.source || '', description: item.description || '', expiresAt: item.expiresAt ? item.expiresAt.slice(0, 10) : '', tenantId: item.tenant.id, intelligenceEntityId: item.intelligenceEntity?.id || '' });
    loadEntities(item.tenant.id).catch(() => setEntities([]));
    setShowForm(true); setError(''); setSuccess('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving) return; setError('');
    if (currentUser?.role === 'SUPER_ADMIN' && !form.tenantId) return setError('Tenant wajib dipilih.');
    setSaving(true);
    try {
    const body = { ...form, confidence: Number(form.confidence), tags: form.tags.split(',').map(tag => tag.trim()).filter(Boolean), expiresAt: form.expiresAt || null };
    const res = await fetch(`${API}/indicators${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.message || 'Gagal menyimpan indicator.');
    setSuccess(editing ? 'Indicator berhasil diperbarui.' : 'Indicator berhasil ditambahkan.');
    setShowForm(false); await loadIndicators();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Gagal menyimpan indicator.'); }
    finally { setSaving(false); }
  }
  async function deactivate(item: Indicator) {
    if (saving) return;
    setSaving(true); setError('');
    try {
    const res = await fetch(`${API}/indicators/${item.id}/deactivate`, { method: 'PATCH', credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.message || 'Gagal menonaktifkan indicator.');
    setSuccess('Indicator dinonaktifkan.'); setDeactivating(null); await loadIndicators();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Gagal menonaktifkan indicator.'); }
    finally { setSaving(false); }
  }

  if (loading) {
    return (
      <div className="app">
        <aside className="sidebar"><div className="brand">CTI Platform</div></aside>
        <section className="main"><div className="content" style={{ paddingTop: 60, textAlign: 'center', color: 'var(--soc-muted)' }}>Memuat indicators…</div></section>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar role={currentUser?.role} moduleAccess={currentUser?.moduleAccess ?? []} onLogout={logout} />

      <section className="main">
        <header className="topbar">
          <div style={{ fontWeight: 600 }}>Threat Intelligence / Indicators</div>
          <span style={{ fontSize: 13, color: 'var(--soc-muted)' }}>{currentUser?.email} · <strong>{currentUser?.role}</strong></span>
        </header>

        <main className="content editorial-module">
          <nav className="ti-section-tabs" aria-label="Threat Intelligence"><Link href="/threat-intelligence">Overview</Link><Link href="/threat-intelligence/indicators">Indicators</Link><Link href="/threat-intelligence/hub">Intelligence Hub</Link></nav>
          <div className="ti-indicators-heading">
            <div>
              <span className="source-eyebrow">INDICATORS</span><h1>Track known malicious infrastructure.</h1>
              <p>Search, assess and enrich the indicators observed by your organization.</p>
            </div>
            {canManage && <Button view="action" size="l" onClick={openCreate}>+ Add Indicator</Button>}
          </div>

          <div className="editorial-section-heading"><span className="source-eyebrow">INTELLIGENCE SUMMARY</span><h2>Current results</h2></div>
          <section className="editorial-metrics" aria-label="Indicator summary"><div><span>Indicators shown</span><strong>{items.length}</strong></div><div><span>Critical</span><strong>{items.filter(item => item.severity === "CRITICAL").length}</strong></div><div><span>High</span><strong>{items.filter(item => item.severity === "HIGH").length}</strong></div><div><span>Active</span><strong>{items.filter(item => item.status === "ACTIVE").length}</strong></div></section>
          {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}
          {success && <div className="success" style={{ marginBottom: 16 }}>{success}</div>}

          {selected && <IndicatorEnrichmentPanel indicator={selected} canManage={canManage} canAccessCases={canAccessCases} onClose={() => setSelected(null)} />}

          <FormModal open={showForm} onOpenChange={setShowForm} title={editing ? 'Edit Indicator' : 'Add Indicator'} onSubmit={submit} loading={saving} error={showForm ? error : undefined} submitLabel="Save">
              <div className="ioc-form">
                <label>Value<input value={form.value} onChange={e => setField('value', e.target.value)} required placeholder="example.com / 1.2.3.4" /></label>
                <label>Type<select value={form.type} onChange={e => setField('type', e.target.value)}><option value="DOMAIN">Domain</option><option value="IP_ADDRESS">IP Address</option><option value="URL">URL</option><option value="FILE_HASH">File Hash</option><option value="EMAIL">Email</option></select></label>
                <label>Severity<select value={form.severity} onChange={e => setField('severity', e.target.value)}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select></label>
                <label>Status<select value={form.status} onChange={e => setField('status', e.target.value)}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="EXPIRED">Expired</option></select></label>
                <label>Confidence (0-100)<input type="number" min="0" max="100" value={form.confidence} onChange={e => setField('confidence', e.target.value)} required /></label>
                {currentUser?.role === 'SUPER_ADMIN' && <label>Tenant<select value={form.tenantId} onChange={e => { setField('tenantId', e.target.value); setField('intelligenceEntityId', ''); loadEntities(e.target.value).catch(() => setEntities([])); }} required><option value="">Pilih tenant</option>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>}
                <label>Entitas CTI<select value={form.intelligenceEntityId} onChange={e => setField('intelligenceEntityId', e.target.value)}><option value="">Tidak terkait</option>{entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name} ({entity.type})</option>)}</select></label>
                <label>Tags (pisahkan koma)<input value={form.tags} onChange={e => setField('tags', e.target.value)} placeholder="phishing, malware" /></label>
                <label>Source<input value={form.source} onChange={e => setField('source', e.target.value)} placeholder="MISP, analyst, feed" /></label>
                <label>Expires at<input type="date" value={form.expiresAt} onChange={e => setField('expiresAt', e.target.value)} /></label>
                <label className="ioc-wide">Description<textarea value={form.description} onChange={e => setField('description', e.target.value)} /></label>
              </div>
          </FormModal>
          <ConfirmationModal open={!!deactivating} onOpenChange={open => { if (!open) setDeactivating(null); }} title="Deactivate indicator" target={deactivating?.value} consequence="This indicator will become inactive." confirmLabel="Deactivate" destructive loading={saving} error={deactivating ? error : undefined} onConfirm={() => deactivating ? deactivate(deactivating) : undefined} />

          <div className="editorial-section-heading"><span className="source-eyebrow">SEARCH & FILTER</span><h2>Find an indicator</h2></div>
          <Card view="outlined" className="ti-inventory" style={{ padding: 24 }}>
            <div className="ioc-filters">
              <input aria-label="Search indicators" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search value, source, tag" />
              <select value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })}><option value="">All types</option><option value="DOMAIN">Domain</option><option value="IP_ADDRESS">IP</option><option value="URL">URL</option><option value="FILE_HASH">Hash</option><option value="EMAIL">Email</option></select>
              <select value={filter.severity} onChange={e => setFilter({ ...filter, severity: e.target.value })}><option value="">All severity</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select>
              <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}><option value="">All status</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="EXPIRED">Expired</option></select>
              <Button view="normal" onClick={() => loadIndicators()}>Apply</Button>
            </div>
            <div className="editorial-section-heading"><span className="source-eyebrow">INDICATOR INVENTORY</span><h2>Observed infrastructure</h2></div>
            <div className="ti-indicator-table"><Table
              data={items}
              columns={[
                { id: 'value', name: 'Indicator', template: (item: Indicator) => item.value },
                { id: 'type', name: 'Type', template: (item: Indicator) => item.type },
                { id: 'severity', name: 'Severity', template: (item: Indicator) => item.severity },
                { id: 'confidence', name: 'Confidence', template: (item: Indicator) => `${item.confidence}%` },
                { id: 'status', name: 'Status', template: (item: Indicator) => item.status },
                { id: 'tags', name: 'Tags', template: (item: Indicator) => item.tags.join(', ') || '-' },
                { id: 'tenant', name: 'Tenant', template: (item: Indicator) => item.tenant.name },
                { id: 'intelligenceEntity', name: 'Entitas CTI', template: (item: Indicator) => item.intelligenceEntity ? `${item.intelligenceEntity.name} (${item.intelligenceEntity.type})` : '-' },
                { id: 'actions', name: 'Actions', template: (item: Indicator) => <div className="ioc-actions"><Button view="flat" size="s" onClick={() => setSelected(item)}>Detail</Button>{canManage && <><Button view="flat" size="s" onClick={() => openEdit(item)}>Edit</Button>{item.status === 'ACTIVE' && <Button view="flat-danger" size="s" onClick={() => { setError(''); setDeactivating(item); }}>Deactivate</Button>}</>}</div> },
              ]}
            /></div>
          </Card>
        </main>
      </section>
    </div>
  );
}
