'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock3, FileSearch, Loader2, MessageSquareText, Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type Person = { readonly id: string; readonly name: string; readonly email: string };
type Note = { readonly id: string; readonly content: string; readonly createdAt: string; readonly author: Person };
type Evidence = { readonly id: string; readonly name: string; readonly type: string; readonly description: string | null; readonly source: string | null; readonly createdAt: string; readonly creator: Person };
type Activity = { readonly id: string; readonly action: string; readonly createdAt: string };

const formatTime = (value: string) => new Date(value).toLocaleString('id-ID');
const actionLabel: Readonly<Record<string, string>> = {
  CASE_CREATED: 'Case dibuat',
  CASE_UPDATED: 'Case diperbarui',
  CASE_ASSIGNED: 'Case ditugaskan',
  CASE_REASSIGNED: 'Case ditugaskan ulang',
  NOTE_ADDED: 'Catatan investigasi ditambahkan',
  EVIDENCE_ADDED: 'Evidence ditambahkan',
  INDICATOR_LINKED: 'Indicator dihubungkan',
  INDICATOR_UNLINKED: 'Indicator dilepas',
  THREAT_ACTOR_LINKED: 'Threat Actor dihubungkan',
  THREAT_ACTOR_UNLINKED: 'Threat Actor dilepas',
  CAMPAIGN_LINKED: 'Campaign dihubungkan',
  CAMPAIGN_UNLINKED: 'Campaign dilepas',
};

