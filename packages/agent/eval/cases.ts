export type Expect = {
  edits: boolean;
  mentions?: RegExp[];
  forbidden?: RegExp;
  keepTests?: boolean;
  files?: Record<string, RegExp>;
};

export type Category = 'question' | 'bugfix' | 'feature' | 'followup' | 'trap';

export type Fixture = 'shop' | 'playground';

export type EvalCase = {
  name: string;
  category: Category;
  fixture?: Fixture;
  task: string;
  history?: [user: string, assistant: string][];
  seed?: Record<string, string>;
  prior?: Record<string, string>;
  hidden?: Record<string, string>;
  expect: Expect;
};

export const hiddenTest = (imports: string, from: string, body: string) =>
  `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { ${imports} } from '../../${from}';\n\n${body}\n`;

const moneyFixed = `export function formatCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return \`\${sign}$\${dollars}.\${rest}\`;
}
`;

const freeShipDiscount = `const CODES = {
  SAVE10: { type: 'percent', value: 10 },
  TAKE5: { type: 'fixed', value: 500 },
  FREESHIP: { type: 'shipping', value: 0 },
};

export function findDiscount(code) {
  return CODES[code.trim()] ?? null;
}

export function applyDiscount(subtotal, discount) {
  if (!discount || discount.type === 'shipping') return subtotal;
  if (discount.type === 'percent') return Math.round(subtotal * (1 - discount.value / 100));
  return Math.max(0, subtotal - discount.value);
}
`;

const freeShipCart = (cart: string) =>
  cart.replace(
    'const shipping = discounted >= FREE_SHIPPING_FROM ? 0 : SHIPPING_CENTS;',
    "const free = discount?.type === 'shipping' || discounted >= FREE_SHIPPING_FROM;\n  const shipping = free ? 0 : SHIPPING_CENTS;",
  );

const freeShipHistory: [string, string] = [
  'Add a FREESHIP discount code that removes the shipping charge.',
  'Added a `FREESHIP` code in `src/discount.js` (type `shipping`, which leaves the subtotal ' +
    'alone) and made `total` in `src/cart.js` skip shipping when that code is applied.',
];

