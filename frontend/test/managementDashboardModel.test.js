import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysLateText, EMPTY_VALUE, escalationHref, escalationMeta, groupKpis, KPI_ALERT_TEXT, KPI_EMPTY_TEXT, KPI_ERROR_TEXT,
  kpiHintText, kpiIsAlert, kpiIsEmpty, kpiNoteText, kpiValueText, normalizeSummary, TOP_ESCALATIONS_MAX,
} from '../src/pages/advanced/managementDashboardModel.js';

// Shaped like GET /management-dashboard/summary. None of these providers, KPI
// keys or sources is known to the model — that is the point of these tests.
const kpi = (extra = {}) => ({
  provider: 'project_tracker', providerLabel: 'Project Tracker', key: 'active', label: 'Task aktif',
  unit: 'issue', value: 12, sub: '3 lewat tenggat', alert: true, error: false, ...extra,
});
const escalation = (extra = {}) => ({
  source: 'issue_overdue', sourceId: 7, title: 'Kirim laporan', reference: 'CEK-4', context: 'Project Cek',
  departmentId: 3, departmentName: 'Warehouse', ownerName: null, severity: 'high', daysLate: 15,
  since: '2026-09-01T00:00:00.000Z', link: '/projects/abc?issue=7', followup: null, ...extra,
});
const SUMMARY = {
  scope: { entityWide: false, departmentId: 3, departmentName: 'Warehouse' },
  kpis: [
    kpi(),
    kpi({ provider: 'approvals', providerLabel: 'Approval', key: 'pending', label: 'Approval menunggu', unit: 'item', value: 4, sub: null, alert: false }),
    kpi({ key: 'overdue', label: 'Task lewat tenggat', value: 3, sub: null, alert: false }),
    kpi({ provider: 'warehouse', providerLabel: 'Warehouse', key: 'stock_value', label: 'Nilai stok', unit: 'rupiah', value: 1234000, sub: null, alert: false }),
  ],
  topEscalations: [escalation(), escalation({ source: 'movement_waiting', sourceId: 41, severity: 'medium', daysLate: 2, reference: null })],
  escalationTotals: { all: 5, open: 4, acknowledged: 1, resolved: 0, bySource: { issue_overdue: 3, movement_waiting: 2 } },
};

test('normalizeSummary keeps a well-formed payload', () => {
  const data = normalizeSummary(SUMMARY);
  assert.deepEqual(data.scope, { entityWide: false, departmentId: 3, departmentName: 'Warehouse' });
  assert.equal(data.kpis.length, 4);
  assert.deepEqual(data.kpis[0], {
    provider: 'project_tracker', providerLabel: 'Project Tracker', key: 'active', id: 'project_tracker.active',
    label: 'Task aktif', unit: 'issue', value: 12, sub: '3 lewat tenggat', alert: true, error: false,
  });
  // A source the frontend has never seen passes: the summary carries no catalogue.
  assert.deepEqual(data.topEscalations.map((e) => e.source), ['issue_overdue', 'movement_waiting']);
  assert.deepEqual(data.escalationTotals, SUMMARY.escalationTotals);
});

test('normalizeSummary survives a malformed or missing payload', () => {
  for (const value of [null, undefined, 'nope', 42, [], { kpis: 'x', topEscalations: {}, escalationTotals: [] }]) {
    const data = normalizeSummary(value);
    assert.deepEqual(data.kpis, []);
    assert.deepEqual(data.topEscalations, []);
    assert.deepEqual(data.escalationTotals, { all: 0, open: 0, acknowledged: 0, resolved: 0, bySource: {} });
    // An absent scope reads as entity-wide, never as a narrowed view.
    assert.equal(data.scope.entityWide, true);
  }
  assert.deepEqual(groupKpis(normalizeSummary(null).kpis), []);
});

