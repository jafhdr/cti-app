const assert = require('node:assert/strict');

const unifiedDatabase = /^cti_unified_qa_[a-z0-9]+$/;

function assertQaDatabase({
  databaseUrl,
  declaredDatabase,
  legacyDatabase,
  requireDeclaredDatabase = false,
  isolatedQa = process.env.SICTI_ISOLATED_QA,
  unifiedQa = process.env.SICTI_UNIFIED_QA_ENABLED,
}) {
  let actualDatabase = '';
  try {
    actualDatabase = new URL(databaseUrl ?? 'postgresql://invalid/invalid').pathname.slice(1);
  } catch {
    assert.fail('Expected isolated QA database');
  }

  const declaredMatches = requireDeclaredDatabase
    ? declaredDatabase === actualDatabase
    : declaredDatabase === undefined || declaredDatabase === actualDatabase;
  const historicalAllowed = legacyDatabase.test(actualDatabase) && declaredMatches;
  const unifiedAllowed = unifiedDatabase.test(actualDatabase)
    && isolatedQa === 'true'
    && unifiedQa === 'true'
    && (declaredDatabase === undefined || declaredDatabase === actualDatabase);

  assert.equal(historicalAllowed || unifiedAllowed, true, 'Expected isolated QA database');
  return actualDatabase;
}

module.exports = { assertQaDatabase };
