import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addItem, attentionText, campaignState, changePct, channelRows, channelShareItems, formBody, formErrors, formValues,
  formatMonth, kpiCards, leadRows, monthOptions, motionSeries, moverItems, nooTable, pctText, perfFigures, perfMessage,
  perfTrend, productRows, stateChips, statusOptions, toggleChannel, totalSeries, CHANNELS, STATE_BADGE, STATE_LABELS,
} from '../src/pages/marketing/marketingModel.js';
import { statusTone } from '../src/components/statusTone.js';

// Marketing (migration 119): the page model for Produk & channel and Kampanye.
const TODAY = '2026-10-01';
const months = Array.from({ length: 12 }, (_, i) => {
  const key = new Date(Date.UTC(2025, 9 + i, 1)).toISOString().slice(0, 7);
  return { key, label: formatMonth(key) };
});
const pad = (tail) => [...Array(12 - tail.length).fill(null), ...tail];
const channels = [
  { key: 'GT', label: 'General Trade', revenue: pad([100, 300]), qty: pad([5, 9]), noo: pad([1, 2]), totalRevenue: 400 },
  { key: 'MT', label: 'Modern Trade', revenue: pad([50, 100]), qty: pad([1, 1]), noo: pad([0, 0]), totalRevenue: 150 },
  { key: 'Export', label: 'Ekspor', revenue: pad([0, 0]), qty: pad([0, 0]), noo: pad([0, 0]), totalRevenue: 0 },
];

test('months: labels and the picker', () => {
  assert.equal(formatMonth('2026-09'), 'Sep 2026');
  const opts = monthOptions('2026-10', 3);
  assert.deepEqual(opts.map((o) => o.value), ['2026-10', '2026-09', '2026-08']);
  assert.equal(opts[0].label, 'Okt 2026');
  assert.equal(pctText(12.345), '+12,3%');
  assert.equal(pctText(-3), '-3%');
  assert.equal(pctText(null), null);
  assert.equal(changePct(150, 100), 50);
  assert.equal(changePct(5, 0), null);
});

test('kpi cards: waiting for Accurate, data behind, and the web card only when GA works', () => {
  const base = { prevMonthLabel: 'Agu 2026', month: '2026-09', dataThrough: '2026-09-30' };
  const ok = kpiCards({ ...base, accurate: true, kpis: { revenue: { value: 150, previous: 100 }, productsSold: { value: 3, previous: 4 }, newCustomers: { value: 1, previous: 0 }, newLeads: { value: 2, previous: 1 } } }, { available: false });
  assert.deepEqual(ok.map((c) => c.key), ['revenue', 'productsSold', 'newCustomers', 'newLeads']);
  assert.match(ok[0].note, /Agu 2026: Rp 100 \(\+50%\)/);
  assert.doesNotMatch(JSON.stringify(ok), /IDR/);
  const waiting = kpiCards({ ...base, accurate: false, kpis: { newLeads: { value: 4, previous: 0 } } });
  assert.equal(waiting[0].value, null);
  assert.match(waiting[0].note, /batch Accurate/);
  assert.equal(waiting[3].value, 4, 'leads come from the Sales app, not Accurate');
  const behind = kpiCards({ ...base, accurate: true, kpis: { revenue: { value: null, previous: 1 } } });
  assert.match(behind[0].note, /30 Sep 2026/);
  const web = kpiCards({ ...base, accurate: true, kpis: {} }, { available: true, sessions: 120, previous: 100, property: { name: 'prakasa.co.id' } });
  assert.equal(web.at(-1).key, 'webSessions');
  assert.match(web.at(-1).note, /prakasa\.co\.id · \+20%/);
});

test('channels: totals, the race, shares, the table and NOO per month', () => {
  assert.deepEqual(totalSeries(channels).slice(-3), [null, 150, 400]);
  const race = motionSeries(channels);
  assert.deepEqual(race.map((s) => s.key), ['GT', 'MT'], 'a channel that never sold does not race');
  assert.deepEqual(Object.keys(race[0]).sort(), ['better', 'key', 'label', 'targets', 'unit', 'values']);
  assert.equal(race[0].unit, 'rupiah');
  assert.equal(race[0].targets.length, 12);
  const shares = channelShareItems(channels, 11);
  assert.deepEqual(shares.map((s) => [s.key, s.value]), [['GT', 300], ['MT', 100]]);
  assert.match(shares[0].note, /75% dari omzet/);
  assert.equal(shares[0].display, 'Rp 300');
  const rows = channelRows(channels, 11);
  assert.deepEqual(rows.map((r) => [r.id, r.revenue, r.changePct, r.noo]), [['GT', 300, 200, 2], ['MT', 100, 100, 0]]);
  const noo = nooTable(channels, months, 3);
  assert.deepEqual(noo.months.map((m) => m.key), ['2026-07', '2026-08', '2026-09']);
  assert.deepEqual(noo.rows, [{ id: 'GT', channel: 'General Trade', total: 3, '2026-07': null, '2026-08': 1, '2026-09': 2 }]);
});

