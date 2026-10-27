'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useThreatIntelligenceTenant } from '../ThreatIntelligenceShell';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Recipient = { id: string; name: string; email: string };
type Feedback = { id: string; relevance: number; answeredRequirement: string; actionability: number; comments: string | null; furtherIntelligenceRequest: string | null; submittedAt: string; followUp?: { status: string; updatedAt: string } | null };
type History = { id: string; status: string; disseminatedAt: string; viewedAt: string | null; message: string | null; recipient: Recipient; sender: { name: string }; feedback: Feedback | null };
type Snapshot = { reference: string; title: string; summary: string; keyFindings: string | null; content: string; recommendedActions: string | null; informationGaps: string | null; confidence: string | null; tlp: string; reportType: string; pir: { reference: string }; stakeholder: { name: string }; sirs: { id: string; reference: string; title: string; analystAnswer: string | null }[]; evidence: { id: string; relevanceNote: string | null; source: { type: string; name: string } | null }[] };
type Received = { id: string; status: string; message: string | null; disseminatedAt: string; viewedAt: string | null; feedback: { id: string; followUp?: { status: string } | null } | null; report: { id: string; reference: string; title: string; tlp: string; pir: { reference: string } | null; stakeholder: { name: string } | null }; sender: { name: string } };
type Viewed = { id: string; snapshot: Snapshot; message: string | null; feedback: Feedback | null };
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}/intelligence/reports/dissemination${path}`, { credentials: 'include', cache: 'no-store', ...init });
  const result: T & { message?: string | string[] } = await response.json();
  if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(', ') : result.message || `Request failed (${response.status})`);
  return result;
}
function detail(error: unknown) { return error instanceof Error ? error.message : 'Request failed'; }

export function DisseminateReport({ reportId, role }: { reportId: string; role: Role }) {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const [open, setOpen] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [reason, setReason] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const query = role === 'SUPER_ADMIN' && tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  const load = useCallback(async () => {
    if (role === 'SUPER_ADMIN' && (!ready || !tenantId)) return;
    setBusy(true); setError('');
    try {
      const [eligible, previous] = await Promise.all([
        request<{ recipients: Recipient[]; reason: string | null }>(`/${reportId}/recipients${query}`),
        request<History[]>(`/${reportId}/history${query}`),
      ]);
      setRecipients(eligible.recipients); setReason(eligible.reason); setHistory(previous);
      setSelectedId(eligible.recipients[0]?.id || '');
    } catch (cause) { setError(detail(cause)); } finally { setBusy(false); }
  }, [reportId, role, ready, tenantId, query]);
  useEffect(() => { if (open) void load(); }, [open, load]);
  async function send(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await request(`/${reportId}/send${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipientId: selectedId, message }) });
      setNotice('Report is available in the recipient’s Received Reports.'); setMessage(''); await load();
    } catch (cause) { setError(detail(cause)); } finally { setBusy(false); }
  }
  return <div className="dissemination"><Button view="outlined" size="s" onClick={() => setOpen(value => !value)}>{open ? 'Close distribution' : 'Disseminate / feedback'}</Button>{open && <Card><h4>Internal dissemination</h4><p>Only the active, authorized responsible user of this report’s stakeholder can receive it.</p>{busy && <p role="status">Loading distribution...</p>}{error && <p className="error" role="alert">{error}</p>}{notice && <p className="success" role="status">{notice}</p>}{recipients.length ? <form onSubmit={event => void send(event)} className="dissemination-form"><label>Recipient<select value={selectedId} onChange={event => setSelectedId(event.target.value)}>{recipients.map(person => <option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}</select></label><label>Accompanying message (optional)<textarea maxLength={1000} value={message} onChange={event => setMessage(event.target.value)} /></label><Button view="action" size="s" type="submit" disabled={busy || !selectedId}>Make available</Button></form> : !busy && <p>{reason || 'No eligible recipient.'}</p>}<h4>Distribution history and feedback</h4>{history.length ? <div className="dissemination-history">{history.map(item => <article key={item.id}><strong>{item.recipient.name}</strong> · {item.status === 'VIEWED' ? 'Viewed' : 'Available'} · {new Date(item.disseminatedAt).toLocaleString()}<p>Sent by {item.sender.name}{item.message ? ` · ${item.message}` : ''}</p>{item.feedback ? <div><strong>Feedback · {new Date(item.feedback.submittedAt).toLocaleString()}</strong><p>Relevance {item.feedback.relevance}/5 · Requirement {item.feedback.answeredRequirement.toLowerCase()} · Actionability {item.feedback.actionability}/5</p>{item.feedback.comments && <p>{item.feedback.comments}</p>}{item.feedback.furtherIntelligenceRequest && <p>Further intelligence: {item.feedback.furtherIntelligenceRequest}</p>}</div> : <p>No feedback submitted.</p>}</article>)}</div> : <p>No distributions yet.</p>}</Card>}</div>;
}

