export type Expect = {
  edits: boolean;
  mentions?: RegExp[];
  forbidden?: RegExp;
  check?: string;
};

export type EvalCase = {
  name: string;
  kind: 'question' | 'change';
  task: string;
  history?: [user: string, assistant: string][];
  prior?: Record<string, string>;
  expect: Expect;
};

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

export function cases(read: (path: string) => string): EvalCase[] {
  const freeShip = {
    'src/discount.js': freeShipDiscount,
    'src/cart.js': freeShipCart(read('src/cart.js')),
  };

  return [
    {
      name: 'q-discount-flow',
      kind: 'question',
      task: 'How does a discount code like SAVE10 get applied to the cart total? Point me to the code.',
      expect: { edits: false, mentions: [/discount\.js/, /cart\.js/] },
    },
    {
      name: 'q-why-bug',
      kind: 'question',
      task: 'Why does a price of 1005 cents show up as $10.5 on the receipt?',
      expect: { edits: false, mentions: [/money\.js/, /pad|leading zero|two digits|05/i] },
    },
    {
      name: 'q-review',
      kind: 'question',
      task: 'Can you review how the cart total is calculated? Does anything look wrong?',
      expect: { edits: false, mentions: [/cart\.js/] },
    },
    {
      name: 'q-tests',
      kind: 'question',
      task: 'Which test framework does this project use, and how do I run the tests?',
      expect: { edits: false, mentions: [/node(:| --)test/] },
    },
    {
      name: 'c-fix-money',
      kind: 'change',
      task: 'Amounts like 1005 cents show up as $10.5. Please fix it.',
      expect: {
        edits: true,
        check:
          "import { formatCents as f } from './src/money.js'; if (f(1005) !== '$10.05' || f(-1005) !== '-$10.05' || f(1999) !== '$19.99') process.exit(1);",
      },
    },
    {
      name: 'c-empty-cart',
      kind: 'change',
      task: "Don't charge shipping when the cart is empty.",
      expect: {
        edits: true,
        check:
          "import { createCart, addItem, total } from './src/cart.js'; if (total(createCart()) !== 0 || total(addItem(createCart(), { sku: 'a', priceCents: 100 })) !== 599) process.exit(1);",
      },
    },
    {
      name: 'f-own-change',
      kind: 'question',
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
      kind: 'question',
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
      kind: 'change',
      task: "Now make discount codes case-insensitive, so 'save10' works too.",
      history: [freeShipHistory],
      prior: freeShip,
      expect: {
        edits: true,
        check:
          "import { findDiscount as d } from './src/discount.js'; if (!d('save10') || !d('freeship') || !d('SAVE10') || d('nope')) process.exit(1);",
      },
    },
  ];
}
