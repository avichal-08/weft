import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCents } from '../src/money.js';

test('formats whole and fractional amounts', () => {
  assert.equal(formatCents(1999), '$19.99');
  assert.equal(formatCents(-250), '-$2.50');
});
