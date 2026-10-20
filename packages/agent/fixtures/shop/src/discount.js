const CODES = {
  SAVE10: { type: 'percent', value: 10 },
  TAKE5: { type: 'fixed', value: 500 },
};

export function findDiscount(code) {
  return CODES[code.trim()] ?? null;
}

export function applyDiscount(subtotal, discount) {
  if (!discount) return subtotal;
  if (discount.type === 'percent') return Math.round(subtotal * (1 - discount.value / 100));
  return Math.max(0, subtotal - discount.value);
}
