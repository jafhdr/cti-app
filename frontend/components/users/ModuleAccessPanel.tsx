'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmationModal } from '@/components/ui/modal-patterns';
import type { UserModuleAccess } from '@/lib/access-policy';
import { isCatalogOnlyFeature, isCatalogOnlyModule } from '@/lib/feature-catalog';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type AccessTarget = { readonly id: string; readonly name: string; readonly email: string };

export default function ModuleAccessPanel({ target, onClose, onError, onSaved, onUnauthorized }: { readonly target: AccessTarget; readonly onClose: () => void; readonly onError: (message: string) => void; readonly onSaved: (message: string) => void; readonly onUnauthorized: () => void }) {
  const [modules, setModules] = useState<readonly UserModuleAccess[]>([]);
  const [original, setOriginal] = useState<readonly UserModuleAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const handlers = useRef({ onUnauthorized });
  handlers.current = { onUnauthorized };

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true); setError('');
      try {
        const response = await fetch(`${API}/users/${target.id}/module-access`, { credentials: 'include', cache: 'no-store' });
        if (response.status === 401) { handlers.current.onUnauthorized(); return; }
        if (!response.ok) throw new Error('Gagal memuat akses modul. Tutup panel dan coba kembali.');
        const received: readonly UserModuleAccess[] = await response.json();
        if (active) { setModules(received); setOriginal(received); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Gagal memuat akses modul.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [target.id]);

  function toggleModule(moduleId: string) {
    setModules(current => current.map(module => module.id === moduleId && (module.assignable || module.assigned) ? { ...module, assigned: !module.assigned, featureKeys: [] } : module));
  }
  function toggleFeature(moduleId: string, key: string) {
    setModules(current => current.map(module => module.id === moduleId && (module.assignable || module.featureKeys.includes(key)) && (!isCatalogOnlyFeature(module.slug, key) || module.featureKeys.includes(key)) ? { ...module, featureKeys: module.featureKeys.includes(key) ? module.featureKeys.filter(item => item !== key) : [...module.featureKeys, key] } : module));
  }
  function save() {
    const revoking = original.some(previous => previous.assigned && (!modules.find(module => module.id === previous.id)?.assigned || previous.featureKeys.some(key => !modules.find(module => module.id === previous.id)?.featureKeys.includes(key))));
    if (revoking) { setConfirmRevoke(true); return; }
    void commitSave();
  }
  async function commitSave() {
    setSaving(true); setError('');
    try {
      const response = await fetch(`${API}/users/${target.id}/module-access`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access: modules.filter(module => module.assigned).map(module => ({ moduleId: module.id, featureKeys: module.featureKeys })) }) });
      if (response.status === 401) { onUnauthorized(); return; }
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data === 'object' && data !== null && 'message' in data ? String(data.message) : 'Gagal menyimpan akses modul.');
      setConfirmRevoke(false); onSaved(`Akses modul ${target.email} berhasil diperbarui.`); onClose();
    } catch (cause) { const message = cause instanceof Error ? cause.message : 'Gagal menyimpan akses modul.'; setError(message); onError(message); }
    finally { setSaving(false); }
  }

  return <section className="access-panel" aria-label={`Akses modul ${target.name}`} aria-busy={loading}>
    <ConfirmationModal open={confirmRevoke} onOpenChange={setConfirmRevoke} title="Hapus akses modul atau fitur" target={target.name} consequence="Assignment dan fitur yang dibatalkan akan dihapus." confirmLabel="Hapus akses" destructive loading={saving} error={confirmRevoke ? error : ''} onConfirm={commitSave} />
    <div className="access-panel-header"><div><h2>Akses Modul: {target.name}</h2><p>User Assigned berbeda dari Accessible. Status efektif berasal dari server; perubahan diterapkan setelah disimpan.</p></div><Button view="outlined" size="s" onClick={onClose} disabled={saving}>Batal</Button></div>
    {error && <p className="error" role="alert">{error}</p>}
    {loading ? <p className="muted" role="status">Memuat akses modul…</p> : <>
      <div className="access-module-list">{modules.map(module => <article className="access-module" key={module.id}>
        <label><input type="checkbox" checked={module.assigned} disabled={saving || (!module.assignable && !module.assigned)} onChange={() => toggleModule(module.id)} /><span>{module.name}{isCatalogOnlyModule(module.slug) ? ' (Catalog only)' : ''}</span></label>
        <dl className="access-policy-details"><div><dt>User Assigned</dt><dd>{module.assigned ? 'Yes' : 'No'}</dd></div><div><dt>Module Included</dt><dd>{module.subscriptionIncluded ? 'Included' : 'Not Included'}</dd></div><div><dt>Subscription</dt><dd>{module.subscriptionActive ? 'Active' : 'Inactive'}</dd></div><div><dt>Global Module</dt><dd>{module.isActive ? 'Active' : 'Inactive'}</dd></div><div><dt>Tenant Enabled</dt><dd>{module.tenantEnabled ? 'Yes' : 'No'}</dd></div><div><dt>Role Access</dt><dd>{module.roleAllowed ? 'Allowed' : 'Denied'}</dd></div><div><dt>Effective Access (tersimpan)</dt><dd>{module.accessible ? 'Accessible' : 'Not Accessible'}</dd></div></dl>
        {module.reason && <p className="muted">{module.reason}</p>}
        {module.assigned && <fieldset className="access-features" disabled={saving}><legend>Feature Access</legend>{module.features.map(feature => <label key={feature.id}><input type="checkbox" checked={module.featureKeys.includes(feature.key)} disabled={(!module.assignable && !module.featureKeys.includes(feature.key)) || (isCatalogOnlyFeature(module.slug, feature.key) && !module.featureKeys.includes(feature.key))} onChange={() => toggleFeature(module.id, feature.key)} /><span>{feature.name}{isCatalogOnlyFeature(module.slug, feature.key) ? ' (Catalog only)' : ''}</span></label>)}{module.features.length === 0 && <p>Tidak ada fitur terpisah.</p>}{module.features.length > 0 && module.featureKeys.length === 0 && <p>Belum ada fitur diberikan.</p>}</fieldset>}
      </article>)}</div>
      {modules.length === 0 && !error && <p className="muted">Belum ada modul dalam katalog tenant.</p>}
      <Button view="action" size="l" onClick={() => void save()} disabled={saving || Boolean(error) || modules.length === 0}>{saving ? 'Menyimpan…' : 'Simpan Akses Modul'}</Button>
    </>}
  </section>;
}
