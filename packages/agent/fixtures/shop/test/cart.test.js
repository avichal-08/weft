import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addItem, createCart, subtotal, total } from '../src/cart.js';

test('adds up items and merges the same sku', () => {
  const cart = createCart();
  addItem(cart, { sku: 'mug', priceCents: 1200 });
  addItem(cart, { sku: 'mug', priceCents: 1200, qty: 2 });
  assert.equal(cart.items.length, 1);
  assert.equal(subtotal(cart), 3600);
});

test('charges shipping below the threshold', () => {
  const cart = addItem(createCart(), { sku: 'mug', priceCents: 1200 });
  assert.equal(total(cart), 1699);
});

test('applies a percent code', () => {
  const cart = addItem(createCart(), { sku: 'lamp', priceCents: 6000 });
  cart.code = 'SAVE10';
  assert.equal(total(cart), 5400);
});