test('KPI rows get safe defaults; keyless and duplicate rows are dropped', () => {
  const data = normalizeSummary({
    kpis: [
      { key: 'bare' },
      { label: 'Tanpa kunci', value: 3 },
      null,
      'kpi',
      kpi(),
      kpi({ label: 'Duplikat' }),
      kpi({ provider: 'other', key: 'active', value: '7', alert: 'yes', error: 'no' }),
    ],
  });
  assert.deepEqual(data.kpis.map((k) => k.id), ['?.bare', 'project_tracker.active', 'other.active']);
  assert.deepEqual(data.kpis[0], {
    provider: '', providerLabel: 'Lainnya', key: 'bare', id: '?.bare', label: 'bare',
    unit: null, value: null, sub: null, alert: false, error: false,
  });
  assert.equal(data.kpis[1].label, 'Task aktif', 'first of a duplicate wins');
  assert.equal(data.kpis[2].value, 7);
  assert.equal(data.kpis[2].alert, false, 'only a real true raises the alert');
  assert.equal(data.kpis[2].error, false);
});

test('groupKpis groups by module label, keeping the API order', () => {
  const groups = groupKpis(normalizeSummary(SUMMARY).kpis);
  assert.deepEqual(groups.map((g) => g.providerLabel), ['Project Tracker', 'Approval', 'Warehouse']);
  assert.deepEqual(groups[0].kpis.map((k) => k.key), ['active', 'overdue']);
  assert.deepEqual(groups[1].kpis.map((k) => k.key), ['pending']);
  assert.deepEqual(groupKpis(undefined), []);
  assert.deepEqual(groupKpis([null, { key: 'x' }]).map((g) => g.providerLabel), ['Lainnya']);
});

test('a KPI value is formatted by its own unit', () => {
  const value = (unit, v) => kpiValueText({ unit, value: v, error: false });
  assert.equal(value('rupiah', 1234000), 'Rp 1,2 jt', 'money is short on a stat card');
  assert.equal(value('rupiah', 1273450000), 'Rp 1,27 M');
  assert.equal(value('rupiah', 0), 'Rp 0');
  assert.equal(value('hari', 1.5), '1,5 hari');
  assert.equal(value('%', 75), '75%');
  assert.equal(value('item', 1234), '1.234', 'counts print bare: the label names the thing');
  assert.equal(value('issue', 12), '12');
  assert.equal(value('poin', 8), '8');
  assert.equal(value(null, 1234.5), '1.234,5');
  assert.equal(value('kg', 3), '3', 'an unknown unit falls back to a plain number');
});

test('a failed or empty KPI reads as a dash with a hint — never as 0', () => {
  const failed = normalizeSummary({ kpis: [kpi({ value: null, error: true, sub: 'x', alert: true })] }).kpis[0];
  assert.equal(kpiValueText(failed), EMPTY_VALUE);
  assert.equal(kpiHintText(failed), KPI_ERROR_TEXT);
  assert.equal(KPI_ERROR_TEXT, 'Gagal dimuat');
  assert.equal(kpiIsEmpty(failed), true);

  const blank = normalizeSummary({ kpis: [kpi({ value: null, sub: null })] }).kpis[0];
  assert.equal(kpiValueText(blank), EMPTY_VALUE);
  assert.equal(kpiHintText(blank), KPI_EMPTY_TEXT);
  assert.equal(kpiIsEmpty(blank), true);

  // An error wins even when a stale number came along.
  assert.equal(kpiValueText({ value: 5, unit: 'item', error: true }), EMPTY_VALUE);

  const zero = normalizeSummary({ kpis: [kpi({ value: 0, sub: null })] }).kpis[0];
  assert.equal(kpiValueText(zero), '0');
  assert.equal(kpiHintText(zero), '');
  assert.equal(kpiIsEmpty(zero), false);

  const ok = normalizeSummary(SUMMARY).kpis[0];
  assert.equal(kpiHintText(ok), '3 lewat tenggat');
  assert.equal(kpiValueText(null), EMPTY_VALUE);
  assert.equal(kpiHintText(null), KPI_ERROR_TEXT);
});

