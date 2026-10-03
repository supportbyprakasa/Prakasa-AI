import { compactMoney } from '../../components/charts/chartModel.js';
import { formatNumber, formatQty } from '../../components/format.js';

// Retail Commerce page model (migration 120): pure helpers that turn the
// /retail-commerce API into cards, bars, chart series and grid rows. No React.

/** Why there is nothing to show yet, in words the division understands. */
export function emptyReason(reason) {
  if (reason === 'no_department') {
    return {
      title: 'Divisi Retail Commerce belum ada',
      description: 'Perusahaan ini belum punya divisi Retail Commerce, jadi belum ada data marketplace yang bisa ditampilkan.',
    };
  }
  if (reason === 'app_mode') {
    return {
      title: 'Transaksi dicatat di aplikasi',
      description: 'Kinerja marketplace dibaca dari Accurate. Selama transaksi Sales dicatat di aplikasi ini, halaman ini belum punya angka.',
    };
  }
  return {
    title: 'Menunggu batch Accurate disetujui',
    description: 'Angka marketplace muncul setelah Supervisor atau Head Sales/Retail Commerce menyetujui batch data Accurate pertama. Sebelum itu tidak ada angka yang ditampilkan, supaya tidak terbaca sebagai fakta.',
  };
}

// What the API calls sales with no platform (backend retailCommerce.service.js
// OTHER): interface text, while a platform's own name is record data.
export const OTHER_PLATFORM = 'Lainnya';

/** Change from `previous` to `current`: amount, percent and direction. */
export function changeOf(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return { change: null, pct: null, direction: null };
  }
  const c = Number(current);
  const p = Number(previous);
  const change = Math.round((c - p) * 100) / 100;
  return {
    change,
    pct: p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : null,
    direction: change > 0 ? 'up' : (change < 0 ? 'down' : 'flat'),
  };
}

const pctText = (pct) => `${pct > 0 ? '+' : ''}${formatQty(pct)}%`;

/** "+12,5% dari bulan lalu" · "-Rp 3 jt dari bulan lalu" · null when unknown. */
export function changeText(current, previous, suffix = 'dari bulan lalu') {
  const d = changeOf(current, previous);
  if (d.direction === null) return null;
  if (d.direction === 'flat') return 'Sama dengan bulan lalu';
  const amount = `${d.change > 0 ? '+' : '-'}${compactMoney(Math.abs(d.change))}`;
  return `${d.pct !== null ? pctText(d.pct) : amount} ${suffix}`;
}

/** The headline figures, in the order the page shows them. */
export function kpiCards(overview) {
  const k = overview?.kpis;
  if (!k) return [];
  const billed = k.invoicesThisMonth > 0;
  const latest = overview.latestMonth?.label;
  const notBilled = latest ? `Ditagih bulanan · belum ada faktur bulan ini · terakhir ${latest}` : 'Ditagih bulanan · belum ada faktur bulan ini';
  const sla = overview.rules?.shipSlaDays ?? 2;
  const rec = k.receivable || { amount: 0, invoices: 0, overdue: 0, overdueInvoices: 0 };
  const ship = k.shipments || { open: 0, late: 0 };
  return [
    {
      key: 'revenue_month', label: 'Omzet bulan ini', unit: 'rupiah', value: k.revenueThisMonth,
      note: billed ? (changeText(k.revenueThisMonth, k.revenueLastMonth) || 'Sebelum PPN, bersih retur') : notBilled,
      alert: false, empty: !billed,
    },
    {
      key: 'revenue_last_month', label: 'Omzet bulan lalu', unit: 'rupiah', value: k.revenueLastMonth,
      note: 'Sebelum PPN, bersih retur', alert: false, empty: !k.revenueLastMonth,
    },
    {
      key: 'orders_month', label: 'Pesanan bulan ini', unit: 'item', value: k.ordersThisMonth,
      note: `${formatNumber(k.invoicesThisMonth)} faktur · bulan lalu ${formatNumber(k.ordersLastMonth)} SO`,
      alert: false, empty: !k.ordersThisMonth,
    },
    {
      key: 'aov_month', label: 'Rata-rata per faktur', unit: 'rupiah', value: k.aovThisMonth,
      note: billed ? 'Omzet bulan ini dibagi jumlah faktur' : notBilled, alert: false, empty: k.aovThisMonth === null,
    },
    {
      key: 'returns_month', label: 'Retur bulan ini', unit: 'rupiah', value: k.returnsThisMonth,
      note: k.returnRateThisMonth === null ? notBilled : `${formatQty(k.returnRateThisMonth)}% dari nilai faktur`,
      alert: false, empty: !k.returnsThisMonth,
    },
    {
      key: 'receivable', label: 'Piutang marketplace belum cair', unit: 'rupiah', value: rec.amount,
      note: rec.invoices
        ? `${formatNumber(rec.invoices)} faktur · ${formatNumber(rec.overdueInvoices)} lewat jatuh tempo (${compactMoney(rec.overdue)})`
        : 'Semua faktur marketplace sudah cair',
      alert: rec.overdueInvoices > 0, empty: !rec.amount,
    },
    {
      key: 'unshipped', label: 'SO belum dikirim', unit: 'item', value: ship.open,
      note: ship.open ? `${formatNumber(ship.late)} lewat janji kirim (${sla}×24 jam)` : 'Semua SO sudah terkirim',
      alert: ship.late > 0, empty: !ship.open,
    },
  ];
}

