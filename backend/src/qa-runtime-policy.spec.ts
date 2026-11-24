import { describe, expect, it } from '@jest/globals';
import { qaRuntimeAllowed } from './qa-runtime-policy';

describe('QA runtime policy', () => {
  it.each([
    { module: 'correlation', database: 'cti_corr_qa_demo' },
    { module: 'soar', database: 'cti_soar_qa_demo' },
    { module: 'monitoring', database: 'cti_phase4a_qa_demo' },
  ] as const)('allows the existing $module database identity when isolated QA is enabled', ({ module, database }) => {
    expect(qaRuntimeAllowed({ module, database, featureEnabled: 'true', isolatedQa: 'true', unifiedQa: undefined })).toBe(true);
  });

  it.each(['correlation', 'soar', 'monitoring'] as const)('allows the unified identity for %s when both QA flags are enabled', module => {
    expect(qaRuntimeAllowed({ module, database: 'cti_unified_qa_sict72', featureEnabled: 'true', isolatedQa: 'true', unifiedQa: 'true' })).toBe(true);
  });

  it.each([
    { isolatedQa: undefined, unifiedQa: 'true' },
    { isolatedQa: 'false', unifiedQa: 'true' },
    { isolatedQa: 'true', unifiedQa: undefined },
    { isolatedQa: 'true', unifiedQa: 'false' },
  ] as const)('denies a unified identity when a required QA flag is missing', flags => {
    expect(qaRuntimeAllowed({ module: 'correlation', database: 'cti_unified_qa_sict72', featureEnabled: 'true', ...flags })).toBe(false);
  });

  it.each(['correlation', 'soar', 'monitoring'] as const)('denies the unified identity for %s when its module flag is missing', module => {
    expect(qaRuntimeAllowed({ module, database: 'cti_unified_qa_sict72', featureEnabled: undefined, isolatedQa: 'true', unifiedQa: 'true' })).toBe(false);
  });

  it.each(['cti', 'production', 'cti_unified_qa_', 'cti_unified_qa_SICT72', 'cti_unified_qa_sict72_extra'])('denies active, arbitrary, or malformed database identity %s', database => {
    expect(qaRuntimeAllowed({ module: 'soar', database, featureEnabled: 'true', isolatedQa: 'true', unifiedQa: 'true' })).toBe(false);
  });

  it('does not let one module-specific identity enable another module', () => {
    expect(qaRuntimeAllowed({ module: 'soar', database: 'cti_corr_qa_demo', featureEnabled: 'true', isolatedQa: 'true', unifiedQa: 'true' })).toBe(false);
  });
});
