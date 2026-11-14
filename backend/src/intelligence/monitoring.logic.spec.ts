import { describe, expect, it } from '@jest/globals';
import { matchObservation, normalizeDomain, safeEvidenceRef } from './monitoring.logic';

describe('Phase 4A monitoring boundaries', () => {
  it('Given a mixed-case corporate domain, when normalized, then it has one canonical form', () => {
    expect(normalizeDomain('Example.TEST.')).toBe('example.test');
    expect(() => normalizeDomain('https://example.test/a')).toThrow();
  });

  it('Given an authorized identity, when watched, then only its hash and masked label remain', () => {
    expect(() => safeEvidenceRef('https://example.test/?token=secret')).toThrow();
  });

  it('Given unrelated and lookalike domains, when matched, then only explainable candidates remain', () => {
    expect(matchObservation('BRAND_IMPERSONATION', 'acme-login.test', null, { kind: 'BRAND', value: 'acme' })?.rule).toBe('BRAND_TOKEN');
    expect(matchObservation('BRAND_IMPERSONATION', 'acm3-login.test', null, { kind: 'DOMAIN', value: 'acme.test' })?.rule).toBe('LOOKALIKE_EDIT_1');
    expect(matchObservation('BRAND_IMPERSONATION', 'acme-corp-login.test', null, { kind: 'BRAND', value: 'acme corp' })?.rule).toBe('BRAND_TOKEN');
    expect(matchObservation('PHISHING_DOMAIN', 'unrelated.test', null, { kind: 'DOMAIN', value: 'acme.test' })).toBeNull();
    expect(matchObservation('CREDENTIAL_EXPOSURE', null, 'a'.repeat(64), { kind: 'IDENTITY_HASH', value: 'a'.repeat(64) })?.confidence).toBe(100);
  });

  it('Given an unsafe evidence reference, when parsed, then it is rejected', () => {
    expect(safeEvidenceRef('qa://fixture/evidence-1')).toBe('qa://fixture/evidence-1');
    expect(() => safeEvidenceRef('https://example.test/?token=secret')).toThrow();
  });
});
