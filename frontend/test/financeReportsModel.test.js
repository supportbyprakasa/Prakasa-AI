import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYABLE_TABS, RECEIVABLE_TABS, agingBars, approvedBy, bucketsFor, channelOptions, dueBadge, exclusionsText, formatShare,
  lastFullMonth, lateBadge, monthLabel, overdueSentence, payableCards, payableWaiting, receivableCards, tabFrom, trendSeries,
} from '../src/pages/finance/financeReportsModel.js';

// Piutang & Utang (Finance, migration 117): the page model.

const BUCKETS = [
  { key: 'current', label: 'Belum jatuh tempo', invoices: 2, amount: 1500000, share: 10 },
  { key: 'd1_30', label: '1–30 hari', invoices: 1, amount: 750000, share: 5 },
  { key: 'd31_60', label: '31–60 hari', invoices: 0, amount: 0, share: 0 },
  { key: 'd61_90', label: '61–90 hari', invoices: 0, amount: 0, share: 0 },
  { key: 'd90_plus', label: '> 90 hari', invoices: 9, amount: 12750000, share: 85 },
];

test('tabs: the URL picks a known tab, anything else opens the first', () => {
  assert.equal(tabFrom('due', RECEIVABLE_TABS), 'due');
  assert.equal(tabFrom('bogus', RECEIVABLE_TABS), 'customers');
  assert.equal(tabFrom(null, PAYABLE_TABS), 'due');
  assert.equal(tabFrom('vendors', PAYABLE_TABS), 'vendors');
});

test('aging bars: compact rupiah, invoice count and share; later buckets are redder', () => {
  const bars = agingBars(BUCKETS);
  assert.deepEqual(bars.map((b) => b.tone), ['success', 'info', 'warning', 'error', 'error']);
  assert.equal(bars[4].value, 12750000);
  assert.equal(bars[4].display, 'Rp 12,8 jt');
  assert.equal(bars[4].note, '9 faktur · 85%');
  assert.equal(bars[1].note, '1 faktur · 5%');
  assert.doesNotMatch(JSON.stringify(bars), /IDR/);
});

test('shares use a decimal comma', () => {
  assert.equal(formatShare(12.34), '12,3%');
  assert.equal(formatShare(80), '80%');
  assert.equal(formatShare(null), '0%');
});

test('channel chips: "Semua" first; a channel shows its own buckets', () => {
  const aging = { buckets: BUCKETS, channels: [{ channel: 'GT', total: { amount: 9 }, buckets: [{ key: 'current', amount: 9 }] }] };
  assert.deepEqual(channelOptions(aging.channels).map((c) => c.key), ['', 'GT']);
  assert.equal(bucketsFor(aging, ''), BUCKETS);
  assert.deepEqual(bucketsFor(aging, 'GT'), [{ key: 'current', amount: 9 }]);
  assert.equal(bucketsFor(aging, 'MT'), BUCKETS, 'an unknown channel falls back to all');
  assert.deepEqual(bucketsFor(null), []);
});

test('12 months → TrendChart months with Indonesian labels; the last full month vs the one before', () => {
  const rows = [{ month: '2026-08', amount: 100 }, { month: '2026-09', amount: 160 }, { month: '2026-10', amount: 5 }];
  assert.equal(monthLabel('2026-10'), 'Okt 2026');
  assert.equal(monthLabel('2026-08'), 'Agu 2026');
  const s = trendSeries(rows);
  assert.deepEqual(s.months, [{ key: '2026-08', label: 'Agu 2026' }, { key: '2026-09', label: 'Sep 2026' }, { key: '2026-10', label: 'Okt 2026' }]);
  assert.deepEqual(s.values, [100, 160, 5]);
  assert.deepEqual(lastFullMonth(rows), { month: 'Sep 2026', value: 160, previous: 100, change: 60, direction: 'up' });
  assert.equal(lastFullMonth(rows.slice(1)), null);
});

test('due and late badges', () => {
  assert.deepEqual(dueBadge(0), { status: 'pending_approval', label: 'Hari ini' });
  assert.deepEqual(dueBadge(2), { status: 'pending_approval', label: '2 hari lagi' });
  assert.deepEqual(dueBadge(10), { status: 'pending', label: '10 hari lagi' });
  assert.deepEqual(lateBadge(1200), { status: 'overdue', label: '1.200 hari' });
});

test('receivable cards: six figures; overdue cards alert only when something is late; DSO explains itself', () => {
  const summary = {
    invoices: 12, customers: 5, outstanding: 15000000,
    overdue: { invoices: 10, amount: 13500000 }, over90: { invoices: 0, amount: 0 },
    dueSoon: { days: 14, invoices: 1, amount: 500000 }, collectedThisMonth: { amount: 2000000, receipts: 3 },
    dso: { days: 45.5, window: 90, billed: 30000000 }, downPaymentsOpen: 0,
  };
  const cards = receivableCards(summary);
  assert.deepEqual(cards.map((c) => c.key), ['outstanding', 'overdue', 'over90', 'due', 'collected', 'dso']);
  assert.equal(cards[1].alert, true);
  assert.equal(cards[2].alert, false);
  assert.equal(cards[5].unit, 'hari');
  assert.match(cards[5].note, /90 hari terakhir \(Rp 30 jt\)/);
  assert.equal(receivableCards({ ...summary, dso: { days: null, window: 90, billed: 0 } })[5].value, null);
  assert.deepEqual(receivableCards(null), []);
});

test('payable cards and what the totals leave out', () => {
  const summary = { invoices: 3, vendors: 2, outstanding: 900, overdue: { invoices: 0, amount: 0 }, dueSoon: { days: 14, invoices: 1, amount: 300 }, paidThisMonth: { amount: 100, payments: 1 }, nonIdrOpen: 2, downPaymentsOpen: 1 };
  assert.deepEqual(payableCards(summary).map((c) => c.label), ['Total utang', 'Lewat jatuh tempo', 'Jatuh tempo 14 hari', 'Dibayar bulan ini']);
  assert.equal(payableCards(summary)[1].alert, false);
  assert.equal(exclusionsText(summary), '1 faktur uang muka dan 2 faktur mata uang asing belum lunas tidak dihitung dalam angka di halaman ini.');
  assert.equal(exclusionsText({ ...summary, nonIdrOpen: 0, downPaymentsOpen: 0 }), null);
  assert.equal(overdueSentence({ outstanding: 1000, overdue: { amount: 250 } }), '25% dari Rp 1.000 sudah lewat jatuh tempo');
  assert.equal(overdueSentence({ outstanding: 0 }), 'Tidak ada yang belum dibayar');
});

test('utang waiting state: the reason, and the waiting batch when there is one', () => {
  const reason = 'Menunggu tarikan data Accurate Finance pertama disetujui Supervisor/Head Finance';
  const waiting = payableWaiting({ ready: false, reason, enabled: true, pending: { batchId: 41, items: 12 } });
  assert.equal(waiting.batchLink, '/data-accurate/41');
  assert.equal(waiting.description, `${reason}. Batch #41 (12 perubahan) sudah menunggu keputusan.`);
  const off = payableWaiting({ ready: false, reason, enabled: false, pending: null });
  assert.equal(off.batchLink, null);
  assert.match(off.description, /belum dinyalakan/);
  assert.equal(payableWaiting({ ready: false, reason, enabled: true }).description, `${reason}.`);
  assert.equal(approvedBy({ approvedBy: 'Rina' }), 'disetujui Rina');
  assert.equal(approvedBy(null), null);
});
