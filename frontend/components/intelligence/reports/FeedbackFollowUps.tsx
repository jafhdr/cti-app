'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useThreatIntelligenceTenant } from '../ThreatIntelligenceShell';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type SirLink = { readonly sirId: string; readonly sir: { readonly reference: string; readonly title: string } };
type Review = { readonly id: string; readonly submittedAt: string; readonly answeredRequirement: string; readonly comments: string | null; readonly furtherIntelligenceRequest: string | null; readonly report: { readonly id: string; readonly reference: string; readonly title: string; readonly pirId: string; readonly pir: { readonly reference: string }; readonly analysisSirs: readonly SirLink[] } };
type FollowUp = { readonly id: string; readonly reference: string; readonly summary: string; readonly status: string; readonly priority: string; readonly newRequirementNeeded: boolean; readonly dueDate: string | null; readonly sirId: string | null; readonly reportId: string; readonly pirId: string; readonly assigneeId: string | null; readonly assignee: { readonly name: string } | null; readonly report: { readonly reference: string; readonly analysisSirs: readonly SirLink[] }; readonly pir: { readonly reference: string }; readonly sir: { readonly reference: string } | null; readonly resolutionNote: string | null; readonly history?: readonly { readonly id: string; readonly action: string; readonly createdAt: string }[] };
type Page<T> = { readonly items: readonly T[]; readonly total: number; readonly page: number; readonly limit: number };
type Analyst = { readonly id: string; readonly name: string; readonly email: string; readonly role: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}/intelligence/feedback-follow-ups${path}`, { credentials: 'include', cache: 'no-store', ...init });
  const result = await response.json();
  if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(', ') : result.message || `Request failed (${response.status})`);
  return result;
}
function body(value: object): RequestInit { return { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }; }
function errorText(value: unknown): string { return value instanceof Error ? value.message : 'Request failed'; }

export function FeedbackFollowUps({ role, pirId, sirId }: { readonly role: 'SUPER_ADMIN' | 'ADMIN' | 'USER'; readonly pirId?: string; readonly sirId?: string }) {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const [review, setReview] = useState<Page<Review> | null>(null);
  const [followUps, setFollowUps] = useState<Page<FollowUp> | null>(null);
  const [selected, setSelected] = useState<FollowUp | null>(null);
  const [page, setPage] = useState(1);
  const [reviewPage, setReviewPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [draft, setDraft] = useState<Review | null>(null);
  const [reference, setReference] = useState('');
  const [summary, setSummary] = useState('');
  const [sir, setSir] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [newRequirementNeeded, setNewRequirementNeeded] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [analysts, setAnalysts] = useState<readonly Analyst[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const enabled = role !== 'USER' && (role !== 'SUPER_ADMIN' || (ready && Boolean(tenantId)));
  const params = new URLSearchParams({ page: String(page), limit: '10' });
  if (role === 'SUPER_ADMIN' && tenantId) params.set('tenantId', tenantId);
  if (pirId) params.set('pirId', pirId);
  if (sirId) params.set('sirId', sirId);
  const baseQuery = params.toString();
  const reviewParams = new URLSearchParams(baseQuery);
  reviewParams.set('page', String(reviewPage));
  const reviewQuery = reviewParams.toString();
  const listQuery = `${baseQuery}${statusFilter ? `&status=${statusFilter}` : ''}`;
  const tenantQuery = role === 'SUPER_ADMIN' && tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  const load = useCallback(async () => {
    if (!enabled) return;
    setError('');
    try {
      const [queue, tracked] = await Promise.all([
        sirId ? Promise.resolve(null) : api<Page<Review>>(`/review?${reviewQuery}`),
        api<Page<FollowUp>>(`?${listQuery}`),
      ]);
      setReview(queue); setFollowUps(tracked);
    } catch (cause) { setError(errorText(cause)); }
  }, [enabled, sirId, reviewQuery, listQuery]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!enabled) return;
    fetch(`${API}/intelligence/pirs/responsible-users${tenantQuery}`, { credentials: 'include', cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error('Unable to load analysts'); return response.json(); })
      .then((rows: Analyst[]) => setAnalysts(rows.filter(row => row.role === 'ADMIN')))
      .catch(cause => setError(errorText(cause)));
  }, [enabled, tenantQuery]);
  async function create(event: FormEvent) {
    event.preventDefault(); if (!draft) return;
    setBusy(true); setError('');
    try {
      const created = await api<FollowUp>(`/from-feedback/${draft.id}${tenantQuery}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference, summary, priority, newRequirementNeeded, sirId: sir || undefined, assigneeId: assigneeId || undefined, dueDate: dueDate ? `${dueDate}T00:00:00.000Z` : undefined }) });
      setDraft(null); setSelected(created); setNotice('Follow-up created.'); await load();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function mutate(path: string, payload: object) {
    if (!selected) return;
    setBusy(true); setError('');
    try { const changed = await api<FollowUp>(`/${selected.id}${path}${tenantQuery}`, body(payload)); setSelected(changed); setNotice('Follow-up updated.'); await load(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function open(item: FollowUp) {
    setBusy(true); setError('');
    try {
      const detail = await api<FollowUp>(`/${item.id}${tenantQuery}`);
      setSelected(detail); setSir(detail.sirId || ''); setPriority(detail.priority); setNewRequirementNeeded(detail.newRequirementNeeded); setAssigneeId(detail.assigneeId || ''); setDueDate(detail.dueDate?.slice(0, 10) || ''); setNote('');
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  if (role === 'USER') return null;
  if (!enabled) return <Card><p role="status">Select a tenant to review feedback follow-ups.</p></Card>;
  return <section className="feedback-follow-ups" aria-label="Feedback follow-ups">
    <div className="source-heading"><div><span className="source-eyebrow">FEEDBACK TO REQUIREMENT</span><h2>{sirId || pirId ? 'Related feedback follow-ups' : 'Feedback follow-ups'}</h2><p>Report feedback stays unchanged. An SIR association is always selected explicitly.</p></div></div>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="success" role="status">{notice}</p>}
    {!followUps && !error && <p role="status">Loading feedback follow-ups...</p>}
    {review && <Card><h3>Awaiting review ({review.total})</h3>{review.items.length ? <div className="feedback-follow-ups-list">{review.items.map(item => <article key={item.id}><strong>{item.report.reference} · {item.report.title}</strong><p>PIR {item.report.pir.reference} · {new Date(item.submittedAt).toLocaleString()} · Requirement {item.answeredRequirement.toLowerCase()}</p>{item.furtherIntelligenceRequest && <p>Further intelligence: {item.furtherIntelligenceRequest}</p>}{item.comments && <p>{item.comments}</p>}<Button view="outlined" size="s" onClick={() => { setDraft(item); setReference(''); setSummary(item.furtherIntelligenceRequest || item.comments || ''); setSir(''); setNewRequirementNeeded(false); }}>Create follow-up</Button></article>)}</div> : <p>No feedback awaiting action on this page.</p>}</Card>}
    {review && review.total > review.limit && <div className="feedback-follow-ups-actions" aria-label="Feedback review pages"><Button view="outlined" size="s" disabled={reviewPage === 1} onClick={() => setReviewPage(value => value - 1)}>Previous reviews</Button><span>Review page {reviewPage}</span><Button view="outlined" size="s" disabled={reviewPage * review.limit >= review.total} onClick={() => setReviewPage(value => value + 1)}>Next reviews</Button></div>}
    {draft && <Card><form className="dissemination-form" onSubmit={event => void create(event)}><h3>Create follow-up for {draft.report.reference}</h3><label>Reference<input required maxLength={40} value={reference} onChange={event => setReference(event.target.value)} /></label><label>Required action<textarea required maxLength={3000} value={summary} onChange={event => setSummary(event.target.value)} /></label><label className="feedback-follow-ups-check"><input type="checkbox" checked={newRequirementNeeded} onChange={event => setNewRequirementNeeded(event.target.checked)} />New PIR or SIR needed; record need only</label><label>Priority<select value={priority} onChange={event => setPriority(event.target.value)}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(value => <option key={value}>{value}</option>)}</select></label><label>Selected SIR (optional)<select value={sir} onChange={event => setSir(event.target.value)}><option value="">Report / PIR feedback only</option>{draft.report.analysisSirs.map(link => <option key={link.sirId} value={link.sirId}>{link.sir.reference} · {link.sir.title}</option>)}</select></label><label>Responsible analyst (optional)<select value={assigneeId} onChange={event => setAssigneeId(event.target.value)}><option value="">Unassigned</option>{analysts.map(person => <option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}</select></label><label>Due date (optional)<input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label><div className="feedback-follow-ups-actions"><Button view="action" size="s" type="submit" disabled={busy}>Create</Button><Button view="outlined" size="s" onClick={() => setDraft(null)}>Cancel</Button></div></form></Card>}
    {followUps && <Card><div className="feedback-follow-ups-head"><h3>Tracked actions ({followUps?.total ?? 0})</h3><label>Status<select value={statusFilter} onChange={event => { setPage(1); setStatusFilter(event.target.value); }}><option value="">All</option>{['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'].map(value => <option key={value}>{value}</option>)}</select></label></div>{followUps?.items.length ? <div className="feedback-follow-ups-list">{followUps.items.map(item => <article key={item.id}><strong>{item.reference} · {item.summary}</strong><p>{item.status.replaceAll('_', ' ')} · {item.priority}{item.newRequirementNeeded ? ' · New requirement needed' : ''} · {item.assignee?.name || 'Unassigned'} · {item.dueDate ? new Date(item.dueDate).toLocaleDateString() : 'No due date'}</p><p><Link href={`/threat-intelligence/pirs?pirId=${encodeURIComponent(item.pirId)}`}>PIR {item.pir.reference}</Link>{item.sir && <> · <Link href={`/threat-intelligence/sirs?sirId=${encodeURIComponent(item.sirId || '')}`}>SIR {item.sir.reference}</Link></>} · Report {item.report.reference}</p><Button view="outlined" size="s" disabled={busy} onClick={() => void open(item)}>Review action</Button></article>)}</div> : <p>No tracked follow-ups on this page.</p>}<div className="feedback-follow-ups-actions"><Button view="outlined" size="s" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</Button><span>Page {page}</span><Button view="outlined" size="s" disabled={!followUps || page * followUps.limit >= followUps.total} onClick={() => setPage(value => value + 1)}>Next</Button></div></Card>}
    {selected && <Card><div className="feedback-follow-ups-head"><div><h3>{selected.reference}</h3><p>{selected.summary}</p></div><Button view="outlined" size="s" onClick={() => setSelected(null)}>Close</Button></div><p>Feedback about report {selected.report.reference} and PIR {selected.pir.reference}{selected.sir ? `; explicitly linked to SIR ${selected.sir.reference}` : '; no SIR attribution'}.</p><div className="dissemination-form"><label className="feedback-follow-ups-check"><input type="checkbox" disabled={['RESOLVED', 'DISMISSED'].includes(selected.status)} checked={newRequirementNeeded} onChange={event => setNewRequirementNeeded(event.target.checked)} />New PIR or SIR needed; record need only</label><label>Priority<select disabled={['RESOLVED', 'DISMISSED'].includes(selected.status)} value={priority} onChange={event => setPriority(event.target.value)}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(value => <option key={value}>{value}</option>)}</select></label><label>Explicit SIR association<select disabled={['RESOLVED', 'DISMISSED'].includes(selected.status)} value={sir} onChange={event => setSir(event.target.value)}><option value="">Report / PIR only</option>{selected.report.analysisSirs.map(link => <option key={link.sirId} value={link.sirId}>{link.sir.reference} · {link.sir.title}</option>)}</select></label><label>Responsible analyst<select disabled={['RESOLVED', 'DISMISSED'].includes(selected.status)} value={assigneeId} onChange={event => setAssigneeId(event.target.value)}><option value="">Unassigned</option>{analysts.map(person => <option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}</select></label><label>Due date<input disabled={['RESOLVED', 'DISMISSED'].includes(selected.status)} type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label><Button view="outlined" size="s" disabled={busy || ['RESOLVED', 'DISMISSED'].includes(selected.status)} onClick={() => void mutate('', { priority, newRequirementNeeded, sirId: sir || null, assigneeId: assigneeId || null, dueDate: dueDate ? `${dueDate}T00:00:00.000Z` : null })}>Save assignment and association</Button><label>Resolution or dismissal note<textarea disabled={['RESOLVED', 'DISMISSED'].includes(selected.status)} maxLength={3000} value={note} onChange={event => setNote(event.target.value)} /></label><div className="feedback-follow-ups-actions">{selected.status === 'OPEN' && <Button view="outlined" size="s" disabled={busy} onClick={() => void mutate('/status', { status: 'IN_PROGRESS' })}>Start work</Button>}{selected.status === 'IN_PROGRESS' && <Button view="action" size="s" disabled={busy || !note.trim()} onClick={() => void mutate('/status', { status: 'RESOLVED', note })}>Resolve</Button>}{['OPEN', 'IN_PROGRESS'].includes(selected.status) && <Button view="outlined" size="s" disabled={busy || !note.trim()} onClick={() => void mutate('/status', { status: 'DISMISSED', note })}>Dismiss with reason</Button>}</div></div>{selected.resolutionNote && <p><strong>Recorded outcome:</strong> {selected.resolutionNote}</p>}<h4>History</h4>{selected.history?.length ? <ol>{selected.history.map(event => <li key={event.id}>{new Date(event.createdAt).toLocaleString()} · {event.action.replaceAll('_', ' ')}</li>)}</ol> : <p>Select an action to load history.</p>}</Card>}
  </section>;
}
