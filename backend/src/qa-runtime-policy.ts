export type QaModule = 'correlation' | 'soar' | 'monitoring';

export type QaRuntimePolicyInput = {
  readonly module: QaModule;
  readonly database: string;
  readonly featureEnabled: string | undefined;
  readonly isolatedQa: string | undefined;
  readonly unifiedQa: string | undefined;
};

const moduleDatabasePatterns: Readonly<Record<QaModule, RegExp>> = {
  correlation: /^cti_corr_qa_[a-z0-9_]+$/,
  soar: /^cti_soar_qa_[a-z0-9_]+$/,
  monitoring: /^cti_phase4a_qa_[a-z0-9]+$/,
};

const unifiedDatabasePattern = /^cti_unified_qa_[a-z0-9]+$/;

export function qaRuntimeAllowed(input: QaRuntimePolicyInput): boolean {
  if (input.featureEnabled !== 'true' || input.isolatedQa !== 'true') return false;
  if (moduleDatabasePatterns[input.module].test(input.database)) return true;
  return input.unifiedQa === 'true' && unifiedDatabasePattern.test(input.database);
}
