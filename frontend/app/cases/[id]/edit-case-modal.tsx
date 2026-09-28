'use client';

import { useState, type FormEvent } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type EditableCase = { id: string; title: string; description?: string; status: string; priority: string };

type Props = { caseDetail: EditableCase; onClose: () => void; onSuccess: () => void };

export default function EditCaseModal({ caseDetail, onClose, onSuccess }: Props) {
  const [title, setTitle] = useState(caseDetail.title);
  const [description, setDescription] = useState(caseDetail.description || '');
  const [status, setStatus] = useState(caseDetail.status);
  const [priority, setPriority] = useState(caseDetail.priority);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(null);
    try {
      const response = await fetch(`${API}/cases/${caseDetail.id}`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description, status, priority }),
      });
      if (!response.ok) throw new Error('Failed to update case');
      onSuccess();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Failed to update case'); }
    finally { setSaving(false); }
  }

  return <div className="case-modal-backdrop fixed inset-0 z-50 flex items-center justify-center" role="presentation">
    <div className="case-modal mx-4 w-full max-w-md" role="dialog" aria-modal="true" aria-labelledby="edit-case-title">
      <span className="source-eyebrow">CASE OPERATIONS</span><h2 id="edit-case-title" className="mb-4 text-2xl font-bold text-card-foreground">Edit case</h2>
      {error && <p role="alert" className="error mb-4 rounded px-3 py-2">{error}</p>}
      <form onSubmit={save} className="space-y-4">
        <label className="block text-sm font-medium">Title<input required value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="block text-sm font-medium">Description<textarea rows={4} value={description} onChange={event => setDescription(event.target.value)} /></label>
        <label className="block text-sm font-medium">Status<select value={status} onChange={event => setStatus(event.target.value)}>{['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
        <label className="block text-sm font-medium">Priority<select value={priority} onChange={event => setPriority(event.target.value)}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <div className="flex gap-3 pt-2"><button type="button" onClick={onClose} className="soc-button-outline flex-1 rounded px-4 py-2">Cancel</button><button type="submit" disabled={saving} className="soc-button-primary flex-1 rounded px-4 py-2 disabled:opacity-50">{saving ? 'Saving...' : 'Save changes'}</button></div>
      </form>
    </div>
  </div>;
}
