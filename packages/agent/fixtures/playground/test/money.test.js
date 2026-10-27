import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatMoney } from '../src/money.js';

describe('formatMoney', () => {
  it('formats with two decimals and thousands separators', () => {
    assert.equal(formatMoney(0), '$0.00');
    assert.equal(formatMoney(1234567.5), '$1,234,567.50');
    assert.equal(formatMoney(-42.1, '€'), '-€42.10');
  });

  it('rounds half up despite floating point error', () => {
    assert.equal(formatMoney(1.005), '$1.01');
    assert.equal(formatMoney(8.345), '$8.35');
    assert.equal(formatMoney(2.675), '$2.68');
  });

  it('does not print negative zero', () => {
    assert.equal(formatMoney(-0.001), '$0.00');
  });

  it('rejects non-finite amounts', () => {
    assert.throws(() => formatMoney(Number.NaN), TypeError);
  });
});
