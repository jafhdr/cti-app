'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, OverlayClose } from '@/components/ui/overlay';
import { useAppSec } from './AppSecShell';
import { appsecUrl, errorMessage, type Asset, type ListResponse } from './types';

type Props = { readonly open: boolean; readonly applicationId: string; readonly onClose: () => void; readonly onLinked: () => void };
export function AssetPicker({ open, applicationId, onClose, onLinked }: Props) {
  const { role, tenantId } = useAppSec();
  const latest = useRef(0);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<readonly Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const requestId = ++latest.current;
    setLoading(true); setError('');
    const params = new URLSearchParams({ page: '1', limit: '25' });
    if (search.trim()) params.set('search', search.trim());
    try {
      const response = await fetch(appsecUrl(`/appsec/applications/${applicationId}/assets/available`, role, tenantId, params), { credentials: 'include', cache: 'no-store' });
      const body: ListResponse<Asset> & { readonly message?: string | readonly string[] } = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal memuat Asset.', response.status));
      if (requestId === latest.current) setItems(body.items);
    } catch (cause) { if (requestId === latest.current) setError(cause instanceof Error ? cause.message : 'Gagal memuat Asset.'); }
    finally { if (requestId === latest.current) setLoading(false); }
  }, [applicationId, role, search, tenantId]);
  useEffect(() => { if (open) void load(); return () => { latest.current += 1; }; }, [load, open]);
  async function link(asset: Asset): Promise<void> {
    setSaving(asset.id); setError('');
    try {
      const response = await fetch(appsecUrl(`/appsec/applications/${applicationId}/assets/${asset.id}`, role, tenantId), { method: 'POST', credentials: 'include' });
      const body: { readonly message?: string | readonly string[] } = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal menghubungkan Asset.', response.status));
      onLinked(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Gagal menghubungkan Asset.'); }
    finally { setSaving(''); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}><DialogContent><DialogHeader><DialogTitle>Link ASM Asset</DialogTitle><OverlayClose /></DialogHeader><DialogBody>
    <label className="appsec-picker-search">Search Asset<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or value" /></label>
    {error && <p role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
    {loading ? <p role="status">Loading available Assets...</p> : items.length === 0 ? <p>No available Assets found.</p> : <div className="appsec-picker-results">{items.map(asset => <div key={asset.id}><div><strong>{asset.name}</strong><small>{asset.value} · {asset.type}</small></div><Button size="s" disabled={Boolean(saving)} onClick={() => void link(asset)}>{saving === asset.id ? 'Linking...' : 'Link'}</Button></div>)}</div>}
  </DialogBody></DialogContent></Dialog>;
}
