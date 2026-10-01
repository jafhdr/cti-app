'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Edit2, Loader } from 'lucide-react';
import Link from 'next/link';
import AssignModal from './assign-modal';
import EditCaseModal from './edit-case-modal';
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
  alerts?: readonly { readonly id: string; readonly assetId: string | null; readonly asset: { readonly id: string; readonly value: string } | null; readonly findingId: string | null; readonly finding: { readonly id: string; readonly title: string } | null; readonly vulnerabilityCorrelationId: string | null; readonly vulnerabilityCorrelation: { readonly vulnerability: { readonly cveId: string; readonly name: string } } | null; readonly changeEventId: string | null; readonly changeEvent: { readonly type: string; readonly detectedAt: string } | null; readonly severity: string; readonly source: string; readonly firstSeenAt: string; readonly title: string }[];
}

export default function CaseDetailPage() {
  const canMutateCases = useCaseMutationAccess();
  const params = useParams();
  const caseId = params.id as string;
  
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

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
    <main className="case-page editorial-module">
      <div className="max-w-4xl mx-auto">
        <Link href="/cases" className="case-back-link mb-6 flex items-center gap-2">
          <ArrowLeft size={20} />
          Back
        </Link>

        <div className="editorial-heading"><span className="source-eyebrow">CASE INTELLIGENCE WORKSPACE · {caseDetail.caseNumber}</span><h1>{caseDetail.title}</h1><p>{caseDetail.tenant.name} · Updated {new Date(caseDetail.updatedAt).toLocaleString('id-ID')}</p></div>
        <section className="editorial-metrics" aria-label="Case status"><div><span>Status</span><strong className="editorial-text-metric">{caseDetail.status.replaceAll("_", " ")}</strong></div><div><span>Priority</span><strong className="editorial-text-metric">{caseDetail.priority}</strong></div><div><span>Severity</span><strong className="editorial-text-metric">{caseDetail.severity}</strong></div><div><span>Assignee</span><strong className="editorial-text-metric">{caseDetail.assignee?.name ?? "Unassigned"}</strong></div></section>
        {caseDetail.alerts?.length ? <section className="case-panel mb-4 p-8" aria-label="Attack Surface Context"><span className="source-eyebrow">ASM PROVENANCE</span><h2 className="case-detail-section-title">Attack Surface Context</h2>{caseDetail.alerts.map(alert => <dl className="asm-detail" key={alert.id}><div><dt>Asset</dt><dd>{alert.asset?.value ?? alert.assetId ?? '-'}</dd></div><div><dt>Alert</dt><dd>{alert.title} ({alert.id})</dd></div><div><dt>Finding</dt><dd>{alert.finding?.title ?? alert.findingId ?? '-'}</dd></div><div><dt>Vulnerability / CVE</dt><dd>{alert.vulnerabilityCorrelation?.vulnerability.cveId ?? alert.vulnerabilityCorrelationId ?? '-'}</dd></div><div><dt>Change event</dt><dd>{alert.changeEvent?.type ?? alert.changeEventId ?? '-'}</dd></div><div><dt>Severity / source</dt><dd>{alert.severity} / {alert.source}</dd></div><div><dt>Detected</dt><dd>{new Date(alert.firstSeenAt).toLocaleString('id-ID')}</dd></div></dl>)}</section> : null}
        {canMutateCases && <div className="case-operations"><span className="source-eyebrow">CASE OPERATIONS</span><div><button type="button" onClick={() => setShowEditModal(true)} className="soc-button-outline">Edit case</button></div></div>}
        <nav aria-label="Bagian detail case" className="case-panel mb-4 flex gap-2 overflow-x-auto p-2">
          <a href="#overview" className="case-detail-tab">Overview</a>
          <a href="#investigation" className="case-detail-tab">Investigation</a>
          <a href="#related-intelligence" className="case-detail-tab">Intelligence</a>
          <a href="#evidence" className="case-detail-tab">Evidence</a>
          <a href="#activity" className="case-detail-tab">Activity</a>
        </nav>

        <section id="overview" aria-labelledby="overview-heading" className="case-panel scroll-mt-4 p-8">
          <div className="border-b pb-6 mb-6">
            <p className="mb-2 text-sm text-muted-foreground">{caseDetail.caseNumber}</p>
            <h2 id="overview-heading" className="case-detail-section-title">Case overview</h2>

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

          {caseDetail.description ? (
            <div className="mb-8">
              <h2 className="mb-3 text-lg font-semibold text-card-foreground">Description</h2>
              <p className="text-foreground">{caseDetail.description}</p>
            </div>
          ) : <p className="mb-8 text-muted-foreground">No description available.</p>}

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
        <InvestigationPanel caseId={caseDetail.id} section="investigation" />
        <section id="related-intelligence" aria-labelledby="related-intelligence-heading" className="scroll-mt-4">
          <div className="mt-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Case intelligence</p>
            <h2 id="related-intelligence-heading" className="mt-1 text-xl font-semibold text-card-foreground">Related Intelligence</h2>
          </div>
          <RelatedIndicators caseId={caseDetail.id} canMutate={canMutateCases} />
          <RelatedThreatActors caseId={caseDetail.id} canMutate={canMutateCases} />
          <RelatedCampaigns caseId={caseDetail.id} canMutate={canMutateCases} />
        </section>
        <InvestigationPanel caseId={caseDetail.id} section="evidence" />
        <InvestigationPanel caseId={caseDetail.id} section="activity" />
      </div>

      {showEditModal && <EditCaseModal caseDetail={caseDetail} onClose={() => setShowEditModal(false)} onSuccess={() => { setShowEditModal(false); void fetchCaseDetail(); }} />}
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
