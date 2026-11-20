import { createTtpObservationSchema, reviewTtpObservationSchema } from './ttp-observations.dto';

const valid = {
  idempotencyKey: 'qa-observation-1', threatActorId: 'actor-1', mitreTechniqueId: 'technique-1', attackVersion: 'Enterprise v18', sirEvidenceId: 'evidence-1',
  attributionBasis: 'Analyst reviewed source report and mapped behavior.', observedStartAt: '2026-11-09T08:00:00Z', observedEndAt: '2026-11-09T08:00:00Z',
  timePrecision: 'INSTANT', tlp: 'AMBER', actorConfidence: 60, techniqueConfidence: 80,
};

describe('TTP observation boundary', () => {
  it('Given a scoped evidence-backed candidate, when parsed, then accepts it', () => {
    expect(createTtpObservationSchema.safeParse(valid).success).toBe(true);
  });
  it('Given no actor or campaign scope, when parsed, then rejects it', () => {
    const { threatActorId: _omitted, ...unscoped } = valid;
    expect(createTtpObservationSchema.safeParse(unscoped).success).toBe(false);
  });
  it('Given unsupported review status, when parsed, then rejects it', () => {
    expect(reviewTtpObservationSchema.safeParse({ status: 'PREDICTED', expectedStatus: 'CANDIDATE', reason: 'This is not a valid review state.' }).success).toBe(false);
  });
});
