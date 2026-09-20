require('reflect-metadata');

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { IndicatorEnrichmentClient, ProviderHttpError, ProviderTimeoutError, UnsupportedIndicatorTypeError } = require('../../dist/src/indicators/indicator-enrichment.client.js');

const response = {
  data: {
    id: 'fixture-id',
    type: 'domain',
    attributes: {
      reputation: -7,
      last_analysis_date: 1_700_000_000,
      last_analysis_stats: { harmless: 67, malicious: 3, suspicious: 2, undetected: 8, timeout: 1 },
    },
  },
};

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');
  const previousBaseUrl = process.env.VIRUSTOTAL_API_BASE_URL;
  process.env.VIRUSTOTAL_API_BASE_URL = `http://127.0.0.1:${address.port}/api/v3`;
  try {
    await run();
  } finally {
    if (previousBaseUrl === undefined) delete process.env.VIRUSTOTAL_API_BASE_URL;
    else process.env.VIRUSTOTAL_API_BASE_URL = previousBaseUrl;
    await new Promise(resolve => server.close(resolve));
  }
}

for (const fixture of [
  { name: 'IP', type: 'IP_ADDRESS', value: '203.0.113.10', path: '/api/v3/ip_addresses/203.0.113.10' },
  { name: 'domain', type: 'DOMAIN', value: 'Example.COM', path: '/api/v3/domains/example.com' },
  { name: 'URL', type: 'URL', value: 'https://example.com/path?q=1', path: '/api/v3/urls/aHR0cHM6Ly9leGFtcGxlLmNvbS9wYXRoP3E9MQ' },
  { name: 'file hash', type: 'FILE_HASH', value: '44d88612fea8a8f36de82e1278abb02f', path: '/api/v3/files/44d88612fea8a8f36de82e1278abb02f' },
]) {
  test(`Given a ${fixture.name} indicator, when VirusTotal enrichment runs, then a compact detection summary is returned`, async () => {
    await withServer((request, serverResponse) => {
      assert.equal(request.url, fixture.path);
      assert.equal(request.headers['x-apikey'], 'test-key');
      serverResponse.setHeader('content-type', 'application/json');
      serverResponse.end(JSON.stringify(response));
    }, async () => {
      process.env.VIRUSTOTAL_API_KEY = 'test-key';
      const result = await new IndicatorEnrichmentClient().enrich(fixture.type, fixture.value, 'VIRUSTOTAL');
      assert.equal(result.provider, 'VIRUSTOTAL');
      assert.deepEqual(result.data.detections, { malicious: 3, suspicious: 2, harmless: 67, undetected: 8, timeout: 1, total: 81 });
      assert.equal(result.data.reputation, -7);
    });
  });
}

test('Given an unsupported indicator type, when VirusTotal enrichment runs, then no provider request is made', async () => {
  process.env.VIRUSTOTAL_API_KEY = 'test-key';
  await assert.rejects(
    () => new IndicatorEnrichmentClient().enrich('EMAIL', 'analyst@example.com', 'VIRUSTOTAL'),
    error => error instanceof UnsupportedIndicatorTypeError && error.message.includes('EMAIL'),
  );
});

test('Given an invalid file hash, when VirusTotal enrichment runs, then the input is rejected', async () => {
  process.env.VIRUSTOTAL_API_KEY = 'test-key';
  await assert.rejects(() => new IndicatorEnrichmentClient().enrich('FILE_HASH', 'not-a-hash', 'VIRUSTOTAL'), /hash/i);
});

test('Given a missing API key, when VirusTotal enrichment runs, then configuration failure is clear', async () => {
  delete process.env.VIRUSTOTAL_API_KEY;
  await assert.rejects(() => new IndicatorEnrichmentClient().enrich('DOMAIN', 'example.com', 'VIRUSTOTAL'), /VIRUSTOTAL_API_KEY/);
});

test('Given a VirusTotal API error, when enrichment runs, then the provider error is isolated', async () => {
  await withServer((_request, serverResponse) => {
    serverResponse.statusCode = 429;
    serverResponse.end(JSON.stringify({ error: { message: 'Quota exceeded' } }));
  }, async () => {
    process.env.VIRUSTOTAL_API_KEY = 'test-key';
    await assert.rejects(
      () => new IndicatorEnrichmentClient().enrich('DOMAIN', 'example.com', 'VIRUSTOTAL'),
      error => error instanceof ProviderHttpError && error.statusCode === 429,
    );
  });
});

test('Given VirusTotal returns Retry-After, when rate limited, then the retry delay is retained', async () => {
  await withServer((_request, serverResponse) => {
    serverResponse.statusCode = 429;
    serverResponse.setHeader('retry-after', '3');
    serverResponse.end('{}');
  }, async () => {
    process.env.VIRUSTOTAL_API_KEY = 'test-key';
    await assert.rejects(
      () => new IndicatorEnrichmentClient().enrich('DOMAIN', 'example.com', 'VIRUSTOTAL'),
      error => error instanceof ProviderHttpError && error.retryAfterMs === 3_000,
    );
  });
});

test('Given a slow VirusTotal API, when the timeout elapses, then enrichment fails without hanging', async () => {
  const previousTimeout = process.env.VIRUSTOTAL_TIMEOUT_MS;
  process.env.VIRUSTOTAL_TIMEOUT_MS = '25';
  await withServer((_request, serverResponse) => {
    setTimeout(() => serverResponse.end(JSON.stringify(response)), 100);
  }, async () => {
    process.env.VIRUSTOTAL_API_KEY = 'test-key';
    await assert.rejects(() => new IndicatorEnrichmentClient().enrich('DOMAIN', 'example.com', 'VIRUSTOTAL'), error => error instanceof ProviderTimeoutError);
  });
  if (previousTimeout === undefined) delete process.env.VIRUSTOTAL_TIMEOUT_MS;
  else process.env.VIRUSTOTAL_TIMEOUT_MS = previousTimeout;
});
