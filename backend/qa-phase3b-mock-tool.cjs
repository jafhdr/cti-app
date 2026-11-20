const http = require('node:http');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { createStore } = require('./qa-phase3c-mock-store.cjs');

if (process.env.SICTI_ISOLATED_QA !== 'true' || !/^\/cti_soar_qa_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL || '').pathname)) throw new Error('Disposable SOAR QA database required');
const secret = process.env.SICTI_SOAR_SANDBOX_SECRET || '';
if (secret.length < 32) throw new Error('Sandbox secret required');
const store = createStore();
let delayedOnce = false;
const sign = body => createHmac('sha256', secret).update(body).digest('hex');
const valid = (body, signature) => /^[0-9a-f]{64}$/.test(signature || '') && timingSafeEqual(Buffer.from(sign(body), 'hex'), Buffer.from(signature, 'hex'));
const synthetic = value => typeof value === 'string' && value.length <= 253 && /^(?:[a-z0-9-]+\.)+[a-z0-9-]+\.test$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 4096) { res.writeHead(413).end(); return; }
  }
  const body = Buffer.concat(chunks).toString('utf8');
  let input;
  try { input = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
  if (req.method !== 'POST' || !['/v1/action', '/v1/state'].includes(req.url) || !valid(body, req.headers['x-soar-signature'])) { res.writeHead(401).end(); return; }
  if (input.version !== 1 || !uuid(input.requestId) || typeof input.tenantId !== 'string' || !input.tenantId || input.tenantId.length > 160 || !synthetic(input.target) || !Number.isSafeInteger(input.timestamp) || Math.abs(Date.now() - input.timestamp) > 30000 || !uuid(input.nonce)) { res.writeHead(400).end(); return; }
  if (req.url === '/v1/action' ? (!['BLOCK_DOMAIN', 'UNBLOCK_DOMAIN'].includes(input.operation) || Object.keys(input).length !== 7) : (Object.hasOwn(input, 'operation') || Object.keys(input).length !== 6)) { res.writeHead(400).end(); return; }
  try { if (!store.recordNonce(input.nonce, input.timestamp)) { res.writeHead(400).end(); return; } }
  catch { res.writeHead(503).end(); return; }
  if (process.env.SICTI_SOAR_MOCK_MODE === 'outage' || (process.env.SICTI_SOAR_MOCK_MODE === 'rollback-failure' && input.operation === 'UNBLOCK_DOMAIN')) { res.writeHead(503).end(); return; }
  let response;
  if (req.url === '/v1/action') {
    try { response = { version: 1, requestId: input.requestId, tenantId: input.tenantId, target: input.target, blocked: store.action(input.requestId, input.tenantId, input.target, input.operation), operation: input.operation, timestamp: Date.now() }; }
    catch (error) { res.writeHead(error.message === 'Mock request ID conflict' ? 409 : 503).end(); return; }
  } else response = { version: 1, requestId: input.requestId, tenantId: input.tenantId, target: input.target, blocked: process.env.SICTI_SOAR_MOCK_MODE === 'verification-mismatch' ? !store.blocked(input.tenantId, input.target) : store.blocked(input.tenantId, input.target), operation: 'READ_STATE', timestamp: Date.now() };
  if (process.env.SICTI_SOAR_MOCK_MODE === 'delay-once' && !delayedOnce) { delayedOnce = true; await new Promise(resolve => setTimeout(resolve, 3500)); }
  const output = JSON.stringify(response);
  res.writeHead(200, { 'content-type': 'application/json', 'x-soar-signature': sign(output), 'cache-control': 'no-store' }).end(output);
});
const port = Number(process.env.SICTI_SOAR_MOCK_PORT ?? 0);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid QA mock port');
server.listen(port, '127.0.0.1', () => process.stdout.write(`Sandbox mock ready on 127.0.0.1:${server.address().port}\n`));
