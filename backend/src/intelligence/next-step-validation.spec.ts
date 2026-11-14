import { createHash } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { evaluateNextStep } from './next-step.logic';
import { evaluateValidation } from './next-step-validation';

const asOf = '2026-06-01T00:00:00.000Z';
const observations = [
  { id: 'ob-1', techniqueId: 'tech-command', campaignId: 'camp-a', sourceLineageId: 'sir-1', externalId: 'T1059', attackVersion: 'Enterprise QA', observedStartAt: '2026-05-20T00:00:00.000Z', observedEndAt: '2026-05-20T00:00:00.000Z', actorConfidence: 80, techniqueConfidence: 90, status: 'CONFIRMED', tlp: 'AMBER' },
  { id: 'ob-2', techniqueId: 'tech-command', campaignId: 'camp-a', sourceLineageId: 'sir-2', externalId: 'T1059', attackVersion: 'Enterprise QA', observedStartAt: '2026-05-21T00:00:00.000Z', observedEndAt: '2026-05-21T00:00:00.000Z', actorConfidence: 80, techniqueConfidence: 90, status: 'CONFIRMED', tlp: 'AMBER' },
] as const;
const catalog = [{ id: 'tech-transfer', externalId: 'T1105', name: 'Ingress Tool Transfer', tactic: 'Command and Control' }] as const;
const snapshot = { engineVersion: 'deterministic-1', ruleVersion: 'explicit-transitions-1', asOf, horizonDays: 14, scope: 'camp-a', observations, catalog };
const digest = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
const hypothesis = evaluateNextStep(observations, catalog);
const candidate = hypothesis.candidates[0];
if (!candidate) throw new Error('Synthetic rule fixture must generate');
const baseCase = {
  tenantId: 'tenant-a', runId: 'run-a', actorId: null, campaignId: 'camp-a', createdById: 'analyst-one',
  asOf, horizonDays: 14, maxTlp: 'AMBER', status: 'GENERATED', engineVersion: 'deterministic-1', ruleVersion: 'explicit-transitions-1', inputSnapshot: snapshot, inputDigest: digest,
  candidates: [{ techniqueId: candidate.techniqueId, rank: 1, supportScore: candidate.supportScore, supportingObservationIds: candidate.supportingObservationIds, contradictingObservationIds: candidate.contradictingObservationIds, ruleTrace: candidate.ruleTrace }],
  availability: [
    { observationId: 'ob-1', createdAt: '2026-05-22T00:00:00.000Z', ingestedAt: '2026-05-22T00:00:00.000Z', reviewedAt: '2026-05-22T01:00:00.000Z' },
    { observationId: 'ob-2', createdAt: '2026-05-23T00:00:00.000Z', ingestedAt: '2026-05-23T00:00:00.000Z', reviewedAt: '2026-05-23T01:00:00.000Z' },
  ],
  catalogAvailability: [{ techniqueId: 'tech-transfer', createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z' }],
  adjudication: { kind: 'VERIFIED_TECHNIQUE', techniqueId: 'tech-transfer', observationId: 'outcome-a', sourceLineageId: 'sir-3', outcomeTlp: 'AMBER', observedAt: '2026-06-02T00:00:00.000Z', ingestedAt: '2026-06-02T01:00:00.000Z', adjudicatedAt: '2026-06-03T00:00:00.000Z', adjudicatorId: 'analyst-two', monitoring: { complete: true, startAt: asOf, endAt: '2026-06-16T00:00:00.000Z', sourceLineageIds: ['sensor-1'] } },
} as const;
const dataset = { provenance: 'SYNTHETIC', tenantId: 'tenant-a', split: { trainEnd: '2026-05-25T00:00:00.000Z', testStart: '2026-05-31T00:00:00.000Z', testEnd: '2026-06-05T00:00:00.000Z' }, cases: [baseCase] } as const;

describe('offline Phase 2C evaluation', () => {
  it('counts a verified synthetic hit while refusing a predictive-accuracy verdict', () => {
    const result = evaluateValidation(dataset, 'tenant-a', 'AMBER');
    expect(result.verdict).toBe('SYNTHETIC_CORRECTNESS_ONLY');
    expect(result.counts).toMatchObject({ testRuns: 1, evaluable: 1, generated: 1, top1Hits: 1, top3Hits: 1, falseHypotheses: 0 });
    expect(result.baselines.recentTechnique.top1Hits).toBe(0);
    expect(result.leadTimeHours).toEqual([24]);
    expect(evaluateValidation(dataset, 'tenant-a', 'AMBER')).toEqual(result);
  });

  it('excludes unknown labels and censored coverage from ranking denominators', () => {
    const unknown = { ...baseCase, adjudication: { kind: 'UNKNOWN', reason: 'No independent outcome label' } };
    const result = evaluateValidation({ ...dataset, cases: [unknown] }, 'tenant-a', 'AMBER');
    expect(result.counts).toMatchObject({ evaluable: 0, unknown: 1, top1Hits: 0, falseHypotheses: 0 });
    expect(result.metrics.top1).toBeNull();
  });

  it('rejects future information, tampered snapshots, and mixed-tenant input', () => {
    expect(() => evaluateValidation({ ...dataset, cases: [{ ...baseCase, availability: [{ ...baseCase.availability[0], ingestedAt: '2026-06-02T00:00:00.000Z' }, baseCase.availability[1]] }] }, 'tenant-a', 'AMBER')).toThrow(/cutoff/i);
    expect(() => evaluateValidation({ ...dataset, cases: [{ ...baseCase, inputDigest: '0'.repeat(64) }] }, 'tenant-a', 'AMBER')).toThrow(/digest/i);
    expect(() => evaluateValidation({ ...dataset, cases: [{ ...baseCase, tenantId: 'tenant-b' }] }, 'tenant-a', 'AMBER')).toThrow(/tenant/i);
  });

  it('removes RED cases at AMBER clearance and rejects shared outcome lineage', () => {
    const hidden = evaluateValidation({ ...dataset, cases: [{ ...baseCase, maxTlp: 'RED' }] }, 'tenant-a', 'AMBER');
    expect(hidden.counts).toMatchObject({ tlpExcluded: 1, testRuns: 0 });
    const hiddenOutcome = evaluateValidation({ ...dataset, cases: [{ ...baseCase, adjudication: { ...baseCase.adjudication, outcomeTlp: 'RED' } }] }, 'tenant-a', 'AMBER');
    expect(hiddenOutcome.counts).toMatchObject({ tlpExcluded: 1, testRuns: 0 });
    expect(() => evaluateValidation({ ...dataset, cases: [{ ...baseCase, adjudication: { ...baseCase.adjudication, sourceLineageId: 'sir-1' } }] }, 'tenant-a', 'AMBER')).toThrow(/lineage/i);
    expect(() => evaluateValidation({ ...dataset, cases: [{ ...baseCase, adjudication: { ...baseCase.adjudication, adjudicatorId: 'analyst-one' } }] }, 'tenant-a', 'AMBER')).toThrow(/adjudicator/i);
  });

  it('does not claim accuracy for an empty real cohort', () => {
    const result = evaluateValidation({ ...dataset, provenance: 'REAL_ADJUDICATED', cases: [] }, 'tenant-a', 'AMBER');
    expect(result.verdict).toBe('NOT_EVALUABLE');
    expect(result.metrics.top1).toBeNull();
    expect(result.counts.evaluable).toBe(0);
  });

  it('rejects underclassified snapshots and a manipulated historical cutoff', () => {
    const underclassified = { ...baseCase, maxTlp: 'GREEN' };
    expect(() => evaluateValidation({ ...dataset, cases: [underclassified] }, 'tenant-a', 'AMBER')).toThrow(/TLP classification/i);
    const training = { ...baseCase, runId: 'run-train', asOf: '2026-05-01T00:00:00.000Z' };
    // The replay contract prevents changing a historical cutoff without regenerating its snapshot.
    expect(() => evaluateValidation({ ...dataset, cases: [training] }, 'tenant-a', 'AMBER')).toThrow(/snapshot contract/i);
  });
});
