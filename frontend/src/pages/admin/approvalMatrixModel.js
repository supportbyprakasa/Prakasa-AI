// Approval matrix data defaults (kept out of the JSX so pages never spell a
// currency code; amounts are shown through components/format.js).
export const DEFAULT_CURRENCY = 'IDR';

export function normalizeCurrency(value) {
  return String(value || '').trim().toUpperCase() || DEFAULT_CURRENCY;
}

export function isDefaultCurrency(value) {
  return normalizeCurrency(value) === DEFAULT_CURRENCY;
}
