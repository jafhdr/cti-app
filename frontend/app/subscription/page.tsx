'use client';

import { Check, CreditCard, Info, LogOut, ShieldCheck } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/dashboard/Sidebar';
import type { ModuleAccess } from '../../lib/module-access';
import { isCatalogOnlyFeature, isCatalogOnlyModule } from '../../lib/feature-catalog';
import { ConfirmationModal } from '@/components/ui/modal-patterns';
import './subscription-visual.css';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Feature = { readonly id: string; readonly key: string; readonly name: string };
type Module = { readonly id: string; readonly slug: string; readonly name: string; readonly description: string; readonly features: readonly Feature[] };
type PackageModule = { readonly moduleId: string; readonly modulePriceMonthly: number | null; readonly modulePriceYearly: number | null; readonly module: Module };
type Package = { readonly id: string; readonly name: string; readonly description: string | null; readonly type: 'PREDEFINED' | 'CUSTOM'; readonly priceMonthly: number; readonly priceYearly: number | null; readonly modules: readonly PackageModule[] };
type Subscription = { readonly id: string; readonly isCustom: boolean; readonly billingCycle: 'MONTHLY' | 'YEARLY'; readonly priceMonthly: number; readonly priceYearly: number | null; readonly status: string; readonly subscribedAt: string; readonly renewalAt: string; readonly package: Package | null; readonly subscriptionActive: boolean; readonly includedModules: readonly { readonly id: string; readonly name: string; readonly subscriptionIncluded: boolean }[]; readonly customModules: ReadonlyArray<{ readonly module: Module }> };
type Tenant = { readonly id: string; readonly name: string };
type CurrentUser = { readonly moduleAccess: readonly ModuleAccess[]; readonly role: Role; readonly email: string; readonly name?: string; readonly tenant: { readonly id: string; readonly name: string } | null };

const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

