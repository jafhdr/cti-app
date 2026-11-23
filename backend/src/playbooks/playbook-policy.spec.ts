import { describe, expect, it } from '@jest/globals';
import { nextPlaybookState, simulationAllowed } from './playbook-policy';

describe('playbook policy', () => {
  it('requires confirmation and a second analyst approval before execution', () => {
    expect(nextPlaybookState('PENDING_CONFIRMATION', 'CONFIRM')).toBe('PENDING_APPROVAL');
    expect(nextPlaybookState('PENDING_APPROVAL', 'APPROVE')).toBe('APPROVED');
    expect(() => nextPlaybookState('PENDING_CONFIRMATION', 'EXECUTE')).toThrow();
  });

  it('restricts simulated execution to an isolated QA database', () => {
    expect(simulationAllowed({ enabled: 'true', isolatedQa: 'true', unifiedQa: undefined, database: 'cti_soar_qa_demo' })).toBe(true);
    expect(simulationAllowed({ enabled: 'true', isolatedQa: 'true', unifiedQa: 'true', database: 'cti' })).toBe(false);
    expect(simulationAllowed({ enabled: 'false', isolatedQa: 'true', unifiedQa: undefined, database: 'cti_soar_qa_demo' })).toBe(false);
  });
});
