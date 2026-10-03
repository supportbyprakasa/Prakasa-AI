import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actualText, buildMatrix, convertPeriod, currentPeriodKey, directionText, emptySummary, formatValue,
  metricRule, NO_DATA_TEXT, normalizeTargets, paceText, periodLabel, periodOptions, periodProgressText,
  readTargetParams, shortPaceText, STATUS_LABELS, STATUSES, statusRank, SUMMARY_STATUSES, targetForm,
  targetHint, targetPayload, targetQuery, targetText, unitLabel, validateNote, validateTargetInput, writeTargetParams,
  moduleOptions, pickModule, restrictedNotes, RESTRICTED_TEXT,
} from '../src/pages/advanced/targetsModel.js';
import { statusLabel, statusTone } from '../src/components/statusTone.js';

const METRICS = [
  { key: 'issues_completed', label: 'Issue selesai', unit: 'issue', better: 'higher', cumulative: true, source: 'Project Tracker' },
  { key: 'points_completed', label: 'Story point selesai', unit: 'poin', better: 'higher', cumulative: true, source: 'Project Tracker' },
  { key: 'on_time_rate', label: 'Selesai tepat waktu', unit: '%', better: 'higher', cumulative: false, source: 'Project Tracker' },
  { key: 'overdue_open', label: 'Issue terlambat', unit: 'issue', better: 'lower', cumulative: false, source: 'Project Tracker' },
  { key: 'approval_days', label: 'Rata-rata waktu approval', unit: 'hari', better: 'lower', cumulative: false, source: 'Approval' },
];
const byKey = Object.fromEntries(METRICS.map((m) => [m.key, m]));
const cell = (over) => ({
  departmentId: 3, metricKey: 'issues_completed', target: null, actual: 0, note: null, updatedAt: null,
  updatedByName: null, achievementPct: null, pacePct: null, status: 'no_target', ...over,
});

// Shaped like the live dev payload (2026-Q3): People & Culture is behind on
// "Issue selesai", Warehouse is fine on approval time.
const PAYLOAD = {
  scope: { entityWide: true, departmentId: null, departmentName: null },
  period: { type: 'quarter', key: '2026-Q3', start: '2026-07-01', end: '2026-09-30', label: 'Kuartal 3 2026 (Jul–Sep)', elapsedPct: 99, ended: false },
  metrics: METRICS,
  divisions: [{ id: 3, name: 'People & Culture' }, { id: 5, name: 'Warehouse' }],
  cells: [
    cell({ target: 6, actual: 2, achievementPct: 33.3, pacePct: 33.7, status: 'off_track', note: 'Kejar backlog', updatedAt: '2026-09-20T02:00:00.000Z', updatedByName: 'Rina' }),
    cell({ metricKey: 'on_time_rate', actual: null }),
    cell({ departmentId: 5, metricKey: 'approval_days', target: 1, actual: 0, achievementPct: 100, status: 'on_track' }),
    cell({ departmentId: 5, metricKey: 'on_time_rate', target: 90, actual: null, status: 'no_data' }),
  ],
  canEdit: true,
};

test('status labels are the agreed Indonesian wording, and tones come from statusTone.js', () => {
  assert.deepEqual(STATUS_LABELS, {
    on_track: 'Sesuai jalur',
    at_risk: 'Perlu perhatian',
    off_track: 'Tertinggal',
    achieved: 'Tercapai',
    no_target: 'Belum ada target',
    no_data: 'Belum ada data',
    billed_monthly: 'Ditagih bulanan',
  });
  for (const status of STATUSES) assert.equal(statusLabel(status), STATUS_LABELS[status], status);
  assert.equal(statusTone('off_track'), 'error');
  assert.equal(statusTone('at_risk'), 'warning');
  assert.equal(statusTone('on_track'), 'info');
  assert.equal(statusTone('achieved'), 'success');
  assert.equal(statusTone('no_target'), 'default');
  assert.equal(statusTone('no_data'), 'default');
  assert.deepEqual(SUMMARY_STATUSES, ['off_track', 'at_risk', 'on_track', 'achieved']);
});

