// Umur piutang per syarat bayar (program 2.3): how a term and a cell read.
import { formatRupiah } from './salesModel.js';

export const termLabel = (days) => (Number(days) === 0 ? 'Tunai / jatuh tempo hari itu' : `${days} hari`);

// One aging cell: the rupiah owed and how many invoices.
export function cellText(cell) {
  if (!cell || !cell.invoices) return '—';
  return `${formatRupiah(cell.outstanding)} · ${cell.invoices} faktur`;
}

// Rows for the grid: one per payment term, then the total.
export function agingRows(aging) {
  if (!aging) return [];
  const rows = aging.terms.map((t) => ({ id: `t${t.termDays}`, term: termLabel(t.termDays), ...t.buckets, total: t.total }));
  rows.push({ id: 'total', term: 'Total', ...aging.totals, total: aging.grand, isTotal: true });
  return rows;
}

// The part of what is owed that is past due (every bucket but "current").
export function overdueShare(aging) {
  if (!aging?.grand?.outstanding) return null;
  const late = aging.buckets.filter((b) => b.key !== 'current').reduce((n, b) => n + Number(aging.totals[b.key]?.outstanding || 0), 0);
  return Math.round((late / aging.grand.outstanding) * 1000) / 10;
}
