'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmationModal } from '@/components/ui/modal-patterns';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type DiscoveryEvidence = {
  readonly type: string;
  readonly value: string;
};

type ThreatActorCandidate = {
  readonly threatActorId: string;
  readonly name: string;
  readonly score: number;
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly evidence: readonly DiscoveryEvidence[];
};

type DiscoveryResult = {
  readonly status: 'CANDIDATES' | 'NO_MATCH';
  readonly candidates: readonly ThreatActorCandidate[];
  readonly overflow: boolean;
};

type ConfirmationResult = {
  readonly status: 'CONFIRMED';
  readonly candidate: {
    readonly id: string;
    readonly name: string;
  };
};

type AttributionResult = {
  readonly status: 'MATCH';
  readonly candidate: {
    readonly id: string;
    readonly name: string;
  };
};

export function ThreatActorDiscoveryPanel({ indicatorId }: { readonly indicatorId: string }) {
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [confirmedCandidate, setConfirmedCandidate] = useState<ConfirmationResult['candidate'] | null>(null);
  const [confirmingCandidateId, setConfirmingCandidateId] = useState<string | null>(null);
  const [attributingCandidateId, setAttributingCandidateId] = useState<string | null>(null);
  const [attributeOpen, setAttributeOpen] = useState(false);
  const [attributedActor, setAttributedActor] = useState<AttributionResult['candidate'] | null>(null);
  const [error, setError] = useState('');
  const [confirmationError, setConfirmationError] = useState('');
  const [attributionError, setAttributionError] = useState('');

  async function discover(): Promise<void> {
    setDiscovering(true);
    setError('');
    setConfirmationError('');
    setAttributionError('');
    setConfirmedCandidate(null);
    setAttributedActor(null);
    setResult(null);
    try {
      const response = await fetch(`${API}/indicators/${indicatorId}/discover-threat-actors`, {
        method: 'POST',
        credentials: 'include',
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(messageFrom(data, 'Threat actor discovery gagal dijalankan.'));
      if (!isDiscoveryResult(data)) throw new Error('Respons threat actor discovery tidak valid.');
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Threat actor discovery gagal dijalankan.');
    } finally {
      setDiscovering(false);
    }
  }

  async function confirm(candidate: ThreatActorCandidate): Promise<void> {
    setConfirmingCandidateId(candidate.threatActorId);
    setConfirmationError('');
    try {
      const response = await fetch(`${API}/indicators/${indicatorId}/confirm-threat-actor`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threatActorId: candidate.threatActorId }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(messageFrom(data, 'Confirmation Threat Actor gagal dijalankan.'));
      if (!isConfirmationResult(data)) throw new Error('Respons confirmation Threat Actor tidak valid.');
      setConfirmedCandidate(data.candidate);
    } catch (cause) {
      setConfirmationError(cause instanceof Error ? cause.message : 'Confirmation Threat Actor gagal dijalankan.');
    } finally {
      setConfirmingCandidateId(null);
    }
  }

  async function attribute(): Promise<void> {
    if (!confirmedCandidate) return;
    setAttributingCandidateId(confirmedCandidate.id);
    setAttributionError('');
    try {
      const response = await fetch(`${API}/indicators/${indicatorId}/attribute-threat-actor`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threatActorId: confirmedCandidate.id }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(messageFrom(data, 'Attribution Threat Actor gagal dijalankan.'));
      if (!isAttributionResult(data)) throw new Error(attributionErrorFrom(data));
      setAttributedActor(data.candidate);
      setAttributeOpen(false);
      setConfirmedCandidate(null);
      setResult(null);
    } catch (cause) {
      setAttributionError(cause instanceof Error ? cause.message : 'Attribution Threat Actor gagal dijalankan.');
    } finally {
      setAttributingCandidateId(null);
    }
  }

  return <section className="threat-actor-discovery" aria-labelledby="threat-actor-discovery-title">
    <div className="threat-actor-discovery-heading">
      <div>
        <h3 id="threat-actor-discovery-title">Threat Actor Candidates</h3>
        <p>Review read-only candidates supported by the indicator context.</p>
      </div>
      <Button view="outlined" disabled={discovering} onClick={() => void discover()}>
        {discovering ? 'Discovering...' : 'Discover Threat Actors'}
      </Button>
    </div>

    {discovering && <div className="source-state discovery-loading" role="status" aria-live="polite">Searching existing threat actors...</div>}
    {error && <div className="error" role="alert">{error}</div>}
    {confirmationError && <div className="error" role="alert">{confirmationError}</div>}
    {attributionError && <div className="error" role="alert">{attributionError}</div>}
    {attributedActor && <div className="success discovery-attribution-success" role="status" aria-live="polite">Indicator sudah terhubung ke Threat Actor {attributedActor.name}.</div>}
    {confirmedCandidate && <div className="threat-actor-confirmation" role="region" aria-labelledby="confirmation-title">
      <h4 id="confirmation-title">Confirmed Candidate</h4>
      <article className="threat-actor-candidate">
        <header>
          <div><strong>{confirmedCandidate.name}</strong></div>
        </header>
        <div className="discovery-candidate-actions">
          <Button
            view="action"
            disabled={attributingCandidateId !== null}
            onClick={() => { setAttributionError(''); setAttributeOpen(true); }}
          >
            {attributingCandidateId ? 'Attributing...' : 'Attribute'}
          </Button>
          <Button
            view="outlined"
            disabled={attributingCandidateId !== null}
            onClick={() => setConfirmedCandidate(null)}
          >
            Cancel
          </Button>
        </div>
      </article>
    </div>}
    {result?.status === 'NO_MATCH' && <div className="source-state discovery-no-match" role="status"><strong>No Match</strong><span>No existing threat actor candidate matched this indicator.</span></div>}
    {result?.status === 'CANDIDATES' && <div className="threat-actor-candidates" aria-live="polite">
      {result.candidates.map(candidate => <article className="threat-actor-candidate" key={candidate.threatActorId}>
        <header>
          <div><strong>{candidate.name}</strong><span className={`discovery-confidence is-${candidate.confidence.toLowerCase()}`}>{candidate.confidence} confidence</span></div>
          <span className="discovery-score"><strong>{candidate.score}</strong><small>score</small></span>
        </header>
        <dl className="discovery-evidence">
          {candidate.evidence.map((evidence, index) => <div key={`${evidence.type}-${evidence.value}-${index}`}><dt>{evidence.type}</dt><dd>{evidence.value}</dd></div>)}
        </dl>
        <div className="discovery-candidate-actions">
          <Link className="discovery-view-link" href={`/intelligence/threat-actors?actorId=${encodeURIComponent(candidate.threatActorId)}`}>View Threat Actor</Link>
          {!result.overflow && !attributedActor && !confirmedCandidate && <Button
            view="action"
            disabled={confirmingCandidateId !== null}
            onClick={() => void confirm(candidate)}
          >
            {confirmingCandidateId === candidate.threatActorId ? 'Confirming...' : 'Confirm'}
          </Button>}
        </div>
      </article>)}
      {result.overflow && <div className="discovery-overflow" role="note">More candidates are available but are not displayed.</div>}
    </div>}
    <ConfirmationModal open={attributeOpen} onOpenChange={setAttributeOpen} title="Attribute indicator" target={confirmedCandidate?.name} consequence="Link this indicator to the confirmed threat actor." confirmLabel="Attribute" loading={attributingCandidateId !== null} error={attributionError} onConfirm={attribute} />
  </section>;
}

function messageFrom(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null || !('message' in value)) return fallback;
  return typeof value.message === 'string' ? value.message : fallback;
}

function isDiscoveryResult(value: unknown): value is DiscoveryResult {
  if (typeof value !== 'object' || value === null || !('status' in value) || !('candidates' in value) || !('overflow' in value)) return false;
  if ((value.status !== 'CANDIDATES' && value.status !== 'NO_MATCH') || !Array.isArray(value.candidates) || typeof value.overflow !== 'boolean') return false;
  return value.candidates.every(isThreatActorCandidate);
}

function isThreatActorCandidate(value: unknown): value is ThreatActorCandidate {
  if (typeof value !== 'object' || value === null) return false;
  return 'threatActorId' in value && typeof value.threatActorId === 'string'
    && 'name' in value && typeof value.name === 'string'
    && 'score' in value && typeof value.score === 'number'
    && 'confidence' in value && (value.confidence === 'HIGH' || value.confidence === 'MEDIUM' || value.confidence === 'LOW')
    && 'evidence' in value && Array.isArray(value.evidence)
    && value.evidence.every(item => typeof item === 'object' && item !== null && 'type' in item && typeof item.type === 'string' && 'value' in item && typeof item.value === 'string');
}

function isConfirmationResult(value: unknown): value is ConfirmationResult {
  if (typeof value !== 'object' || value === null || !('status' in value) || value.status !== 'CONFIRMED' || !('candidate' in value)) return false;
  const candidate = value.candidate;
  return typeof candidate === 'object' && candidate !== null
    && 'id' in candidate && typeof candidate.id === 'string'
    && 'name' in candidate && typeof candidate.name === 'string';
}

function isAttributionResult(value: unknown): value is AttributionResult {
  if (typeof value !== 'object' || value === null || !('status' in value) || value.status !== 'MATCH' || !('candidate' in value)) return false;
  const candidate = value.candidate;
  return typeof candidate === 'object' && candidate !== null
    && 'id' in candidate && typeof candidate.id === 'string'
    && 'name' in candidate && typeof candidate.name === 'string';
}

function attributionErrorFrom(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'status' in value && value.status === 'NO_MATCH') {
    return 'Candidate tidak lagi memenuhi evidence attribution.';
  }
  return 'Respons attribution Threat Actor tidak valid.';
}