test('normalizeTargets reads the live payload', () => {
  const data = normalizeTargets(PAYLOAD);
  assert.deepEqual(data.scope, { entityWide: true, departmentId: null, departmentName: null });
  assert.equal(data.period.key, '2026-Q3');
  assert.equal(data.period.label, 'Kuartal 3 2026 (Jul–Sep)');
  assert.equal(data.period.elapsedPct, 99);
  assert.equal(data.metrics.length, 5);
  assert.equal(data.metrics[3].better, 'lower');
  assert.deepEqual(data.divisions.map((d) => d.name), ['People & Culture', 'Warehouse']);
  assert.equal(data.cells.length, 4);
  assert.equal(data.cells[0].status, 'off_track');
  assert.equal(data.cells[0].updatedByName, 'Rina');
  assert.equal(data.canEdit, true);
});

test('normalizeTargets has safe defaults and never reads "unknown" as zero', () => {
  const empty = normalizeTargets(null);
  assert.deepEqual(empty.scope, { entityWide: true, departmentId: null, departmentName: null });
  assert.deepEqual([empty.metrics, empty.divisions, empty.cells, empty.restricted], [[], [], [], []]);
  assert.equal(empty.canEdit, false);
  assert.equal(empty.period.key, '');
  assert.equal(normalizeTargets({ canEdit: 'true' }).canEdit, false, 'only a real true grants editing');

  const data = normalizeTargets({
    ...PAYLOAD,
    cells: [
      cell({ target: '6', actual: '2', pacePct: '33.7', status: 'off_track' }),
      cell({ departmentId: 5, metricKey: 'on_time_rate', target: 90, actual: 0, status: 'no_data' }),
      cell({ departmentId: 5, metricKey: 'overdue_open', target: '', actual: '', status: 'no_target' }),
    ],
  });
  assert.equal(data.cells[0].target, 6);
  assert.equal(data.cells[0].actual, 2);
  assert.equal(data.cells[0].pacePct, 33.7);
  assert.equal(data.cells[1].actual, null, 'no_data forces an unknown actual');
  assert.equal(data.cells[2].target, null);
  assert.equal(data.cells[2].actual, null);
});

test('normalizeTargets drops malformed cells and validates enums', () => {
  const data = normalizeTargets({
    ...PAYLOAD,
    period: { type: 'week', key: '2026-W3', elapsedPct: 250, ended: 'yes' },
    metrics: [...METRICS, { key: 'odd', label: 'Aneh', unit: 'kg', better: 'sideways' }, { label: 'Tanpa kunci' }, METRICS[0]],
    divisions: [...PAYLOAD.divisions, { id: 'x', name: 'Rusak' }, { id: 3, name: 'Duplikat' }, { id: 9 }],
    cells: [
      cell({ status: 'off_track' }),
      cell({ status: 'on_track' }), // duplicate of the first — first wins
      cell({ departmentId: 42, status: 'on_track' }), // unknown division
      cell({ metricKey: 'nope', status: 'on_track' }), // unknown metric
      cell({ metricKey: 'points_completed', status: 'great' }), // unknown status
      cell({ departmentId: 'abc' }),
      null,
      'cell',
    ],
  });
  assert.equal(data.period.key, '');
  assert.equal(data.period.type, 'quarter');
  assert.equal(data.period.elapsedPct, 100);
  assert.equal(data.period.ended, false);
  const odd = data.metrics.find((m) => m.key === 'odd');
  assert.deepEqual([odd.unit, odd.better, odd.cumulative], [null, 'higher', false]);
  assert.equal(data.metrics.length, 6, 'no key → dropped, duplicate → dropped');
  assert.deepEqual(data.divisions.map((d) => [d.id, d.name]), [[3, 'People & Culture'], [5, 'Warehouse'], [9, 'Divisi #9']]);
  assert.equal(data.cells.length, 1);
  assert.equal(data.cells[0].status, 'off_track');
});

test('buildMatrix gives every division every metric and counts only cells with a target', () => {
  const { metrics, rows, summary } = buildMatrix(normalizeTargets(PAYLOAD));
  assert.equal(metrics.length, 5);
  assert.deepEqual(rows.map((r) => r.name), ['People & Culture', 'Warehouse']);
  for (const row of rows) assert.deepEqual(Object.keys(row.cells), METRICS.map((m) => m.key));
  // A pair the API left out reads as "no target".
  assert.equal(rows[1].cells.issues_completed.status, 'no_target');
  assert.equal(rows[1].cells.issues_completed.actual, null);
  assert.deepEqual(summary, { off_track: 1, at_risk: 0, on_track: 1, achieved: 0, billed_monthly: 0, no_data: 1, withTarget: 3, total: 10 });
  assert.deepEqual(buildMatrix(null), { metrics: [], rows: [], summary: emptySummary() });
});

