export type ModulePolicy = {
  readonly subscriptionActive: boolean;
  readonly subscriptionIncluded: boolean;
  readonly isActive: boolean;
  readonly tenantEnabled: boolean;
  readonly roleAllowed: boolean;
};

export function modulePolicyDecision(policy: ModulePolicy) {
  const reason = !policy.subscriptionActive ? 'Subscription tenant tidak aktif'
    : !policy.subscriptionIncluded ? 'Modul tidak termasuk dalam subscription tenant'
    : !policy.isActive ? 'Modul ini sedang tidak aktif'
    : !policy.tenantEnabled ? 'Modul dinonaktifkan untuk tenant ini'
    : !policy.roleAllowed ? 'Role tidak memiliki akses ke modul ini'
    : null;
  return { accessible: reason === null, reason };
}

export function effectiveModuleDecision(policy: ModulePolicy, assigned: boolean) {
  const decision = modulePolicyDecision(policy);
  if (!decision.accessible) return decision;
  return assigned ? decision : { accessible: false, reason: 'Modul belum diberikan kepada user ini' };
}
