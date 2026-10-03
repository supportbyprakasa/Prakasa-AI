import { compactMoney } from '../../components/charts/chartModel.js';
import { formatMoney, formatNumber } from '../../components/format.js';
import { MONTHS_SHORT as MONTHS } from '../../i18n/names.js';

// Piutang & Utang (Finance, migration 117): how the pages arrange what
// /finance/reports sends. Pure, so it is tested without a browser.

export const RECEIVABLE_TABS = Object.freeze([
  { k: 'customers', l: 'Pelanggan terlambat' },
  { k: 'due', l: 'Jatuh tempo 14 hari' },
]);
export const PAYABLE_TABS = Object.freeze([
  { k: 'due', l: 'Jatuh tempo 14 hari' },
  { k: 'overdue', l: 'Lewat jatuh tempo' },
  { k: 'vendors', l: 'Per pemasok' },
]);

/** The tab named in the URL, or the first one. */
export function tabFrom(value, tabs) {
  return tabs.some((t) => t.k === value) ? value : tabs[0].k;
}

// How alarming each aging bucket is: the later, the redder.
const BUCKET_COLOUR = Object.freeze({ current: 'success', d1_30: 'info', d31_60: 'warning', d61_90: 'error', d90_plus: 'error' });

/** Aging buckets → BarList items: rupiah per bucket, with invoice count and share. */
export function agingBars(buckets = []) {
  return buckets.map((b) => ({
    key: b.key,
    label: b.label,
    value: Number(b.amount) || 0,
    display: compactMoney(b.amount || 0),
    note: `${formatNumber(b.invoices || 0)} faktur · ${formatShare(b.share)}`,
    tone: BUCKET_COLOUR[b.key] || 'default',
  }));
}

/** "12,5%" (a share already in percent). */
export function formatShare(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0%';
  return `${String(Math.round(n * 10) / 10).replace('.', ',')}%`;
}

/** Channel chips for the aging card: "Semua" first, then each channel with its total. */
export function channelOptions(channels = []) {
  return [{ key: '', label: 'Semua' }, ...channels.map((c) => ({ key: c.channel, label: c.channel, amount: c.total?.amount || 0 }))];
}

/** The buckets for one channel ('' = all). */
export function bucketsFor(aging, channel = '') {
  if (!aging) return [];
  if (!channel) return aging.buckets || [];
  return (aging.channels || []).find((c) => c.channel === channel)?.buckets || aging.buckets || [];
}


/** "2026-10" → "Okt 2026" (the dashboard's month labels). */
export function monthLabel(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(key || '');
}

/** 12 months from the API → TrendChart props: { months: [{ key, label }], values }. */
export function trendSeries(rows = []) {
  return {
    months: rows.map((r) => ({ key: r.month, label: monthLabel(r.month) })),
    values: rows.map((r) => (r.amount === null || r.amount === undefined ? null : Number(r.amount))),
  };
}

/** The last full month against the one before it: { value, previous, change, direction } (this month is still running). */
export function lastFullMonth(rows = []) {
  if (rows.length < 3) return null;
  const last = rows[rows.length - 2];
  const prev = rows[rows.length - 3];
  const change = Number(last.amount || 0) - Number(prev.amount || 0);
  return { month: monthLabel(last.month), value: Number(last.amount || 0), previous: Number(prev.amount || 0), change, direction: change > 0 ? 'up' : (change < 0 ? 'down' : 'flat') };
}

/** Days to a due date as a status: due today or within 3 days is a warning. */
export function dueBadge(daysLeft) {
  const n = Math.max(0, Math.trunc(Number(daysLeft) || 0));
  if (n === 0) return { status: 'pending_approval', label: 'Hari ini' };
  return { status: n <= 3 ? 'pending_approval' : 'pending', label: `${n} hari lagi` };
}

/** Days past due as a status (always late). */
export function lateBadge(days) {
  const n = Math.max(0, Math.trunc(Number(days) || 0));
  return { status: 'overdue', label: `${formatNumber(n)} hari` };
}

