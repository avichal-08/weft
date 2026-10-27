export class LRUCache {
  #max;
  #entries = new Map();

  constructor(max) {
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError('max must be a positive integer');
    }
    this.#max = max;
  }

  get(key) {
    if (!this.#entries.has(key)) return undefined;
    const value = this.#entries.get(key);
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key, value) {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    if (this.#entries.size > this.#max) {
      this.#entries.delete(this.#entries.keys().next().value);
    }
    return this;
  }

  has(key) {
    return this.#entries.has(key);
  }

  get size() {
    return this.#entries.size;
  }
}