// Shaped like the live summary: the module says why a card has no number, and
// that line must reach the card instead of the generic "Belum ada data".
test('an empty KPI keeps the module\'s own explanation and its alert', () => {
  assert.equal(kpiHintText({ value: null, sub: 'X', alert: true }), 'X');
  const [otif, held, restricted, blank, failed] = normalizeSummary({
    kpis: [
      kpi({ provider: 'warehouse', key: 'warehouse_so_otif_month', unit: '%', value: null, sub: 'Belum ada SO jatuh tempo 30 hari terakhir · 2 lewat janji belum terkirim', alert: true }),
      kpi({ provider: 'flow', key: 'flow_order_to_cash', unit: 'hari', value: null, sub: 'Transaksi Sales dicatat di aplikasi', alert: false }),
      kpi({
        provider: 'procurement', key: 'procurement_po_value_month', unit: 'rupiah', value: null,
        sub: 'Hanya untuk yang berwenang melihat harga beli', alert: false, restricted: true,
      }),
      kpi({ key: 'blank', value: null, sub: null, alert: false }),
      kpi({ key: 'failed', value: null, sub: 'basi', alert: true, error: true }),
    ],
  }).kpis;

  assert.equal(kpiHintText(otif), 'Belum ada SO jatuh tempo 30 hari terakhir · 2 lewat janji belum terkirim');
  assert.equal(kpiValueText(otif), EMPTY_VALUE, 'still a dash, never 0%');
  assert.equal(kpiIsEmpty(otif), true);
  assert.equal(kpiIsAlert(otif), true, 'an empty card can still need attention');

  assert.equal(kpiHintText(held), 'Transaksi Sales dicatat di aplikasi');
  assert.equal(kpiIsAlert(held), false);

  assert.equal(kpiHintText(restricted), 'Hanya untuk yang berwenang melihat harga beli');
  assert.equal(kpiValueText(restricted), EMPTY_VALUE, 'no rupiah');
  assert.equal(kpiIsAlert(restricted), false);

  assert.equal(kpiHintText(blank), KPI_EMPTY_TEXT, 'no explanation → the generic hint');
  assert.equal(kpiHintText(failed), KPI_ERROR_TEXT, 'a failure wins over a stale sub line');
  assert.equal(kpiIsAlert(failed), false, 'a failed card never alerts');

  assert.equal(kpiIsAlert(normalizeSummary(SUMMARY).kpis[0]), true, 'a number with an alert');
  assert.equal(kpiIsAlert(null), false);
  assert.equal(kpiIsAlert({ value: 3, alert: 'yes' }), false, 'only a real true');
});

// StatCard turns only the note red on an alert, so a flagged card always has one.
test('the card note is the hint, or a short cue when a flagged card has none', () => {
  assert.equal(kpiNoteText(normalizeSummary(SUMMARY).kpis[0]), '3 lewat tenggat');
  assert.equal(kpiNoteText({ value: 4, sub: null, alert: true }), KPI_ALERT_TEXT);
  assert.equal(KPI_ALERT_TEXT, 'Perlu ditindaklanjuti');
  assert.equal(kpiNoteText({ value: 4, sub: null, alert: false }), '', 'a quiet card needs no note');
  assert.equal(kpiNoteText({ value: null, sub: null, alert: true }), KPI_EMPTY_TEXT, 'an empty card keeps its hint');
  assert.equal(kpiNoteText({ value: 4, alert: true, error: true }), KPI_ERROR_TEXT);
  assert.equal(kpiNoteText(null), KPI_ERROR_TEXT);
});

test('top escalations are capped, well-formed and described from their own fields', () => {
  const many = Array.from({ length: 8 }, (_, i) => escalation({ sourceId: i + 1 }));
  const data = normalizeSummary({ topEscalations: [...many, { source: 'x' }, null, escalation({ source: 'bad key' })] });
  assert.equal(data.topEscalations.length, TOP_ESCALATIONS_MAX);

  const [first] = normalizeSummary(SUMMARY).topEscalations;
  assert.equal(escalationMeta(first), 'Project Cek · Warehouse');
  assert.equal(escalationMeta({ context: '-', departmentName: null }), '');
  assert.equal(escalationMeta(null), '');
  assert.equal(daysLateText(first), '15 hari');
  assert.equal(daysLateText({ daysLate: 'x' }), '0 hari');
  assert.equal(escalationHref(first), '/escalations?source=issue_overdue');
  assert.equal(escalationHref({}), '/escalations');
});
