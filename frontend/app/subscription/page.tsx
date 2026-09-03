'use client';

import { Check, CreditCard, ShieldCheck } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/dashboard/Sidebar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Feature = { readonly id: string; readonly key: string; readonly name: string };
type Module = { readonly id: string; readonly slug: string; readonly name: string; readonly description: string; readonly features: readonly Feature[] };
type PackageModule = { readonly moduleId: string; readonly modulePriceMonthly: number | null; readonly modulePriceYearly: number | null; readonly module: Module };
type Package = { readonly id: string; readonly name: string; readonly description: string | null; readonly type: 'PREDEFINED' | 'CUSTOM'; readonly priceMonthly: number; readonly priceYearly: number | null; readonly modules: readonly PackageModule[] };
type Subscription = { readonly id: string; readonly isCustom: boolean; readonly billingCycle: 'MONTHLY' | 'YEARLY'; readonly priceMonthly: number; readonly priceYearly: number | null; readonly status: string; readonly renewalAt: string; readonly package: Package | null; readonly customModules: ReadonlyArray<{ readonly module: Module }> };
type Tenant = { readonly id: string; readonly name: string };
type CurrentUser = { readonly role: Role; readonly email: string };

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
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`${API}${path}`, { credentials: 'include', cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
    if (response.status === 401) { router.replace('/'); return null; }
    if (response.status === 403) { router.replace('/dashboard'); return null; }
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof data === 'object' && data !== null && 'message' in data ? String(data.message) : 'Permintaan subscription gagal.');
    return data;
  }

  async function loadSubscription(role: Role, selectedTenantId: string) {
    const query = role === 'SUPER_ADMIN' ? `?tenantId=${encodeURIComponent(selectedTenantId)}` : '';
    setSubscription(await request(`/subscription/my${query}`) as Subscription | null);
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
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Data subscription gagal dimuat.'); }
  })(); }, [router]);

  const predefined = packages.filter((item) => item.type === 'PREDEFINED');
  const custom = packages.find((item) => item.type === 'CUSTOM');
  const selectedEntries = custom?.modules.filter((entry) => selectedModules.includes(entry.moduleId)) ?? [];
  const customTotal = useMemo(() => selectedEntries.reduce((sum, entry) => sum + (cycle === 'YEARLY' ? entry.modulePriceYearly ?? 0 : entry.modulePriceMonthly ?? 0), 0), [cycle, selectedEntries]);

  async function subscribe(body: object, busyKey: string) {
    setBusy(busyKey); setMessage('');
    try {
      const payload = { ...body, billingCycle: cycle, ...(user?.role === 'SUPER_ADMIN' ? { tenantId } : {}) };
      setSubscription(await request('/subscription', { method: 'POST', body: JSON.stringify(payload) }) as Subscription);
      setMessage('Subscription berhasil diperbarui.');
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

  return <div className="app"><Sidebar role={user?.role} /><section className="main"><header className="topbar subscription-topbar"><div><span>PLATFORM BILLING</span><strong>Subscription</strong></div><span>{user?.role?.replace('_', ' ')}</span></header><main className="content subscription-page">
    <div className="subscription-heading"><div><h1>Subscription</h1><p>Atur paket dan kapabilitas yang tersedia untuk tenant.</p></div><label className="billing-cycle"><span>Siklus tagihan</span><select value={cycle} onChange={(event) => setCycle(event.target.value as 'MONTHLY' | 'YEARLY')}><option value="MONTHLY">Bulanan</option><option value="YEARLY">Tahunan</option></select></label></div>
    {user?.role === 'SUPER_ADMIN' && <label className="subscription-tenant"><span>Kelola tenant</span><select value={tenantId} onChange={(event) => { setTenantId(event.target.value); void loadSubscription('SUPER_ADMIN', event.target.value); }}>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>}
    <section className="current-subscription" aria-label="Subscription saat ini"><div className="subscription-status-icon"><ShieldCheck size={22} /></div><div><span>SUBSCRIPTION SAAT INI</span><h2>{subscription ? subscription.isCustom ? 'Custom Package' : subscription.package?.name : 'Belum berlangganan'}</h2><p>{subscription ? `${subscription.status} · ${subscription.billingCycle === 'YEARLY' ? rupiah.format(subscription.priceYearly ?? 0) + '/tahun' : rupiah.format(subscription.priceMonthly) + '/bulan'} · Perpanjangan ${new Date(subscription.renewalAt).toLocaleDateString('id-ID')}` : 'Pilih paket untuk mengaktifkan akses modul tenant.'}</p></div></section>
    {message && <div className={message.includes('berhasil') ? 'success subscription-message' : 'error subscription-message'} role="status">{message}</div>}
    <div className="subscription-tabs" role="tablist" aria-label="Jenis paket"><button id="subscription-tab-packages" role="tab" aria-selected={tab === 'packages'} aria-controls="subscription-panel-packages" tabIndex={tab === 'packages' ? 0 : -1} className={tab === 'packages' ? 'active' : ''} onKeyDown={handleTabKey} onClick={() => setTab('packages')}>Paket Subscription</button><button id="subscription-tab-custom" role="tab" aria-selected={tab === 'custom'} aria-controls="subscription-panel-custom" tabIndex={tab === 'custom' ? 0 : -1} className={tab === 'custom' ? 'active' : ''} onKeyDown={handleTabKey} onClick={() => setTab('custom')}>Paket Custom</button></div>
    {tab === 'packages' ? <section id="subscription-panel-packages" role="tabpanel" aria-labelledby="subscription-tab-packages" className="package-grid">{predefined.map((item) => <article className="package-card" key={item.id}><div><span className="package-kicker">{item.name === 'Professional' ? 'RECOMMENDED' : 'PREDEFINED'}</span><h2>{item.name}</h2><p>{item.description}</p></div><div className="package-price"><strong>{rupiah.format(cycle === 'YEARLY' ? item.priceYearly ?? 0 : item.priceMonthly)}</strong><span>/{cycle === 'YEARLY' ? 'tahun' : 'bulan'}</span></div><ul>{item.modules.map((entry) => <li key={entry.moduleId}><Check size={15} /> <span><strong>{entry.module.name}</strong><small>{entry.module.features.map((feature) => feature.name).join(' · ')}</small></span></li>)}</ul><button className="subscription-primary" disabled={Boolean(busy) || (user?.role === 'SUPER_ADMIN' && !tenantId)} onClick={() => void subscribe({ packageId: item.id, isCustom: false }, item.id)}>{busy === item.id ? 'Memproses…' : 'Pilih Paket'}</button></article>)}</section> : <section id="subscription-panel-custom" role="tabpanel" aria-labelledby="subscription-tab-custom" className="custom-builder"><div className="custom-modules"><h2>Pilih modul</h2><p>Kombinasikan modul sesuai kebutuhan operasi keamanan Anda.</p>{custom?.modules.map((entry) => <label className={`custom-module${selectedModules.includes(entry.moduleId) ? ' selected' : ''}`} key={entry.moduleId}><input type="checkbox" checked={selectedModules.includes(entry.moduleId)} onChange={() => setSelectedModules((current) => current.includes(entry.moduleId) ? current.filter((id) => id !== entry.moduleId) : [...current, entry.moduleId])} /><span><strong>{entry.module.name}</strong><small>{entry.module.description}</small><em>{rupiah.format(cycle === 'YEARLY' ? entry.modulePriceYearly ?? 0 : entry.modulePriceMonthly ?? 0)}/{cycle === 'YEARLY' ? 'tahun' : 'bulan'}</em></span></label>)}</div><aside className="price-breakdown"><CreditCard size={22} /><h2>Rincian harga</h2>{selectedEntries.length ? selectedEntries.map((entry) => <div key={entry.moduleId}><span>{entry.module.name}</span><strong>{rupiah.format(cycle === 'YEARLY' ? entry.modulePriceYearly ?? 0 : entry.modulePriceMonthly ?? 0)}</strong></div>) : <p>Belum ada modul dipilih.</p>}<div className="price-total"><span>Total</span><strong>{rupiah.format(customTotal)}</strong></div><button className="subscription-primary" disabled={!selectedModules.length || Boolean(busy) || (user?.role === 'SUPER_ADMIN' && !tenantId)} onClick={() => void subscribe({ isCustom: true, moduleIds: selectedModules }, 'custom')}>{busy === 'custom' ? 'Memproses…' : 'Konfirmasi Pembelian'}</button></aside></section>}
  </main></section></div>;
}
