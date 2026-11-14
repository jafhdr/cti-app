'use client';

import { useCallback, useEffect, useState } from 'react';
import { caseWorkspaceUrl, useCaseTenant } from '../case-access';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type TaskState = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
type Task = { id: string; title: string; description: string | null; state: TaskState; assigneeId: string; assignee: { name: string } };
type Handoff = { id: string; previousAssigneeName: string | null; newAssigneeName: string; reason: string; createdAt: string };
type Workflow = { revision: number; dueAt: string | null; overdue: boolean; status: string; assigneeId: string | null; canManage: boolean; currentUserId: string; tasks: Task[]; handoffs: Handoff[] };
type User = { id: string; name: string };

function localDateTime(iso: string): string {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function CaseWorkflowPanel({ caseId, onCaseChange, readOnly = false }: { caseId: string; onCaseChange: () => void; readOnly?: boolean }) {
  const { role, tenantId, ready } = useCaseTenant();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [handoffAssignee, setHandoffAssignee] = useState('');
  const [reason, setReason] = useState('');
  const [dueAt, setDueAt] = useState('');
  const url = useCallback((path: string) => caseWorkspaceUrl(`${API}/cases/${caseId}${path}`, role, tenantId), [caseId, role, tenantId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(url('/workflow'), { credentials: 'include', signal });
      if (response.status === 403) { setHidden(true); return; }
      if (!response.ok) throw new Error('Workflow tidak dapat dimuat');
      const data = await response.json() as Workflow;
      if (!signal?.aborted) { setWorkflow(data); setHidden(false); setDueAt(data.dueAt ? localDateTime(data.dueAt) : ''); }
      if (data.canManage) {
        const assignable = await fetch(caseWorkspaceUrl(`${API}/cases/assignable-users`, role, tenantId), { credentials: 'include', signal });
        if (assignable.ok && !signal?.aborted) setUsers(await assignable.json() as User[]);
      }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Workflow tidak dapat dimuat');
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [role, tenantId, url]);

  useEffect(() => { if (!ready) return; const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [ready, load]);

  async function mutate(path: string, method: 'POST' | 'PATCH', payload: Record<string, unknown>) {
    if (!workflow || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(url(path), { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, expectedRevision: workflow.revision }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(response.status === 409 ? 'Case berubah. Data terbaru telah dimuat; ulangi tindakan Anda.' : (body.message || 'Perubahan gagal'));
      }
      setTitle(''); setReason(''); setTaskAssignee(''); setHandoffAssignee('');
      await load(); onCaseChange();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Perubahan gagal'); await load(); }
    finally { setBusy(false); }
  }

  if (hidden) return null;
  const mayManage = Boolean(workflow?.canManage && !readOnly);
  return <section id="workflow" aria-labelledby="workflow-heading" className="case-panel mt-8 scroll-mt-4 p-8">
    <span className="source-eyebrow">CASE OPERATIONS</span>
    <h2 id="workflow-heading" className="case-detail-section-title">Workflow</h2>
    {loading && !workflow ? <p role="status">Memuat workflow…</p> : null}
    {error ? <p role="alert" className="error my-4 rounded p-3">{error}</p> : null}
    {workflow ? <div className="mt-6 space-y-6">
      <div className="case-subpanel p-5">
        <h3 className="font-semibold">Due date</h3>
        <p className="mt-2 text-sm">{workflow.dueAt ? new Date(workflow.dueAt).toLocaleString('id-ID') : 'Belum ditetapkan'} {workflow.overdue ? <strong className="case-badge case-badge-danger">Overdue</strong> : null}</p>
        {mayManage ? <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-sm">Due date (waktu lokal)<input aria-label="Due date" className="mt-1 block rounded border p-2" type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} /></label><button className="soc-button-outline" type="button" disabled={busy} onClick={() => void mutate('/due-date', 'PATCH', { dueAt: dueAt ? new Date(dueAt).toISOString() : null })}>Simpan due date</button></div> : null}
      </div>
      <div className="case-subpanel p-5">
        <h3 className="font-semibold">Tasks</h3>
        {workflow.tasks.length ? <ul className="mt-3 space-y-3">{workflow.tasks.map(task => <li key={task.id} className="rounded border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{task.title}</strong><p className="text-sm text-muted-foreground">{task.assignee.name} · {task.state.replaceAll('_', ' ')}</p></div>{(mayManage || (!readOnly && workflow.currentUserId === task.assigneeId)) && task.state !== 'DONE' && task.state !== 'CANCELLED' ? <div className="flex flex-wrap gap-2">{task.state === 'TODO' ? <button className="soc-button-outline" disabled={busy} onClick={() => void mutate(`/tasks/${task.id}`, 'PATCH', { state: 'IN_PROGRESS' })}>Mulai</button> : <button className="soc-button-outline" disabled={busy} onClick={() => void mutate(`/tasks/${task.id}`, 'PATCH', { state: 'DONE' })}>Selesai</button>}{mayManage ? <><button className="soc-button-outline" disabled={busy} onClick={() => void mutate(`/tasks/${task.id}`, 'PATCH', { state: 'CANCELLED' })}>Batalkan</button><select aria-label={`Assignee ${task.title}`} className="rounded border p-2" disabled={busy} value={task.assigneeId} onChange={event => void mutate(`/tasks/${task.id}`, 'PATCH', { assigneeId: event.target.value })}>{users.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></> : null}</div> : null}</div></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">Belum ada task.</p>}
        {mayManage ? <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void mutate('/tasks', 'POST', { title, assigneeId: taskAssignee }); }}><label className="text-sm">Task<input aria-label="Judul task" className="mt-1 block rounded border p-2" required maxLength={255} value={title} onChange={event => setTitle(event.target.value)} /></label><label className="text-sm">Assignee<select aria-label="Task assignee" className="mt-1 block rounded border p-2" required value={taskAssignee} onChange={event => setTaskAssignee(event.target.value)}><option value="">Pilih analis</option>{users.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><button className="soc-button-outline" disabled={busy}>Tambah task</button></form> : null}
      </div>
      <div className="case-subpanel p-5"><h3 className="font-semibold">Handoff</h3>
        {workflow.handoffs.length ? <ul className="mt-3 space-y-2 text-sm">{workflow.handoffs.map(item => <li key={item.id}>{item.previousAssigneeName ?? 'Unassigned'} → {item.newAssigneeName}: {item.reason} <span className="text-muted-foreground">({new Date(item.createdAt).toLocaleString('id-ID')})</span></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">Belum ada handoff.</p>}
        {mayManage ? <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void mutate('/handoff', 'POST', { assigneeId: handoffAssignee, reason }); }}><label className="text-sm">Assignee baru<select aria-label="Handoff assignee" className="mt-1 block rounded border p-2" required value={handoffAssignee} onChange={event => setHandoffAssignee(event.target.value)}><option value="">Pilih analis</option>{users.filter(person => person.id !== workflow.assigneeId).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="text-sm">Alasan<input aria-label="Alasan handoff" className="mt-1 block rounded border p-2" required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label><button className="soc-button-outline" disabled={busy}>Serahkan case</button></form> : null}
      </div>
    </div> : null}
  </section>;
}
