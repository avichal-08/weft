import assert from 'node:assert/strict';
import { test } from 'node:test';
import { greet } from '@fixture/greet';
import ms from 'ms';

test('resolves the workspace package and the registry package', () => {
  assert.equal(greet('weft'), 'hello weft');
  assert.equal(ms('2h'), 7_200_000);
});
