export function isCatalogOnlyFeature(moduleSlug: string, featureKey: string): boolean {
  return moduleSlug === 'appsec-posture'
    || (moduleSlug === 'threat-intelligence' && featureKey === 'export')
    || (moduleSlug === 'case-management' && featureKey === 'alert-triage');
}

export function isCatalogOnlyModule(moduleSlug: string): boolean {
  return moduleSlug === 'appsec-posture';
}
