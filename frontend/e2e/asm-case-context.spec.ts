import { expect, test } from '@playwright/test';

test('Case Detail shows ASM provenance and CVE at desktop and mobile', async ({ page }) => {
  await page.route('**/auth/me', route => route.fulfill({ json: { email: 'qa@local', role: 'ADMIN', moduleAccess: [{ moduleSlug: 'case-management', accessible: true, featureKeys: ['case-workflow'] }] } }));
  await page.route('http://localhost:3001/cases/case-1', route => route.fulfill({ json: { id: 'case-1', caseNumber: 'CASE-2026-00001', title: 'Investigate exposure', status: 'OPEN', priority: 'HIGH', severity: 'HIGH', creator: { id: 'user-1', name: 'QA', email: 'qa@local' }, tenant: { id: 'tenant-1', name: 'QA Tenant', slug: 'qa' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', alerts: [{ id: 'alert-1', title: 'Confirmed vulnerability', source: 'ASM', severity: 'HIGH', firstSeenAt: '2026-10-01T00:00:00Z', assetId: 'asset-1', asset: { id: 'asset-1', value: '192.0.2.10' }, findingId: 'finding-1', finding: { id: 'finding-1', title: 'Exposed OpenSSH' }, vulnerabilityCorrelationId: 'correlation-1', vulnerabilityCorrelation: { vulnerability: { cveId: 'CVE-2026-12345', name: 'Example' } }, changeEventId: 'change-1', changeEvent: { type: 'VULNERABILITY_CONFIRMED', detectedAt: '2026-10-01T00:00:00Z' } }] } }));
  for (const suffix of ['indicators', 'threat-actors', 'campaigns', 'notes', 'evidence', 'activity']) await page.route(`http://localhost:3001/cases/case-1/${suffix}`, route => route.fulfill({ json: [] }));
  await page.goto('http://localhost:3000/cases/case-1');
  const context = page.getByLabel('Attack Surface Context');
  await expect(context).toContainText('192.0.2.10');
  await expect(context).toContainText('Exposed OpenSSH');
  await expect(context).toContainText('CVE-2026-12345');
  await expect(context).toContainText('VULNERABILITY_CONFIRMED');
  for (const width of [1280, 390]) { await page.setViewportSize({ width, height: 900 }); await context.screenshot({ path: `test-results/asm-case-context-${width}.png` }); }
});
