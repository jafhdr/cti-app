const assert = require('node:assert/strict');
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = require('undici');

async function validateAsmApis({ t, request, assign, admin, user, root, asm, tenantId, allAccess, prisma }) {
  await t.test('TRIAL subscription preserves assigned ASM access', async () => {
    assert.equal((await request(root, '/subscription/status', 'PATCH', { tenantId, status: 'TRIAL' })).status, 200);
    const me = await request(admin, '/auth/me');
    assert.equal(me.body.moduleAccess.find(m => m.moduleSlug === asm.slug).accessible, true);
    assert.equal((await request(admin, '/attack-surface/assets')).status, 200);
    assert.equal((await request(root, '/subscription/status', 'PATCH', { tenantId, status: 'ACTIVE' })).status, 200);
  });

  await t.test('persistent ASM catalog flows through all three menus', async () => {
    for (const path of ['/subscription/packages', '/modules/configuration', `/users/${admin.id}/module-access`]) {
      const response = await request(admin, path);
      assert.equal(response.status, 200, path);
      const modules = path === '/subscription/packages'
        ? response.body.flatMap(pkg => pkg.modules.map(entry => entry.module)) : response.body;
      const module = modules.find(entry => entry.id === asm.id);
      assert.ok(module, path);
      for (const key of ['asset-management', 'asset-discovery']) assert.ok(module.features.some(f => f.key === key), `${path}: ${key}`);
    }
  });

  await t.test('real ASM asset and discovery APIs enforce individual feature revocation', async () => {
    const created = await request(admin, '/attack-surface/assets', 'POST', {
      name: 'ASM isolated QA asset', type: 'SUBDOMAIN', value: 'asm-qa.example.test',
    });
    assert.equal(created.status, 201);
    const assetId = created.body.id;
    assert.ok(assetId);
    const path = `/attack-surface/assets/${assetId}`;
    const previous = getGlobalDispatcher();
    const dns = new MockAgent();
    dns.disableNetConnect();
    dns.enableNetConnect(/^(localhost|127[.]0[.]0[.]1)(:[0-9]+)?$/);
    const provider = dns.get('https://cloudflare-dns.com');
    for (const type of ['A', 'AAAA', 'CNAME']) {
      provider.intercept({ path: `/dns-query?name=asm-qa.example.test&type=${type}`, method: 'GET' }).reply(200, {
        Status: 0,
        Answer: type === 'A' ? [{ name: 'asm-qa.example.test', type: 1, TTL: 60, data: '192.0.2.12' }] : [],
      }, { headers: { 'content-type': 'application/dns-json' } });
    }
    setGlobalDispatcher(dns);
    try {
      const discovery = await request(admin, `${path}/discover`, 'POST');
      assert.equal(discovery.status, 201);
      assert.equal(discovery.body.failed, 0);
      assert.equal(discovery.body.created, 1);
      assert.deepEqual(discovery.body.errors, []);
      dns.assertNoPendingInterceptors();
      assert.equal(await prisma.asset.count({ where: { tenantId, type: 'IP_ADDRESS', value: '192.0.2.12' } }), 1);
    } finally {
      setGlobalDispatcher(previous);
      await dns.close();
    }
    const ip = await prisma.asset.findFirstOrThrow({ where: { tenantId, type: 'IP_ADDRESS', value: '192.0.2.12' } });
    const portsPath = `/attack-surface/assets/${ip.id}/port-services`;
    assert.equal((await request(admin, portsPath)).status, 200);
    const withoutDiscovery = allAccess.map(entry => entry.moduleId === asm.id ? { ...entry, featureKeys: ['asset-management'] } : entry);
    await assign(admin, withoutDiscovery);
    assert.equal((await request(admin, `${path}/discover`, 'POST')).status, 403);
    assert.equal((await request(admin, `${portsPath}/discover`, 'POST')).status, 403);
    assert.equal((await request(admin, path)).status, 200);
    assert.equal((await request(admin, portsPath)).status, 200);
    const discoveryOnly = allAccess.map(entry => entry.moduleId === asm.id ? { ...entry, featureKeys: ['asset-discovery'] } : entry);
    await assign(admin, discoveryOnly);
    assert.equal((await request(admin, path)).status, 403);
    assert.equal((await request(admin, portsPath)).status, 403);
    await assign(admin);
    await assign(user, allAccess.filter(entry => entry.moduleId !== asm.id));
    const me = await request(user, '/auth/me');
    const access = me.body.moduleAccess.find(entry => entry.moduleSlug === asm.slug);
    assert.equal(access.assigned, false);
    assert.equal(access.accessible, false);
    assert.equal((await request(user, path)).status, 403);
    assert.equal((await request(user, `${path}/discover`, 'POST')).status, 403);
    await assign(user);
  });
}

module.exports = { validateAsmApis };