test('statusRank sorts the worst status first', () => {
  const sorted = ['achieved', 'no_target', 'on_track', 'off_track', 'no_data', 'at_risk'].sort((a, b) => statusRank(a) - statusRank(b));
  assert.deepEqual(sorted, ['off_track', 'at_risk', 'on_track', 'achieved', 'no_data', 'no_target']);
  assert.equal(statusRank('mystery'), STATUSES.length);
});

test('formatValue uses the id-ID number format and the unit', () => {
  assert.equal(formatValue(75, '%'), '75%');
  assert.equal(formatValue(1.5, 'hari'), '1,5 hari');
  assert.equal(formatValue(6, 'issue'), '6 issue');
  assert.equal(formatValue(1234, 'poin'), '1.234 poin');
  assert.equal(formatValue(33.333, '%'), '33,3%');
  assert.equal(formatValue(0, 'issue'), '0 issue');
  assert.equal(formatValue(12, null), '12');
  assert.equal(formatValue(null, '%'), null);
  assert.equal(formatValue(undefined, 'hari'), null);
  assert.equal(formatValue('', 'hari'), null);
  assert.equal(formatValue('abc', 'hari'), null);
});

test('formatValue covers every provider unit and falls back to a plain number', () => {
  assert.equal(formatValue(3, 'item'), '3 item');
  assert.equal(formatValue(1234000, 'rupiah'), 'Rp 1.234.000');
  assert.equal(formatValue(1234000.6, 'rupiah'), 'Rp 1.234.001', 'rupiah has no decimals');
  assert.equal(formatValue(0, 'rupiah'), 'Rp 0');
  // A unit the frontend has never heard of still shows the number.
  assert.equal(formatValue(1234.56, 'kg'), '1.234,6');
  assert.equal(formatValue(7, undefined), '7');
  // Counts can print bare where the label already names the thing counted.
  assert.equal(formatValue(1234, 'item', { countUnit: false }), '1.234');
  assert.equal(formatValue(6, 'issue', { countUnit: false }), '6');
  assert.equal(formatValue(1.5, 'hari', { countUnit: false }), '1,5 hari');
  assert.equal(formatValue(75, '%', { countUnit: false }), '75%');
});

test('a metric never seen before renders with its API label, unit and module', () => {
  const data = normalizeTargets({
    ...PAYLOAD,
    metrics: [...METRICS, {
      key: 'movements_approved', label: 'Pergerakan disetujui', unit: 'item', better: 'higher',
      cumulative: true, provider: 'warehouse', providerLabel: 'Warehouse', source: 'Warehouse',
    }, { key: 'revenue', label: 'Omzet', unit: 'rupiah', provider: 'sales', providerLabel: 'Sales' }],
    cells: [...PAYLOAD.cells, cell({ departmentId: 5, metricKey: 'movements_approved', target: 40, actual: 12, pacePct: 30, achievementPct: 30, status: 'off_track' })],
  });
  const moved = data.metrics.find((m) => m.key === 'movements_approved');
  assert.deepEqual(
    [moved.label, moved.unit, moved.provider, moved.providerLabel, moved.source],
    ['Pergerakan disetujui', 'item', 'warehouse', 'Warehouse', 'Warehouse'],
  );
  // providerLabel is the source when the API sends no separate `source`.
  assert.equal(data.metrics.find((m) => m.key === 'revenue').source, 'Sales');
  const { rows } = buildMatrix(data);
  const warehouse = rows.find((r) => r.id === 5);
  assert.equal(actualText(warehouse.cells.movements_approved, moved), '12 item');
  assert.equal(targetText(warehouse.cells.movements_approved, moved), '40 item');
  assert.equal(shortPaceText(warehouse.cells.movements_approved, moved), 'Laju 30%');
  assert.equal(unitLabel('item'), 'item');
  assert.equal(unitLabel('rupiah'), 'rupiah');
  assert.equal(unitLabel('kg'), 'angka');
  assert.ok(validateTargetInput('2.5', moved).error, 'items are whole');
  assert.equal(validateTargetInput('2500000.5', { unit: 'rupiah' }).error, '');
});