/**
 * Revenue per platform for <BarList> (pass max = the window total, so a bar is
 * the platform's share of all marketplace revenue).
 */
export function revenueBars(platforms = []) {
  return platforms.filter((p) => p.revenue).map((p) => ({
    key: p.channel || 'other',
    label: p.label,
    value: p.revenue,
    display: compactMoney(p.revenue),
    note: p.share === null ? null : `${formatQty(p.share)}% dari total`,
  }));
}

/** Unpaid marketplace invoices per platform for <BarList>, largest first; red when overdue. */
export function receivableBars(platforms = []) {
  return platforms
    .filter((p) => p.receivable?.amount > 0)
    .sort((a, b) => b.receivable.amount - a.receivable.amount)
    .map((p) => ({
      key: p.channel || 'other',
      label: p.label,
      value: p.receivable.amount,
      display: compactMoney(p.receivable.amount),
      note: `${formatNumber(p.receivable.invoices)} faktur · ${formatNumber(p.receivable.overdueInvoices)} lewat jatuh tempo`,
      tone: p.receivable.overdueInvoices > 0 ? 'error' : 'default',
    }));
}

// Marketplaces are billed in one recap invoice per month, so the running
// month reads 0 until it is billed. Show it as "no figure yet", not as a drop.
function openMonth(values, invoices) {
  const out = values.map((v) => (v === null || v === undefined ? null : Number(v)));
  const billed = invoices?.length ? Number(invoices[invoices.length - 1]) : 0;
  if (out.length && !billed) out[out.length - 1] = null;
  return out;
}

/** Motion chart: each platform's revenue racing through the months, plus orders. */
export function motionSeries(overview) {
  const platforms = overview?.platforms || [];
  const series = platforms
    .filter((p) => p.series.revenue.some((v) => Number(v)))
    .map((p) => ({
      key: `revenue_${p.channel || 'other'}`,
      label: `Omzet ${p.label}`,
      unit: 'rupiah',
      better: 'higher',
      values: openMonth(p.series.revenue, p.series.invoices),
      targets: [],
    }));
  const orders = overview?.totals?.orders || [];
  if (orders.some((v) => Number(v))) {
    series.push({ key: 'orders', label: 'Pesanan (SO)', unit: 'item', better: 'higher', values: orders.map(Number), targets: [] });
  }
  return series;
}

/** The latest month that has a figure: { value, month } or nulls. */
export function latestValue(values, months) {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] !== null && values[i] !== undefined) return { value: values[i], month: months[i]?.label || null };
  }
  return { value: null, month: null };
}

/** Trend cards: total revenue, each platform's revenue, orders, returns. Series that stayed 0 are left out. */
export function trendCards(overview) {
  if (!overview?.totals) return [];
  const t = overview.totals;
  const cards = [
    { key: 'revenue', label: 'Omzet marketplace (sebelum PPN)', unit: 'rupiah', values: openMonth(t.revenue, t.invoices) },
    ...(overview.platforms || []).map((p) => ({
      key: `revenue_${p.channel || 'other'}`, label: `Omzet ${p.label}`, unit: 'rupiah', values: openMonth(p.series.revenue, p.series.invoices),
    })),
    { key: 'orders', label: 'Pesanan (SO)', unit: 'item', values: t.orders.map(Number) },
    { key: 'returns', label: 'Retur (sebelum PPN)', unit: 'rupiah', values: t.returns.map(Number) },
  ];
  return cards.filter((c) => c.values.some((v) => v !== null && Number(v) !== 0));
}

