const { createServer } = require('node:http');
const { collectionRequestSchema, connectorSecret, evidenceDigest, signConnector, verifyConnector } = require('./dist/src/intelligence/monitoring-connector.contract');

if (new URL(process.env.DATABASE_URL || 'postgresql://invalid@localhost/invalid').pathname !== '/cti_phase4a_qa_20261111'
  || process.env.SICTI_ISOLATED_QA !== 'true' || process.env.SICTI_MONITORING_CONNECTOR_QA_ENABLED !== 'true') throw new Error('Isolated Phase 4B QA required');
const secret = connectorSecret();
const seen = new Map();
const attempts = new Map();
const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/collect') { response.writeHead(404).end(); return; }
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 4096) { response.writeHead(413).end(); return; }
  }
  if (!verifyConnector(body, request.headers['x-sicti-signature'], secret)) { response.writeHead(401).end(); return; }
  const parsed = collectionRequestSchema.safeParse(JSON.parse(body));
  if (!parsed.success || Math.abs(Date.now() - new Date(parsed.data.requestedAt).getTime()) > 300_000) { response.writeHead(400).end(); return; }
  const input = parsed.data;
  if (process.env.SICTI_MONITORING_SIMULATOR_FAIL_ONCE === 'true' && !attempts.has(input.requestId)) {
    attempts.set(input.requestId, 1); response.writeHead(503).end(); return;
  }
  const recent = [...seen.values()].filter(time => Date.now() - time < 1000).length;
  if (recent >= 5 && !seen.has(input.requestId)) { response.writeHead(429).end(); return; }
  seen.set(input.requestId, Date.now());
  if (seen.size > 1000) seen.delete(seen.keys().next().value);
  const eventKey = input.requestId;
  const observedAt = input.requestedAt;
  const payload = {
    version: 1, requestId: input.requestId, tenantId: input.tenantId, sourceId: input.sourceId,
    providerKey: input.providerKey, coverageLabel: 'Synthetic authorized domain/brand fixture', publishedAt: input.requestedAt,
    observations: [{ providerEventKey: eventKey, kind: 'BRAND_IMPERSONATION', domain: input.targetDomain,
      metadataCategory: 'LOOKALIKE_DOMAIN', evidenceRef: `qa://simulator/${eventKey}`,
      evidenceDigest: evidenceDigest(eventKey, input.targetDomain, observedAt), observedAt, tlp: 'AMBER' }],
  };
  const output = JSON.stringify(payload);
  response.writeHead(200, { 'content-type': 'application/json', 'x-sicti-signature': signConnector(output, secret) }).end(output);
});
server.listen(new URL(process.env.SICTI_MONITORING_SIMULATOR_URL || 'http://127.0.0.1:33103/v1/collect').port || 33103, '127.0.0.1');
