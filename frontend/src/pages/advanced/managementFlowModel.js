// Alur & Margin (program 3.3, Management) — pure helpers for the page, no
// React, so every rule is unit-tested. Numbers the server could not compute
// stay null (shown "—"), never 0.
import { formatDate } from '../../components/format.js';
import { writeTargetParams } from './targetsModel.js';
import { numberLocale } from '../../i18n/language.js';

export const FLOW_TABS = [
  { k: 'sales', l: 'Alur penjualan', needs: ['management_dashboard.view'] },
  { k: 'purchase', l: 'Alur pembelian', needs: ['management_dashboard.view'] },
  // Purchase prices (P1): management with procurement.price.view only.
  { k: 'margin', l: 'Perkiraan margin (harga PO)', needs: ['management_dashboard.view', 'procurement.price.view'] },
  // Stock quantities (D2): management with warehouse.stock.view only.
  { k: 'slow', l: 'Lambat laku', needs: ['management_dashboard.view', 'warehouse.stock.view'] },
];

export function flowTabs(permissions) {
  const granted = new Set(permissions || []);
  return FLOW_TABS.filter((t) => t.needs.every((code) => granted.has(code)));
}

export const PERIOD_PRESETS = [
  { key: 'month', label: 'Bulan ini' },
  { key: 'prev', label: 'Bulan lalu' },
  { key: '3m', label: '3 bulan terakhir' },
  { key: 'ytd', label: 'Tahun ini' },
];
export const DEFAULT_PRESET = '3m';
export const isPreset = (key) => PERIOD_PRESETS.some((p) => p.key === key);

const DIVISION_LABELS = { sales: 'Sales', retail_commerce: 'Retail Commerce', warehouse: 'Warehouse', procurement: 'Procurement' };

// ------------------------------------------------------------------ numbers & text

export const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const count = (v) => {
  const n = numOrNull(v);
  return n === null ? 0 : Math.max(0, Math.trunc(n));
};
const decimal = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
const idNumber = new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 0 });

export function daysText(v) {
  const n = numOrNull(v);
  return n === null ? '—' : `${decimal(Math.round(n * 10) / 10)} hari`;
}

export function pctText(v) {
  const n = numOrNull(v);
  return n === null ? '—' : `${decimal(Math.round(n * 10) / 10)}%`;
}

export function shareText(part, whole) {
  const p = numOrNull(part);
  const w = numOrNull(whole);
  if (p === null || !w) return '—';
  return pctText((100 * p) / w);
}

// "median 1 hari · rata-rata 0,4 · p90 3 · 97 SO"
export function stepGapText(step, noun = 'SO') {
  if (!step || !count(step.count) || numOrNull(step.medianDays) === null) return 'Belum ada data';
  return `median ${daysText(step.medianDays)} · rata-rata ${decimal(step.avgDays)} · p90 ${decimal(step.p90Days)} · ${idNumber.format(count(step.count))} ${noun}`;
}

