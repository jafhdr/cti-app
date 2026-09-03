'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Feature = { readonly id: string; readonly key: string; readonly name: string };
type ModuleAccess = { readonly id: string; readonly name: string; readonly assigned: boolean; readonly features: readonly Feature[]; readonly featureKeys: readonly string[] };
type AccessTarget = { readonly id: string; readonly name: string; readonly email: string };

export default function ModuleAccessPanel({ target, onClose, onError, onSaved, onUnauthorized }: { readonly target: AccessTarget; readonly onClose: () => void; readonly onError: (message: string) => void; readonly onSaved: (message: string) => void; readonly onUnauthorized: () => void }) {
  const [modules, setModules] = useState<ModuleAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const handlers = useRef({ onClose, onError, onUnauthorized });

  useEffect(() => { void (async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API}/users/${target.id}/module-access`, { credentials: 'include', cache: 'no-store' });
      if (response.status === 401) { handlers.current.onUnauthorized(); return; }
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data === 'object' && data !== null && 'message' in data ? String(data.message) : 'Gagal memuat akses modul.');
      const received = Array.isArray(data) ? data as ModuleAccess[] : [];
      setModules(received.map((module) => ({ ...module, featureKeys: module.assigned && module.featureKeys.length === 0 ? module.features.map((feature) => feature.key) : module.featureKeys })));
    } catch (cause) { handlers.current.onError(cause instanceof Error ? cause.message : 'Gagal memuat akses modul.'); handlers.current.onClose(); }
    finally { setLoading(false); }
  })(); }, [target.id]);

  function toggleModule(moduleId: string) { setModules((current) => current.map((module) => module.id === moduleId ? { ...module, assigned: !module.assigned, featureKeys: !module.assigned ? module.features.map((feature) => feature.key) : [] } : module)); }
  function toggleFeature(moduleId: string, key: string) { setModules((current) => current.map((module) => module.id === moduleId ? { ...module, assigned: true, featureKeys: module.featureKeys.includes(key) ? module.featureKeys.filter((item) => item !== key) : [...module.featureKeys, key] } : module)); }

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(`${API}/users/${target.id}/module-access`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access: modules.filter((module) => module.assigned).map((module) => ({ moduleId: module.id, featureKeys: module.featureKeys })) }) });
      if (response.status === 401) { onUnauthorized(); return; }
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data === 'object' && data !== null && 'message' in data ? String(data.message) : 'Gagal menyimpan akses modul.');
      onSaved(`Akses modul ${target.email} berhasil diperbarui.`); onClose();
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Gagal menyimpan akses modul.'); }
    finally { setSaving(false); }
  }

  return <section className="access-panel" aria-label={`Akses modul ${target.name}`} aria-busy={loading}><div className="access-panel-header"><div><h2>Akses Modul: {target.name}</h2><p>Hanya modul dalam subscription aktif tenant yang dapat diberikan. Perubahan mengganti seluruh assignment lama.</p></div><Button view="outlined" size="s" onClick={onClose} disabled={saving}>Batal</Button></div>{loading ? <p className="muted" role="status">Memuat akses modul…</p> : <><div className="access-module-list">{modules.map((module) => <article className="access-module" key={module.id}><label><input type="checkbox" checked={module.assigned} onChange={() => toggleModule(module.id)} /><span>{module.name}</span></label>{module.assigned && module.features.length > 0 && <div className="access-features">{module.features.map((feature) => <label key={feature.id}><input type="checkbox" checked={module.featureKeys.includes(feature.key)} onChange={() => toggleFeature(module.id, feature.key)} /><span>{feature.name}</span></label>)}</div>}</article>)}</div>{modules.length === 0 && <p className="muted">Tenant belum memiliki subscription aktif atau paket belum berisi modul.</p>}<Button view="action" size="l" onClick={() => void save()} disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan Akses Modul'}</Button></>}</section>;
}
