'use client';

import { useState } from 'react';
import { caseWorkspaceUrl, useCaseTenant } from '../case-access';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
export type CaseEvidenceItem = { readonly id: string; readonly name: string; readonly type: string; readonly description: string | null; readonly source: string | null; readonly createdBy: string };
type EvidenceRevision = { readonly id: string | null; readonly revision: number; readonly name: string; readonly type: string; readonly description: string | null; readonly source: string | null; readonly authorId: string; readonly recordedAt: string; readonly integrityKind: string };
type EvidenceHistory = { readonly integrityKind: string; readonly revisions: readonly EvidenceRevision[] };

export function CaseEvidenceHistory({ caseId, evidence, canManage, currentUserId, busy, readOnly, revise }: {
  readonly caseId: string; readonly evidence: readonly CaseEvidenceItem[]; readonly canManage: boolean; readonly currentUserId: string;
  readonly busy: boolean; readonly readOnly: boolean; readonly revise: (id: string, form: { name: string; type: string; description: string; source: string }) => Promise<boolean>;
}) {
  const { role, tenantId } = useCaseTenant();
  const [history, setHistory] = useState<Record<string, EvidenceHistory>>({});
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', type: '', description: '', source: '' });

  async function load(id: string) {
    setError('');
    try {
      const response = await fetch(caseWorkspaceUrl(`${API}/cases/${caseId}/evidence/${id}/revisions`, role, tenantId), { credentials: 'include' });
      if (!response.ok) throw new Error('Riwayat evidence gagal dimuat');
      const result: EvidenceHistory = await response.json();
      setHistory(previous => ({ ...previous, [id]: result }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Riwayat evidence gagal dimuat'); }
  }

  return <div className="case-subpanel p-5">
    <h3 className="font-semibold">Evidence history</h3>
    <p className="mt-1 text-sm text-muted-foreground">Metadata only. File bytes and cryptographic file integrity are not verified.</p>
    {error ? <p role="alert" className="error mt-3 rounded p-3">{error}</p> : null}
    {evidence.length ? <ul className="mt-4 space-y-3">{evidence.map(item => <li key={item.id} className="min-w-0 rounded border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{item.name}</strong><p className="text-sm text-muted-foreground">{item.type} · {item.source || 'No source'} · Metadata only</p></div>
        <div className="flex gap-2"><button type="button" className="soc-button-outline" onClick={() => void load(item.id)}>History</button>
          {!readOnly && (canManage || currentUserId === item.createdBy) ? <button type="button" className="soc-button-outline" onClick={() => { setEditing(item.id); setForm({ name: item.name, type: item.type, description: item.description || '', source: item.source || '' }); }}>Revise</button> : null}</div></div>
      {history[item.id] ? <ol className="mt-3 space-y-2 border-t pt-3 text-sm">{history[item.id].revisions.map(revision => <li key={revision.id ?? 'legacy'} className="rounded border p-2"><strong>Revision {revision.revision}</strong> · {revision.integrityKind.replaceAll('_', ' ')} · {new Date(revision.recordedAt).toLocaleString('id-ID')}<p>{revision.name} · {revision.type} · {revision.source || 'No source'}</p>{revision.description ? <p className="text-muted-foreground">{revision.description}</p> : null}</li>)}</ol> : null}
      {editing === item.id ? <form className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void revise(item.id, form).then(ok => { if (ok) { setEditing(null); void load(item.id); } }); }}>
        <label className="text-sm">Name<input aria-label="Evidence revision name" className="mt-1 w-full rounded border p-2" required maxLength={255} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label className="text-sm">Type<input aria-label="Evidence revision type" className="mt-1 w-full rounded border p-2" required maxLength={100} value={form.type} onChange={event => setForm({ ...form, type: event.target.value })} /></label>
        <label className="text-sm">Source reference<input aria-label="Evidence revision source" className="mt-1 w-full rounded border p-2" maxLength={2000} value={form.source} onChange={event => setForm({ ...form, source: event.target.value })} /></label>
        <label className="text-sm">Description<input aria-label="Evidence revision description" className="mt-1 w-full rounded border p-2" maxLength={5000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
        <div className="flex gap-2"><button type="submit" className="soc-button-outline" disabled={busy}>Save revision</button><button type="button" className="soc-button-outline" onClick={() => setEditing(null)}>Cancel</button></div>
      </form> : null}
    </li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No evidence yet. Add evidence in the inventory above before review.</p>}
  </div>;
}
