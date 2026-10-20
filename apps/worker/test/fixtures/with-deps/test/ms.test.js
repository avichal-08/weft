import assert from 'node:assert/strict';
import { test } from 'node:test';
import ms from 'ms';

test('ms parses durations', () => {
  assert.equal(ms('2h'), 7_200_000);
});
