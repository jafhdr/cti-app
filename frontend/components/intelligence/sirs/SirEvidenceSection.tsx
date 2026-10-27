'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ConfirmationModal, FormModal } from '@/components/ui/modal-patterns';
import { AssessmentPanel } from '../AssessmentPanel';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Kind = 'INDICATOR' | 'THREAT_ACTOR' | 'CAMPAIGN';
type Candidate = { id: string; type: Kind; name: string; context: string };
type Evidence = { id: string; source: Candidate & { href: string }; relevanceNote: string | null; createdBy: { name: string }; createdAt: string; updatedAt: string };
const kinds: { value: Kind; label: string }[] = [
  { value: 'INDICATOR', label: 'Indicator' },
  { value: 'THREAT_ACTOR', label: 'Threat Actor' },
  { value: 'CAMPAIGN', label: 'Campaign' },
];

export function SirEvidenceSection({ sirId, role, tenantId }: { sirId: string; role: Role; tenantId: string }) {
  const [items, setItems] = useState<Evidence[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [kind, setKind] = useState<Kind>('INDICATOR');
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const [note, setNote] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<Evidence | null>(null);
  const [detachItem, setDetachItem] = useState<Evidence | null>(null);
  const [archivedEvidenceId, setArchivedEvidenceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [notice, setNotice] = useState('');
  const canManage = role !== 'USER';
  const tenantQuery = role === 'SUPER_ADMIN' ? `tenantId=${encodeURIComponent(tenantId)}` : '';
  const base = `${API}/intelligence/sirs/${encodeURIComponent(sirId)}/evidence`;
  const suffix = tenantQuery ? `?${tenantQuery}` : '';

  const load = useCallback(async () => {
    if (role === 'SUPER_ADMIN' && !tenantId) return;
    setLoading(true); setError('');
    try {
      const response = await fetch(`${base}${suffix}`, { credentials: 'include', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not load evidence');
      setItems(data as Evidence[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load evidence'); }
    finally { setLoading(false); }
  }, [base, suffix, role, tenantId]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!addOpen || (role === 'SUPER_ADMIN' && !tenantId)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true); setDialogError('');
      try {
        const params = new URLSearchParams({ type: kind, search: search.trim() });
        if (tenantQuery) params.set('tenantId', tenantId);
        const response = await fetch(`${base}/search?${params}`, { credentials: 'include', signal: controller.signal, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Could not search evidence');
        setCandidates(data as Candidate[]);
      } catch (cause) {
        if (!controller.signal.aborted) { setCandidates([]); setDialogError(cause instanceof Error ? cause.message : 'Could not search evidence'); }
      } finally { if (!controller.signal.aborted) setSearching(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [addOpen, kind, search, base, role, tenantId, tenantQuery]);

  async function mutate(method: string, path: string, body?: object) {
    const response = await fetch(`${base}${path}${suffix}`, { method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Evidence action failed');
    return data;
  }

  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!chosen) return;
    setSaving(true); setDialogError('');
    try {
      await mutate('POST', '', { type: kind, sourceId: chosen.id, relevanceNote: note });
      setAddOpen(false); setChosen(null); setNote(''); setNotice('Evidence linked.'); await load();
    } catch (cause) { setDialogError(cause instanceof Error ? cause.message : 'Could not link evidence'); }
    finally { setSaving(false); }
  }

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editItem) return;
    setSaving(true); setDialogError('');
    try {
      await mutate('PATCH', `/${encodeURIComponent(editItem.id)}`, { relevanceNote: note });
      setEditItem(null); setNotice('Relevance note saved.'); await load();
    } catch (cause) { setDialogError(cause instanceof Error ? cause.message : 'Could not save relevance note'); }
    finally { setSaving(false); }
  }

  async function detach() {
    if (!detachItem) return;
    setSaving(true); setDialogError('');
    try {
      const result: { archivedAssessments?: boolean } = await mutate('DELETE', `/${encodeURIComponent(detachItem.id)}`);
      setArchivedEvidenceId(result.archivedAssessments ? detachItem.id : null);
      setDetachItem(null); setNotice('Evidence detached.'); await load();
    } catch (cause) { setDialogError(cause instanceof Error ? cause.message : 'Could not detach evidence'); }
    finally { setSaving(false); }
  }

  return <section className="sir-evidence" aria-label="Linked evidence">
    <div className="sir-evidence-head"><div><h3>Linked evidence</h3><p>Existing intelligence records supporting this SIR. Explain their relevance in the analyst answer.</p></div>{canManage && <Button variant="outline" onClick={() => { setKind('INDICATOR'); setSearch(''); setChosen(null); setNote(''); setDialogError(''); setAddOpen(true); }}>Add Evidence</Button>}</div>
    {notice && <p role="status" className="pir-notice">{notice}</p>}
    {archivedEvidenceId && <AssessmentPanel kind="evidence" sirId={sirId} evidenceId={archivedEvidenceId} role={role} tenantId={tenantId} />}
    {error && <p role="alert" className="error">{error} <Button variant="outline" onClick={() => void load()}>Retry</Button></p>}
    {loading ? <p role="status">Loading evidence...</p> : !error && (items.length ? <div className="sir-evidence-list">{items.map(item => <article className="sir-evidence-card" key={item.id}><div><span className="pir-reference">{kinds.find(value => value.value === item.source.type)?.label}</span><h4>{item.source.name}</h4><p>{item.source.context}</p>{item.relevanceNote && <p><strong>Relevance:</strong> {item.relevanceNote}</p>}<small>Linked by {item.createdBy.name} · {new Date(item.createdAt).toLocaleDateString()}</small></div><div className="sir-evidence-actions"><Link href={`${item.source.href}${role === 'SUPER_ADMIN' ? `&${tenantQuery}` : ''}`}>View source</Link>{canManage && <><Button variant="outline" onClick={() => { setEditItem(item); setNote(item.relevanceNote || ''); setDialogError(''); }}>Edit note</Button><Button variant="outline" onClick={() => { setDetachItem(item); setDialogError(''); }}>Detach</Button></>}</div><AssessmentPanel kind="evidence" sirId={sirId} evidenceId={item.id} role={role} tenantId={tenantId} /></article>)}</div> : <p>No evidence linked yet.</p>)}
    <FormModal open={addOpen} onOpenChange={setAddOpen} title="Add Evidence" onSubmit={event => void attach(event)} loading={saving} error={dialogError} submitLabel="Link evidence" submitDisabled={!chosen}>
      <div className="pir-form">
        <label>Intelligence type<select value={kind} onChange={event => { setKind(event.target.value as Kind); setChosen(null); }}>{kinds.map(value => <option key={value.value} value={value.value}>{value.label}</option>)}</select></label>
        <label>Search existing records<input value={search} onChange={event => { setSearch(event.target.value); setChosen(null); }} placeholder="Name or indicator value" /></label>
        <div className="sir-evidence-results" aria-label="Eligible evidence">{searching ? <p>Searching...</p> : candidates.length ? candidates.map(value => <button type="button" key={value.id} className={chosen?.id === value.id ? 'selected' : ''} onClick={() => setChosen(value)}><strong>{value.name}</strong><span>{value.context}</span></button>) : <p>No eligible records found.</p>}</div>
        <label>Relevance note<textarea maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder="How does this record relate to the SIR?" /></label>
      </div>
    </FormModal>
    <FormModal open={!!editItem} onOpenChange={open => { if (!open) setEditItem(null); }} title="Edit relevance note" onSubmit={event => void update(event)} loading={saving} error={dialogError} submitLabel="Save note"><div className="pir-form"><p>{editItem?.source.name}</p><label>Relevance note<textarea maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label></div></FormModal>
    <ConfirmationModal open={!!detachItem} onOpenChange={open => { if (!open) setDetachItem(null); }} title="Detach evidence" target={detachItem?.source.name} consequence="The intelligence source remains available." confirmLabel="Detach evidence" loading={saving} error={dialogError} onConfirm={detach} />
  </section>;
}
