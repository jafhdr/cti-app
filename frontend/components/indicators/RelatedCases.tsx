'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BriefcaseBusiness, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FormModal } from '@/components/ui/modal-patterns';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, OverlayClose } from '@/components/ui/overlay';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type CaseSummary = {
  readonly id: string;
  readonly caseNumber: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly severity: string;
};

type Props = {
  readonly indicatorId: string;
  readonly canMutate: boolean;
};

type CreateCaseForm = {
  readonly title: string;
  readonly description: string;
  readonly priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
};

const EMPTY_CREATE_FORM: CreateCaseForm = {
  title: '',
  description: '',
  priority: 'MEDIUM',
  severity: 'MEDIUM',
};

function isCaseLevel(value: string): value is CreateCaseForm['priority'] {
  return value === 'LOW' || value === 'MEDIUM' || value === 'HIGH' || value === 'CRITICAL';
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string') return body.message;
  return fallback;
}

export function RelatedCases({ indicatorId, canMutate }: Props) {
  const [items, setItems] = useState<readonly CaseSummary[]>([]);
  const [available, setAvailable] = useState<readonly CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateCaseForm>(EMPTY_CREATE_FORM);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setListError(null);
    try {
      const response = await fetch(`${API}/indicators/${indicatorId}/cases`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(await responseMessage(response, 'Related Cases failed to load.'));
      setItems(await response.json());
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : 'Related Cases failed to load.');
    } finally {
      setLoading(false);
    }
  }, [indicatorId]);

  const loadAvailable = useCallback(async (value: string): Promise<void> => {
    setSearching(true);
    setSearchError(null);
    try {
      const query = new URLSearchParams(value.trim() ? { search: value.trim() } : {});
      const response = await fetch(`${API}/indicators/${indicatorId}/cases/available?${query}`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(await responseMessage(response, 'Available Cases failed to load.'));
      setAvailable(await response.json());
    } catch (cause) {
      setSearchError(cause instanceof Error ? cause.message : 'Available Cases failed to load.');
    } finally {
      setSearching(false);
    }
  }, [indicatorId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!dialogOpen) return;
    const timeoutId = window.setTimeout(() => { void loadAvailable(search); }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [dialogOpen, loadAvailable, search]);

  async function link(caseRecord: CaseSummary): Promise<void> {
    setBusyId(caseRecord.id);
    setSearchError(null);
    try {
      const response = await fetch(`${API}/indicators/${indicatorId}/cases`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: caseRecord.id }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Case failed to link.'));
      setDialogOpen(false);
      setSearch('');
      await load();
    } catch (cause) {
      setSearchError(cause instanceof Error ? cause.message : 'Case failed to link.');
    } finally {
      setBusyId(null);
    }
  }

  async function unlink(caseRecord: CaseSummary): Promise<void> {
    setBusyId(caseRecord.id);
    setListError(null);
    try {
      const response = await fetch(`${API}/indicators/${indicatorId}/cases/${caseRecord.id}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error(await responseMessage(response, 'Case failed to unlink.'));
      await load();
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : 'Case failed to unlink.');
    } finally {
      setBusyId(null);
    }
  }

  async function createCase(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    setSuccess(null);
    try {
      const response = await fetch(`${API}/cases/from-indicator/${indicatorId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Case failed to create.'));
      const created: CaseSummary = await response.json();
      setItems(current => [created, ...current.filter(item => item.id !== created.id)]);
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE_FORM);
      setSuccess(`${created.caseNumber} created and linked.`);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : 'Case failed to create.');
    } finally {
      setCreating(false);
    }
  }

  return <section className="indicator-related-cases" aria-labelledby="related-cases-heading">
    <div className="source-panel-heading">
      <div><span className="source-eyebrow">CASE MANAGEMENT</span><h3 id="related-cases-heading"><BriefcaseBusiness aria-hidden="true" />Related Cases</h3></div>
      {canMutate && <div className="related-cases-actions"><span className="related-cases-trigger"><Button view="normal" size="s" onClick={() => setDialogOpen(true)}><Plus aria-hidden="true" />Add to Case</Button></span><span className="related-cases-trigger"><Button view="action" size="s" onClick={() => { setCreateError(null); setCreateOpen(true); }}><Plus aria-hidden="true" />Create Case</Button></span></div>}
    </div>
    {success && <div className="success" role="status">{success}</div>}
    {listError && <div className="error" role="alert">{listError} <button type="button" onClick={() => void load()}>Retry</button></div>}
    {loading ? <div className="related-cases-state" role="status"><Loader2 className="spin" aria-hidden="true" />Loading related Cases...</div> : items.length === 0 ? <div className="related-cases-state"><strong>No related Cases yet.</strong><span>{canMutate ? 'Add this Indicator to an existing Case.' : 'No Case has been linked to this Indicator.'}</span></div> : <div className="related-cases-grid">{items.map(caseRecord => <article key={caseRecord.id}>
      <Link href={`/cases/${caseRecord.id}`}><strong>{caseRecord.caseNumber}</strong><span>{caseRecord.title}</span><small>{caseRecord.status} / {caseRecord.priority} priority / {caseRecord.severity} severity</small></Link>
      {canMutate && <button type="button" aria-label={`Unlink ${caseRecord.caseNumber}`} disabled={busyId === caseRecord.id} onClick={() => void unlink(caseRecord)}>{busyId === caseRecord.id ? <Loader2 className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}</button>}
    </article>)}</div>}

    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="cti-case-picker" initialFocusRef={searchRef}><DialogHeader><DialogTitle>Add to Case</DialogTitle><OverlayClose label="Close Case search" /></DialogHeader><DialogBody>
      <label className="cti-case-search"><Search aria-hidden="true" /><span className="sr-only">Search Cases</span><input ref={searchRef} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search case number or title..." /></label>
      {searchError && <div className="error" role="alert">{searchError} <button type="button" onClick={() => void loadAvailable(search)}>Retry search</button></div>}
      {!searchError && (searching ? <div className="related-cases-state" role="status"><Loader2 className="spin" aria-hidden="true" />Searching Cases...</div> : available.length === 0 ? <div className="related-cases-state">No available Cases found.</div> : <div className="related-case-options">{available.map(caseRecord => <article key={caseRecord.id}><div><strong>{caseRecord.caseNumber}</strong><span>{caseRecord.title}</span><small>{caseRecord.status} / {caseRecord.priority}</small></div><Button view="action" size="s" aria-label={`Link ${caseRecord.caseNumber}`} disabled={busyId === caseRecord.id} onClick={() => void link(caseRecord)}>{busyId === caseRecord.id ? 'Linking...' : 'Link'}</Button></article>)}</div>)}
    </DialogBody></DialogContent></Dialog>

    <FormModal open={createOpen} onOpenChange={setCreateOpen} title="Create Case from Indicator" onSubmit={createCase} loading={creating} error={createError} submitLabel="Create Case"><div className="ioc-form">
      <label><span>Title</span><input required value={createForm.title} onChange={event => setCreateForm(current => ({ ...current, title: event.target.value }))} /></label>
      <label><span>Description</span><textarea rows={4} value={createForm.description} onChange={event => setCreateForm(current => ({ ...current, description: event.target.value }))} /></label>
      <div className="related-cases-create-grid">
        <label><span>Priority</span><select value={createForm.priority} onChange={event => { const value = event.target.value; if (isCaseLevel(value)) setCreateForm(current => ({ ...current, priority: value })); }}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select></label>
        <label><span>Severity</span><select value={createForm.severity} onChange={event => { const value = event.target.value; if (isCaseLevel(value)) setCreateForm(current => ({ ...current, severity: value })); }}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select></label>
      </div>
    </div></FormModal>
  </section>;
}
