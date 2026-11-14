import { describe, expect, it } from '@jest/globals';
import { identityDigest } from './monitoring-identity';

describe('Phase 4B tenant-separated identity digests', () => {
  it('Given two tenants and two key versions, when digesting an identity, then every scope has a distinct digest', () => {
    process.env.SICTI_MONITORING_IDENTITY_KEY_V1 = Buffer.alloc(32, 1).toString('base64url');
    process.env.SICTI_MONITORING_IDENTITY_KEY_V2 = Buffer.alloc(32, 2).toString('base64url');
    process.env.SICTI_MONITORING_IDENTITY_ACTIVE_VERSION = 'v1';
    const first = identityDigest('tenant-a', 'Analyst@Example.TEST', 'v1');
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.label).toBe('***@example.test');
    expect(first.digest).toBe(identityDigest('tenant-a', 'analyst@example.test', 'v1').digest);
    expect(first.digest).not.toBe(identityDigest('tenant-b', 'analyst@example.test', 'v1').digest);
    expect(first.digest).not.toBe(identityDigest('tenant-a', 'analyst@example.test', 'v2').digest);
    expect(first.digest).not.toBe('4ab4f0bd');
  });
});