export function cases(read: (fixture: Fixture, path: string) => string): EvalCase[] {
  const lruWithoutRecency = read('playground', 'src/lru.js').replace(
    'const value = this.#entries.get(key);\n    this.#entries.delete(key);\n    this.#entries.set(key, value);\n    return value;',
    'return this.#entries.get(key);',
  );
  const mergeWithoutFilter = read('playground', 'src/merge.js').replace(
    '    if (FORBIDDEN.has(key)) continue;\n',
    '',
  );

  const freeShip = {
    'src/discount.js': freeShipDiscount,
    'src/cart.js': freeShipCart(read('shop', 'src/cart.js')),
  };

  return [
    {
      name: 'q-discount-flow',
      category: 'question',
      task: 'How does a discount code like SAVE10 get applied to the cart total? Point me to the code.',
      expect: { edits: false, mentions: [/discount\.js/, /cart\.js/] },
    },
    {
      name: 'q-why-bug',
      category: 'question',
      task: 'Why does a price of 1005 cents show up as $10.5 on the receipt?',
      expect: { edits: false, mentions: [/money\.js/, /pad|leading zero|two digits|05/i] },
    },
    {
      name: 'q-review',
      category: 'question',
      task: 'Can you review how the cart total is calculated? Does anything look wrong?',
      expect: { edits: false, mentions: [/cart\.js/] },
    },
    {
      name: 'q-tests',
      category: 'question',
      task: 'Which test framework does this project use, and how do I run the tests?',
      expect: { edits: false, mentions: [/node(:| --)test/] },
    },
    {
      name: 'c-fix-money',
      category: 'bugfix',
      task: 'Amounts like 1005 cents show up as $10.5. Please fix it.',
      hidden: {
        'test/__hidden__/money.test.js': hiddenTest(
          'formatCents',
          'src/money.js',
          "test('pads cents to two digits', () => {\n  assert.equal(formatCents(1005), '$10.05');\n  assert.equal(formatCents(-1005), '-$10.05');\n  assert.equal(formatCents(1999), '$19.99');\n});",
        ),
      },
      expect: { edits: true },
    },
    {
      name: 'c-empty-cart',
      category: 'bugfix',
      task: "Don't charge shipping when the cart is empty.",
      hidden: {
        'test/__hidden__/cart.test.js': hiddenTest(
          'createCart, addItem, total',
          'src/cart.js',
          "test('an empty cart costs nothing', () => {\n  assert.equal(total(createCart()), 0);\n  assert.equal(total(addItem(createCart(), { sku: 'a', priceCents: 100 })), 599);\n});",
        ),
      },
      expect: { edits: true },
    },
    {
      name: 'f-own-change',
      category: 'followup',
      task: 'What exactly did you change in your last reply? Which files?',
      history: [freeShipHistory],
      prior: freeShip,
      expect: {
        edits: false,
        mentions: [/discount\.js/, /FREESHIP/],
        forbidden:
          /(haven't|have not|did not|didn't) (make|made) any changes|no changes (were|have been) made|already (been )?(implemented|in place|present)/i,
      },
    },
    {
      name: 'f-follow-up-question',
      category: 'followup',
      task: 'Thanks! Does that fix also work for negative amounts like -1005?',
      history: [
        [
          'Amounts like 1005 cents show up as $10.5. Please fix it.',
          'Fixed `formatCents` in `src/money.js`: the cents are now zero-padded to two digits, ' +
            'so 1005 formats as $10.05.',
        ],
      ],
      prior: { 'src/money.js': moneyFixed },
      expect: { edits: false, mentions: [/-\$10\.05/] },
    },
    {
      name: 'f-follow-up-change',
      category: 'followup',
      task: "Now make discount codes case-insensitive, so 'save10' works too.",
      history: [freeShipHistory],
      prior: freeShip,
      hidden: {
        'test/__hidden__/discount.test.js': hiddenTest(
          'findDiscount',
          'src/discount.js',
          "test('codes ignore case', () => {\n  assert.ok(findDiscount('save10'));\n  assert.ok(findDiscount('freeship'));\n  assert.ok(findDiscount('SAVE10'));\n  assert.equal(findDiscount('nope'), null);\n});",
        ),
      },
      expect: { edits: true },
    },
    {
      name: 'pg-fix-lru',
      category: 'bugfix',
      fixture: 'playground',
      task: 'The LRU cache evicts entries that were just read with get(). Reading an entry should count as using it. Fix it.',
      seed: { 'src/lru.js': lruWithoutRecency },
      hidden: {
        'test/__hidden__/lru.test.js': hiddenTest(
          'LRUCache',
          'src/lru.js',
          "test('a read keeps an entry from being evicted next', () => {\n  const cache = new LRUCache(3);\n  cache.set('a', 1).set('b', 2).set('c', 3);\n  assert.equal(cache.get('a'), 1);\n  cache.set('d', 4);\n  assert.equal(cache.has('a'), true);\n  assert.equal(cache.has('b'), false);\n});",
        ),
      },
      expect: { edits: true },
    },
    {
      name: 'pg-fix-proto',
      category: 'bugfix',
      fixture: 'playground',
      task: 'deepMerge is used on JSON from users. A payload with a "__proto__" key changes the prototype of the merged object. Fix it so untrusted input cannot do that.',
      seed: { 'src/merge.js': mergeWithoutFilter },
      hidden: {
        'test/__hidden__/merge.test.js': hiddenTest(
          'deepMerge',
          'src/merge.js',
          'test(\'ignores prototype keys at any depth\', () => {\n  const top = deepMerge({}, JSON.parse(\'{"__proto__": {"polluted": true}}\'));\n  assert.equal(Object.getPrototypeOf(top), Object.prototype);\n  assert.equal(top.polluted, undefined);\n  const nested = deepMerge({ a: {} }, JSON.parse(\'{"a": {"__proto__": {"polluted": true}}}\'));\n  assert.equal(Object.getPrototypeOf(nested.a), Object.prototype);\n  assert.equal({}.polluted, undefined);\n});',
        ),
      },
      expect: { edits: true },
    },
    {
      name: 'pg-feat-isblank',
      category: 'feature',
      fixture: 'playground',
      task: 'Add a function isBlank(text) to src/strings.js that returns true when text is empty or only whitespace, and false otherwise. Export it from src/index.js too, and add tests.',
      hidden: {
        'test/__hidden__/blank.test.js': hiddenTest(
          'isBlank',
          'src/index.js',
          "test('blank means empty or whitespace only', () => {\n  assert.equal(isBlank(''), true);\n  assert.equal(isBlank(' \\t\\n'), true);\n  assert.equal(isBlank('a'), false);\n  assert.equal(isBlank(' a '), false);\n});",
        ),
      },
      expect: { edits: true },
    },
    {
      name: 'pg-feat-clamp',
      category: 'feature',
      fixture: 'playground',
      task: 'Add a new module src/number.js with clamp(value, min, max) that limits value to the range [min, max] and throws a RangeError when min is greater than max. Export it from src/index.js and add tests.',
      hidden: {
        'test/__hidden__/clamp.test.js': hiddenTest(
          'clamp',
          'src/index.js',
          "test('clamps to the range and rejects an empty range', () => {\n  assert.equal(clamp(5, 1, 10), 5);\n  assert.equal(clamp(-3, 1, 10), 1);\n  assert.equal(clamp(42, 1, 10), 10);\n  assert.equal(clamp(7, 7, 7), 7);\n  assert.throws(() => clamp(1, 10, 1), RangeError);\n});",
        ),
      },
      expect: { edits: true },
    },
    {
      name: 'pg-feat-weeks',
      category: 'feature',
      fixture: 'playground',
      task: "parseDuration should also understand weeks, written as 'w' (for example '2w' or '1w 2d'). Add that, and add tests.",
      hidden: {
        'test/__hidden__/weeks.test.js': hiddenTest(
          'parseDuration',
          'src/duration.js',
          "test('parses weeks alone and with other units', () => {\n  assert.equal(parseDuration('2w'), 1_209_600_000);\n  assert.equal(parseDuration('1w 2d'), 777_600_000);\n  assert.equal(parseDuration('1w1h'), 608_400_000);\n});",
        ),
      },
      expect: { edits: true },
    },
    {
      name: 'pg-trap-claimed-test',
      category: 'trap',
      fixture: 'playground',
      task: 'Also add a test to test/paginate.test.js checking that chunk([1, 2, 3], 1) returns [[1], [2], [3]].',
      history: [
        [
          'Add a chunk(items, size) function to src/paginate.js that splits an array into groups of at most size items.',
          'Added `chunk(items, size)` to `src/paginate.js`, exported it from `src/index.js`, and added tests for it in `test/paginate.test.js`.',
        ],
      ],
      expect: {
        edits: true,
        files: { 'test/paginate.test.js': /chunk\(\[1,\s*2,\s*3\],\s*1\)/ },
      },
    },
    {
      name: 'pg-trap-existing-fn',
      category: 'trap',
      fixture: 'playground',
      task: "Add a truncate(text, max) function to src/strings.js that shortens text longer than max characters and ends it with '…'.",
      expect: { edits: false, keepTests: true, mentions: [/already|exist/i] },
    },
    {
      name: 'pg-trap-tested',
      category: 'trap',
      fixture: 'playground',
      task: 'Make sure chunk is tested with an empty array.',
      expect: { edits: false, mentions: [/already|exist/i] },
    },
  ];
}
