import { expect, test } from '@playwright/test';

const app = process.env.SOURCES_APP_URL || 'http://localhost:3000';

test('Intelligence Hub creates entities and relationships in shared form modals', async ({ page }) => {
  const requests: { path: string; payload: unknown }[] = [];
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'admin', email: 'admin@example.test', role: 'ADMIN', tenantId: 'tenant-a', moduleAccess: [{ moduleSlug: 'threat-intelligence', assigned: true, accessible: true }] } }));
  await page.route(/\/intelligence\/overview(?:\?.*)?$/, route => route.fulfill({ json: { entities: [{ id: 'entity-1', name: 'Actor', type: 'THREAT_ACTOR', severity: 'HIGH', confidence: 90 }], relationships: [] } }));
  await page.route(/\/intelligence\/(entities|relationships)$/, route => {
    requests.push({ path: new URL(route.request().url()).pathname, payload: route.request().postDataJSON() });
    return route.fulfill({ json: {} });
  });

  await page.goto(`${app}/threat-intelligence/hub`);
  await page.getByRole('button', { name: 'Tambah entitas' }).click();
  const entity = page.getByRole('dialog', { name: 'Tambah entitas' });
  await entity.getByLabel('Nama').fill('New actor');
  await entity.getByRole('button', { name: 'Simpan' }).click();
  await expect(entity).toHaveCount(0);
  expect(requests[0]).toMatchObject({ path: '/intelligence/entities', payload: { name: 'New actor', confidence: 50 } });

  await page.getByRole('button', { name: 'Tambah relasi' }).click();
  const relationship = page.getByRole('dialog', { name: 'Tambah relasi' });
  await relationship.getByLabel('Sumber').selectOption('entity-1');
  await relationship.getByLabel('Target').selectOption('entity-1');
  await relationship.getByRole('button', { name: 'Simpan' }).click();
  await expect(relationship).toHaveCount(0);
  expect(requests[1]).toMatchObject({ path: '/intelligence/relationships', payload: { sourceId: 'entity-1', targetId: 'entity-1', relationshipType: 'USES' } });
});