test('a cell reads "Belum ada data" when the realisation is unknown — never 0', () => {
  assert.equal(actualText(cell({ actual: null, status: 'no_target' }), byKey.on_time_rate), NO_DATA_TEXT);
  assert.equal(actualText(cell({ actual: 0, target: 90, status: 'no_data' }), byKey.on_time_rate), NO_DATA_TEXT);
  assert.equal(actualText(cell({ actual: 0, status: 'on_track' }), byKey.approval_days), '0 hari');
  assert.equal(actualText(cell({ actual: 2, status: 'off_track' }), byKey.issues_completed), '2 issue');
  assert.equal(NO_DATA_TEXT, 'Belum ada data');
});

test('the target reads as a ceiling when lower is better', () => {
  assert.equal(targetText(cell({ target: 6 }), byKey.issues_completed), '6 issue');
  assert.equal(targetText(cell({ target: 1 }), byKey.approval_days), 'maks. 1 hari');
  assert.equal(targetText(cell({ target: null }), byKey.approval_days), '—');
  assert.equal(directionText(byKey.overdue_open), 'Lebih rendah lebih baik');
  assert.equal(directionText(byKey.on_time_rate), 'Lebih tinggi lebih baik');
  assert.match(metricRule(byKey.issues_completed), /laju selama periode berjalan/);
  assert.match(metricRule(byKey.approval_days), /^Lebih rendah lebih baik/);
});

test('paceText explains pace while a cumulative period runs, and the final result after', () => {
  const running = { elapsedPct: 99, ended: false };
  assert.equal(
    paceText(cell({ target: 6, actual: 2, achievementPct: 33.3, pacePct: 33.7, status: 'off_track' }), byKey.issues_completed, running),
    'Laju: 33,7% dari yang seharusnya tercapai saat ini (periode berjalan 99%, jadi sekitar 99% target seharusnya sudah tercapai).',
  );
  assert.equal(
    paceText(cell({ target: 6, actual: 6, achievementPct: 100, pacePct: null, status: 'achieved' }), byKey.issues_completed, { elapsedPct: 100, ended: true }),
    'Capaian akhir: 100% dari target.',
  );
  assert.match(paceText(cell({ target: 1, actual: 0, achievementPct: 100, status: 'on_track' }), byKey.approval_days, running), /di bawah atau sama dengan batas target/);
  assert.match(paceText(cell({ target: 1, actual: 2, achievementPct: 50, status: 'off_track' }), byKey.approval_days, running), /melewati batas target \(capaian 50%\)/);
  assert.equal(paceText(cell({ target: 90, actual: 72, achievementPct: 80, status: 'at_risk' }), byKey.on_time_rate, running), 'Capaian: 80% dari target.');
  assert.match(paceText(cell({ target: 90, actual: null, status: 'no_data' }), byKey.on_time_rate, running), /bukan berarti nol/);
  assert.equal(paceText(cell({ status: 'no_target' }), byKey.on_time_rate, running), 'Belum ada target untuk periode ini.');
});

test('shortPaceText is the one-line measure shown in a cell', () => {
  assert.equal(shortPaceText(cell({ target: 6, actual: 2, achievementPct: 33.3, pacePct: 33.7, status: 'off_track' }), byKey.issues_completed), 'Laju 33,7%');
  assert.equal(shortPaceText(cell({ target: 6, actual: 6, achievementPct: 100, status: 'achieved' }), byKey.issues_completed), 'Capaian 100%');
  assert.equal(shortPaceText(cell({ target: 1, actual: 0, achievementPct: 100, status: 'on_track' }), byKey.approval_days), 'Capaian 100%');
  assert.equal(shortPaceText(cell({ status: 'no_target' }), byKey.approval_days), '');
  assert.equal(shortPaceText(cell({ target: 90, status: 'no_data' }), byKey.on_time_rate), '');
});

test('period progress reads running, not started, or finished', () => {
  const today = new Date(2026, 8, 29);
  assert.equal(periodProgressText({ key: '2026-Q3', start: '2026-07-01', elapsedPct: 99, ended: false }, today), 'Periode berjalan 99%');
  assert.equal(periodProgressText({ key: '2026-Q2', start: '2026-04-01', elapsedPct: 100, ended: true }, today), 'Periode selesai');
  assert.equal(periodProgressText({ key: '2026-Q4', start: '2026-10-01', elapsedPct: 0, ended: false }, today), 'Periode belum dimulai');
  assert.equal(periodProgressText({ key: '' }, today), '');
});

