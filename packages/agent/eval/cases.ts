export type Expect = {
  edits: boolean;
  mentions?: RegExp[];
  forbidden?: RegExp;
  keepTests?: boolean;
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
  ];
}