export function ReceivedReports() {
  const [items, setItems] = useState<Received[]>([]);
  const [selected, setSelected] = useState<Viewed | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [relevance, setRelevance] = useState(3);
  const [answeredRequirement, setAnsweredRequirement] = useState('PARTIALLY');
  const [actionability, setActionability] = useState(3);
  const [comments, setComments] = useState('');
  const [furtherIntelligenceRequest, setFurtherIntelligenceRequest] = useState('');
  const load = useCallback(async () => { setLoading(true); try { setItems(await request<Received[]>('/received')); } catch (cause) { setError(detail(cause)); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function view(id: string) { setBusy(true); setError(''); try { setSelected(await request<Viewed>(`/received/${id}`)); await load(); } catch (cause) { setError(detail(cause)); } finally { setBusy(false); } }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!selected) return; setBusy(true); setError('');
    try { const feedback = await request<Feedback>(`/received/${selected.id}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relevance, answeredRequirement, actionability, comments, furtherIntelligenceRequest }) }); setSelected({ ...selected, feedback }); setNotice('Feedback submitted.'); await load(); }
    catch (cause) { setError(detail(cause)); } finally { setBusy(false); }
  }
  return <section className="analysis-reports received-reports">
    <div className="source-heading"><div><span className="source-eyebrow">INTERNAL DISTRIBUTION</span><h2>Received Reports</h2><p>Finalized reports explicitly shared with your account.</p></div></div>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="success" role="status">{notice}</p>}
    {selected ? <Card><div className="analysis-editor-head"><div><span className="source-eyebrow">FINAL · {selected.snapshot.tlp}</span><h3>{selected.snapshot.reference} · {selected.snapshot.title}</h3></div><Button view="outlined" size="s" onClick={() => setSelected(null)}>Back to received reports</Button></div>
      <p className="analysis-frozen">Finalized snapshot. This read-only assessment is the version shared with you.</p>{selected.message && <p><strong>Sender message:</strong> {selected.message}</p>}<SnapshotBody snapshot={selected.snapshot} />
      {selected.feedback ? <><p className="success">Feedback submitted on {new Date(selected.feedback.submittedAt).toLocaleString()}.</p>{selected.feedback.followUp && <p>Follow-up status: {selected.feedback.followUp.status.replaceAll('_', ' ')}. Updated {new Date(selected.feedback.followUp.updatedAt).toLocaleString()}.</p>}</> : <form className="dissemination-form" onSubmit={event => void submit(event)}><h4>Stakeholder feedback</h4><label>Intelligence relevance<select value={relevance} onChange={event => setRelevance(Number(event.target.value))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} / 5</option>)}</select></label><label>Did this answer the stated requirement?<select value={answeredRequirement} onChange={event => setAnsweredRequirement(event.target.value)}><option value="YES">Yes</option><option value="PARTIALLY">Partially</option><option value="NO">No</option></select></label><label>Actionability / usefulness<select value={actionability} onChange={event => setActionability(Number(event.target.value))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} / 5</option>)}</select></label><label>Comments (optional)<textarea maxLength={3000} value={comments} onChange={event => setComments(event.target.value)} /></label><label>Further intelligence request (optional)<textarea maxLength={3000} value={furtherIntelligenceRequest} onChange={event => setFurtherIntelligenceRequest(event.target.value)} /></label><Button view="action" size="s" type="submit" disabled={busy}>Submit feedback</Button></form>}</Card>
      : <Card>{loading ? <p role="status">Loading received reports...</p> : items.length ? <div className="received-list">{items.map(item => <article key={item.id}><div><strong>{item.report.reference} · {item.report.title}</strong><p>{item.report.pir?.reference} · {item.report.stakeholder?.name} · {item.report.tlp} · {item.status === 'VIEWED' ? 'Viewed' : 'Available'}</p><small>From {item.sender.name} · {new Date(item.disseminatedAt).toLocaleString()}{item.feedback ? ' · Feedback submitted' : ''}</small></div><Button view="outlined" size="s" disabled={busy} onClick={() => void view(item.id)}>View report</Button></article>)}</div> : <p>No reports have been shared with your account.</p>}</Card>}
  </section>;
}
function SnapshotBody({ snapshot }: { snapshot: Snapshot }) {
  const sections = [['Executive summary', snapshot.summary], ['Key findings', snapshot.keyFindings], ['Analytical assessment', snapshot.content], ['Recommended actions', snapshot.recommendedActions], ['Information gaps and limitations', snapshot.informationGaps]] as const;
  return <div className="analysis-document"><p><strong>PIR:</strong> {snapshot.pir.reference} · <strong>Stakeholder:</strong> {snapshot.stakeholder.name}</p><p><strong>Confidence:</strong> {snapshot.confidence || 'Not set'} · <strong>Type:</strong> {snapshot.reportType}</p>{sections.map(([heading, value]) => <section key={heading}><h4>{heading}</h4><p>{value || 'Not written'}</p></section>)}<section><h4>Selected SIRs and recorded answers</h4>{snapshot.sirs.map(sir => <div key={sir.id}><strong>{sir.reference} · {sir.title}</strong><p>{sir.analystAnswer || 'No answer recorded'}</p></div>)}</section><section><h4>Cited evidence</h4>{snapshot.evidence.map(item => <div key={item.id}><strong>{item.source?.type} · {item.source?.name}</strong><p>{item.relevanceNote || 'No relevance note'}</p></div>)}</section></div>;
}