test('period labels, defaults and Bulan ⇄ Kuartal conversion', () => {
  const today = new Date(2026, 8, 29); // 29 Sep 2026
  assert.equal(periodLabel('2026-Q3'), 'Kuartal 3 2026 (Jul–Sep)');
  assert.equal(periodLabel('2026-09'), 'September 2026');
  assert.equal(periodLabel('bogus'), '');
  assert.equal(currentPeriodKey('quarter', today), '2026-Q3');
  assert.equal(currentPeriodKey('month', today), '2026-09');
  assert.equal(convertPeriod('2026-Q3', 'month', today), '2026-09', 'today falls in the quarter → today\'s month');
  assert.equal(convertPeriod('2026-Q1', 'month', today), '2026-01', 'otherwise the quarter\'s first month');
  assert.equal(convertPeriod('2026-05', 'quarter', today), '2026-Q2');
  assert.equal(convertPeriod('2026-12', 'quarter', today), '2026-Q4');
  assert.equal(convertPeriod('2026-Q2', 'quarter', today), '2026-Q2');
  assert.equal(convertPeriod('', 'month', today), '2026-09');
});

test('periodOptions offers months and quarters around today, oldest first', () => {
  const today = new Date(2026, 8, 29);
  const { month, quarter } = periodOptions(today);
  assert.equal(month.length, 16);
  assert.equal(month[0].value, '2025-09');
  assert.equal(month.at(-1).value, '2026-12');
  assert.ok(month.some((o) => o.value === '2026-09' && o.label === 'September 2026'));
  assert.deepEqual(quarter.map((o) => o.value), ['2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4', '2027-Q1']);
  assert.equal(quarter[4].label, 'Kuartal 3 2026 (Jul–Sep)');
  // A shared link to an older period stays selectable, in order.
  const withOld = periodOptions(today, '2024-Q1');
  assert.equal(withOld.quarter[0].value, '2024-Q1');
  assert.equal(periodOptions(today, '2023-02').month[0].value, '2023-02');
  assert.equal(periodOptions(today, '2026-Q3').quarter.length, 7, 'an in-range key is not duplicated');
});

test('period ⇄ URL keeps only valid keys and leaves other params alone', () => {
  const period = (qs) => readTargetParams(qs === undefined ? undefined : new URLSearchParams(qs)).period;
  assert.equal(period('period=2026-Q3'), '2026-Q3');
  assert.equal(period('period=2026-q2'), '2026-Q2');
  assert.equal(period('period=2026-09'), '2026-09');
  assert.equal(period('period=2026-13'), '');
  assert.equal(period('period=1999-Q1'), '');
  assert.equal(period(''), '');
  assert.equal(period(undefined), '');

  const next = writeTargetParams(new URLSearchParams('tab=x'), { period: '2026-Q4' });
  assert.equal(next.toString(), 'tab=x&period=2026-Q4');
  assert.equal(writeTargetParams(next, { period: '' }).toString(), 'tab=x');
  assert.equal(writeTargetParams(next, { period: 'garbage' }).toString(), 'tab=x');
  assert.equal(writeTargetParams(next, { other: 1 }).toString(), 'tab=x&period=2026-Q4');

  assert.deepEqual(targetQuery('2026-Q3'), { period: '2026-Q3' });
  assert.equal(targetQuery(''), undefined, 'no period → the server picks the current quarter');
});

test('validateTargetInput mirrors the server rules', () => {
  assert.deepEqual(validateTargetInput('6', byKey.issues_completed), { value: 6, error: '' });
  assert.deepEqual(validateTargetInput('0', byKey.overdue_open), { value: 0, error: '' });
  assert.deepEqual(validateTargetInput('1,5', byKey.approval_days), { value: 1.5, error: '' });
  assert.deepEqual(validateTargetInput(100, byKey.on_time_rate), { value: 100, error: '' });
  assert.match(validateTargetInput('', byKey.issues_completed).error, /Hapus target/);
  assert.equal(validateTargetInput('abc', byKey.issues_completed).error, 'Target harus berupa angka.');
  assert.equal(validateTargetInput('-1', byKey.issues_completed).error, 'Target tidak boleh negatif.');
  assert.equal(validateTargetInput('101', byKey.on_time_rate).error, 'Target persentase maksimal 100.');
  assert.equal(validateTargetInput('2e9', byKey.points_completed).error, 'Target terlalu besar.');
  assert.equal(validateTargetInput('2.5', byKey.issues_completed).error, 'Jumlah issue harus bilangan bulat.');
  assert.equal(validateTargetInput('2.5', byKey.points_completed).error, '');
  assert.equal(validateTargetInput('abc', byKey.issues_completed).value, null);
});

