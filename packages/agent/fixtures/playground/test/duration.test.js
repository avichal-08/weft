import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDuration, parseDuration } from '../src/duration.js';

describe('parseDuration', () => {
  it('parses single units', () => {
    assert.equal(parseDuration('30s'), 30_000);
    assert.equal(parseDuration('5m'), 300_000);
    assert.equal(parseDuration('2h'), 7_200_000);
    assert.equal(parseDuration('1d'), 86_400_000);
  });

  it('parses milliseconds', () => {
    assert.equal(parseDuration('500ms'), 500);
    assert.equal(parseDuration('1s 250ms'), 1250);
  });

  it('parses combinations and decimals', () => {
    assert.equal(parseDuration('1h30m'), 5_400_000);
    assert.equal(parseDuration('1h 30m 15s'), 5_415_000);
    assert.equal(parseDuration('1.5h'), 5_400_000);
  });

  it('rejects invalid input', () => {
    assert.throws(() => parseDuration(''), SyntaxError);
    assert.throws(() => parseDuration('10'), SyntaxError);
    assert.throws(() => parseDuration('5 minutes'), SyntaxError);
  });
});

describe('formatDuration', () => {
  it('formats durations', () => {
    assert.equal(formatDuration(500), '500ms');
    assert.equal(formatDuration(5_415_000), '1h 30m 15s');
    assert.equal(formatDuration(90_061_000), '1d 1h 1m 1s');
  });
});
