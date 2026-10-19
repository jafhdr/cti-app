export const SYSTEM_MODULE_SLUGS = [
  'threat-intelligence',
  'case-management',
  'appsec-posture',
  'attack-surface-management',
] as const;

export function isSystemModule(slug: string): boolean {
  return SYSTEM_MODULE_SLUGS.some(systemSlug => systemSlug === slug);
}

export function isCatalogOnlyFeature(slug: string, key: string): boolean {
  return (slug === 'appsec-posture' && key === 'advanced-chart')
    || (slug === 'threat-intelligence' && key === 'export')
    || (slug === 'case-management' && key === 'alert-triage');
}
