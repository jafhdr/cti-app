'use client';
import { useEffect, useState } from 'react';
import { Loader } from 'lucide-react';
import { FormModal } from '@/components/ui/modal-patterns';
import { caseWorkspaceUrl, useCaseTenant } from '../case-access';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface User {
  id: string;
  name: string;
  email: string;
  role?: string;
}

interface AssignModalProps {
  caseId: string;
  tenantId: string;
  currentAssigneeId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AssignModal({ caseId, tenantId, currentAssigneeId, onClose, onSuccess }: AssignModalProps) {
  const workspace = useCaseTenant();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState(currentAssigneeId || '');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchUsers();
  }, [tenantId]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API}/cases/assignable-users?tenantId=${encodeURIComponent(tenantId)}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedUserId) {
      setError('Please select a user');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const response = await fetch(caseWorkspaceUrl(`${API}/cases/${caseId}/assign`, workspace.role, workspace.tenantId), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeId: selectedUserId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to assign case');
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  return <FormModal open onOpenChange={open => { if (!open) onClose(); }} title="Assign Case" onSubmit={event => { event.preventDefault(); void handleAssign(); }} loading={submitting} error={error} submitLabel="Assign" submitDisabled={loading || !selectedUserId}>
    {loading ? <div role="status" aria-label="Loading users" className="flex justify-center py-8"><Loader className="h-6 w-6 animate-spin text-primary" /></div> :
      <label htmlFor="case-assignee">Select User<select id="case-assignee" value={selectedUserId} onChange={event => setSelectedUserId(event.target.value)}><option value="">-- Select a user --</option>{users.map(user => <option key={user.id} value={user.id}>{user.name} ({user.email})</option>)}</select></label>}
  </FormModal>;
}
