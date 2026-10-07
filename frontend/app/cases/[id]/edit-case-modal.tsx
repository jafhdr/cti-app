'use client';

import { useState, type FormEvent } from 'react';
import { FormModal } from '@/components/ui/modal-patterns';
import { caseWorkspaceUrl, useCaseTenant } from '../case-access';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type EditableCase = { id: string; title: string; description?: string; status: string; priority: string };

type Props = { caseDetail: EditableCase; onClose: () => void; onSuccess: () => void };

export default function EditCaseModal({ caseDetail, onClose, onSuccess }: Props) {
  const { role, tenantId } = useCaseTenant();
  const [title, setTitle] = useState(caseDetail.title);
  const [description, setDescription] = useState(caseDetail.description || '');
  const [status, setStatus] = useState(caseDetail.status);
  const [priority, setPriority] = useState(caseDetail.priority);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextStatuses: Record<string, readonly string[]> = {
    OPEN: ['IN_PROGRESS'],
    IN_PROGRESS: ['RESOLVED'],
    RESOLVED: ['IN_PROGRESS', 'CLOSED'],
    CLOSED: [],
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(null);
    try {
      const response = await fetch(caseWorkspaceUrl(`${API}/cases/${caseDetail.id}`, role, tenantId), {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description, status, priority }),
      });
      if (!response.ok) throw new Error('Failed to update case');
      onSuccess();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Failed to update case'); }
    finally { setSaving(false); }
  }

  return <FormModal open onOpenChange={open => { if (!open) onClose(); }} title="Edit case" onSubmit={save} loading={saving} error={error} submitLabel="Save changes">
    <label>Title<input required value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label>Description<textarea rows={4} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <label>Status<select value={status} onChange={event => setStatus(event.target.value)}>{[caseDetail.status, ...(nextStatuses[caseDetail.status] || [])].map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
    <label>Priority<select value={priority} onChange={event => setPriority(event.target.value)}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
  </FormModal>;
}