export default function SubscriptionPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [tab, setTab] = useState<'packages' | 'custom'>('packages');
  const [cycle, setCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [pendingSubscription, setPendingSubscription] = useState<{ body: object; busyKey: string } | null>(null);

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`${API}${path}`, { credentials: 'include', cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
    if (response.status === 401) { router.replace('/login'); return null; }
    if (response.status === 403) { router.replace('/dashboard'); return null; }
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof data === 'object' && data !== null && 'message' in data ? String(data.message) : 'Permintaan subscription gagal.');
    return data;
  }

  async function loadSubscription(role: Role, selectedTenantId: string) {
    const query = role === 'SUPER_ADMIN' ? `?tenantId=${encodeURIComponent(selectedTenantId)}` : '';
    setSubscription(null);
    setLoading(true);
    try { setSubscription(await request(`/subscription/my${query}`) as Subscription | null); } finally { setLoading(false); }
  }

  useEffect(() => { void (async () => {
    try {
      const me = await request('/auth/me') as CurrentUser | null;
      if (!me) return;
      if (me.role === 'USER') { router.replace('/dashboard'); return; }
      setUser(me);
      const packageData = await request('/subscription/packages');
      setPackages(Array.isArray(packageData) ? packageData as Package[] : []);
      if (me.role === 'SUPER_ADMIN') {
        const tenantData = await request('/users/tenants');
        const list = Array.isArray(tenantData) ? tenantData as Tenant[] : [];
        setTenants(list);
        const firstTenant = list[0]?.id ?? '';
        setTenantId(firstTenant);
        if (firstTenant) await loadSubscription(me.role, firstTenant);
      } else await loadSubscription(me.role, '');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Data subscription gagal dimuat.'); } finally { setLoading(false); }
  })(); }, [router]);

  const predefined = packages.filter((item) => item.type === 'PREDEFINED');
  const custom = packages.find((item) => item.type === 'CUSTOM');
  const selectedEntries = custom?.modules.filter((entry) => selectedModules.includes(entry.moduleId)) ?? [];
  const customPriceUnavailable = cycle === 'YEARLY' && selectedEntries.some(entry => entry.modulePriceYearly === null);
  const customTotal = useMemo(() => selectedEntries.reduce((sum, entry) => sum + (cycle === 'YEARLY' ? entry.modulePriceYearly ?? 0 : entry.modulePriceMonthly ?? 0), 0), [cycle, selectedEntries]);

  function subscribe(body: object, busyKey: string) {
    if (subscription) { setPendingSubscription({ body, busyKey }); return; }
    void commitSubscription(body, busyKey);
  }
  async function commitSubscription(body: object, busyKey: string) {
    setBusy(busyKey); setMessage('');
    try {
      const payload = { ...body, billingCycle: cycle, ...(user?.role === 'SUPER_ADMIN' ? { tenantId } : {}) };
      await request('/subscription', { method: 'POST', body: JSON.stringify(payload) });
      if (user) await loadSubscription(user.role, tenantId);
      setUser(await request('/auth/me') as CurrentUser | null);
      setMessage('Subscription berhasil diperbarui.'); setPendingSubscription(null);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Subscription gagal diperbarui.'); }
    finally { setBusy(''); }
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = tab === 'packages' ? 'custom' : 'packages';
    setTab(next);
    document.getElementById(`subscription-tab-${next}`)?.focus();
  }

  async function logout() { await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' }); router.replace('/login'); }

  return <div className="app subscription-shell"><Sidebar role={user?.role} moduleAccess={user?.moduleAccess} dashboardPresentation onLogout={logout} /><section className="main"><header className="topbar subscription-topbar"><div className="subscription-profile"><span className="subscription-avatar" aria-hidden="true">{(user?.name ?? user?.email ?? '').split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}</span><span><strong>{user?.name ?? user?.email}</strong><small>{user?.role?.replaceAll('_', ' ')}</small></span><button type="button" onClick={() => void logout()} aria-label="Keluar dari Subscription"><LogOut size={20} aria-hidden="true" /></button></div></header><main className="content subscription-page editorial-module">
    <div className="subscription-heading"><div><span className="source-eyebrow">SUBSCRIPTION</span><h1>Subscription</h1><p>Manage your organization&apos;s plan, access, and platform capabilities.</p></div></div>
    {user?.role === 'SUPER_ADMIN' && <label className="subscription-tenant"><span>Kelola tenant</span><select value={tenantId} onChange={(event) => { setTenantId(event.target.value); void loadSubscription('SUPER_ADMIN', event.target.value).catch(cause => setMessage(cause instanceof Error ? cause.message : 'Gagal memuat subscription.')); }}>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>}
    <section className="subscription-usage" aria-label="Usage and entitlements"><div><span>Available modules</span><strong>{subscription ? subscription.includedModules.filter(module => module.subscriptionIncluded && subscription.subscriptionActive).length : 'Not available'}</strong></div><div><span>Active modules</span><strong>Not available</strong></div><div><span>Users</span><strong>Not available</strong></div></section>
    <section className="subscription-section subscription-current"><div className="editorial-section-heading"><span className="source-eyebrow">CURRENT PLAN</span><h2>Organization subscription</h2></div><section className="current-subscription subscription-overview" aria-label="Subscription saat ini"><div className="subscription-status-icon"><ShieldCheck size={22} /></div><div className="subscription-overview-body"><span>Subscribed plan</span><h2>{subscription ? subscription.isCustom ? 'Custom Subscription' : subscription.package?.name ?? 'Not available' : loading ? 'Memuat subscription…' : 'Belum berlangganan'}</h2><span className={`subscription-state${subscription?.subscriptionActive ? ' is-active' : ''}`}>{subscription?.status ?? 'Not available'}</span><dl><div><dt>Organization</dt><dd>{user?.role === 'SUPER_ADMIN' ? tenants.find(tenant => tenant.id === tenantId)?.name ?? 'Not available' : user?.tenant?.name ?? 'Not available'}</dd></div><div><dt>Billing period</dt><dd>{subscription ? subscription.billingCycle === 'YEARLY' ? 'Yearly' : 'Monthly' : 'Not available'}</dd></div><div><dt>Start</dt><dd>{subscription?.subscribedAt ? new Date(subscription.subscribedAt).toLocaleDateString('id-ID') : 'Not available'}</dd></div><div><dt>Renewal / expiration</dt><dd>{subscription?.renewalAt ? new Date(subscription.renewalAt).toLocaleDateString('id-ID') : 'Not available'}</dd></div></dl></div></section></section>
    {subscription && <section className="subscription-section subscription-platform"><div className="editorial-section-heading"><span className="source-eyebrow">PLATFORM ACCESS</span><h2>Platform capabilities</h2></div><section className="module-access-card subscription-capabilities" aria-label="Platform capabilities"><p className="subscription-info"><Info size={16} aria-hidden="true" />Availability comes from the organization entitlement. User assignment and effective access are evaluated separately by the backend.</p>{!subscription.subscriptionActive && <p className="error">Subscription tidak aktif atau telah kedaluwarsa; entitlement tidak dapat digunakan.</p>}<ul>{subscription.includedModules?.map(module => <li key={module.id}><strong>{module.name}</strong><span className={module.subscriptionIncluded && subscription.subscriptionActive ? 'available' : 'unavailable'}>{module.subscriptionIncluded && subscription.subscriptionActive ? 'Available' : 'Unavailable'}</span></li>)}</ul></section></section>}
    <ConfirmationModal open={Boolean(pendingSubscription)} onOpenChange={open => { if (!open) setPendingSubscription(null); }} title="Ganti subscription tenant" consequence="Modul di luar paket baru akan kehilangan akses efektif." confirmLabel="Ganti subscription" destructive loading={Boolean(busy)} error={pendingSubscription && message && !message.includes('berhasil') ? message : ''} onConfirm={() => { if (pendingSubscription) return commitSubscription(pendingSubscription.body, pendingSubscription.busyKey); }} />
    {message && <div className={message.includes('berhasil') ? 'success subscription-message' : 'error subscription-message'} role="status">{message}</div>}
    <section className="subscription-section subscription-plans"><div className="editorial-section-heading"><span className="source-eyebrow">PLANS</span><h2>Available plans</h2></div><div className="subscription-plan-toolbar"><label className="billing-cycle"><span>Billing period</span><select value={cycle} onChange={(event) => setCycle(event.target.value as 'MONTHLY' | 'YEARLY')}><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option></select></label><div className="subscription-tabs" role="tablist" aria-label="Jenis paket"><button id="subscription-tab-packages" role="tab" aria-selected={tab === 'packages'} aria-controls="subscription-panel-packages" tabIndex={tab === 'packages' ? 0 : -1} className={tab === 'packages' ? 'active' : ''} onKeyDown={handleTabKey} onClick={() => setTab('packages')}>Subscription Packages</button><button id="subscription-tab-custom" role="tab" aria-selected={tab === 'custom'} aria-controls="subscription-panel-custom" tabIndex={tab === 'custom' ? 0 : -1} className={tab === 'custom' ? 'active' : ''} onKeyDown={handleTabKey} onClick={() => setTab('custom')}>Custom Packages</button></div></div>
    {tab === 'packages' ? <section id="subscription-panel-packages" role="tabpanel" aria-labelledby="subscription-tab-packages" className="package-grid">{predefined.map((item) => <article className="package-card" key={item.id}><div><span className="package-kicker">PREDEFINED</span><h2>{item.name}</h2><p>{item.description}</p></div><div className="package-price"><strong>{cycle === 'YEARLY' && item.priceYearly === null ? 'Not available' : rupiah.format(cycle === 'YEARLY' ? item.priceYearly ?? 0 : item.priceMonthly)}</strong><span>/{cycle === 'YEARLY' ? 'year' : 'month'}</span></div><ul>{item.modules.map((entry) => <li key={entry.moduleId}><Check size={15} /> <span><strong>{entry.module.name}{isCatalogOnlyModule(entry.module.slug) ? ' (Catalog only)' : ''}</strong><small>{entry.module.features.map((feature) => `${feature.name}${isCatalogOnlyFeature(entry.module.slug, feature.key) ? ' (Catalog only)' : ''}`).join(' · ')}</small></span></li>)}</ul><button className="subscription-primary" disabled={loading || Boolean(busy) || (cycle === 'YEARLY' && item.priceYearly === null) || (user?.role === 'SUPER_ADMIN' && !tenantId)} onClick={() => void subscribe({ packageId: item.id, isCustom: false }, item.id)}>{busy === item.id ? 'Memproses…' : 'Choose Plan'}</button></article>)}</section> : <section id="subscription-panel-custom" role="tabpanel" aria-labelledby="subscription-tab-custom" className="custom-builder"><div className="custom-modules"><h2>Pilih modul</h2><p>Kombinasikan modul sesuai kebutuhan operasi keamanan Anda.</p>{custom?.modules.map((entry) => <label className={`custom-module${selectedModules.includes(entry.moduleId) ? ' selected' : ''}`} key={entry.moduleId}><input type="checkbox" checked={selectedModules.includes(entry.moduleId)} disabled={isCatalogOnlyModule(entry.module.slug) && !selectedModules.includes(entry.moduleId)} onChange={() => setSelectedModules((current) => current.includes(entry.moduleId) ? current.filter((id) => id !== entry.moduleId) : [...current, entry.moduleId])} /><span><strong>{entry.module.name}{isCatalogOnlyModule(entry.module.slug) ? ' (Catalog only)' : ''}</strong><small>{entry.module.description}</small><em>{cycle === 'YEARLY' && entry.modulePriceYearly === null ? 'Not available' : rupiah.format(cycle === 'YEARLY' ? entry.modulePriceYearly ?? 0 : entry.modulePriceMonthly ?? 0)}/{cycle === 'YEARLY' ? 'year' : 'month'}</em></span></label>)}</div><aside className="price-breakdown"><CreditCard size={22} /><h2>Rincian harga</h2>{selectedEntries.length ? selectedEntries.map((entry) => <div key={entry.moduleId}><span>{entry.module.name}</span><strong>{cycle === 'YEARLY' && entry.modulePriceYearly === null ? 'Not available' : rupiah.format(cycle === 'YEARLY' ? entry.modulePriceYearly ?? 0 : entry.modulePriceMonthly ?? 0)}</strong></div>) : <p>Belum ada modul dipilih.</p>}<div className="price-total"><span>Total</span><strong>{customPriceUnavailable ? 'Not available' : rupiah.format(customTotal)}</strong></div><button className="subscription-primary" disabled={loading || !selectedModules.length || customPriceUnavailable || Boolean(busy) || (user?.role === 'SUPER_ADMIN' && !tenantId)} onClick={() => void subscribe({ isCustom: true, moduleIds: selectedModules }, 'custom')}>{busy === 'custom' ? 'Memproses…' : 'Aktifkan Subscription'}</button></aside></section>}</section>
  </main></section></div>;
}