/** Platform comparison rows for the grid. */
export function platformRows(platforms = []) {
  return platforms.map((p) => ({
    id: p.channel || 'other',
    label: p.label,
    revenue: p.revenue,
    revenueThisMonth: p.revenueThisMonth,
    invoices: p.invoices,
    orders: p.orders,
    aov: p.aov,
    returnRate: p.returnRate,
    share: p.share,
    receivable: p.receivable?.amount ?? 0,
    unshipped: p.shipments?.open ?? 0,
  }));
}

/** "9.963 Pcs" · "6 Box + 12 Pcs" · base unit total when every unit converts. */
export function qtyText(row) {
  if (row?.baseQty) return formatQty(row.baseQty.qty, row.baseQty.unit);
  const units = row?.qtyByUnit || [];
  if (!units.length) return '—';
  return units.map((u) => formatQty(u.qty, u.unit)).join(' + ');
}

/** A product's change vs last month: text and whether it is good news. */
export function productChange(row) {
  if (row.isNew) return { text: 'Baru bulan ini', tone: 'good' };
  if (row.changePct === null || row.changePct === undefined) return { text: '—', tone: 'flat' };
  if (row.changePct === 0) return { text: '0%', tone: 'flat' };
  return { text: pctText(row.changePct), tone: row.changePct > 0 ? 'good' : 'bad' };
}

/** Top-product rows for the grid. */
export function productRows(rows = []) {
  return rows.map((r) => ({
    ...r,
    id: r.code,
    qty: qtyText(r),
    platformText: (r.platforms || []).map((p) => p.label).join(', ') || '—',
    // The same list for <Mixed separator=", ">: platform names are data, "Lainnya" is not.
    platformParts: (r.platforms || []).map((p) => (p.channel ? { text: p.label, data: true } : p.label)),
  }));
}

/** Status of an SO waiting to ship (StatusBadge status + label). */
export function shipmentStatus(row) {
  if (row.late) return { status: 'flow_so_late', label: `Lewat ${formatNumber(row.daysLate)} hari` };
  if (!row.judged) return { status: 'pending', label: 'Menunggu batch disetujui' };
  return { status: 'open', label: row.state === 'partial' ? 'Terkirim sebagian' : 'Belum dikirim' };
}

/** Status of an unpaid marketplace invoice. */
export function receivableStatus(row) {
  if (row.daysOverdue > 0) return { status: 'overdue', label: `Lewat ${formatNumber(row.daysOverdue)} hari` };
  return { status: 'unpaid', label: 'Belum jatuh tempo' };
}

/** Month choices for the best-seller list: the window, newest first. */
export function monthOptions(months = []) {
  return [...months].reverse().map((m) => ({ value: m.key, label: m.label }));
}

/**
 * Section 2, "Perlu perhatian": what the marketplaces still owe the division
 * — SOs not yet shipped (late ones first) and invoices not yet paid out, with
 * the overdue ones. Only counts above zero are listed.
 */
export function attentionItems(overview, shipments, receivables) {
  const k = overview?.kpis || {};
  const ship = k.shipments || { open: 0, late: 0 };
  const rec = k.receivable || { invoices: 0, overdueInvoices: 0 };
  const open = Number(shipments?.total ?? ship.open) || 0;
  const invoices = Number(receivables?.total ?? rec.invoices) || 0;
  const late = Number(ship.late) || 0;
  const overdue = Number(rec.overdueInvoices) || 0;
  const items = [];
  if (open > 0) items.push({ key: 'unshipped', label: 'SO belum dikirim', value: open, display: formatNumber(open), note: late ? `${formatNumber(late)} lewat batas kirim` : undefined, tone: late ? 'error' : 'warning' });
  if (invoices > 0) items.push({ key: 'receivable', label: 'Faktur belum cair', value: invoices, display: formatNumber(invoices), note: overdue ? `${formatNumber(overdue)} lewat jatuh tempo` : undefined, tone: overdue ? 'error' : 'warning' });
  return items;
}
