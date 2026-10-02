import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFollowup, escalationKey, escalationQuery, EMPTY_TOTALS, followupForm, followupPayload,
  groupSourceCounts, itemStatus, NOTE_MAX, normalizeEscalations, normalizeFollowup, normalizeSources,
  readEscalationParams, resolveSource, severityTone, shiftTotals, sourceLabel, sourceProviderLabel,
  STATUS_FILTERS, STATUS_LABELS, STATUS_OPTIONS, statusKey, validateFollowupForm, writeEscalationParams,
} from '../src/pages/advanced/escalationsModel.js';
import { statusTone } from '../src/components/statusTone.js';

const item = (extra = {}) => ({
  source: 'issue_overdue',
  sourceId: 7,
  title: 'Kirim laporan bulanan',
  reference: 'CEK-4',
  context: 'Project Cek',
  departmentId: 3,
  departmentName: 'Warehouse',
  ownerName: 'Rina',
  severity: 'high',
  daysLate: 5,
  since: '2026-09-20T02:00:00.000Z',
  link: '/projects/abc?issue=7',
  followup: null,
  ...extra,
});

// The catalogue as the API sends it. Nothing in the model knows these keys:
// every test below would pass just as well with any other module's sources.
const SOURCES = [
  { key: 'issue_overdue', label: 'Task lewat tenggat', provider: 'project_tracker', providerLabel: 'Project Tracker' },
  { key: 'issue_stale', label: 'Task mandek', provider: 'project_tracker', providerLabel: 'Project Tracker' },
  { key: 'approval_aged', label: 'Approval menumpuk', provider: 'approvals', providerLabel: 'Approval' },
  { key: 'sprint_overdue', label: 'Sprint lewat tenggat', provider: 'project_tracker', providerLabel: 'Project Tracker' },
];

const payload = (extra = {}) => ({
  scope: { entityWide: false, departmentId: 3, departmentName: 'Warehouse' },
  sources: SOURCES,
  totals: { all: 4, open: 2, acknowledged: 1, resolved: 1, bySource: { issue_overdue: 2, issue_stale: 1, approval_aged: 1, sprint_overdue: 0 } },
  items: [item()],
  ...extra,
});

test('source labels come from the catalogue, follow-up statuses from the model', () => {
  const { sources } = normalizeEscalations(payload());
  assert.equal(sourceLabel(sources, 'issue_stale'), 'Task mandek');
  assert.equal(sourceProviderLabel(sources, 'approval_aged'), 'Approval');
  assert.equal(sourceLabel(sources, 'nonsense'), 'Lainnya');
  assert.equal(sourceProviderLabel(sources, 'nonsense'), '');
  assert.equal(sourceLabel(undefined, 'issue_stale'), 'Lainnya');
  assert.deepEqual(Object.keys(STATUS_LABELS), ['open', 'acknowledged', 'resolved']);
  assert.deepEqual(STATUS_OPTIONS.map((o) => o.value), ['open', 'acknowledged', 'resolved']);
});

test('a source never seen before renders with its own API label', () => {
  const data = normalizeEscalations(payload({
    sources: [...SOURCES, { key: 'movement_waiting', label: 'Barang tertahan approval', provider: 'warehouse', providerLabel: 'Warehouse' }],
    totals: { all: 1, open: 1, bySource: { movement_waiting: 1 } },
    items: [item({ source: 'movement_waiting', sourceId: 41, link: '/warehouse/movements/outbound/41' })],
  }));
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].source, 'movement_waiting');
  assert.equal(sourceLabel(data.sources, 'movement_waiting'), 'Barang tertahan approval');
  assert.equal(sourceProviderLabel(data.sources, 'movement_waiting'), 'Warehouse');
  assert.equal(data.totals.bySource.movement_waiting, 1);
  // Every catalogue key gets a count, 0 when the API left it out.
  assert.equal(data.totals.bySource.issue_stale, 0);
});

test('normalizeSources keeps the API order, dedupes and defaults labels', () => {
  const sources = normalizeSources([
    { key: 'b_key', label: ' B ', provider: 'mod_b', providerLabel: 'Modul B' },
    { key: 'a_key', provider: 'mod_a' },
    { key: 'b_key', label: 'Duplikat' },
    { label: 'Tanpa kunci' },
    { key: 'bad key!' },
    null,
    'x',
  ]);
  assert.deepEqual(sources, [
    { key: 'b_key', label: 'B', provider: 'mod_b', providerLabel: 'Modul B' },
    { key: 'a_key', label: 'a_key', provider: 'mod_a', providerLabel: 'mod_a' },
  ]);
  assert.deepEqual(normalizeSources(null), []);
  assert.equal(normalizeSources([{ key: 'k' }])[0].providerLabel, 'Lainnya');
});

