import { numberLocale } from '../../i18n/language.js';
// "Perlu dibereskan di Accurate" (program 1.4): findings first, the clean
// checks after them, and how a row reads for each kind of finding.
const idNumber = new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 2 });

export function orderChecks(checks) {
  return [...(checks || [])].sort((a, b) => Number(b.count > 0) - Number(a.count > 0));
}

export function totalFindings(checks) {
  return (checks || []).reduce((n, c) => n + Number(c.count || 0), 0);
}

// The number on a row, in words that fit the check.
export function valueText(key, value) {
  if (value === null || value === undefined) return '—';
  if (key === 'transfer_not_received') return `${idNumber.format(value)} hari`;
  if (key === 'so_stale') return `lewat ${idNumber.format(value)} hari`;
  if (key === 'future_date') return `${idNumber.format(value)} hari ke depan`;
  if (key === 'unit_names') return `${idNumber.format(value)} barang`;
  if (key === 'stock_mismatch') return `selisih ${idNumber.format(value)}`;
  return idNumber.format(value);
}

// A list shows at most the first 100 rows of a check; say so when there are more.
export function moreText(check) {
  const shown = (check?.rows || []).length;
  return check && check.count > shown ? `Menampilkan ${idNumber.format(shown)} dari ${idNumber.format(check.count)}.` : '';
}
