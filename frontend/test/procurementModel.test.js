import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PO_STATES, PO_STATUS, changeStatus, changeText, chipLabel, dueMeta, isPoState, procurementCheckLines, procurementNotice, qtyText, rateText, receivedText, rupiah,
  trendChipLabel, REORDER_URGENCIES, REORDER_STATUS, coverDaysText, dailyOutText, isReorderUrgency, leadTimeText, onOrderMeta, reorderChipLabel,
  reorderEmptyText, reorderNotice, reorderRulesText, reorderTodayCount, suggestionMeta, suggestionText,
} from '../src/pages/procurement/procurementModel.js';
import { formatDate } from '../src/components/format.js';
import { STATUS_LABELS, statusTone } from '../src/components/statusTone.js';

const page = (name) => fs.readFileSync(new URL(`../src/pages/procurement/${name}`, import.meta.url), 'utf8');

test('every PO state has a chip and a badge', () => {
  for (const s of PO_STATES.filter((x) => x.key !== 'all')) assert.equal(STATUS_LABELS[PO_STATUS[s.key]], s.label, s.key);
  assert.equal(chipLabel('late', { late: 3 }), 'Terlambat (3)');
  assert.equal(chipLabel('all', {}), 'Semua');
  assert.equal(isPoState('legacy'), true);
  assert.equal(isPoState('bogus'), false);
});

test('dates and quantities read plainly; never a sum across units', () => {
  assert.equal(dueMeta({ state: 'late', daysLate: 3 }), 'Terlambat 3 hari');
  assert.equal(dueMeta({ state: 'open', estimated: true }), '(perkiraan) 14 hari dari tanggal PO');
  assert.equal(dueMeta({ state: 'open', estimated: false }), '');
  assert.equal(receivedText({ percentReceived: 62.5 }), '62,5%');
  assert.equal(qtyText(1200, 'Ctns'), '1.200 Ctns');
  assert.equal(qtyText(null, 'Ctns'), '—');
  assert.equal(rateText(null), '—');
  assert.equal(rateText(87.5), '87,5%');
  assert.equal(rupiah(1250000), 'Rp 1.250.000');
});

test('an empty page explains itself before the first approved batch', () => {
  assert.equal(procurementNotice({ ready: true }), null);
  assert.match(procurementNotice({ ready: false, pending: { batchId: 12 } }).title, /menunggu persetujuan/);
  assert.match(procurementNotice({ ready: false }).title, /belum ada/);
  assert.match(procurementNotice({ ready: false, enabled: false }).title, /belum dinyalakan/, 'a switched-off pull is not "waiting for approval"');
});

test('the approver reads the pull\'s own checks', () => {
  const lines = procurementCheckLines({
    complete: true, names_cleaned: 0, units_uncertain: 0,
    po: { final: 347, open: 1, partial: 0, late: 1, received: 255, closed: 0, legacy: 90, no_expected_date: 0 },
    lines_match_subtotal: { checked: 347, matched: 347 },
    unmirrored: { 'purchase-requisition': 0, 'vendor-price': 1 },
  });
  assert.deepEqual(lines.map((l) => l.label), ['Bacaan Accurate', 'PO final', 'Baris cocok dengan subtotal', 'Belum dicerminkan']);
  assert.equal(lines[1].value, '347 (menunggu 1, sebagian 0, terlambat 1, diterima 255, PO lama 90, tanpa tgl datang 0)');
  assert.equal(lines[3].value, 'permintaan barang 0, harga pemasok 1');
  assert.deepEqual(procurementCheckLines({ stock_sum: {} }), []);
});

test('a price move reads with its sign; up is a warning, down is good news', () => {
  assert.equal(changeText(12.5), '+12,5%');
  assert.equal(changeText(-3), '−3%');
  assert.equal(changeText(null), '—');
  assert.equal(changeStatus(5), 'price_up');
  assert.equal(changeStatus(-5), 'price_down');
  assert.equal(changeStatus(0), 'price_same');
  assert.equal(statusTone(changeStatus(5)), 'warning');
  assert.equal(statusTone(changeStatus(-5)), 'success');
  assert.equal(trendChipLabel('up', { up: 4 }), 'Naik (4)');
});