test('groupSourceCounts reads per module, in catalogue order', () => {
  const data = normalizeEscalations(payload());
  const groups = groupSourceCounts(data.sources, data.totals.bySource);
  assert.deepEqual(groups.map((g) => g.providerLabel), ['Project Tracker', 'Approval']);
  assert.deepEqual(groups[0].sources.map((s) => [s.key, s.label, s.count]), [
    ['issue_overdue', 'Task lewat tenggat', 2], ['issue_stale', 'Task mandek', 1], ['sprint_overdue', 'Sprint lewat tenggat', 0],
  ]);
  assert.equal(groups[0].total, 3);
  assert.equal(groups[1].total, 1);
  assert.deepEqual(groupSourceCounts(null, null), []);
  assert.equal(groupSourceCounts(data.sources, { issue_overdue: 'junk' })[0].total, 0);
});

// The tone must come from components/statusTone.js, never from a map in this module.
test('follow-up statuses map onto keys statusTone already knows', () => {
  assert.equal(statusTone(statusKey('open')), 'default');
  assert.equal(statusTone(statusKey('acknowledged')), 'info');
  assert.equal(statusTone(statusKey('resolved')), 'success');
  assert.equal(statusKey('whatever'), 'open');
});

test('severityTone only shouts for high severity', () => {
  assert.equal(severityTone('high'), 'error');
  assert.equal(severityTone('medium'), 'warning');
  assert.equal(severityTone(undefined), 'warning');
});

test('normalizeEscalations keeps a well-formed payload intact', () => {
  const data = normalizeEscalations(payload());
  assert.deepEqual(data.scope, { entityWide: false, departmentId: 3, departmentName: 'Warehouse' });
  assert.deepEqual(data.sources, SOURCES);
  assert.equal(data.totals.all, 4);
  assert.equal(data.totals.bySource.issue_overdue, 2);
  assert.equal(data.items.length, 1);
  assert.deepEqual(data.items[0], { ...item(), referenceLabel: false });
  // A provider that sends one of the app's labels as the reference says so.
  assert.equal(normalizeEscalations(payload({ items: [{ ...item(), reference: 'Kebersihan', referenceLabel: true }] })).items[0].referenceLabel, true);
});

test('normalizeEscalations survives a missing or junk payload', () => {
  for (const value of [null, undefined, 'nope', 42, []]) {
    const data = normalizeEscalations(value);
    assert.deepEqual(data.items, []);
    assert.deepEqual(data.sources, []);
    assert.deepEqual(data.totals, EMPTY_TOTALS);
    // An absent scope must read as entity-wide, never as a narrowed view.
    assert.deepEqual(data.scope, { entityWide: true, departmentId: null, departmentName: null });
  }
});

test('normalizeEscalations drops rows it could never address', () => {
  const data = normalizeEscalations(payload({
    items: [
      item(),
      null,
      'string',
      item({ source: 'made_up' }), // not in the catalogue
      item({ source: '' }),
      item({ sourceId: 0 }),
      item({ sourceId: 'x' }),
      item({ sourceId: -2 }),
    ],
  }));
  assert.equal(data.items.length, 1);
});

test('normalizeEscalations defaults every optional field', () => {
  const [row] = normalizeEscalations({
    sources: SOURCES,
    items: [{ source: 'approval_aged', sourceId: '12' }],
  }).items;
  assert.deepEqual(row, {
    source: 'approval_aged',
    sourceId: 12,
    title: 'Tanpa judul',
    reference: null,
    referenceLabel: false,
    context: '-',
    departmentId: null,
    departmentName: null,
    ownerName: null,
    severity: 'medium',
    daysLate: 0,
    since: '',
    link: null,
    followup: null,
  });
});

test('counts are coerced to non-negative integers', () => {
  const data = normalizeEscalations({
    sources: SOURCES,
    totals: { all: '9', open: -4, acknowledged: 2.7, resolved: null, bySource: { issue_overdue: '3', sprint_overdue: -1, not_listed: 5 } },
    items: [item({ daysLate: -3 }), item({ sourceId: 8, daysLate: '4.9' })],
  });
  assert.equal(data.totals.all, 9);
  assert.equal(data.totals.open, 0);
  assert.equal(data.totals.acknowledged, 2);
  assert.equal(data.totals.resolved, 0);
  assert.equal(data.totals.bySource.issue_overdue, 3);
  assert.equal(data.totals.bySource.sprint_overdue, 0);
  assert.equal('not_listed' in data.totals.bySource, false, 'a key outside the catalogue is not counted');
  assert.equal(data.items[0].daysLate, 0);
  assert.equal(data.items[1].daysLate, 4);
});

