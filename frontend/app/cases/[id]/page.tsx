'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Edit2, Loader } from 'lucide-react';
import Link from 'next/link';
import AssignModal from './assign-modal';
import { InvestigationPanel } from './investigation-panel';
import { RelatedIndicators } from './related-indicators';
import { RelatedThreatActors } from './related-threat-actors';
import { RelatedCampaigns } from './related-campaigns';
import { useCaseMutationAccess } from '../case-access';
import { Button } from '@/components/ui/button';

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
      <div role="status" aria-label="Memuat detail case" className="case-page flex items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <main className="case-page">
        <div className="max-w-4xl mx-auto">
          <Link href="/cases" className="case-back-link mb-6 flex items-center gap-2">
            <ArrowLeft size={20} />
            Back
          </Link>
          <div className="error rounded px-6 py-4">
            {error}
          </div>
        </div>
      </main>
    );
  }

  if (!caseDetail) {
    return (
      <main className="case-page">
        <div className="max-w-4xl mx-auto">
          <Link href="/cases" className="case-back-link mb-6 flex items-center gap-2">
            <ArrowLeft size={20} />
            Back
          </Link>
          <div className="case-panel p-12 text-center text-muted-foreground">
            Case not found
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="case-page">
      <div className="max-w-4xl mx-auto">
        <Link href="/cases" className="case-back-link mb-6 flex items-center gap-2">
          <ArrowLeft size={20} />
          Back
        </Link>

        <nav aria-label="Bagian detail case" className="case-panel mb-4 flex gap-2 overflow-x-auto p-2">
          <a href="#overview" className="case-detail-tab">Overview</a>
          <a href="#investigation" className="case-detail-tab">Investigation</a>
          <a href="#related-intelligence" className="case-detail-tab">Related Intelligence</a>
        </nav>

        <section id="overview" aria-labelledby="overview-heading" className="case-panel scroll-mt-4 p-8">
          <div className="border-b pb-6 mb-6">
            <p className="mb-2 text-sm text-muted-foreground">{caseDetail.caseNumber}</p>
            <h1 id="overview-heading" className="case-title">{caseDetail.title}</h1>

            <div className="flex gap-3 flex-wrap mt-4">
              <span className="case-badge case-badge-info">
                {caseDetail.status}
              </span>
              <span className="case-badge case-badge-warning">
                {caseDetail.priority}
              </span>
              <span className="case-badge case-badge-danger">
                {caseDetail.severity}
              </span>
            </div>
          </div>

          {caseDetail.description && (
            <div className="mb-8">
              <h2 className="mb-3 text-lg font-semibold text-card-foreground">Description</h2>
              <p className="text-foreground">{caseDetail.description}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <div className="case-subpanel p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-card-foreground">Assigned To</h3>
                {canMutateCases && (
                  <Button
                    type="button"
                    size="s"
                    onClick={() => setShowAssignModal(true)}
                    className="gap-2"
                  >
                    <Edit2 size={14} />
                    Change
                  </Button>
                )}
              </div>
              <p className="text-sm text-foreground">
                {caseDetail.assignee ? caseDetail.assignee.name : 'Unassigned'}
              </p>
            </div>

            <div className="case-subpanel p-6">
              <h3 className="mb-2 font-semibold text-card-foreground">Created By</h3>
              <p className="text-sm text-foreground">{caseDetail.creator.name}</p>
            </div>
          </div>

          <div className="case-subpanel p-6">
            <p className="mb-1 text-xs text-muted-foreground">Created: {new Date(caseDetail.createdAt).toLocaleString('id-ID')}</p>
            <p className="text-xs text-muted-foreground">Updated: {new Date(caseDetail.updatedAt).toLocaleString('id-ID')}</p>
          </div>
        </section>
        <InvestigationPanel caseId={caseDetail.id} />
        <section id="related-intelligence" aria-labelledby="related-intelligence-heading" className="scroll-mt-4">
          <div className="mt-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Case intelligence</p>
            <h2 id="related-intelligence-heading" className="mt-1 text-xl font-semibold text-card-foreground">Related Intelligence</h2>
          </div>
          <RelatedIndicators caseId={caseDetail.id} canMutate={canMutateCases} />
          <RelatedThreatActors caseId={caseDetail.id} canMutate={canMutateCases} />
          <RelatedCampaigns caseId={caseDetail.id} canMutate={canMutateCases} />
        </section>
      </div>

      {showAssignModal && (
        <AssignModal
          caseId={caseDetail.id}
          currentAssigneeId={caseDetail.assignee?.id}
          onClose={() => setShowAssignModal(false)}
          onSuccess={handleAssignSuccess}
        />
      )}
    </main>
  );
}