test('edit form, hint, note and payload', () => {
  assert.deepEqual(targetForm(cell({ target: 6, note: 'Kejar backlog' })), { value: '6', note: 'Kejar backlog' });
  assert.deepEqual(targetForm(cell({ target: null })), { value: '', note: '' });
  assert.deepEqual(targetForm(null), { value: '', note: '' });
  assert.match(targetHint(byKey.issues_completed), /laju/);
  assert.match(targetHint(byKey.approval_days), /batas maksimal/);
  assert.match(targetHint(byKey.on_time_rate), /0 dan 100/);
  assert.equal(validateNote('x'.repeat(500)), '');
  assert.equal(validateNote('x'.repeat(501)), 'Maksimal 500 karakter.');

  assert.deepEqual(
    targetPayload({ departmentId: 3, metricKey: 'issues_completed', period: '2026-Q3', value: 6, note: '  Kejar backlog ' }),
    { departmentId: 3, metricKey: 'issues_completed', period: '2026-Q3', targetValue: 6, note: 'Kejar backlog' },
  );
  assert.deepEqual(
    targetPayload({ departmentId: 3, metricKey: 'issues_completed', period: '2026-Q3', value: 0, note: '   ' }),
    { departmentId: 3, metricKey: 'issues_completed', period: '2026-Q3', targetValue: 0, note: null },
  );
  // Clearing sends targetValue null.
  assert.deepEqual(
    targetPayload({ departmentId: 5, metricKey: 'approval_days', period: '2026-09', value: null, note: 'lama' }),
    { departmentId: 5, metricKey: 'approval_days', period: '2026-09', targetValue: null, note: null },
  );
});

test('the matrix shows one module at a time; the summary still covers every module', () => {
  const data = {
    metrics: [
      { key: 'issues_completed', label: 'Issue selesai', unit: 'issue', provider: 'project_tracker', providerLabel: 'Project Tracker' },
      { key: 'sales_won_value', label: 'Nilai won', unit: 'rupiah', provider: 'sales', providerLabel: 'Sales & Customer' },
      { key: 'sales_deals_won', label: 'Deal won', unit: 'item', provider: 'sales', providerLabel: 'Sales & Customer' },
    ],
    divisions: [{ id: 5, name: 'Sales' }, { id: 9, name: 'Warehouse' }],
    cells: [
      { departmentId: 5, metricKey: 'sales_won_value', status: 'off_track', target: 100, actual: 10 },
      { departmentId: 9, metricKey: 'issues_completed', status: 'on_track', target: 3, actual: 3 },
    ],
  };
  const modules = moduleOptions(data);
  assert.deepEqual(modules.map((m) => [m.value, m.label, m.withTarget, m.offTrack]), [
    ['project_tracker', 'Project Tracker', 1, 0],
    ['sales', 'Sales & Customer', 1, 1],
  ]);
  const matrix = buildMatrix(data, 'sales');
  assert.deepEqual(matrix.metrics.map((m) => m.key), ['sales_won_value', 'sales_deals_won'], 'only the chosen module');
  assert.deepEqual(Object.keys(matrix.rows[0].cells), ['sales_won_value', 'sales_deals_won']);
  assert.equal(matrix.summary.withTarget, 2, 'the summary counts every module, not just the one shown');
  assert.equal(matrix.summary.total, 6);
  // Default lands on the first module that already has targets; a requested one wins when it exists.
  assert.equal(pickModule(modules, ''), 'project_tracker');
  assert.equal(pickModule(modules, 'sales'), 'sales');
  assert.equal(pickModule(modules, 'tidak_ada'), 'project_tracker');
  assert.equal(pickModule([], ''), null);
  // The module lives in the URL next to the period.
  assert.equal(readTargetParams(new URLSearchParams('period=2026-Q3&modul=sales')).module, 'sales');
  assert.equal(readTargetParams(new URLSearchParams('modul=Bad-Key')).module, '');
  assert.equal(writeTargetParams(new URLSearchParams('period=2026-Q3'), { module: 'sales' }).toString(), 'period=2026-Q3&modul=sales');
  assert.equal(writeTargetParams(new URLSearchParams('period=2026-Q3&modul=sales'), { module: '' }).toString(), 'period=2026-Q3');
});