test('products, movers and leads', () => {
  const rows = productRows([{ itemCode: 'A', itemName: 'Oat 1L', revenue: 400, prevRevenue: 200, changePct: 100, qty: [{ unit: 'PCS', qty: 10 }, { unit: 'Box', qty: 1 }], channels: [{ key: 'GT', label: 'General Trade' }] }]);
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[0].qtyText, '10 PCS + 1 Box');
  assert.equal(rows[0].channelsText, 'General Trade');
  const up = moverItems([{ itemCode: 'A', itemName: 'A', change: 2000000, changePct: null }, { itemCode: 'B', itemName: 'B', change: 500000, changePct: 25 }]);
  assert.deepEqual(up.map((i) => i.value), [2000000, 500000]);
  assert.equal(up[0].display, '+Rp 2 jt');
  assert.equal(up[0].note, 'Baru terjual bulan ini');
  assert.equal(up[0].tone, 'success');
  const down = moverItems([{ itemCode: 'C', itemName: 'C', change: -1500, changePct: -50 }]);
  assert.equal(down[0].display, '-Rp 1,5 rb');
  assert.equal(down[0].value, 1500, 'the bar is the size of the fall');
  assert.equal(down[0].tone, 'error');
  const leads = leadRows([{ area: 'Tangerang', total: 40, converted: 2, open: 38, visited: 40, dropped: 0, newInMonth: 5 }]);
  assert.equal(leads[0].conversion, 5);
  assert.equal(leads[0].id, 'Tangerang');
});

test('campaign states use shared status tones and make the filter chips', () => {
  assert.equal(campaignState({ status: 'berjalan', endedOpen: true }), 'campaign_ended_open');
  assert.equal(campaignState({ status: 'berjalan', upcoming: true }), 'campaign_scheduled');
  assert.equal(campaignState({ status: 'selesai' }), 'campaign_selesai');
  const tones = Object.fromEntries(Object.keys(STATE_LABELS).map((key) => [key, statusTone(STATE_BADGE[key])]));
  assert.deepEqual(tones, {
    campaign_ended_open: 'warning', campaign_scheduled: 'info', campaign_berjalan: 'info',
    campaign_draft: 'default', campaign_selesai: 'success', campaign_dibatalkan: 'error',
  });
  const chips = stateChips([{ status: 'draft' }, { status: 'berjalan', endedOpen: true }, { status: 'draft' }]);
  assert.deepEqual(chips.map((c) => [c.key, c.count]), [['campaign_ended_open', 1], ['campaign_draft', 2]]);
  assert.match(attentionText({ endedOpen: 2 }), /2 kampanye sudah lewat/);
  assert.equal(attentionText({ endedOpen: 0 }), '');
});

test('campaign form: required fields, end ≥ start, channels, and an edit sends only changes', () => {
  const blank = formValues(null, TODAY);
  assert.equal(blank.startOn, TODAY);
  assert.equal(blank.status, 'draft');
  const errors = formErrors({ ...blank, endOn: '2026-09-30' });
  assert.deepEqual(Object.keys(errors).sort(), ['channels', 'endOn', 'name', 'objective']);
  assert.match(errors.endOn, /tidak boleh sebelum/);
  assert.equal(formErrors({ ...blank, name: 'X', objective: 'penjualan', endOn: '2026-10-31', allChannels: true, budget: '-1' }).budget, 'Anggaran berupa angka 0 atau lebih');

  const values = { ...blank, name: ' Promo Oat ', objective: 'penjualan', endOn: '2026-10-31', channels: ['MT', 'GT'], budget: '5000000', items: [{ itemNo: 'A', itemName: 'Oat' }] };
  assert.deepEqual(formErrors(values), {});
  assert.deepEqual(formBody(values), {
    name: 'Promo Oat', objective: 'penjualan', startOn: TODAY, endOn: '2026-10-31', budget: 5000000, status: 'draft', notes: null, channels: ['GT', 'MT'], items: ['A'],
  });

  const row = { id: 7, version: 3, name: 'Promo Oat', objective: 'penjualan', startOn: TODAY, endOn: '2026-10-31', budget: 5000000, status: 'draft', notes: null, channels: ['GT', 'MT'], items: [{ itemNo: 'A', itemName: 'Oat' }] };
  const edit = formValues(row, TODAY);
  assert.deepEqual(formBody(edit, row), { version: 3 }, 'nothing changed');
  assert.deepEqual(formBody({ ...edit, status: 'berjalan', items: [] }, row), { version: 3, status: 'berjalan', items: [] });
  // A closed campaign: only the notes go out.
  const closed = { ...row, status: 'selesai' };
  assert.deepEqual(formBody({ ...formValues(closed, TODAY), name: 'Lain', notes: 'Hasil: naik 20%' }, closed), { version: 3, notes: 'Hasil: naik 20%' });
  assert.deepEqual(formErrors({ ...formValues(closed, TODAY), name: '' }, closed), {}, 'closed fields are not checked');
  assert.deepEqual(statusOptions(null).map((o) => o.value), ['draft', 'berjalan']);
  assert.deepEqual(statusOptions({ status: 'berjalan' }).map((o) => o.value), ['berjalan', 'selesai', 'dibatalkan']);
});

