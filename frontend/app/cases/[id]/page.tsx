'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Edit2, Loader } from 'lucide-react';
import Link from 'next/link';
import AssignModal from './assign-modal';
import { InvestigationPanel } from './investigation-panel';
import { useCaseMutationAccess } from '../layout';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface User {
  id: string;
  name: string;
  email: string;
  role?: string;
}

interface CaseDetail {
  id: string;
  caseNumber: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  severity: string;
  assignee?: User;
  creator: User;
  createdAt: string;
  updatedAt: string;
  tenant: { id: string; name: string; slug: string };
}

export default function CaseDetailPage() {
  const canMutateCases = useCaseMutationAccess();
  const params = useParams();
  const caseId = params.id as string;
  
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);

  useEffect(() => {
    fetchCaseDetail();
  }, [caseId]);

  const fetchCaseDetail = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API}/cases/${caseId}`, { credentials: 'include' });
      if (!response.ok) {
        if (response.status === 404) throw new Error('Case tidak ditemukan');
        throw new Error('Failed to fetch case detail');
      }
      const data = await response.json();
      setCaseDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleAssignSuccess = () => {
    setShowAssignModal(false);
    fetchCaseDetail();
  };

  if (loading) {
    return (
      <div role="status" aria-label="Memuat detail case" className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-4xl mx-auto">
          <Link href="/cases" className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6">
            <ArrowLeft size={20} />
            Back
          </Link>
          <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-lg">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!caseDetail) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-4xl mx-auto">
          <Link href="/cases" className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6">
            <ArrowLeft size={20} />
            Back
          </Link>
          <div className="bg-gray-50 rounded-lg p-12 text-center text-gray-600">
            Case not found
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6" style={{ colorScheme: 'light' }}>
      <div className="max-w-4xl mx-auto">
        <Link href="/cases" className="mb-6 flex items-center gap-2 !text-blue-600 hover:!text-blue-700">
          <ArrowLeft size={20} />
          Back
        </Link>

        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="border-b pb-6 mb-6">
            <p className="text-sm text-gray-600 mb-2">{caseDetail.caseNumber}</p>
            <h1 className="text-3xl font-bold text-slate-900">{caseDetail.title}</h1>

            <div className="flex gap-3 flex-wrap mt-4">
              <span className="px-4 py-2 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                {caseDetail.status}
              </span>
              <span className="px-4 py-2 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                {caseDetail.priority}
              </span>
              <span className="px-4 py-2 rounded-full text-sm font-medium bg-orange-100 text-orange-800">
                {caseDetail.severity}
              </span>
            </div>
          </div>

          {caseDetail.description && (
            <div className="mb-8">
              <h2 className="mb-3 text-lg font-semibold !text-slate-900">Description</h2>
              <p className="!text-slate-700">{caseDetail.description}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <div className="bg-gray-50 rounded-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold !text-slate-900">Assigned To</h3>
                {canMutateCases && (
                  <button
                    onClick={() => setShowAssignModal(true)}
                    className="flex items-center gap-2 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    <Edit2 size={14} />
                    Change
                  </button>
                )}
              </div>
              <p className="text-sm !text-slate-700">
                {caseDetail.assignee ? caseDetail.assignee.name : 'Unassigned'}
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="mb-2 font-semibold !text-slate-900">Created By</h3>
              <p className="text-sm !text-slate-700">{caseDetail.creator.name}</p>
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-6">
            <p className="text-xs text-gray-600 mb-1">Created: {new Date(caseDetail.createdAt).toLocaleString('id-ID')}</p>
            <p className="text-xs text-gray-600">Updated: {new Date(caseDetail.updatedAt).toLocaleString('id-ID')}</p>
          </div>
        </div>
        <InvestigationPanel caseId={caseDetail.id} />
      </div>

      {showAssignModal && (
        <AssignModal
          caseId={caseDetail.id}
          currentAssigneeId={caseDetail.assignee?.id}
          onClose={() => setShowAssignModal(false)}
          onSuccess={handleAssignSuccess}
        />
      )}
    </div>
  );
}
