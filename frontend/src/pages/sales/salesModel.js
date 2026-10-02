// Pure helpers shared by the Sales pages (customers, leads, funnel, orders,
// sync). No React, so every rule is unit-tested.
import { formatMoney } from '../../components/format.js';
import { numberLocale } from '../../i18n/language.js';
import { MONTHS_SHORT as MONTHS } from '../../i18n/names.js';

// Tones live in components/statusTone.js; these are the Sales wording.
export const CUSTOMER_STATUS_LABEL = { aktif: 'Aktif', dormant: 'Dormant', lost: 'Lost' };

export const LEAD_FILTERS = [
  { key: 'open', label: 'Belum order' },
  { key: 'needs_visit', label: 'Perlu dikunjungi ulang' },
  { key: 'converted', label: 'Sudah jadi pelanggan' },
  { key: 'dropped', label: 'Tidak berminat' },
  { key: 'all', label: 'Semua' },
];

export const ORDER_STATUS_FILTERS = [
  { key: '', label: 'Semua' },
  { key: 'no_do', label: 'Belum ada surat jalan' },
  { key: 'no_invoice', label: 'Belum ditagih' },
  { key: 'unpaid', label: 'Belum lunas' },
  { key: 'overdue', label: 'Terlambat bayar' },
  { key: 'paid', label: 'Lunas' },
];

// Approved Accurate invoices (Tahap B): the aging table links to the ones past due.
export const INVOICE_STATUS_FILTERS = [
  { key: '', label: 'Semua' },
  { key: 'open', label: 'Belum lunas' },
  { key: 'overdue', label: 'Lewat jatuh tempo' },
];

// Order channels, and the channel a customer's orders default to (same as the server).
export const ORDER_CHANNELS = ['GT', 'MT', 'FoodService', 'e-Commerce', 'QuickCommerce', 'Export', 'Internal'];
const ORDER_CHANNEL_FOR_CATEGORY = { Shopee: 'e-Commerce', TokoPedia: 'e-Commerce', GRAB: 'QuickCommerce', GOJEK: 'QuickCommerce' };
export function orderChannelFor(customerChannel) {
  if (ORDER_CHANNEL_FOR_CATEGORY[customerChannel]) return ORDER_CHANNEL_FOR_CATEGORY[customerChannel];
  return ORDER_CHANNELS.includes(customerChannel) ? customerChannel : 'GT';
}

const PPN_RATE = 0.11;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Order totals exactly as the server computes them: goods plus delivery; PPN
// 11% on taxable lines recorded alongside.
export function orderTotals(lines, deliveryFee) {
  const rows = (lines || []).map((l) => {
    const lineTotal = round2((Number(l.qty) || 0) * (Number(l.unitPrice) || 0));
    return { lineTotal, taxAmount: l.taxable ? round2(lineTotal * PPN_RATE) : 0 };
  });
  const subtotal = round2(rows.reduce((s, r) => s + r.lineTotal, 0));
  const fee = round2(deliveryFee);
  return {
    lines: rows,
    subtotal,
    deliveryFee: fee,
    taxAmount: round2(rows.reduce((s, r) => s + r.taxAmount, 0)),
    totalAmount: round2(subtotal + fee),
  };
}

export const DOCUMENT_TABS = [
  { key: 'orders', label: 'Sales order' },
  { key: 'do', label: 'Surat jalan' },
  { key: 'invoice', label: 'Invoice' },
];

const idNumber = new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 0 });
const SHORT = [0, 1, 2].map((digits) => new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: digits }));

// "Rp 104.121.409" through the shared formatter (components/format.js); an
// empty or unreadable amount is '' so a sentence can leave it out.
export function formatRupiah(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return '';
  return formatMoney(n);
}

// Short form for cards and bars: Rp 104,1 jt · Rp 2,17 M.
export function formatRupiahShort(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const fmt = (v, digits) => SHORT[digits].format(v);
  if (abs >= 1e12) return `${sign}Rp ${fmt(abs / 1e12, 2)} T`;
  if (abs >= 1e9) return `${sign}Rp ${fmt(abs / 1e9, 2)} M`;
  if (abs >= 1e6) return `${sign}Rp ${fmt(abs / 1e6, 1)} jt`;
  if (abs >= 1e3) return `${sign}Rp ${fmt(abs / 1e3, 0)} rb`;
  return `${sign}Rp ${fmt(abs, 0)}`;
}

export function formatCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? idNumber.format(n) : '';
}

// A list's panel title with its size once known: "Customer (1.234)".
export function listTitle(label, total, loading = false) {
  const n = Number(total);
  return loading || !Number.isFinite(n) ? label : `${label} (${formatCount(n)})`;
}

// Quantity sold per unit — "6.000 Ctns + 411 TetraPk". A product can sell in
// cartons and in packs; without a unit conversion they are never added up.
export function formatQtyByUnit(units) {
  if (!units?.length) return '0';
  return units.map((u) => `${formatCount(u.qty)}${u.unit ? ` ${u.unit}` : ''}`).join(' + ');
}

// Sold quantity in the base unit (once Accurate's units are approved), with the
// units it sold in as the detail — or, without a known ratio, per unit only.
export function soldQty(row) {
  const byUnit = formatQtyByUnit(row?.qtyByUnit);
  if (!row?.baseQty) return { main: byUnit, detail: '' };
  const main = `${formatCount(row.baseQty.qty)} ${row.baseQty.unit}`;
  return { main, detail: byUnit === main ? '' : byUnit };
}

