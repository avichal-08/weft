import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deepMerge } from '../src/merge.js';

describe('deepMerge', () => {
  it('merges nested objects', () => {
    const merged = deepMerge(
      { server: { host: 'localhost', port: 80 }, debug: false },
      { server: { port: 8080 }, debug: true },
    );
    assert.deepEqual(merged, { server: { host: 'localhost', port: 8080 }, debug: true });
  });

  it('replaces arrays instead of merging them', () => {
    assert.deepEqual(deepMerge({ tags: ['a', 'b'] }, { tags: ['c'] }), { tags: ['c'] });
  });

  it('does not modify its inputs', () => {
    const target = { server: { port: 80 } };
    const source = { server: { port: 8080 }, extra: 1 };
    deepMerge(target, source);
    assert.deepEqual(target, { server: { port: 80 } });
    assert.deepEqual(source, { server: { port: 8080 }, extra: 1 });
  });

  it('ignores prototype keys from untrusted input', () => {
    const merged = deepMerge({}, JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}'));
    assert.equal(merged.polluted, undefined);
    assert.equal(Object.getPrototypeOf(merged), Object.prototype);
    assert.equal({}.polluted, undefined);
    assert.equal(merged.ok, 1);
  });
});