test('channel chips and the product list', () => {
  let v = { allChannels: false, channels: [] };
  v = toggleChannel(v, 'MT');
  v = toggleChannel(v, 'GT');
  assert.deepEqual(v.channels, ['GT', 'MT'], 'canonical order');
  v = toggleChannel(v, 'GT');
  assert.deepEqual(v.channels, ['MT']);
  let all = { allChannels: false, channels: [] };
  for (const c of CHANNELS) all = toggleChannel(all, c);
  assert.equal(all.allChannels, true, 'every channel = all');
  assert.equal(toggleChannel(all, 'all').allChannels, false);
  const items = addItem(addItem([], { itemNo: 'A', itemName: 'Oat' }), { itemNo: 'A', itemName: 'Oat' });
  assert.equal(items.length, 1);
});

test('performance: messages, figures and the series', () => {
  assert.match(perfMessage({ state: 'not_reliable' }), /batch Accurate/);
  assert.match(perfMessage({ state: 'no_data', dataThrough: '2026-09-30' }), /30 Sep 2026/);
  assert.equal(perfMessage({ state: 'ok' }), null);
  const perf = {
    state: 'ok', window: { start: '2026-09-11', end: '2026-09-20', days: 10, partial: false }, baseline: { start: '2026-09-01', end: '2026-09-10' },
    revenue: 300, baselineRevenue: 150, upliftPct: 100, qty: 5, baselineQty: 3, qtyUpliftPct: 66.7, noo: 2, baselineNoo: 1,
    series: [{ key: '2026-09-01', label: '01/09', phase: 'baseline', revenue: 0 }, { key: '2026-09-11', label: '11/09', phase: 'campaign', revenue: 300 }],
    seriesStep: 'day',
  };
  const figs = perfFigures(perf);
  assert.deepEqual(figs.map((f) => [f.key, f.value, f.unit]), [['revenue', 300, 'rupiah'], ['uplift', 100, '%'], ['qty', 5, 'item'], ['noo', 2, 'item']]);
  assert.match(figs[0].note, /10 hari sebelumnya: Rp 150/);
  const trend = perfTrend(perf);
  assert.deepEqual(trend.values, [0, 300]);
  assert.equal(trend.points[0].label, '01/09 (sebelum)');
  assert.equal(trend.step, 'per hari');
});

test('F08: a campaign in several units shows no single quantity or uplift, but the quantity per unit', async () => {
  const m = await import('../src/pages/marketing/marketingModel.js');
  const base = { state: 'ok', window: { days: 10 }, revenue: 1000, baselineRevenue: 500, upliftPct: 100, noo: 1, baselineNoo: 0 };
  const mixed = m.perfFigures({ ...base, qty: null, baselineQty: null, qtyUpliftPct: null, qtyUnit: null, qtyByUnit: [{ unit: 'Box', qty: 1 }, { unit: 'PCS', qty: 5 }] });
  const qty = mixed.find((f) => f.key === 'qty');
  assert.equal(qty.value, null);
  assert.match(qty.note, /tidak dapat dihitung/);
  assert.match(qty.note, /1 Box \+ 5 PCS/);
  const one = m.perfFigures({ ...base, qty: 6, baselineQty: 3, qtyUpliftPct: 100, qtyUnit: 'PCS', qtyByUnit: [{ unit: 'PCS', qty: 6 }] }).find((f) => f.key === 'qty');
  assert.equal(one.value, 6);
  assert.equal(one.label, 'Jumlah terjual (PCS)');
  assert.match(m.perfFigures({ ...base, qty: 0, baselineQty: 0, qtyByUnit: [] }).find((f) => f.key === 'noo').note, /belum tentu membeli produk target/);
});

test('F08: the channel table writes quantities per unit, never one sum', async () => {
  const m = await import('../src/pages/marketing/marketingModel.js');
  const channel = { key: 'GT', label: 'GT', revenue: [100], qty: [null], noo: [0], qtyByUnit: [{ unit: 'Box', values: [1] }, { unit: 'PCS', values: [5] }] };
  assert.equal(m.channelQtyText(channel, 0), '1 Box + 5 PCS');
  assert.equal(m.channelRows([channel], 0)[0].qtyText, '1 Box + 5 PCS');
});
