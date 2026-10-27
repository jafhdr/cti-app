'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Assessment = { readonly id: string; readonly grade: string; readonly rationale: string; readonly consistency?: string | null; readonly accuracy?: string | null; readonly timeliness?: string | null; readonly trackRecord?: string | null; readonly supportingInformation?: string | null; readonly conflictingInformation?: string | null; readonly assessedAt: string; readonly reviewAt?: string | null; readonly assessedBy: { readonly id: string; readonly name: string } };
type Response = { readonly subject: { readonly id: string; readonly name?: string; readonly type?: string; readonly sirId?: string; readonly recordId?: string; readonly archived: boolean }; readonly current: Assessment | null; readonly history: readonly Assessment[]; readonly state: 'ASSESSED' | 'UNASSESSED'; readonly legacyRegistryGrade?: string | null; readonly note: string; readonly page: number; readonly total: number; readonly totalPages: number };
type Props = { readonly kind: 'source'; readonly sourceId: string; readonly role: Role; readonly tenantId: string } | { readonly kind: 'evidence'; readonly sirId: string; readonly evidenceId: string; readonly role: Role; readonly tenantId: string };
const sourceGrades = [['A', 'Consistently reliable'], ['B', 'Generally reliable'], ['C', 'Mixed record'], ['D', 'Limited record'], ['E', 'Repeatedly inaccurate'], ['F', 'Documented deception']] as const;
const evidenceGrades = [['1', 'Independently corroborated'], ['2', 'Supported'], ['3', 'Plausible, uncorroborated'], ['4', 'Conflicting information'], ['5', 'Contradicted']] as const;
const date = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function AssessmentPanel(props: Props) {
  const { role, tenantId } = props;
  const path = props.kind === 'source' ? `sources/${encodeURIComponent(props.sourceId)}` : `sirs/${encodeURIComponent(props.sirId)}/evidence/${encodeURIComponent(props.evidenceId)}`;
  const tenantQuery = role === 'SUPER_ADMIN' ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [grade, setGrade] = useState('');
  const [rationale, setRationale] = useState('');
  const [context, setContext] = useState('');
  const [counterpoint, setCounterpoint] = useState('');
  const [timeliness, setTimeliness] = useState('');
  const [trackRecord, setTrackRecord] = useState('');
  const [reviewAt, setReviewAt] = useState('');
  const [page, setPage] = useState(1);
  const grades = props.kind === 'source' ? sourceGrades : evidenceGrades;
  const load = useCallback(async () => {
    if (role === 'SUPER_ADMIN' && !tenantId) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ page: String(page), limit: '10' });
      if (role === 'SUPER_ADMIN') query.set('tenantId', tenantId);
      const response = await fetch(`${API}/intelligence/assessments/${path}?${query}`, { credentials: 'include', cache: 'no-store' });
      const result: Response & { message?: string } = await response.json();
      if (!response.ok) throw new Error(result.message || 'Assessment unavailable');
      setData(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Assessment unavailable'); }
    finally { setLoading(false); }
  }, [path, role, tenantId, page]);
  useEffect(() => { void load(); }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    const body = props.kind === 'source' ? { grade, rationale, consistency: context, accuracy: counterpoint, timeliness, trackRecord, reviewAt: reviewAt ? new Date(reviewAt).toISOString() : undefined } : { grade, rationale, supportingInformation: context, conflictingInformation: counterpoint };
    try {
      const response = await fetch(`${API}/intelligence/assessments/${path}${tenantQuery}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result: Response & { message?: string } = await response.json();
      if (!response.ok) throw new Error(result.message || 'Assessment could not be saved');
      setPage(1); setData(result); setEditing(false); setGrade(''); setRationale(''); setContext(''); setCounterpoint(''); setTimeliness(''); setTrackRecord(''); setReviewAt('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Assessment could not be saved'); }
    finally { setSaving(false); }
  }
  return <section className="assessment-panel" aria-label={props.kind === 'source' ? 'Source reliability assessment' : 'Evidence credibility assessment'}>
    <div className="assessment-head"><div><h4>{props.kind === 'source' ? 'Source reliability assessment' : 'Information credibility assessment'}</h4><p>{props.kind === 'source' ? 'Human judgment about this source’s track record.' : 'Human judgment about this particular linked evidence.'}</p></div>{role !== 'USER' && !data?.subject.archived && <Button variant="outline" onClick={() => setEditing(value => !value)}>{editing ? 'Cancel' : 'Record assessment'}</Button>}</div>
    {loading ? <p role="status">Loading assessment...</p> : error && !data ? <p role="alert">{error} <Button variant="outline" onClick={() => void load()}>Retry</Button></p> : data ? <>
      <p className="assessment-note">{data.note}</p>
      {data.subject.archived && <p className="assessment-legacy"><strong>Historical assessment · target deleted.</strong> {props.kind === 'source' ? `${data.subject.name} · ${data.subject.type} · original source ${data.subject.id}` : `${data.subject.type} record ${data.subject.recordId} · original evidence ${data.subject.id} · SIR ${data.subject.sirId}`}. These are captured facts; the operational link is no longer live.</p>}
      {props.kind === 'source' && data.legacyRegistryGrade && <p className="assessment-legacy">Legacy registry grade: {data.legacyRegistryGrade}. This default or editable registry value is not an analyst assessment.</p>}
      {data.current ? <div className="assessment-current"><strong>Current grade {data.current.grade} · {grades.find(([value]) => value === data.current?.grade)?.[1]}</strong><p>{data.current.rationale}</p><p>Assessed by {data.current.assessedBy.name} · {date(data.current.assessedAt)}{data.current.reviewAt ? ` · Review ${date(data.current.reviewAt)}` : ''}</p>{data.current.supportingInformation && <p>Supporting: {data.current.supportingInformation}</p>}{data.current.conflictingInformation && <p>Conflicting: {data.current.conflictingInformation}</p>}{data.current.consistency && <p>Consistency: {data.current.consistency}</p>}{data.current.accuracy && <p>Accuracy: {data.current.accuracy}</p>}{data.current.timeliness && <p>Timeliness: {data.current.timeliness}</p>}{data.current.trackRecord && <p>Track record: {data.current.trackRecord}</p>}</div> : <p>Unassessed. No analyst grade or rationale has been recorded.</p>}
      {data.total > 1 && <details><summary>Assessment history ({data.total} records)</summary><ol>{(page === 1 ? data.history.slice(1) : data.history).map(item => <li key={item.id}>Grade {item.grade} · {item.assessedBy.name} · {date(item.assessedAt)}<p>{item.rationale}</p></li>)}</ol>{data.totalPages > 1 && <div className="assessment-pages"><Button variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</Button><span>Page {page} of {data.totalPages}</span><Button variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(value => value + 1)}>Next</Button></div>}</details>}
    </> : <p>Select a tenant to view assessments.</p>}
    {error && data && <p role="alert">{error}</p>}
    {editing && <form onSubmit={event => void submit(event)} className="assessment-form"><label>Grade<select required value={grade} onChange={event => setGrade(event.target.value)}><option value="">Choose a grade</option>{grades.map(([value, label]) => <option value={value} key={value}>{value} · {label}</option>)}</select></label><label>Rationale<textarea required maxLength={2000} value={rationale} onChange={event => setRationale(event.target.value)} /></label><label>{props.kind === 'source' ? 'Consistency observations' : 'Supporting information'}<textarea maxLength={1000} value={context} onChange={event => setContext(event.target.value)} /></label><label>{props.kind === 'source' ? 'Accuracy observations' : 'Conflicting information'}<textarea maxLength={1000} value={counterpoint} onChange={event => setCounterpoint(event.target.value)} /></label>{props.kind === 'source' && <><label>Timeliness observations<textarea maxLength={1000} value={timeliness} onChange={event => setTimeliness(event.target.value)} /></label><label>Observed track record<textarea maxLength={1000} value={trackRecord} onChange={event => setTrackRecord(event.target.value)} /></label><label>Review time (optional)<input type="datetime-local" value={reviewAt} onChange={event => setReviewAt(event.target.value)} /></label></>}<Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save assessment'}</Button></form>}
  </section>;
}