// "Hari ini", "1 hari lalu", "12 hari lalu"; null → "".
export function daysAgoText(days) {
  if (days === null || days === undefined || days === '') return '';
  const n = Number(days);
  if (!Number.isFinite(n)) return '';
  if (n <= 0) return 'Hari ini';
  return `${n} hari lalu`;
}


export function monthLabel(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  const name = m ? MONTHS[Number(m[2]) - 1] : null;
  return name ? `${name} ${m[1]}` : '';
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Today as YYYY-MM-DD in local time: the default of every date field.
export const todayIso = (now = new Date()) => iso(now);

// Period presets for the orders page, relative to `today` (local time).
export function periodRange(preset, today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case 'this_month': return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'last_month': return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'last_3_months': return { from: iso(new Date(y, m - 2, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'this_year': return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'all': return { from: '', to: '' };
    default: return null;
  }
}

export const PERIOD_OPTIONS = [
  { value: 'this_month', label: 'Bulan ini' },
  { value: 'last_month', label: 'Bulan lalu' },
  { value: 'last_3_months', label: '3 bulan terakhir' },
  { value: 'this_year', label: 'Tahun ini' },
  { value: 'all', label: 'Semua waktu' },
];

// Monthly revenue as bar rows: every month in the window appears, empty ones
// as 0, so a gap in the data is visible instead of silently closing up.
export function monthBars(months, { count = 12, today = new Date() } = {}) {
  const byMonth = new Map((months || []).map((m) => [m.month, m]));
  const rows = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const m = byMonth.get(key);
    rows.push({
      month: key,
      label: monthLabel(key),
      revenue: m ? Number(m.revenue) || 0 : 0,
      orders: m ? Number(m.orders) || 0 : 0,
      newCustomers: m ? Number(m.newCustomers) || 0 : 0,
    });
  }
  const max = Math.max(0, ...rows.map((r) => r.revenue));
  return rows.map((r) => ({ ...r, pct: max > 0 ? Math.round((r.revenue / max) * 1000) / 10 : 0 }));
}

export function apiError(err, fallback = 'Gagal memuat data') {
  return err?.response?.data?.error?.message || fallback;
}

// A rejected save's field errors (zod flatten from the API), split into the
// ones the form shows on a visible field and a message for everything else,
// so no error is ever swallowed. `aliases` maps API keys to form keys
// (customerId → customer, lines → items). `message` is null only when every
// error landed on a field.
export function splitServerErrors(err, visible, { aliases = {}, fallback = 'Gagal menyimpan' } = {}) {
  const details = err?.response?.data?.error?.details || {};
  const fields = {};
  const hidden = [];
  for (const [key, messages] of Object.entries(details.fieldErrors || {})) {
    const text = Array.isArray(messages) ? messages[0] : messages;
    if (!text) continue;
    const target = aliases[key] || key;
    if (visible.includes(target) && !fields[target]) fields[target] = String(text);
    else hidden.push(String(text));
  }
  for (const text of details.formErrors || []) if (text) hidden.push(String(text));
  let message = null;
  if (hidden.length) message = `${fallback}: ${[...new Set(hidden)].join('; ')}`;
  else if (!Object.keys(fields).length) message = apiError(err, fallback);
  return { fields, message };
}

// ------------------------------------------------------------------ printing

const DIGITS = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

function spellBelowThousand(n) {
  if (n < 12) return DIGITS[n];
  if (n < 20) return `${DIGITS[n - 10]} belas`;
  if (n < 100) return `${DIGITS[Math.floor(n / 10)]} puluh${n % 10 ? ` ${DIGITS[n % 10]}` : ''}`;
  if (n < 200) return `seratus${n % 100 ? ` ${spellBelowThousand(n % 100)}` : ''}`;
  return `${DIGITS[Math.floor(n / 100)]} ratus${n % 100 ? ` ${spellBelowThousand(n % 100)}` : ''}`;
}

// Rupiah amount in words, as written on invoices and kwitansi:
// 1.089.000 → "Satu juta delapan puluh sembilan ribu rupiah".
// Printed on documents, so it is ALWAYS Indonesian: the render sites are
// data-no-translate (SalesPrint.jsx) and these pieces are in i18n/ignore.json.
export function terbilang(value) {
  let n = Math.round(Math.abs(Number(value) || 0));
  if (n === 0) return 'Nol rupiah';
  const scales = [[1e12, 'triliun'], [1e9, 'miliar'], [1e6, 'juta'], [1e3, 'ribu']];
  const parts = [];
  for (const [size, word] of scales) {
    const chunk = Math.floor(n / size);
    if (chunk) {
      parts.push(size === 1e3 && chunk === 1 ? 'seribu' : `${spellBelowThousand(chunk)} ${word}`);
      n %= size;
    }
  }
  if (n) parts.push(spellBelowThousand(n));
  const text = `${parts.join(' ')} rupiah`.replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Invoice due date: invoice date + payment terms; nothing when either is missing.
export function dueDate(invoiceDate, termsDays) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(invoiceDate || ''));
  if (!m || termsDays === null || termsDays === undefined || termsDays === '') return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Number(termsDays)));
  return d.toISOString().slice(0, 10);
}

export const PRINT_DOCUMENTS = {
  so: 'Sales Order',
  do: 'Surat Jalan',
  invoice: 'Invoice',
  receipt: 'Kwitansi',
};
