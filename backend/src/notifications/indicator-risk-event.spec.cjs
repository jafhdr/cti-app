const assert = require('node:assert/strict');
const test = require('node:test');
const { isSignificantRiskIncrease } = require('../../dist/src/notifications/indicator-risk-event');

test('Given Indicator severities, when risk changes, then only increases into HIGH or CRITICAL trigger', () => {
  assert.equal(isSignificantRiskIncrease('LOW', 'HIGH'), true);
  assert.equal(isSignificantRiskIncrease('HIGH', 'CRITICAL'), true);
  assert.equal(isSignificantRiskIncrease('MEDIUM', 'CRITICAL'), true);
  assert.equal(isSignificantRiskIncrease('HIGH', 'HIGH'), false);
  assert.equal(isSignificantRiskIncrease('CRITICAL', 'HIGH'), false);
  assert.equal(isSignificantRiskIncrease('LOW', 'MEDIUM'), false);
});
