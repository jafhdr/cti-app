'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/modal-patterns';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function CreateCaseModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<string>('MEDIUM');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API}/cases`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, priority }),
      });

      if (!response.ok) throw new Error('Failed to create case');
      
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return <FormModal open onOpenChange={open => { if (!open) onClose(); }} title="Create New Case" onSubmit={handleSubmit} loading={loading} error={error} submitLabel="Create Case">
    <label htmlFor="case-title">Title<input id="case-title" type="text" required value={title} onChange={event => setTitle(event.target.value)} placeholder="Case title" /></label>
    <label htmlFor="case-description">Description<textarea id="case-description" value={description} onChange={event => setDescription(event.target.value)} placeholder="Case description" rows={3} /></label>
    <label htmlFor="case-priority">Priority<select id="case-priority" value={priority} onChange={event => setPriority(event.target.value)}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select></label>
  </FormModal>;
}

export default CreateCaseModal;
