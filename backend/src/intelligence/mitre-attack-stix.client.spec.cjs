const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createServer } = require('node:http');
const { ConfigService } = require('@nestjs/config');

let baseUrl;
let server;

before(async () => {
  server = createServer((request, response) => {
    if (request.url === '/success') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ type: 'bundle', id: 'bundle--test', objects: [{ type: 'intrusion-set', id: 'intrusion-set--test', name: 'APT Test' }] }));
      return;
    }
    if (request.url === '/http-failure') {
      response.writeHead(503);
      response.end('unavailable');
      return;
    }
    if (request.url === '/invalid-json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{not-json');
      return;
    }
    if (request.url === '/invalid-bundle') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ type: 'collection', objects: {} }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.flushHeaders();
    setTimeout(() => response.end(JSON.stringify({ type: 'bundle', objects: [] })), 100);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

function client(path, timeoutMs = 1000) {
  const { MitreAttackStixClient } = require('../../dist/src/intelligence/mitre-attack-stix.client.js');
  return new MitreAttackStixClient(new ConfigService({ MITRE_ATTACK_STIX_URL: `${baseUrl}${path}`, MITRE_ATTACK_STIX_TIMEOUT_MS: String(timeoutMs) }));
}

test('Given an official-shaped response, when the enterprise bundle is fetched, then the parsed STIX bundle is returned', async () => {
  const bundle = await client('/success').fetchEnterpriseBundle();
  assert.equal(bundle.type, 'bundle');
  assert.equal(bundle.objects.length, 1);
});

test('Given a non-success response, when the enterprise bundle is fetched, then an HTTP error is raised', async () => {
  await assert.rejects(client('/http-failure').fetchEnterpriseBundle(), error => error.name === 'MitreAttackHttpError' && error.statusCode === 503);
});

test('Given a slow response, when the timeout expires, then a timeout error is raised', async () => {
  await assert.rejects(client('/timeout', 20).fetchEnterpriseBundle(), error => error.name === 'MitreAttackTimeoutError');
});

test('Given malformed JSON, when the enterprise bundle is fetched, then an invalid JSON error is raised', async () => {
  await assert.rejects(client('/invalid-json').fetchEnterpriseBundle(), error => error.name === 'MitreAttackInvalidJsonError');
});

test('Given a non-bundle payload, when the enterprise bundle is fetched, then an invalid bundle error is raised', async () => {
  await assert.rejects(client('/invalid-bundle').fetchEnterpriseBundle(), error => error.name === 'MitreAttackInvalidBundleError');
});
