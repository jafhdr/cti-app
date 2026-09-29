'use client';

import { Flag, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, OverlayClose } from '@/components/ui/overlay';
import { Card } from '../../../components/ui/card';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type Campaign = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly objective: string | null;
  readonly status: string;
  readonly severity: string;
  readonly confidence: number;
  readonly externalId: string | null;
  readonly threatActor: { readonly entity: { readonly name: string } };
};

type Props = { readonly caseId: string; readonly canMutate: boolean };

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json();
  if (typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string') return body.message;
  return fallback;
}

export function RelatedCampaigns({ caseId, canMutate }: Props) {
  const [items, setItems] = useState<readonly Campaign[]>([]);
  const [available, setAvailable] = useState<readonly Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`${API}/cases/${caseId}/campaigns`, { credentials: 'include' });
      if (!response.ok) throw new Error(await responseMessage(response, 'Campaign gagal dimuat'));
      setItems(await response.json());
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Campaign gagal dimuat'); }
    finally { setLoading(false); }
  }, [caseId]);

  const loadAvailable = useCallback(async (value: string) => {
    setAvailableLoading(true); setDialogError(null);
    try {
      const query = new URLSearchParams(value.trim() ? { search: value.trim() } : {});
      const response = await fetch(`${API}/cases/${caseId}/campaigns/available?${query}`, { credentials: 'include' });
      if (!response.ok) throw new Error(await responseMessage(response, 'Campaign tersedia gagal dimuat'));
      setAvailable(await response.json());
    } catch (caught) { setDialogError(caught instanceof Error ? caught.message : 'Campaign tersedia gagal dimuat'); }
    finally { setAvailableLoading(false); }
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!dialogOpen) return; const timeoutId = window.setTimeout(() => { void loadAvailable(search); }, 250); return () => window.clearTimeout(timeoutId); }, [dialogOpen, loadAvailable, search]);

  async function link(campaign: Campaign): Promise<void> {
    setBusyId(campaign.id); setDialogError(null);
    try {
      const response = await fetch(`${API}/cases/${caseId}/campaigns`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: campaign.id }) });
      if (!response.ok) throw new Error(await responseMessage(response, 'Campaign gagal dihubungkan'));
      setDialogOpen(false); setSearch(''); await load();
    } catch (caught) { setDialogError(caught instanceof Error ? caught.message : 'Campaign gagal dihubungkan'); }
    finally { setBusyId(null); }
  }

  async function unlink(campaign: Campaign): Promise<void> {
    setBusyId(campaign.id); setError(null);
    try {
      const response = await fetch(`${API}/cases/${caseId}/campaigns/${campaign.id}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error(await responseMessage(response, 'Campaign gagal dilepas'));
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Campaign gagal dilepas'); }
    finally { setBusyId(null); }
  }

  return <section aria-labelledby="related-campaigns-heading" className="mt-8">
    <Card view="outlined" className="border-input p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Related Intelligence</p><h2 id="related-campaigns-heading" className="mt-1 flex items-center gap-2 text-lg font-semibold !text-card-foreground"><Flag className="h-5 w-5 text-primary" />Campaigns</h2></div>{canMutate && <Button type="button" onClick={() => setDialogOpen(true)} className="gap-2"><Plus className="h-4 w-4" />Add Campaign</Button>}</div>
      {error && <div role="alert" className="mt-4 rounded-md border border-destructive px-4 py-3 text-sm text-destructive">{error}<button type="button" onClick={() => void load()} className="ml-3 font-semibold underline">Coba lagi</button></div>}
      {loading ? <div role="status" aria-label="Memuat Campaign terkait" className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : <div className="case-related-grid mt-5 grid gap-3">{items.length === 0 ? <p className="col-span-full rounded-md bg-muted py-10 text-center text-sm text-muted-foreground">Belum ada Campaign yang terhubung.</p> : items.map((campaign) => <article key={campaign.id} className="min-w-0 rounded-md border border-input p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-semibold !text-card-foreground"><Link href={`/threat-intelligence/campaigns?campaignId=${encodeURIComponent(campaign.id)}`} className="hover:underline">{campaign.name}</Link></h3><p className="mt-1 text-xs text-muted-foreground">{campaign.severity} / {campaign.status} / Confidence {campaign.confidence}%</p></div>{canMutate && <button type="button" aria-label={`Lepas ${campaign.name}`} disabled={busyId === campaign.id} onClick={() => void unlink(campaign)} className="rounded-md p-3 text-destructive hover:bg-muted disabled:opacity-50">{busyId === campaign.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button>}</div><p className="mt-3 truncate text-xs text-muted-foreground">{campaign.externalId || 'Tanpa external ID'} / {campaign.threatActor.entity.name}</p></article>)}</div>}
    </Card>
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="cti-case-picker" initialFocusRef={searchInputRef}><DialogHeader><DialogTitle>Add Campaign</DialogTitle><OverlayClose label="Tutup" /></DialogHeader><DialogBody><label className="mt-4 flex items-center gap-2 rounded-md border border-input bg-card px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring"><Search className="h-4 w-4 text-muted-foreground" /><span className="sr-only">Cari Campaign</span><input ref={searchInputRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama, deskripsi, objective, atau external ID..." className="min-w-0 flex-1 !border-0 !bg-transparent py-2.5 text-sm text-card-foreground !shadow-none !outline-none !ring-0" /></label>{dialogError && <div role="alert" className="mt-4 rounded-md border border-destructive px-4 py-3 text-sm text-destructive">{dialogError}<button type="button" onClick={() => void loadAvailable(search)} className="ml-3 font-semibold underline">Coba lagi</button></div>}<div className="mt-4 space-y-2">{availableLoading ? <div role="status" aria-label="Memuat Campaign tersedia" className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : available.length === 0 ? <p className="rounded-md bg-muted py-10 text-center text-sm text-muted-foreground">Tidak ada Campaign tersedia.</p> : available.map((campaign) => <div key={campaign.id} className="flex items-center justify-between gap-3 rounded-md border border-input p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold !text-card-foreground">{campaign.name}</p><p className="mt-1 text-xs text-muted-foreground">{campaign.severity} / {campaign.status} / {campaign.threatActor.entity.name}</p></div><Button type="button" aria-label={`Hubungkan ${campaign.name}`} disabled={busyId === campaign.id} onClick={() => void link(campaign)}>{busyId === campaign.id ? 'Menambahkan...' : 'Add'}</Button></div>)}</div></DialogBody></DialogContent></Dialog>
  </section>;
}
