'use client';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import CreateCaseModal from './create-case-modal';

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
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    fetchCases();
  }, [page]);

  const fetchCases = async () => {
    try {
      const response = await fetch(`/api/cases?page=${page}&limit=25`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setCases(data.items);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div></div>;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold">Case Management</h1>
          <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg">
            <Plus size={20} />
            New Case
          </button>
        </div>

        {cases.length === 0 ? (
          <div className="bg-white rounded-lg p-12 text-center text-gray-600">No cases found</div>
        ) : (
          <div className="bg-white rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
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
                  <tr key={c.id} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-6 py-4 text-sm font-mono text-blue-600">
                      <a href={`/cases/${c.id}`} className="hover:underline">{c.caseNumber}</a>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <a href={`/cases/${c.id}`} className="hover:underline">{c.title}</a>
                    </td>
                    <td className="px-6 py-4 text-sm"><span className="px-3 py-1 rounded-full text-xs bg-blue-100 text-blue-800">{c.status}</span></td>
                    <td className="px-6 py-4 text-sm"><span className="px-3 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">{c.priority}</span></td>
                    <td className="px-6 py-4 text-sm">{c.assignee?.name || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-between items-center mt-6">
          <div className="text-sm text-gray-600">Showing {Math.min(page * 25, total)} of {total}</div>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(page - 1)} className="px-4 py-2 border rounded-lg disabled:opacity-50">Previous</button>
            <button disabled={page * 25 >= total} onClick={() => setPage(page + 1)} className="px-4 py-2 border rounded-lg disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>

      {showCreateModal && <CreateCaseModal onClose={() => setShowCreateModal(false)} onSuccess={fetchCases} />}
    </div>
  );
}
