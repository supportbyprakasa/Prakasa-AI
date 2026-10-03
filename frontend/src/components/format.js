// The one place dates, money and quantities are turned into text
// (docs/ui-guideline.md §4.16). Pages never call toLocale* themselves.
// Every formatter returns EMPTY ("—") for a missing or unreadable value, so a
// table cell or a KeyValue row never collapses.

// They follow the interface language (i18n/language.js): Indonesian
// "30 Sep 2026, 14.05" · "1.234,5"; English "30 Sep 2026, 14:05" · "1,234.5".
// The currency is always "Rp".
import { getLanguage, numberLocale } from '../i18n/language.js';
import { namesFor } from '../i18n/names.js';

export const EMPTY = '—';

const months = () => namesFor(getLanguage()).monthsShort;
const clockSeparator = () => (getLanguage() === 'en' ? ':' : '.');
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const isBlank = (value) => value === null || value === undefined || value === '';
const pad2 = (n) => String(n).padStart(2, '0');

// A date-only string ("2026-09-30") is a calendar day, not an instant: it is
// read in local time so it never shifts a day in a negative UTC offset.
export function toDate(value) {
  if (isBlank(value)) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const m = DATE_ONLY.exec(value.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// "30 Sep 2026"
export function formatDate(value) {
  const date = toDate(value);
  if (!date) return EMPTY;
  return `${date.getDate()} ${months()[date.getMonth()]} ${date.getFullYear()}`;
}

// "30 Sep 2026, 14.05" (Indonesian clock: a dot between hour and minute;
// English: a colon).
export function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return EMPTY;
  return `${formatDate(date)}, ${formatTime(date)}`;
}

// "14.05"
export function formatTime(value) {
  const date = toDate(value);
  if (!date) return EMPTY;
  return `${pad2(date.getHours())}${clockSeparator()}${pad2(date.getMinutes())}`;
}

// One formatter per language and precision, made on first use.
const formatters = new Map();
function group(digits) {
  const key = `${getLanguage()}:${digits}`;
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.NumberFormat(numberLocale(), { minimumFractionDigits: 0, maximumFractionDigits: digits }));
  }
  return formatters.get(key);
}
const INTEGER = { format: (n) => group(0).format(n) };
const QTY = { format: (n) => group(2).format(n) };

function toNumber(value) {
  if (isBlank(value) || typeof value === 'boolean') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// "Rp 1.234.567" · "-Rp 5.000". Rounded to the rupiah.
export function formatMoney(value) {
  const n = toNumber(value);
  if (n === null) return EMPTY;
  const rounded = Math.round(Math.abs(n));
  return `${n < 0 && rounded !== 0 ? '-' : ''}Rp ${INTEGER.format(rounded)}`;
}

// "1.234" · "12,5" · "6 Ctns". Up to two decimals, Indonesian grouping.
export function formatQty(value, unit) {
  const n = toNumber(value);
  if (n === null) return EMPTY;
  const text = QTY.format(n);
  return unit ? `${text} ${unit}` : text;
}

// Whole numbers with grouping: "1.738".
export function formatNumber(value) {
  const n = toNumber(value);
  return n === null ? EMPTY : INTEGER.format(Math.round(n));
}

// Count shown in a CountBadge: 0 → '' (nothing to show), 120 → "99+".
export function formatBadgeCount(count, max = 99) {
  const n = toNumber(count);
  if (n === null || n <= 0) return '';
  return n > max ? `${max}+` : String(Math.round(n));
}
