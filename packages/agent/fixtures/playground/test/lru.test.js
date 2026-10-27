import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LRUCache } from '../src/lru.js';

describe('LRUCache', () => {
  it('stores and returns values', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1).set('b', 2);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('missing'), undefined);
    assert.equal(cache.size, 2);
  });

  it('evicts the least recently set entry', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1).set('b', 2).set('c', 3);
    assert.equal(cache.has('a'), false);
    assert.equal(cache.has('c'), true);
  });

  it('counts reads as use when choosing what to evict', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1).set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    assert.equal(cache.has('a'), true);
    assert.equal(cache.has('b'), false);
  });

  it('rejects an invalid size', () => {
    assert.throws(() => new LRUCache(0), RangeError);
  });
});