test('saran pesan ulang: every level has a chip and a badge; counts show in the chip', () => {
  for (const u of REORDER_URGENCIES.filter((x) => x.key !== 'all')) assert.equal(STATUS_LABELS[REORDER_STATUS[u.key]], u.label, u.key);
  const ready = { stockReady: true, historyDays: 9 };
  const rules = { minHistoryDays: 7 };
  assert.equal(reorderChipLabel('critical', { critical: 3 }, ready, rules), 'Habis sebelum barang datang (3)');
  assert.equal(reorderChipLabel('all', { total: 1200 }, ready, rules), 'Semua saran (1.200)');
  assert.equal(reorderChipLabel('reorder', undefined, ready, rules), 'Pesan sekarang');
  assert.equal(isReorderUrgency('out'), true);
  assert.equal(isReorderUrgency('late'), false);
});

// Stock of batch #10 applied, no history yet: every saran is "Habis, perlu dicek".
const RULES = { minHistoryDays: 7 };
const NO_HISTORY = { readiness: { stockReady: true, historyDays: 0, coverFrom: '2026-10-07' }, rules: RULES, counts: { total: 124, critical: 0, reorder: 0, out: 124, unknown: 438 } };

test('the Procurement day: "Perlu dipesan" counts exactly what its link opens (every level of the list)', () => {
  assert.deepEqual(reorderTodayCount(NO_HISTORY, 'total'), { text: '124 barang', link: true });
  const later = { ...NO_HISTORY, readiness: { ...NO_HISTORY.readiness, historyDays: 12 }, counts: { total: 9, critical: 2, reorder: 3, out: 4 } };
  assert.equal(reorderTodayCount(later, 'total').text, '9 barang', 'critical + reorder + out');
  assert.equal(reorderTodayCount(later, 'critical', { timed: true }).text, '2 barang');
  const today = page('ProcurementToday.jsx');
  assert.match(today, /reorderCount\(reorder, 'total', '\/procurement\/reorder'\)/, 'the unfiltered list, counted in full');
  assert.match(today, /reorderCount\(reorder, 'critical', '\/procurement\/reorder\?urgency=critical', \{ timed: true \}\)/);
});

test('saran pesan ulang: no definite 0 before stock is approved or before the outflow can be known', () => {
  // Stock not approved yet.
  const waiting = { readiness: { stockReady: false, stockPending: true, historyDays: 0, coverFrom: null }, rules: RULES, counts: { total: 0, critical: 0, reorder: 0, out: 0 } };
  assert.deepEqual(reorderTodayCount(waiting, 'total'), { text: '—', link: false });
  assert.deepEqual(reorderTodayCount(waiting, 'critical', { timed: true }), { text: '—', link: false });
  for (const u of REORDER_URGENCIES) assert.equal(reorderChipLabel(u.key, waiting.counts, waiting.readiness, RULES), u.label, `${u.key}: no "(0)"`);
  assert.equal(reorderEmptyText(waiting.readiness, RULES, 'all'), 'Menunggu stok disetujui Warehouse');
  // Stock approved, fewer than 7 days of history: the timed count says when it starts.
  assert.deepEqual(reorderTodayCount(NO_HISTORY, 'critical', { timed: true }), { text: `mulai ${formatDate('2026-10-07')}`, link: false });
  assert.equal(reorderChipLabel('critical', NO_HISTORY.counts, NO_HISTORY.readiness, RULES), 'Habis sebelum barang datang');
  assert.equal(reorderChipLabel('reorder', NO_HISTORY.counts, NO_HISTORY.readiness, RULES), 'Pesan sekarang');
  assert.equal(reorderChipLabel('out', NO_HISTORY.counts, NO_HISTORY.readiness, RULES), 'Habis, perlu dicek (124)', 'needs no history');
  assert.equal(reorderChipLabel('all', NO_HISTORY.counts, NO_HISTORY.readiness, RULES), 'Semua saran (124)');
  assert.equal(reorderEmptyText(NO_HISTORY.readiness, RULES, 'critical'), `Laju keluar dihitung mulai ${formatDate('2026-10-07')}`);
  assert.equal(reorderEmptyText(NO_HISTORY.readiness, RULES, 'out'), 'Tidak ada barang yang perlu dipesan');
  assert.equal(reorderEmptyText({ stockReady: true, historyDays: 9 }, RULES, 'critical'), 'Tidak ada barang yang perlu dipesan');
});

