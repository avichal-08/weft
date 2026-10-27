export function formatMoney(amount, symbol = '$') {
  if (!Number.isFinite(amount)) {
    throw new TypeError('amount must be a finite number');
  }

  const cents = Math.round(Number(`${Math.abs(amount)}e2`));
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = String(cents % 100).padStart(2, '0');
  const sign = amount < 0 && cents > 0 ? '-' : '';

  return `${sign}${symbol}${whole}.${fraction}`;
}