// Shaped like GET /management-dashboard/targets for an account without
// procurement.price.view: the PO value metric is only named, with the reason.
test('a metric this account may not see is named with its reason — never a number', () => {
  const data = normalizeTargets({
    ...PAYLOAD,
    metrics: [
      ...METRICS.map((m) => ({ ...m, provider: 'project_tracker', providerLabel: 'Project Tracker' })),
      { key: 'procurement_fill_rate', label: 'Fill rate pemasok', unit: '%', provider: 'procurement', providerLabel: 'Procurement' },
    ],
    restricted: [
      { key: 'procurement_po_value', label: 'Nilai PO (sebelum PPN)', provider: 'procurement', providerLabel: 'Procurement', reason: 'Hanya untuk yang berwenang melihat harga beli' },
      { key: 'procurement_po_value', label: 'Duplikat' },
      { key: 'issues_completed', label: 'Issue selesai' }, // also visible → the metric wins
      { key: 'finance_spend', label: 'Belanja', provider: 'finance', providerLabel: 'Finance' }, // no reason → the default
      { label: 'Tanpa kunci' },
      null,
    ],
  });
  assert.deepEqual(data.restricted, [
    { key: 'procurement_po_value', label: 'Nilai PO (sebelum PPN)', provider: 'procurement', providerLabel: 'Procurement', reason: 'Hanya untuk yang berwenang melihat harga beli' },
    { key: 'finance_spend', label: 'Belanja', provider: 'finance', providerLabel: 'Finance', reason: RESTRICTED_TEXT },
  ]);
  assert.ok(!data.metrics.some((m) => m.key === 'procurement_po_value'), 'never becomes a column');
  assert.ok(!buildMatrix(data, 'procurement').metrics.some((m) => m.key === 'procurement_po_value'));

  // The module shown gets its own line; Finance has no visible metric (no chip), so its line always shows.
  assert.deepEqual(restrictedNotes(data, 'procurement'), [
    'Nilai PO (sebelum PPN) tidak ditampilkan untuk akun Anda. Hanya untuk yang berwenang melihat harga beli.',
    'Belanja tidak ditampilkan untuk akun Anda. Hanya untuk yang berwenang melihat angka ini.',
  ]);
  assert.deepEqual(restrictedNotes(data, 'project_tracker'), [
    'Belanja tidak ditampilkan untuk akun Anda. Hanya untuk yang berwenang melihat angka ini.',
  ]);
  assert.equal(restrictedNotes(data, null).length, 2, 'no module: every line');
  // One line per reason.
  const grouped = restrictedNotes({
    metrics: [],
    restricted: [
      { key: 'a', label: 'Nilai PO', provider: 'procurement', reason: 'Hanya untuk yang berwenang melihat harga beli.' },
      { key: 'b', label: 'Harga rata-rata', provider: 'procurement', reason: 'Hanya untuk yang berwenang melihat harga beli.' },
    ],
  }, 'procurement');
  assert.deepEqual(grouped, ['Nilai PO, Harga rata-rata tidak ditampilkan untuk akun Anda. Hanya untuk yang berwenang melihat harga beli.']);
  assert.deepEqual(restrictedNotes(normalizeTargets(PAYLOAD), 'project_tracker'), [], 'nothing hidden → no line');
  assert.deepEqual(restrictedNotes(null), []);
});

test('a target billed monthly reads "Ditagih bulanan" while its period runs — no pace, never a shortfall', () => {
  const cell = { status: 'billed_monthly', actual: 0, target: 100, achievementPct: null, pacePct: null };
  const metric = { cumulative: true, better: 'higher', unit: 'rupiah' };
  assert.equal(STATUS_LABELS.billed_monthly, 'Ditagih bulanan');
  assert.equal(shortPaceText(cell, metric), 'Ditagih bulanan');
  assert.match(paceText(cell, metric, { elapsedPct: 10, ended: false }), /satu faktur rekap per akhir bulan/);
});