test('saran pesan ulang: the escalation\'s "Belum ada PO" arrives from the address and can be removed', () => {
  const src = page('ProcurementReorder.jsx');
  assert.match(src, /searchParams\.get\('noPo'\) === '1'/);
  assert.match(src, /noPo: noPo \? '1' : ''/, 'sent to the API as noPo=1');
  assert.match(src, /<Chip selected icon="close" aria-label="Hapus filter Belum ada PO" onClick=\{clearNoPo\}>Belum ada PO<\/Chip>/);
  assert.match(src, /next\.delete\('noPo'\)/, 'removing it clears the address too');
});

test('saran pesan ulang: the suggestion, cover and lead time read plainly', () => {
  const s = { units: 25, ratio: 12, baseQty: 300, coverAfterDays: 35.4, unit: 'Ctns' };
  assert.equal(suggestionText(s), '25 Ctns');
  assert.equal(suggestionText(null), 'Tentukan manual');
  assert.equal(suggestionMeta(s, 'TetraPk'), '= 300 TetraPk · cukup ± 35 hari');
  assert.equal(suggestionMeta({ ...s, ratio: 1 }, 'Pcs'), 'cukup ± 35 hari');
  assert.equal(leadTimeText({ days: 10, source: 'vendor', samples: 4 }), '10 hari (rata-rata 4 PO)');
  assert.equal(leadTimeText({ days: 14, source: 'default', samples: 0 }), '14 hari (perkiraan)');
  assert.equal(dailyOutText(12.3333, 'Pcs'), 'keluar ± 12,33 Pcs/hari');
  assert.equal(dailyOutText(null, 'Pcs'), '');
  assert.equal(coverDaysText(5.9, null), '± 5 hari');
  assert.equal(coverDaysText(120, null), '> 90 hari');
  assert.equal(coverDaysText(null, 'history'), 'Belum cukup riwayat');
  assert.equal(coverDaysText(null, 'no_outflow'), 'Tidak ada barang keluar 30 hari');
  assert.equal(onOrderMeta({ pos: 1, latePos: 1, legacyPos: 2 }), '1 PO, 1 terlambat · PO lama 2 (tidak dihitung)');
  assert.equal(onOrderMeta({ pos: 0, latePos: 0, legacyPos: 0 }), '');
});

test('saran pesan ulang: the page says why it is empty until stock, history and POs are approved', () => {
  const rules = { safetyDays: 7, orderCycleDays: 14, defaultLeadDays: 14, minHistoryDays: 7, minLeadSamples: 3 };
  assert.equal(reorderNotice({ stockReady: false, stockPending: true }, rules).title, 'Stok menunggu persetujuan Warehouse');
  assert.equal(reorderNotice({ stockReady: false, stockPending: false }, rules).title, 'Stok dari Accurate belum ada');
  assert.match(reorderNotice({ stockReady: true, historyDays: 2, coverFrom: '2026-10-06' }, rules).title, /^Laju keluar dihitung mulai /);
  assert.equal(reorderNotice({ stockReady: true, historyDays: 9, poReady: false }, rules).tone, 'warning');
  assert.equal(reorderNotice({ stockReady: true, historyDays: 9, poReady: true }, rules), null);
  assert.match(reorderRulesText(rules, { receiptsReady: false }), /14 hari \(perkiraan\) sampai penerimaan gudang disetujui/);
  assert.match(reorderRulesText(rules, { receiptsReady: true }), /min\. 3 PO/);
  assert.match(reorderRulesText(rules, {}), /PO lama tidak dihitung · stok total saja, tanpa stok per gudang/);
  assert.doesNotMatch(reorderRulesText(rules, {}), /Rp/);
});