export function InvestigationPanel({ caseId, section }: { readonly caseId: string; readonly section: 'investigation' | 'evidence' | 'activity' }) {
  const [notes, setNotes] = useState<readonly Note[]>([]);
  const [evidence, setEvidence] = useState<readonly Evidence[]>([]);
  const [activity, setActivity] = useState<readonly Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [evidenceForm, setEvidenceForm] = useState({ name: '', type: '', description: '', source: '' });
  const [noteRequestId, setNoteRequestId] = useState(() => crypto.randomUUID());
  const [evidenceRequestId, setEvidenceRequestId] = useState(() => crypto.randomUUID());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const paths = section === 'investigation' ? ['notes'] : [section];
      const responses = await Promise.all(paths.map((path) => fetch(`${API}/cases/${caseId}/${path}`, { credentials: 'include' })));
      if (responses.some((response) => !response.ok)) throw new Error('Investigation data gagal dimuat');
      const [items] = await Promise.all(responses.map((response) => response.json()));
      if (section === 'investigation') setNotes(items);
      if (section === 'evidence') setEvidence(items);
      if (section === 'activity') setActivity(items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Investigation data gagal dimuat');
    } finally {
      setLoading(false);
    }
  }, [caseId, section]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (section !== 'activity') return;
    const refresh = () => { void load(); };
    window.addEventListener('case-activity-updated', refresh);
    return () => window.removeEventListener('case-activity-updated', refresh);
  }, [load, section]);

  const submit = async (path: 'notes' | 'evidence', body: object) => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${API}/cases/${caseId}/${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error((await response.json()).message || 'Perubahan gagal disimpan');
      setNote('');
      setEvidenceForm({ name: '', type: '', description: '', source: '' });
      if (path === 'notes') setNoteRequestId(crypto.randomUUID());
      else setEvidenceRequestId(crypto.randomUUID());
      await load();
      window.dispatchEvent(new Event('case-activity-updated'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Perubahan gagal disimpan');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div data-testid="investigation-loading" role="status" aria-label="Memuat data investigasi" className="flex items-center justify-center rounded-md border border-input bg-card py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <section id={section} aria-label={section} className="mt-8 scroll-mt-4 space-y-6">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Case workspace</p><h2 id={`${section}-heading`} className="mt-1 text-xl font-semibold text-card-foreground">{section === 'investigation' ? 'Investigation' : section === 'evidence' ? 'Evidence' : 'Activity'}</h2><p className="mt-2 text-sm text-muted-foreground">{section === 'investigation' ? 'Document findings and investigation notes.' : section === 'evidence' ? 'Evidence collected for this case.' : 'Investigation event history.'}</p></div>
      {error && <div role="alert" className="rounded-md border border-destructive bg-card px-4 py-3 text-sm text-destructive">{error}<button type="button" onClick={() => void load()} className="ml-3 font-semibold underline">Coba lagi</button></div>}
      {section === 'investigation' && <div className="flex flex-col gap-6 xl:flex-row">
        <Card view="outlined" className="min-w-0 flex-1 border-input p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold !text-card-foreground"><MessageSquareText className="h-5 w-5 text-primary" />Investigation Notes</h2>
          <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void submit('notes', { requestId: noteRequestId, content: note }); }}>
            <label htmlFor="investigation-note" className="flex flex-1 flex-col gap-1 text-xs font-semibold text-muted-foreground">Catatan investigasi<textarea id="investigation-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Tambahkan temuan investigasi..." className="min-h-32 resize-y rounded-sm border border-input !bg-card px-3 py-2 text-sm font-normal !text-card-foreground" required /></label>
            <button type="submit" aria-label="Tambah catatan" disabled={submitting || !note.trim()} className="self-end rounded-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground disabled:opacity-50">{submitting ? 'Menyimpan...' : 'Save note'}</button>
          </form>
          <div className="mt-5 space-y-3">
            {notes.length === 0 ? <p className="rounded-md bg-muted py-8 text-center text-sm text-muted-foreground">Belum ada catatan investigasi.</p> : notes.map((item) => <div key={item.id} className="rounded-md border border-input p-3"><p className="whitespace-pre-wrap text-sm text-card-foreground">{item.content}</p><p className="mt-2 text-xs text-muted-foreground">{item.author.name} / {formatTime(item.createdAt)}</p></div>)}
          </div>
        </Card>

      </div>}

      {section === 'evidence' && <Card view="outlined" className="min-w-0 border-input p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold !text-card-foreground"><FileSearch className="h-5 w-5 text-primary" />Evidence inventory</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="case-subpanel p-4"><p className="text-xs text-muted-foreground">Total evidence</p><strong className="text-xl text-card-foreground">{evidence.length}</strong></div><div className="case-subpanel p-4"><p className="text-xs text-muted-foreground">Recent</p><strong className="text-sm text-card-foreground">{evidence[0] ? formatTime(evidence[0].createdAt) : 'No data available'}</strong></div><div className="case-subpanel p-4"><p className="text-xs text-muted-foreground">Types</p><strong className="text-xl text-card-foreground">{new Set(evidence.map((item) => item.type)).size}</strong></div></div>
          <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void submit('evidence', { requestId: evidenceRequestId, ...evidenceForm }); }}>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">Nama evidence<input aria-label="Nama evidence" required placeholder="Nama evidence" value={evidenceForm.name} onChange={(event) => setEvidenceForm({ ...evidenceForm, name: event.target.value })} className="rounded-sm border border-input !bg-card px-3 py-2 text-sm font-normal !text-card-foreground" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">Tipe evidence<input aria-label="Tipe evidence" required placeholder="Tipe (file, log, URL...)" value={evidenceForm.type} onChange={(event) => setEvidenceForm({ ...evidenceForm, type: event.target.value })} className="rounded-sm border border-input !bg-card px-3 py-2 text-sm font-normal !text-card-foreground" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">Sumber evidence<input aria-label="Sumber evidence" placeholder="Sumber" value={evidenceForm.source} onChange={(event) => setEvidenceForm({ ...evidenceForm, source: event.target.value })} className="rounded-sm border border-input !bg-card px-3 py-2 text-sm font-normal !text-card-foreground" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">Deskripsi evidence<textarea aria-label="Deskripsi evidence" placeholder="Deskripsi" value={evidenceForm.description} onChange={(event) => setEvidenceForm({ ...evidenceForm, description: event.target.value })} className="min-h-16 resize-y rounded-sm border border-input !bg-card px-3 py-2 text-sm font-normal !text-card-foreground" /></label>
            <button type="submit" disabled={submitting || !evidenceForm.name.trim() || !evidenceForm.type.trim()} className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{submitting ? 'Menyimpan...' : 'Tambah Evidence'}</button>
          </form>
          <div className="mt-5 space-y-3">
            {evidence.length === 0 ? <p className="rounded-md bg-muted py-8 text-center text-sm text-muted-foreground">No evidence available for this case.</p> : evidence.map((item) => <details key={item.id} className="min-w-0 rounded-md border border-input p-3"><summary className="cursor-pointer text-sm font-medium text-card-foreground">{item.name} · {item.type}</summary><div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2"><p>Source: {item.source ?? 'Not available'}</p><p>Created: {formatTime(item.createdAt)}</p><p>Collected by: {item.creator.name}</p><p className="sm:col-span-2">Description: {item.description ?? 'No data available'}</p></div></details>)}
          </div>
        </Card>}

      {section === 'activity' && <Card view="outlined" className="border-input p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold !text-card-foreground"><Clock3 className="h-5 w-5 text-primary" />Activity Timeline</h2>
        <div className="mt-5 space-y-0">
          {activity.length === 0 ? <p className="rounded-md bg-muted py-8 text-center text-sm text-muted-foreground">Belum ada aktivitas investigasi.</p> : activity.map((item) => <div key={item.id} className="relative ml-2 border-l border-input pb-5 pl-5 last:pb-0"><span className="absolute -left-1.5 top-1 h-3 w-3 rounded-full bg-primary ring-4 ring-accent" /><p className="text-sm font-medium text-card-foreground">{actionLabel[item.action] ?? item.action}</p><p className="mt-1 text-xs text-muted-foreground">{formatTime(item.createdAt)}</p></div>)}
        </div>
      </Card>}
    </section>
  );
}
