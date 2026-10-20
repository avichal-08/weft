import { applyDiscount, findDiscount } from './discount.js';
import { formatCents } from './money.js';

export const SHIPPING_CENTS = 499;
export const FREE_SHIPPING_FROM = 5000;

export function createCart() {
  return { items: [], code: null };
}

export function addItem(cart, { sku, priceCents, qty = 1 }) {
  const existing = cart.items.find((item) => item.sku === sku);
  if (existing) existing.qty += qty;
  else cart.items.push({ sku, priceCents, qty });
  return cart;
}

export function subtotal(cart) {
  return cart.items.reduce((sum, item) => sum + item.priceCents * item.qty, 0);
}

export function total(cart) {
  const discount = cart.code ? findDiscount(cart.code) : null;
  const discounted = applyDiscount(subtotal(cart), discount);
  const shipping = discounted >= FREE_SHIPPING_FROM ? 0 : SHIPPING_CENTS;
  return discounted + shipping;
}

export function receipt(cart) {
  const lines = cart.items.map(
    (item) => `${item.qty} x ${item.sku}  ${formatCents(item.priceCents * item.qty)}`,
  );
  return [...lines, `Total  ${formatCents(total(cart))}`].join('\n');
}