export function pendingText(codes) {
  const names = [...new Set((codes || []).map((c) => DIVISION_LABELS[c] || c))];
  if (!names.length) return '';
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} dan ${names[names.length - 1]}`;
  return `Data Accurate ${list} masih menunggu persetujuan — angka di sini belum memuatnya.`;
}

// Dates go through components/format.js ("30 Sep 2026"); a missing or
// unreadable date is '' here, so a sentence never shows a stray dash.
export function shortDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso || ''))) return '';
  return formatDate(String(iso).slice(0, 10));
}
export function periodText(period) {
  if (!period?.from || !period?.to) return '';
  return `${shortDate(period.from)} – ${shortDate(period.to)}`;
}
// "Sep 2026"
export function monthText(key) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(key || ''))) return String(key || '');
  return formatDate(`${key}-01`).split(' ').slice(1).join(' ');
}
// "22 Sep" — the day late SOs start to be escalated.
export function dayMonth(iso) {
  const full = shortDate(iso);
  return full ? full.split(' ').slice(0, 2).join(' ') : '';
}

// ------------------------------------------------------------------ links

// A link only to a page the user may open (the menu's own rule, shared with
// Pusat Eskalasi): null → the card shows its numbers without the link.
export { allowedLink } from '../../components/navigation.js';

export const RECEIVABLE_AGING_LINK = '/sales/orders?tab=aging';
// Target & realisasi opened on the Procurement module (the page reads ?modul=).
export const PURCHASE_TARGET_LINK = `/targets?${writeTargetParams(new URLSearchParams(), { module: 'procurement' })}`;

// Where the promise of an SO late to ship comes from (the Warehouse promise,
// program 3.4): Tgl kirim, or the standard — moved to Monday when it fell on a Sunday.
export function dueSourceText(item) {
  if (!item?.dueEstimated) return 'Tgl kirim di SO';
  return `standar 2×24 jam dari tanggal SO${item.dueShifted ? ', digeser ke Senin' : ''}`;
}

// ------------------------------------------------------------------ normalizers

const arr = (v) => (Array.isArray(v) ? v : []);
const step = (s) => ({
  key: String(s?.key || ''), label: String(s?.label || ''), count: count(s?.count),
  avgDays: numOrNull(s?.avgDays), medianDays: numOrNull(s?.medianDays), p90Days: numOrNull(s?.p90Days),
});
const stuckList = (s) => ({
  count: count(s?.count), escalated: count(s?.escalated),
  items: arr(s?.items).filter((i) => i && i.soNumber).map((i) => ({ ...i, daysLate: count(i.daysLate), percentShipped: numOrNull(i.percentShipped) })),
});

export function normalizeSalesFlow(data) {
  const d = data || {};
  const st = d.stages || {};
  return {
    period: d.period || null,
    ready: Boolean(d.ready),
    pending: arr(d.pending),
    otifFrom: d.otifFrom || null,
    stages: {
      total: count(st.total), started: count(st.started), shippedFull: count(st.shippedFull), billed: count(st.billed),
      paid: count(st.paid), closed: count(st.closed), ordered: count(st.ordered),
    },
    shippedBy: { delivery: count(d.shippedBy?.delivery), invoice: count(d.shippedBy?.invoice) },
    steps: arr(d.steps).filter((s) => s && s.key).map(step),
    byDivision: arr(d.byDivision).filter((r) => r && typeof r === 'object').map((r) => ({
      departmentId: numOrNull(r.departmentId), departmentName: r.departmentName || 'Tanpa divisi',
      total: count(r.total), shippedFull: count(r.shippedFull), billed: count(r.billed), paid: count(r.paid),
    })),
    stuck: {
      notShipped: stuckList(d.stuck?.notShipped),
      notBilled: stuckList(d.stuck?.notBilled),
      overdue: { count: count(d.stuck?.overdue?.count), amount: numOrNull(d.stuck?.overdue?.amount) },
    },
    invoicesWithoutSo: count(d.invoicesWithoutSo),
  };
}

export const PO_FLOW_STATES = ['open', 'partial', 'late', 'received', 'closed', 'legacy'];

export function normalizePurchaseFlow(data) {
  const d = data || {};
  return {
    period: d.period || null,
    ready: Boolean(d.ready),
    receiptsReady: Boolean(d.receiptsReady),
    pending: arr(d.pending),
    total: count(d.total),
    stages: Object.fromEntries(PO_FLOW_STATES.map((s) => [s, count(d.stages?.[s])])),
    steps: arr(d.steps).filter((s) => s && s.key).map(step),
    onTime: { completed: count(d.onTime?.completed), onTime: count(d.onTime?.onTime), pct: numOrNull(d.onTime?.pct) },
    stuck: arr(d.stuck).filter((s) => s && PO_FLOW_STATES.includes(s.state)).map((s) => ({
      state: s.state, count: count(s.count), link: typeof s.link === 'string' && s.link.startsWith('/') ? s.link : null,
    })),
  };
}

const money = (b) => ({
  revenue: numOrNull(b?.revenue), costedRevenue: numOrNull(b?.costedRevenue), cost: numOrNull(b?.cost),
  margin: numOrNull(b?.margin), marginPct: numOrNull(b?.marginPct), coveragePct: numOrNull(b?.coveragePct),
  afterPricePct: numOrNull(b?.afterPricePct), revenueWithoutLines: numOrNull(b?.revenueWithoutLines),
  noPriceRevenue: numOrNull(b?.noPriceRevenue), noUnitRevenue: numOrNull(b?.noUnitRevenue),
});

export function normalizeMargin(data) {
  const d = data || {};
  return {
    period: d.period || null,
    departmentId: numOrNull(d.departmentId),
    pending: arr(d.pending),
    lowCoveragePct: numOrNull(d.lowCoveragePct) ?? 80,
    divisionOptions: arr(d.divisionOptions).filter((o) => o && numOrNull(o.id) !== null).map((o) => ({ id: Number(o.id), name: String(o.name || '') })),
    summary: { ...money(d.summary), invoiced: numOrNull(d.summary?.invoiced), returns: numOrNull(d.summary?.returns) },
    months: arr(d.months).filter((m) => m && m.month).map((m) => ({ month: String(m.month), ...money(m) })),
    divisions: arr(d.divisions).filter((m) => m && typeof m === 'object').map((m) => ({ departmentId: numOrNull(m.departmentId), departmentName: m.departmentName || 'Tanpa divisi', ...money(m) })),
    products: arr(d.products).filter((p) => p && typeof p === 'object').map((p) => ({
      itemCode: p.itemCode || null,
      itemName: p.itemName || p.itemCode || 'Tanpa kode barang',
      revenue: numOrNull(p.revenue), costedRevenue: numOrNull(p.costedRevenue), cost: numOrNull(p.cost),
      margin: numOrNull(p.margin), marginPct: numOrNull(p.marginPct), qtyBase: numOrNull(p.qtyBase),
      qtyByUnit: arr(p.qtyByUnit).map((u) => ({ unit: u?.unit || null, qty: numOrNull(u?.qty) ?? 0 })),
      coverage: ['ok', 'partial', 'no_price', 'no_unit'].includes(p.coverage) ? p.coverage : 'no_price',
      costAfter: Boolean(p.costAfter), lastCostDate: p.lastCostDate || null,
    })),
  };
}

export const SLOW_STATUSES = ['slow_moving', 'not_moving', 'never_sold'];

export function normalizeSlowMovers(data) {
  const d = data || {};
  const prices = Boolean(d.prices);
  return {
    ready: Boolean(d.ready),
    stockItems: count(d.stockItems),
    pending: arr(d.pending),
    horizon: { dataStart: d.horizon?.dataStart || null, slowDays: numOrNull(d.horizon?.slowDays) ?? 60, deadDays: numOrNull(d.horizon?.deadDays) ?? 90 },
    prices,
    valueTotals: prices && d.valueTotals ? {
      slow: numOrNull(d.valueTotals.slow), dead: numOrNull(d.valueTotals.dead), neverSold: numOrNull(d.valueTotals.neverSold), unknown: count(d.valueTotals.unknown),
    } : null,
    items: arr(d.items).filter((i) => i && i.itemNo && SLOW_STATUSES.includes(i.status)).map((i) => ({
      itemId: numOrNull(i.itemId), itemNo: String(i.itemNo), itemName: i.itemName || String(i.itemNo),
      qty: numOrNull(i.qty), qtyAllUnits: i.qtyAllUnits || null,
      lastSoldOn: i.lastSoldOn || null, firstPoOn: i.firstPoOn || null, neverSold: Boolean(i.neverSold),
      idleSince: i.idleSince || null, idleDays: count(i.idleDays), out30d: numOrNull(i.out30d),
      status: i.status, value: prices ? numOrNull(i.value) : null,
    })),
  };
}

// ------------------------------------------------------------------ margin

export function coverageWarning(summary, threshold = 80) {
  const pct = numOrNull(summary?.coveragePct);
  if (pct === null || pct >= threshold) return '';
  return `${pctText(100 - pct)} omzet belum punya harga beli dengan kode barang yang sama (mis. kode barang baru yang belum pernah di-PO) atau satuannya belum diketahui. Margin hanya dihitung dari omzet yang terhitung.`;
}

// One badge per product, most important first.
export function productStatus(p) {
  if (!p) return null;
  if (numOrNull(p.margin) !== null && p.margin < 0) return 'margin_negative';
  if (p.coverage === 'no_price') return 'cost_missing';
  if (p.coverage === 'no_unit') return 'unit_missing';
  if (p.coverage === 'partial') return 'cost_partial';
  if (p.costAfter) return 'cost_after';
  return null;
}

export const PRODUCT_FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'negative', label: 'Rugi' },
  { key: 'uncovered', label: 'Belum terhitung' },
];
export function filterProducts(products, filter) {
  const list = arr(products);
  if (filter === 'negative') return list.filter((p) => numOrNull(p.margin) !== null && p.margin < 0);
  if (filter === 'uncovered') return list.filter((p) => p.coverage !== 'ok');
  return list;
}
export function productCounts(products) {
  return { all: arr(products).length, negative: filterProducts(products, 'negative').length, uncovered: filterProducts(products, 'uncovered').length };
}

// "6.000 Pcs + 411 Ctn" — never added across units.
export function qtyText(p) {
  const units = arr(p?.qtyByUnit).filter((u) => u.qty);
  if (!units.length) return '—';
  return units.map((u) => `${idNumber.format(u.qty)}${u.unit ? ` ${u.unit}` : ''}`).join(' + ');
}

// ------------------------------------------------------------------ slow movers

export const SLOW_FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'slow', label: 'Lambat laku' },
  { key: 'dead', label: 'Tidak laku' },
  { key: 'never', label: 'Belum pernah terjual' },
];
const SLOW_BY_FILTER = { slow: 'slow_moving', dead: 'not_moving', never: 'never_sold' };
export function filterSlow(items, filter) {
  const status = SLOW_BY_FILTER[filter];
  return status ? arr(items).filter((i) => i.status === status) : arr(items);
}
export function slowCounts(items) {
  const list = arr(items);
  return {
    all: list.length,
    slow: list.filter((i) => i.status === 'slow_moving').length,
    dead: list.filter((i) => i.status === 'not_moving').length,
    never: list.filter((i) => i.status === 'never_sold').length,
  };
}
export function slowChipLabel(key, counts, horizon) {
  const n = counts?.[key] ?? 0;
  const deadDays = horizon?.deadDays ?? 90;
  const slowDays = horizon?.slowDays ?? 60;
  const label = {
    all: 'Semua',
    slow: `Lambat laku ${slowDays}–${deadDays - 1} hari`,
    dead: `Tidak laku ≥ ${deadDays} hari`,
    never: 'Belum pernah terjual',
  }[key] || key;
  return `${label} (${idNumber.format(n)})`;
}

// Which waiting Accurate batches matter to a tab.
const PENDING_BY_TAB = {
  sales: ['sales', 'retail_commerce'],
  purchase: ['procurement', 'warehouse'],
  margin: ['sales', 'retail_commerce', 'procurement'],
  slow: ['warehouse', 'sales', 'retail_commerce', 'procurement'],
};
export function relevantPending(codes, tab) {
  const wanted = PENDING_BY_TAB[tab] || [];
  return arr(codes).filter((c) => wanted.includes(c));
}
