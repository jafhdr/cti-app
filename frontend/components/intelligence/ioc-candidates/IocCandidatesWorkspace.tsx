'use client';

import { AlertCircle, Check, Inbox, RotateCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useThreatIntelligenceTenant } from '../ThreatIntelligenceShell';
import type { CandidateReviewResult, IocCandidate } from './types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

export function IocCandidatesWorkspace({ role }: { readonly role: Role }) {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const [items, setItems] = useState<readonly IocCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState<{ readonly indicatorId?: string; readonly message: string } | null>(null);
  const tenantQuery = role === 'SUPER_ADMIN' ? `?tenantId=${encodeURIComponent(tenantId)}` : '';

  const load = useCallback(async () => {
    if (role === 'SUPER_ADMIN' && (!ready || !tenantId)) { setLoading(true); return; }
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API}/intelligence/ioc-candidates${tenantQuery}`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) { const errorBody: { readonly message?: string } = await response.json(); throw new Error(errorBody.message || 'Gagal memuat IOC candidate.'); }
      const body: readonly IocCandidate[] = await response.json();
      setItems(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Gagal memuat IOC candidate.'); }
    finally { setLoading(false); }
  }, [ready, role, tenantId, tenantQuery]);

  useEffect(() => { void load(); }, [load]);

  async function review(id: string, action: 'approve' | 'reject'): Promise<void> {
    setBusyId(id); setError(''); setNotice(null);
    try {
      const response = await fetch(`${API}/intelligence/ioc-candidates/${id}/${action}${tenantQuery}`, { method: 'PATCH', credentials: 'include' });
      const body: CandidateReviewResult & { readonly message?: string } = await response.json();
      if (!response.ok) throw new Error(body.message || `Gagal ${action === 'approve' ? 'menyetujui' : 'menolak'} candidate.`);
      setItems(current => current.filter(candidate => candidate.id !== id));
      if (body.status === 'APPROVED') setNotice({ indicatorId: body.indicatorId, message: body.indicatorCreated ? 'Candidate approved. Indicator baru dibuat.' : 'Candidate approved. Indicator existing digunakan.' });
      else setNotice({ message: 'Candidate rejected.' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Aksi review gagal.'); }
    finally { setBusyId(''); }
  }

  return <>
    <div className="source-heading"><div><span className="source-eyebrow">TELEGRAM INGESTION</span><h1>IOC Candidate Review</h1><p>Validasi observasi IOC sebelum dipromosikan ke alur intelligence berikutnya.</p></div><Button view="outlined" size="m" disabled={loading} onClick={() => void load()}><RotateCw size={15} aria-hidden="true" />Refresh</Button></div>
    {notice && <Card view="outlined" className="candidate-review-notice" role="status"><Check size={16} aria-hidden="true" /><span>{notice.message}</span>{notice.indicatorId && <a href="/threat-intelligence/indicators">Indicator {notice.indicatorId}</a>}</Card>}
    {error && <div className="error feed-feedback" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div>}
    {loading ? <Card view="outlined" className="source-state" aria-live="polite">Loading IOC candidates...</Card> : items.length === 0 ? <Card view="outlined" className="source-state"><Inbox size={28} aria-hidden="true" /><strong>No pending candidates</strong><span>IOC hasil Telegram yang menunggu review akan tampil di sini.</span></Card> : <div className="cti-table-wrap" aria-label="IOC candidate table"><table className="cti-table"><thead><tr><th>IOC</th><th>Type</th><th>Source Telegram</th><th>Timestamp</th><th>Confidence</th><th>Actions</th></tr></thead><tbody>{items.map(candidate => {
      const observation = candidate.observations[0]?.telegramStagingMessage;
      return <tr key={candidate.id}><td data-label="IOC"><strong className="candidate-value">{candidate.normalizedValue}</strong>{candidate.rawValue !== candidate.normalizedValue && <small className="candidate-raw">Raw: {candidate.rawValue}</small>}</td><td data-label="Type"><span className="candidate-type">{candidate.type}</span></td><td data-label="Source Telegram">{observation?.messageUrl ? <a className="candidate-source" href={observation.messageUrl} target="_blank" rel="noreferrer">{observation.channelTitle}</a> : observation?.channelTitle ?? candidate.intelligenceSource.name}<small className="candidate-raw">Message #{observation?.messageId ?? '—'}</small></td><td data-label="Timestamp">{formatDate(observation?.messageTimestamp ?? candidate.createdAt)}</td><td data-label="Confidence"><span className={`candidate-confidence ${candidate.confidence < 50 ? 'is-low' : ''}`}>{candidate.confidence}%</span></td><td data-label="Actions"><div className="ioc-actions"><Button view="action" size="s" disabled={busyId === candidate.id} onClick={() => void review(candidate.id, 'approve')}><Check size={14} aria-hidden="true" />Approve</Button><Button view="flat-danger" size="s" disabled={busyId === candidate.id} onClick={() => void review(candidate.id, 'reject')}><X size={14} aria-hidden="true" />Reject</Button></div></td></tr>;
    })}</tbody></table></div>}
  </>;
}

function formatDate(value: string): string { return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
