import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRateLimitCount } from './rateLimit.js';

test('rate limiting allows valid counts below the threshold', () => {
  assert.equal(classifyRateLimitCount(2, 3), 'ok');
});

test('rate limiting rejects counts above the threshold', () => {
  assert.equal(classifyRateLimitCount(4, 3), 'rate_limited');
});

test('rate limiting fails closed when the counter is unavailable or invalid', () => {
  for (const value of [undefined, null, 'not-a-number', Number.NaN, -1]) {
    assert.equal(classifyRateLimitCount(value, 3), 'unavailable');
  }
});