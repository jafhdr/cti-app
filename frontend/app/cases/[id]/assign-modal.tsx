'use client';
import { useEffect, useState } from 'react';
import { Loader, X } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface User {
  id: string;
  name: string;
  email: string;
  role?: string;
}

interface AssignModalProps {
  caseId: string;
  currentAssigneeId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AssignModal({ caseId, currentAssigneeId, onClose, onSuccess }: AssignModalProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState(currentAssigneeId || '');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API}/cases/assignable-users`, { credentials: 'include' });
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
      const response = await fetch(`${API}/cases/${caseId}/assign`, {
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

  return (
    <div className="case-modal-backdrop fixed inset-0 z-50 flex items-center justify-center">
      <div className="case-modal mx-4 w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-card-foreground">Assign Case</h2>
          <button aria-label="Close" onClick={onClose} className="soc-button-ghost rounded p-1">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="error mb-4 rounded px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        ) : (
          <>
            <div className="mb-6">
              <label className="mb-2 block text-sm font-medium">
                Select User
              </label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full px-3 py-2"
              >
                <option value="">-- Select a user --</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.email})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="soc-button-outline flex-1 rounded px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={handleAssign}
                disabled={submitting || !selectedUserId}
                className="soc-button-primary flex-1 rounded px-4 py-2 disabled:opacity-50"
              >
                {submitting ? 'Assigning...' : 'Assign'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