test('only a plain in-app path survives as a link', () => {
  const links = (value) => normalizeEscalations({ sources: SOURCES, items: [item({ link: value })] }).items[0].link;
  assert.equal(links('/projects/abc?issue=7'), '/projects/abc?issue=7');
  assert.equal(links('//evil.example.com'), null);
  assert.equal(links('https://evil.example.com'), null);
  assert.equal(links('javascript:alert(1)'), null);
  assert.equal(links(''), null);
  assert.equal(links(null), null);
});

test('a follow-up is normalized and its status enum validated', () => {
  assert.equal(normalizeFollowup(null), null);
  assert.equal(normalizeFollowup('x'), null);
  assert.deepEqual(normalizeFollowup({}), {
    status: 'open', ownerUserId: null, ownerName: null, note: null, updatedAt: '', updatedByName: null,
  });
  assert.deepEqual(normalizeFollowup({
    status: 'made_up', ownerUserId: '5', ownerName: ' Budi ', note: ' catatan ', updatedAt: '2026-09-27T00:00:00.000Z', updatedByName: 'Sari',
  }), {
    status: 'open', ownerUserId: 5, ownerName: 'Budi', note: 'catatan', updatedAt: '2026-09-27T00:00:00.000Z', updatedByName: 'Sari',
  });
  assert.equal(normalizeFollowup({ status: 'resolved' }).status, 'resolved');
});

test('an item with no follow-up row counts as open', () => {
  assert.equal(itemStatus(item()), 'open');
  assert.equal(itemStatus(item({ followup: { status: 'acknowledged' } })), 'acknowledged');
  assert.equal(itemStatus(null), 'open');
});

test('escalationKey identifies a row across sources that share an id', () => {
  assert.equal(escalationKey(item()), 'issue_overdue:7');
  assert.notEqual(escalationKey(item({ source: 'approval_aged' })), escalationKey(item()));
  assert.equal(escalationKey(null), '?:?');
});

// ---------------------------------------------------------------------------
// URL filters

test('readEscalationParams falls back to the open queue', () => {
  const read = (query) => readEscalationParams(new URLSearchParams(query));
  assert.deepEqual(read(''), { status: 'open', source: '' });
  assert.deepEqual(read('status=resolved&source=issue_stale'), { status: 'resolved', source: 'issue_stale' });
  assert.deepEqual(read('status=all'), { status: 'all', source: '' });
  // Which sources exist is only known after the first load, so any well-formed
  // key is kept here; a malformed one is dropped straight away.
  assert.deepEqual(read('status=made_up&source=made_up'), { status: 'open', source: 'made_up' });
  assert.deepEqual(read('source=%3Cscript%3E'), { status: 'open', source: '' });
  assert.deepEqual(readEscalationParams(undefined), { status: 'open', source: '' });
  assert.deepEqual(STATUS_FILTERS, ['open', 'acknowledged', 'resolved', 'all']);
});

test('writeEscalationParams drops defaults and leaves foreign keys alone', () => {
  const base = new URLSearchParams('tab=x&status=resolved&source=issue_stale');
  assert.equal(writeEscalationParams(base, { status: 'open' }).toString(), 'tab=x&source=issue_stale');
  assert.equal(writeEscalationParams(base, { source: '' }).toString(), 'tab=x&status=resolved');
  assert.equal(writeEscalationParams(base, { status: 'all' }).get('status'), 'all');
  // Keys this page doesn't own are never written.
  assert.equal(writeEscalationParams(base, { tab: 'y' }).get('tab'), 'x');
  // A round trip through the URL gives back the same filters.
  const written = writeEscalationParams(new URLSearchParams(), { status: 'acknowledged', source: 'sprint_overdue' });
  assert.deepEqual(readEscalationParams(written), { status: 'acknowledged', source: 'sprint_overdue' });
});

test('resolveSource keeps the URL source until the catalogue has loaded', () => {
  const { sources } = normalizeEscalations(payload());
  assert.equal(resolveSource('movement_waiting', [], false), 'movement_waiting', 'not wiped before the first load');
  assert.equal(resolveSource('movement_waiting', sources, true), '', 'unknown once loaded → Semua jenis');
  assert.equal(resolveSource('issue_stale', sources, true), 'issue_stale');
  assert.equal(resolveSource('', sources, true), '');
  assert.equal(resolveSource('bad key', [], false), '');
});

test('escalationQuery sends a status always and a source only when set', () => {
  assert.deepEqual(escalationQuery({ status: 'all', source: 'approval_aged' }), { status: 'all', source: 'approval_aged' });
  assert.deepEqual(escalationQuery({ status: 'open', source: '' }), { status: 'open' });
  assert.deepEqual(escalationQuery({ status: 'junk', source: 'bad key' }), { status: 'open' });
  assert.deepEqual(escalationQuery({ status: 'open', source: 'movement_waiting' }), { status: 'open', source: 'movement_waiting' });
  assert.deepEqual(escalationQuery(), { status: 'open' });
});

