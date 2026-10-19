'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmationModal } from '@/components/ui/modal-patterns';
import { useAppSec } from './AppSecShell';
import { ApplicationForm } from './ApplicationForm';
import { AssetPicker } from './AssetPicker';
import { appsecUrl, errorMessage, type Application, type Asset } from './types';

export function ApplicationDetail() {
  const params = useParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const { role, tenantId, canManage, canViewAssets } = useAppSec();
  const latest = useRef(0);
  const [application, setApplication] = useState<Application | null>(null);
  const [assets, setAssets] = useState<readonly Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [assetLoading, setAssetLoading] = useState(false);
  const [error, setError] = useState('');
  const [assetError, setAssetError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<Asset | null>(null);
  const [unlinking, setUnlinking] = useState(false);

  const load = useCallback(async () => {
    const requestId = ++latest.current;
    setLoading(true); setError(''); setApplication(null); setAssets([]);
    try {
      const response = await fetch(appsecUrl(`/appsec/applications/${id}`, role, tenantId), { credentials: 'include', cache: 'no-store' });
      const body: Application & { readonly message?: string | readonly string[] } = await response.json();
      if (!response.ok) throw new Error(response.status === 404 ? 'Application tidak ditemukan dalam tenant ini.' : errorMessage(body, 'Gagal memuat Application.', response.status));
      if (requestId === latest.current) setApplication(body);
    } catch (cause) { if (requestId === latest.current) setError(cause instanceof Error ? cause.message : 'Gagal memuat Application.'); }
    finally { if (requestId === latest.current) setLoading(false); }
  }, [id, role, tenantId]);
  const loadAssets = useCallback(async () => {
    if (!canViewAssets) return;
    const requestId = latest.current;
    setAssetLoading(true); setAssetError(''); setAssets([]);
    try {
      const response = await fetch(appsecUrl(`/appsec/applications/${id}/assets`, role, tenantId), { credentials: 'include', cache: 'no-store' });
      const body: readonly Asset[] & { readonly message?: string | readonly string[] } = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal memuat linked Assets.', response.status));
      if (requestId === latest.current) setAssets(body);
    } catch (cause) { if (requestId === latest.current) setAssetError(cause instanceof Error ? cause.message : 'Gagal memuat linked Assets.'); }
    finally { if (requestId === latest.current) setAssetLoading(false); }
  }, [canViewAssets, id, role, tenantId]);
  useEffect(() => { void load(); return () => { latest.current += 1; }; }, [load]);
  useEffect(() => { if (application) void loadAssets(); }, [application, loadAssets]);
  async function unlink(): Promise<void> {
    if (!unlinkTarget) return;
    setUnlinking(true); setAssetError('');
    try {
      const response = await fetch(appsecUrl(`/appsec/applications/${id}/assets/${unlinkTarget.id}`, role, tenantId), { method: 'DELETE', credentials: 'include' });
      const body: { readonly message?: string | readonly string[] } = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal melepas Asset.', response.status));
      setUnlinkTarget(null); setNotice('Asset unlinked.'); await loadAssets();
    } catch (cause) { setAssetError(cause instanceof Error ? cause.message : 'Gagal melepas Asset.'); }
    finally { setUnlinking(false); }
  }
  return <main className="content editorial-module appsec-workspace"><Link className="appsec-back" href="/appsec/applications">← Applications</Link>
    {loading ? <div className="appsec-state" role="status">Loading Application...</div> : error ? <div className="appsec-state" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></div> : application && <>
      <header className="editorial-heading appsec-heading"><div><span className="source-eyebrow">APPLICATION PROFILE</span><h1>{application.name}</h1><p>Ownership and deployment context for this application.</p></div>{canManage && <Button view="outlined" onClick={() => setEditing(true)}>Edit application</Button>}</header>
      {notice && <div className="success" role="status">{notice}</div>}
      <dl className="appsec-facts"><div><dt>Criticality</dt><dd>{application.criticality}</dd></div><div><dt>Status</dt><dd>{application.status}</dd></div><div><dt>Owner</dt><dd>{application.owner || '—'}</dd></div><div><dt>Repository</dt><dd>{application.repositoryUrl ? <a href={application.repositoryUrl} target="_blank" rel="noreferrer">Open repository</a> : '—'}</dd></div><div><dt>Created</dt><dd>{new Date(application.createdAt).toLocaleString()}</dd></div><div><dt>Updated</dt><dd>{new Date(application.updatedAt).toLocaleString()}</dd></div><div className="appsec-fact-wide"><dt>Description</dt><dd>{application.description || 'No description.'}</dd></div></dl>
      <section className="appsec-assets"><div className="appsec-section-head"><div><span className="source-eyebrow">DEPLOYMENT CONTEXT</span><h2>Linked ASM Assets</h2></div>{canManage && canViewAssets && <Button onClick={() => setPicker(true)}>Link Asset</Button>}</div>
        {!canViewAssets ? <p className="appsec-state">ASM asset access is required to view linked Assets.</p> : assetLoading ? <p className="appsec-state" role="status">Loading linked Assets...</p> : assetError ? <p className="appsec-state" role="alert">{assetError} <button type="button" onClick={() => void loadAssets()}>Retry</button></p> : assets.length === 0 ? <p className="appsec-state">No ASM Assets linked to this application.</p> : <div className="appsec-asset-list">{assets.map(asset => <article key={asset.id}><div><strong>{asset.name}</strong><code>{asset.value}</code><span>{asset.type} · {asset.status} · {asset.criticality}</span></div>{canManage && <Button view="outlined" size="s" onClick={() => setUnlinkTarget(asset)}>Unlink</Button>}</article>)}</div>}
      </section>
      <ApplicationForm open={editing} application={application} onClose={() => setEditing(false)} onSaved={updated => { setApplication(updated); setNotice('Application updated.'); }} />
      {canManage && canViewAssets && <AssetPicker open={picker} applicationId={id} onClose={() => setPicker(false)} onLinked={() => { setNotice('Asset linked.'); void loadAssets(); }} />}
      <ConfirmationModal open={unlinkTarget !== null} onOpenChange={open => { if (!open) setUnlinkTarget(null); }} title="Unlink ASM Asset" target={unlinkTarget?.name} consequence="The Asset remains available in ASM." confirmLabel="Unlink Asset" loading={unlinking} onConfirm={unlink} />
    </>}
  </main>;
}
