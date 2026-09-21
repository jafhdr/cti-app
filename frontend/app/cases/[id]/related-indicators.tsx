'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { Card } from '@/components/ui/card';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type Indicator = {
  readonly id: string;
  readonly value: string;
  readonly type: string;
  readonly severity: string;
  readonly status: string;
  readonly tags: readonly string[];
  readonly source: string | null;
};

type Props = { readonly caseId: string; readonly canMutate: boolean };

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json();
  if (typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string') return body.message;
  return fallback;
}

export function RelatedIndicators({ caseId, canMutate }: Props) {
  const [items, setItems] = useState<readonly Indicator[]>([]);
  const [available, setAvailable] = useState<readonly Indicator[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API}/cases/${caseId}/indicators`, { credentials: 'include' });
      if (!response.ok) throw new Error(await responseMessage(response, 'Indicator gagal dimuat'));
      setItems(await response.json());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Indicator gagal dimuat');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  const loadAvailable = useCallback(async (value: string) => {
    try {
      const query = new URLSearchParams(value.trim() ? { search: value.trim() } : {});
      const response = await fetch(`${API}/cases/${caseId}/indicators/available?${query}`, { credentials: 'include' });
      if (!response.ok) throw new Error(await responseMessage(response, 'Indicator tersedia gagal dimuat'));
      setAvailable(await response.json());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Indicator tersedia gagal dimuat');
    }
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!dialogOpen) return;
    const timeoutId = window.setTimeout(() => { void loadAvailable(search); }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [dialogOpen, loadAvailable, search]);

  async function link(indicator: Indicator): Promise<void> {
    setBusyId(indicator.id);
    setError(null);
    try {
      const response = await fetch(`${API}/cases/${caseId}/indicators`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ indicatorId: indicator.id }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Indicator gagal dihubungkan'));
      setDialogOpen(false);
      setSearch('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Indicator gagal dihubungkan');
    } finally {
      setBusyId(null);
    }
  }

  async function unlink(indicator: Indicator): Promise<void> {
    setBusyId(indicator.id);
    setError(null);
    try {
      const response = await fetch(`${API}/cases/${caseId}/indicators/${indicator.id}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error(await responseMessage(response, 'Indicator gagal dilepas'));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Indicator gagal dilepas');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="related-indicators-heading" className="mt-8">
      <Card view="outlined" className="border-input p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Related Intelligence</p>
            <h2 id="related-indicators-heading" className="mt-1 flex items-center gap-2 text-lg font-semibold !text-card-foreground"><Link2 className="h-5 w-5 text-primary" />Indicators</h2>
          </div>
          {canMutate && <button type="button" onClick={() => setDialogOpen(true)} className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium !text-white"><Plus className="h-4 w-4" />Add Indicator</button>}
        </div>
        {error && <div role="alert" className="mt-4 rounded-md border border-destructive px-4 py-3 text-sm text-destructive">{error}<button type="button" onClick={() => void load()} className="ml-3 font-semibold underline">Coba lagi</button></div>}
        {loading ? <div role="status" aria-label="Memuat Indicator terkait" className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {items.length === 0 ? <p className="col-span-full rounded-md bg-muted py-10 text-center text-sm text-muted-foreground">Belum ada Indicator yang terhubung.</p> : items.map((indicator) => (
              <div key={indicator.id} className="min-w-0 rounded-md border border-input p-4">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-mono text-sm font-semibold text-card-foreground">{indicator.value}</p><p className="mt-1 text-xs text-muted-foreground">{indicator.type} / {indicator.severity} / {indicator.status}</p></div>{canMutate && <button type="button" aria-label={`Lepas ${indicator.value}`} disabled={busyId === indicator.id} onClick={() => void unlink(indicator)} className="rounded-md p-3 text-destructive hover:bg-muted disabled:opacity-50">{busyId === indicator.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button>}</div>
                {(indicator.source || indicator.tags.length > 0) && <p className="mt-3 truncate text-xs text-muted-foreground">{indicator.source ?? 'Tanpa sumber'}{indicator.tags.length > 0 ? ` / ${indicator.tags.join(', ')}` : ''}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {dialogOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="add-indicator-title"><div className="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-t-lg border border-input bg-card p-5 shadow-xl sm:rounded-md"><div className="flex items-center justify-between gap-3"><h3 id="add-indicator-title" className="text-lg font-semibold text-card-foreground">Add Indicator</h3><button type="button" aria-label="Tutup" onClick={() => setDialogOpen(false)} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><X className="h-5 w-5" /></button></div><label className="mt-4 flex items-center gap-2 rounded-md border border-input bg-card px-3"><Search className="h-4 w-4 text-muted-foreground" /><span className="sr-only">Cari Indicator</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari value, source, atau tag..." className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-card-foreground outline-none" /></label><div className="mt-4 space-y-2">{available.length === 0 ? <p className="rounded-md bg-muted py-10 text-center text-sm text-muted-foreground">Tidak ada Indicator tersedia.</p> : available.map((indicator) => <div key={indicator.id} className="flex items-center justify-between gap-3 rounded-md border border-input p-3"><div className="min-w-0"><p className="truncate font-mono text-sm font-semibold text-card-foreground">{indicator.value}</p><p className="mt-1 text-xs text-muted-foreground">{indicator.type} / {indicator.severity}</p></div><button type="button" aria-label={`Hubungkan ${indicator.value}`} disabled={busyId === indicator.id} onClick={() => void link(indicator)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium !text-white disabled:opacity-50">{busyId === indicator.id ? 'Menambahkan...' : 'Add'}</button></div>)}</div></div></div>}
    </section>
  );
}
