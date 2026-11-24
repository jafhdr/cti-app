const assert = require('node:assert/strict');
const test = require('node:test');

const { assertQaDatabase } = require('./qa-database-guard.cjs');

const unifiedUrl = 'postgresql://qa:secret@127.0.0.1:55475/cti_unified_qa_sict75';

test('accepts an unchanged historical database contract', () => {
  assert.doesNotThrow(() => assertQaDatabase({
    databaseUrl: 'postgresql://qa:secret@127.0.0.1:55475/stake48_p1d_0123456789',
    declaredDatabase: 'stake48_p1d_0123456789',
    legacyDatabase: /^stake48_p1d_[0-9a-f]{10}$/,
    requireDeclaredDatabase: true,
  }));
});

test('accepts the approved unified identity only with both QA flags', () => {
  assert.doesNotThrow(() => assertQaDatabase({
    databaseUrl: unifiedUrl,
    declaredDatabase: undefined,
    legacyDatabase: /^stake48_p1d_[0-9a-f]{10}$/,
    isolatedQa: 'true',
    unifiedQa: 'true',
  }));
});

test('rejects unified identity when either QA flag is absent', () => {
  for (const flags of [
    { isolatedQa: undefined, unifiedQa: 'true' },
    { isolatedQa: 'true', unifiedQa: undefined },
  ]) {
    assert.throws(() => assertQaDatabase({
      databaseUrl: unifiedUrl,
      declaredDatabase: undefined,
      legacyDatabase: /^stake48_p1d_[0-9a-f]{10}$/,
      ...flags,
    }), /Expected isolated QA database/);
  }
});

test('rejects active, malformed, and mismatched historical database identities', () => {
  for (const fixture of [
    { databaseUrl: 'postgresql://qa:secret@127.0.0.1:55475/cti' },
    { databaseUrl: 'postgresql://qa:secret@127.0.0.1:55475/cti_unified_qa_' },
    {
      databaseUrl: 'postgresql://qa:secret@127.0.0.1:55475/stake48_p1d_0123456789',
      declaredDatabase: 'stake48_p1d_aaaaaaaaaa',
    },
  ]) {
    assert.throws(() => assertQaDatabase({
      ...fixture,
      legacyDatabase: /^stake48_p1d_[0-9a-f]{10}$/,
      requireDeclaredDatabase: fixture.declaredDatabase !== undefined,
      isolatedQa: 'true',
      unifiedQa: 'true',
    }), /Expected isolated QA database/);
  }
});