// ---------------------------------------------------------------------------
// Follow-up form

test('followupForm seeds from the row, defaulting to an untouched item', () => {
  assert.deepEqual(followupForm(item()), { status: 'open', ownerUserId: '', note: '' });
  assert.deepEqual(followupForm(item({ followup: { status: 'acknowledged', ownerUserId: 5, note: 'cek' } })), {
    status: 'acknowledged', ownerUserId: '5', note: 'cek',
  });
  assert.deepEqual(followupForm(null), { status: 'open', ownerUserId: '', note: '' });
});

test('validateFollowupForm guards the status enum and the note length', () => {
  assert.deepEqual(validateFollowupForm({ status: 'resolved', note: 'ok' }), {});
  assert.ok(validateFollowupForm({ status: 'nope' }).status);
  assert.deepEqual(validateFollowupForm({ status: 'open', note: 'a'.repeat(NOTE_MAX) }), {});
  assert.ok(validateFollowupForm({ status: 'open', note: 'a'.repeat(NOTE_MAX + 1) }).note);
});

test('followupPayload sends an explicit empty so an owner or note can be cleared', () => {
  assert.deepEqual(followupPayload({ status: 'resolved', ownerUserId: '5', note: '  catatan  ' }), {
    status: 'resolved', ownerUserId: 5, note: 'catatan',
  });
  assert.deepEqual(followupPayload({ status: 'open', ownerUserId: '', note: '   ' }), {
    status: 'open', ownerUserId: null, note: null,
  });
});

test('applyFollowup replaces exactly one row', () => {
  const items = [item(), item({ source: 'approval_aged', sourceId: 7 }), item({ sourceId: 8 })];
  const next = applyFollowup(items, 'issue_overdue', 7, { status: 'resolved', updatedAt: '2026-09-28T00:00:00.000Z' });
  assert.equal(next[0].followup.status, 'resolved');
  assert.equal(next[1].followup, null, 'same id, different source stays untouched');
  assert.equal(next[2].followup, null);
  assert.notEqual(next[0], items[0], 'the changed row is a new object');
  assert.equal(next[2], items[2], 'unchanged rows keep their identity');
  assert.deepEqual(applyFollowup(null, 'issue_overdue', 7, {}), []);
});

test('shiftTotals moves one row between buckets without touching the rest', () => {
  const totals = normalizeEscalations(payload()).totals;
  const next = shiftTotals(totals, 'open', 'resolved');
  assert.equal(next.open, 1);
  assert.equal(next.resolved, 2);
  assert.equal(next.acknowledged, 1);
  assert.equal(next.all, 4, 'the row is still in the queue, only in another bucket');
  assert.deepEqual(next.bySource, totals.bySource);
  // Saving a note without changing the status must not move any count.
  assert.deepEqual(shiftTotals(totals, 'open', 'open'), totals);
  assert.deepEqual(shiftTotals(totals, 'open', 'junk'), totals);
  // A bucket never goes negative when the API's count was already behind.
  assert.equal(shiftTotals({ open: 0, resolved: 0 }, 'open', 'resolved').open, 0);
});

test('an escalation row links only to a page the viewer may open (Pusat Eskalasi)', async () => {
  const { allowedLink } = await import('../src/components/navigation.js');
  const { STANDARD_ROLES } = await import('../../backend/src/config/standardOrganization.js');
  const perms = (key) => STANDARD_ROLES.find((r) => r.key === key).permissions;
  const doLink = '/sales/orders?tab=do&periode=last_3_months&q=SO67%2FHRC-PFN%2FIX%2F2026';
  // The Management Office sees every division but has no Data Sales: plain title, not a link home.
  assert.equal(allowedLink(doLink, perms('management_office.head')), null);
  assert.equal(allowedLink(doLink, perms('sales.head')), doLink);
  assert.equal(allowedLink('/escalations', perms('management_office.head')), '/escalations');
});

test('context lines show ISO dates as Indonesian dates, never inside a document number', async () => {
  const { readableDates } = await import('../src/pages/advanced/escalationsModel.js');
  assert.equal(readableDates('SO-2026-09-0877 · 62.5% terkirim · janji kirim 2026-09-22'), 'SO-2026-09-0877 · 62.5% terkirim · janji kirim 22 Sep 2026');
  assert.equal(readableDates('Surat jalan DO-2026-09-1102 dikirim 2026-09-15'), 'Surat jalan DO-2026-09-1102 dikirim 15 Sep 2026');
  assert.equal(readableDates('Berakhir 2026-10-15, masih berstatus Berjalan'), 'Berakhir 15 Okt 2026, masih berstatus Berjalan');
  assert.equal(readableDates('Tanpa tanggal'), 'Tanpa tanggal');
});
