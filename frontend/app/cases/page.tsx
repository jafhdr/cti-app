'use client';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import CreateCaseModal from './create-case-modal';
import { useCaseMutationAccess } from './layout';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Case {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  priority: string;
  assignee?: { name: string };
  createdAt: string;
}

export default function CasesPage() {
  const canMutateCases = useCaseMutationAccess();
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCases();
  }, [page]);

  const fetchCases = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API}/cases?page=${page}&limit=25`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setCases(data.items);
      setTotal(data.total);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div></div>;

  return (
    <main className="case-page">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="case-title">Case Management</h1>
          {canMutateCases && (
            <button onClick={() => setShowCreateModal(true)} className="soc-button-primary flex items-center gap-2 rounded px-4 py-2">
              <Plus size={20} />
              New Case
            </button>
          )}
        </div>

        {error ? (
          <div role="alert" className="error rounded p-6">
            <p>{error}</p>
            <button type="button" onClick={() => void fetchCases()} className="mt-3 font-semibold underline">Retry</button>
          </div>
        ) : cases.length === 0 ? (
          <div className="case-panel p-12 text-center text-muted-foreground">No cases found</div>
        ) : (
          <div className="case-panel overflow-hidden">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Case #</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Title</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Priority</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Assignee</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {cases.map((c) => (
                  <tr key={c.id} className="cursor-pointer">
                    <td className="px-6 py-4 text-sm font-mono text-primary">
                      <a href={`/cases/${c.id}`} className="hover:underline">{c.caseNumber}</a>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <a href={`/cases/${c.id}`} className="hover:underline">{c.title}</a>
                    </td>
                    <td className="px-6 py-4 text-sm"><span className="case-badge case-badge-info">{c.status}</span></td>
                    <td className="px-6 py-4 text-sm"><span className="case-badge case-badge-warning">{c.priority}</span></td>
                    <td className="px-6 py-4 text-sm">{c.assignee?.name || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-between items-center mt-6">
          <div className="text-sm text-muted-foreground">Showing {Math.min(page * 25, total)} of {total}</div>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(page - 1)} className="soc-button-outline rounded px-4 py-2 disabled:opacity-50">Previous</button>
            <button disabled={page * 25 >= total} onClick={() => setPage(page + 1)} className="soc-button-outline rounded px-4 py-2 disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>

      {showCreateModal && <CreateCaseModal onClose={() => setShowCreateModal(false)} onSuccess={fetchCases} />}
    </main>
  );
}
