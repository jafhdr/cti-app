import { randomUUID } from 'node:crypto';
import { actionSchema, connectorConfig, sign, validSignature, validTimestamp } from './sandbox-contract';

const secret = 'a'.repeat(32);

describe('sandbox connector contract', () => {
  it('accepts a versioned synthetic domain action', () => {
    expect(actionSchema.parse({ version: 1, requestId: randomUUID(), tenantId: 'qa-tenant', operation: 'BLOCK_DOMAIN', target: 'malicious.example.test', timestamp: Date.now(), nonce: randomUUID() }).target).toBe('malicious.example.test');
  });

  it.each(['example.com', '127.0.0.1', 'localhost', 'foo.test.evil.com', 'https://foo.test'])('rejects non synthetic target %s', target => {
    expect(() => actionSchema.parse({ version: 1, requestId: randomUUID(), tenantId: 'qa-tenant', operation: 'BLOCK_DOMAIN', target, timestamp: Date.now(), nonce: randomUUID() })).toThrow();
  });

  it('rejects tampered signatures and stale timestamps', () => {
    const signature = sign('payload', secret);
    expect(validSignature('payload', signature, secret)).toBe(true);
    expect(validSignature('altered', signature, secret)).toBe(false);
    expect(validTimestamp(Date.now() - 31_000)).toBe(false);
  });

  it('rejects non loopback endpoints and short secrets', () => {
    const priorUrl = process.env.SICTI_SOAR_SANDBOX_URL;
    const priorSecret = process.env.SICTI_SOAR_SANDBOX_SECRET;
    try {
      process.env.SICTI_SOAR_SANDBOX_URL = 'https://production.example.test/';
      process.env.SICTI_SOAR_SANDBOX_SECRET = secret;
      expect(connectorConfig).toThrow();
      process.env.SICTI_SOAR_SANDBOX_URL = 'http://127.0.0.1:4000/';
      process.env.SICTI_SOAR_SANDBOX_SECRET = 'short';
      expect(connectorConfig).toThrow();
    } finally {
      if (priorUrl === undefined) delete process.env.SICTI_SOAR_SANDBOX_URL; else process.env.SICTI_SOAR_SANDBOX_URL = priorUrl;
      if (priorSecret === undefined) delete process.env.SICTI_SOAR_SANDBOX_SECRET; else process.env.SICTI_SOAR_SANDBOX_SECRET = priorSecret;
    }
  });
});