/** Piutang headline cards (value in rupiah unless a unit is given). */
export function receivableCards(summary) {
  if (!summary) return [];
  return [
    { key: 'outstanding', label: 'Total piutang', value: summary.outstanding, unit: 'rupiah', note: `${formatNumber(summary.invoices)} faktur · ${formatNumber(summary.customers)} pelanggan` },
    { key: 'overdue', label: 'Lewat jatuh tempo', value: summary.overdue?.amount, unit: 'rupiah', note: `${formatNumber(summary.overdue?.invoices)} faktur`, alert: (summary.overdue?.invoices || 0) > 0 },
    { key: 'over90', label: 'Terlambat > 90 hari', value: summary.over90?.amount, unit: 'rupiah', note: `${formatNumber(summary.over90?.invoices)} faktur`, alert: (summary.over90?.invoices || 0) > 0 },
    { key: 'due', label: `Jatuh tempo ${summary.dueSoon?.days || 14} hari`, value: summary.dueSoon?.amount, unit: 'rupiah', note: `${formatNumber(summary.dueSoon?.invoices)} faktur` },
    { key: 'collected', label: 'Tertagih bulan ini', value: summary.collectedThisMonth?.amount, unit: 'rupiah', note: `${formatNumber(summary.collectedThisMonth?.receipts)} penerimaan` },
    {
      key: 'dso',
      label: 'Perkiraan DSO',
      value: summary.dso?.days ?? null,
      unit: 'hari',
      note: summary.dso?.days == null ? `Belum ada faktur ${summary.dso?.window || 90} hari terakhir` : `Piutang ÷ penagihan ${summary.dso.window} hari terakhir (${compactMoney(summary.dso.billed)})`,
    },
  ];
}

/** Utang headline cards. */
export function payableCards(summary) {
  if (!summary) return [];
  return [
    { key: 'outstanding', label: 'Total utang', value: summary.outstanding, unit: 'rupiah', note: `${formatNumber(summary.invoices)} faktur · ${formatNumber(summary.vendors)} pemasok` },
    { key: 'overdue', label: 'Lewat jatuh tempo', value: summary.overdue?.amount, unit: 'rupiah', note: `${formatNumber(summary.overdue?.invoices)} faktur`, alert: (summary.overdue?.invoices || 0) > 0 },
    { key: 'due', label: `Jatuh tempo ${summary.dueSoon?.days || 14} hari`, value: summary.dueSoon?.amount, unit: 'rupiah', note: `${formatNumber(summary.dueSoon?.invoices)} faktur` },
    { key: 'paid', label: 'Dibayar bulan ini', value: summary.paidThisMonth?.amount, unit: 'rupiah', note: `${formatNumber(summary.paidThisMonth?.payments)} pembayaran` },
  ];
}

/** What the totals leave out, as one sentence (or null). */
export function exclusionsText(summary) {
  if (!summary) return null;
  const parts = [];
  if (summary.downPaymentsOpen) parts.push(`${formatNumber(summary.downPaymentsOpen)} faktur uang muka`);
  if (summary.nonIdrOpen) parts.push(`${formatNumber(summary.nonIdrOpen)} faktur mata uang asing`);
  return parts.length ? `${parts.join(' dan ')} belum lunas tidak dihitung dalam angka di halaman ini.` : null;
}

/** Overdue share of the total, for the aging card's subtitle. */
export function overdueSentence(summary) {
  if (!summary || !summary.outstanding) return 'Tidak ada yang belum dibayar';
  const share = (Number(summary.overdue?.amount || 0) / Number(summary.outstanding)) * 100;
  return `${formatShare(share)} dari ${formatMoney(summary.outstanding)} sudah lewat jatuh tempo`;
}

/** What the Utang page says while it waits for the first approved Finance batch. */
export function payableWaiting(data) {
  const pending = data?.pending || null;
  let description = data?.reason || 'Menunggu tarikan data Accurate Finance pertama disetujui Supervisor/Head Finance';
  // Each sentence is a whole string of its own (the language switch
  // translates them one by one).
  const batchWaiting = pending ? `Batch #${pending.batchId} (${formatNumber(pending.items)} perubahan) sudah menunggu keputusan.` : '';
  const pullOff = 'Tarikan faktur dan pembayaran pembelian dari Accurate belum dinyalakan.';
  if (pending) description = `${description}. ${batchWaiting}`;
  else if (data && data.enabled === false) description = `${description}. ${pullOff}`;
  else description += '.';
  return { title: 'Data utang belum tersedia', description, batchLink: pending ? `/data-accurate/${pending.batchId}` : null };
}

/** "Disetujui Rina · 1 Okt 2026" style line parts for the Utang page's header. */
export function approvedBy(asOf) {
  if (!asOf) return null;
  return asOf.approvedBy ? `disetujui ${asOf.approvedBy}` : 'disetujui';
}
