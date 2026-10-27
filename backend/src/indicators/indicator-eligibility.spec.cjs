const test = require('node:test');
const assert = require('node:assert/strict');
const { effectiveIndicatorEligibility } = require('./indicator-eligibility.ts');

const now = new Date('2026-10-27T00:00:00.000Z');
const active = { status: 'ACTIVE', expiresAt: null, suppressionKind: null };

test('Given active IOC without expiry, when eligibility is evaluated, then it remains eligible', () => {
  assert.equal(effectiveIndicatorEligibility(active, now).eligible, true);
});

test('Given expiry at the current instant, when eligibility is evaluated, then it is expired', () => {
  assert.deepEqual(effectiveIndicatorEligibility({ ...active, expiresAt: now }, now), { eligible: false, reason: 'EXPIRED' });
});

test('Given independent restrictions, when a suppression is cleared, then expiry and inactive status still deny use', () => {
  assert.equal(effectiveIndicatorEligibility({ ...active, status: 'INACTIVE' }, now).reason, 'INACTIVE');
  assert.equal(effectiveIndicatorEligibility({ ...active, expiresAt: new Date(now.getTime() - 1) }, now).reason, 'EXPIRED');
});

test('Given analyst decisions, when eligibility is evaluated, then each suppression remains distinct', () => {
  assert.equal(effectiveIndicatorEligibility({ ...active, suppressionKind: 'FALSE_POSITIVE' }, now).reason, 'FALSE_POSITIVE');
  assert.equal(effectiveIndicatorEligibility({ ...active, suppressionKind: 'SAFELIST' }, now).reason, 'SAFELIST');
});
