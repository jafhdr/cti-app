import { describe, expect, it } from '@jest/globals';
import { evaluateNextStep, RULE_VERSION, type HypothesisInput } from './next-step.logic';

const base: HypothesisInput = {
  id: 'one', techniqueId: 'tech-command', externalId: 'T1059', attackVersion: 'Enterprise QA',
  sourceLineageId: 'sir-one', campaignId: null,
  observedStartAt: '2026-01-01T00:00:00.000Z', observedEndAt: '2026-01-01T00:00:00.000Z',
  actorConfidence: 80, techniqueConfidence: 90, status: 'CONFIRMED', tlp: 'AMBER',
};
const second: HypothesisInput = { ...base, id: 'two', sourceLineageId: 'sir-two', observedStartAt: '2026-01-02T00:00:00.000Z', observedEndAt: '2026-01-02T00:00:00.000Z' };
const catalog = [{ id: 'tech-transfer', externalId: 'T1105', name: 'Ingress Tool Transfer', tactic: 'Command and Control' }];

describe('deterministic next-step hypotheses', () => {
  it('generates a traceable rule result when two confirmed ordered observations exist', () => {
    const result = evaluateNextStep([base, second], catalog);
    expect(result.status).toBe('GENERATED');
    expect(result.candidates[0]).toMatchObject({ techniqueId: 'tech-transfer', supportingObservationIds: ['one', 'two'] });
    expect(result.candidates[0]?.ruleTrace.ruleVersion).toBe(RULE_VERSION);
    expect(evaluateNextStep([second, base], catalog)).toEqual(result);
  });

  it('abstains when evidence is missing, disputed, overlapping, or weakly attributed', () => {
    expect(evaluateNextStep([base], catalog).status).toBe('ABSTAINED');
    expect(evaluateNextStep([base, { ...second, status: 'DISPUTED' }], catalog).status).toBe('ABSTAINED');
    expect(evaluateNextStep([base, { ...second, observedStartAt: base.observedStartAt }], catalog).status).toBe('ABSTAINED');
    expect(evaluateNextStep([base, { ...second, actorConfidence: 40 }], catalog).status).toBe('ABSTAINED');
    expect(evaluateNextStep([base, { ...second, sourceLineageId: 'sir-one' }], catalog).status).toBe('ABSTAINED');
    expect(evaluateNextStep([base, { ...second, campaignId: 'campaign-other' }], catalog).status).toBe('ABSTAINED');
  });

  it('does not emit an unsupported catalog technique or calibrated probability', () => {
    expect(evaluateNextStep([base, second], []).status).toBe('ABSTAINED');
    const result = evaluateNextStep([base, second], catalog);
    expect(JSON.stringify(result)).not.toMatch(/probability|likelihood/i);
  });

  it('shows a disputed target mapping as counterevidence without treating it as the confirmed input chain', () => {
    const disputedTarget: HypothesisInput = { ...second, id: 'counter', externalId: 'T1105', techniqueId: 'tech-transfer', status: 'DISPUTED', observedStartAt: '2026-01-03T00:00:00.000Z', observedEndAt: '2026-01-03T00:00:00.000Z' };
    const result = evaluateNextStep([base, second, disputedTarget], catalog);
    expect(result.status).toBe('GENERATED');
    expect(result.candidates[0]?.contradictingObservationIds).toEqual(['counter']);
    expect(result.candidates[0]?.ruleTrace.components.contradiction).toBe(-30);
  });
});
