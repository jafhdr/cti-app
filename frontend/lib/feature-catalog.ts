export function isCatalogOnlyFeature(moduleSlug: string, featureKey: string): boolean {
  return (moduleSlug === 'appsec-posture' && featureKey === 'advanced-chart')
    || (moduleSlug === 'threat-intelligence' && featureKey === 'export')
    || (moduleSlug === 'case-management' && featureKey === 'alert-triage');
}

export function isCatalogOnlyModule(moduleSlug: string): boolean {
  return !['threat-intelligence', 'case-management', 'appsec-posture', 'attack-surface-management'].includes(moduleSlug);
}
