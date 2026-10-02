import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeSprintOf, addDaysIso, addLabel, applyIssuePatch, backlogSections, barPath, boardIssues,
  burndownGeometry, categoryStatus, computeMove, deriveProjectKey, groupByColumn, initials,
  isOverdue, issuePayload, issueQuery, issueRows, normalizeKeyInput, normalizePortfolio,
  parentOptions, readTrackerParams, sectionTotals, spaceIdFromName, sprintProgressPct,
  sprintTargets, validateIssueForm, validateProjectKey, enableProjectBody, velocityGeometry, wipState, writeTrackerParams,
  activityText, shareRows, formatWeekLabel, trendRows, donutGeometry, groupedBarGeometry,
  trendGeometry, issueComposition, workloadRows, EMPTY_ISSUE_FORM, apiPatch,
} from '../src/pages/projects/trackerModel.js';
import { statusTone } from '../src/components/statusTone.js';

const columns = [
  { id: 1, name: 'To Do', category: 'todo', position: 0 },
  { id: 2, name: 'In Progress', category: 'in_progress', position: 1, wipLimit: 2 },
  { id: 3, name: 'Done', category: 'done', position: 2 },
];
const project = {
  id: 9,
  columns,
  sprints: [
    { id: 10, name: 'Sprint 1', status: 'completed' },
    { id: 11, name: 'Sprint 2', status: 'active', points: 20, donePoints: 5 },
    { id: 12, name: 'Sprint 3', status: 'planned' },
  ],
};
const issue = (id, extra = {}) => ({ id, number: id, key: `P-${id}`, title: `I${id}`, type: 'task', columnId: 1, status: 'todo', position: id, sprintId: null, ...extra });

test('deriveProjectKey builds a valid key from a space name', () => {
  assert.equal(deriveProjectKey('Sales Ops Dept'), 'SOD');
  assert.equal(deriveProjectKey('warehouse'), 'WARE');
  assert.equal(deriveProjectKey('Tim Ékspor 2026'), 'TE2');
  assert.equal(validateProjectKey(deriveProjectKey('x')), '');
  assert.equal(validateProjectKey(deriveProjectKey('')), '');
  assert.equal(normalizeKeyInput('so-do 1'), 'SODO1');
  assert.ok(validateProjectKey('1AB'));
  assert.ok(validateProjectKey('A'));
});

test('enabling a tracker always sends the "Kirim update ke space" choice — unticked means nothing is posted to Google Chat', async () => {
  assert.deepEqual(enableProjectBody('SODO', true), { key: 'SODO', postUpdatesToSpace: true });
  assert.deepEqual(enableProjectBody('SODO', false), { key: 'SODO', postUpdatesToSpace: false });
  assert.deepEqual(enableProjectBody('SODO', undefined), { key: 'SODO', postUpdatesToSpace: false });
  // The page sends that body (it used to send `{ key }` only, and the server's default is "post").
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../src/pages/projects/ProjectTracker.jsx', import.meta.url), 'utf8');
  assert.match(page, /api\.post\(`\/tracker\/spaces\/\$\{spaceId\}\/project`, enableProjectBody\(key, postUpdates\)\)/);
  assert.match(page, /useState\(true\);\s*\n\s*useEffect\(\(\) => \{ setKey/, 'a new tracker starts with the box ticked, as the form shows');
});

test('URL params round-trip, whitelist values and prefix when embedded', () => {
  const next = writeTrackerParams(new URLSearchParams('space=abc'), { view: 'list', q: 'invoice', type: 'bug', issue: 5 }, true);
  assert.equal(next.get('space'), 'abc');
  assert.equal(next.get('trView'), 'list');
  const read = readTrackerParams(next, true);
  assert.equal(read.view, 'list');
  assert.equal(read.issue, 5);
  assert.deepEqual(read.filters, { q: 'invoice', assignee: '', type: 'bug', priority: '', label: '' });
  const bad = readTrackerParams(new URLSearchParams('view=hack&type=evil&priority=x&issue=1;drop'));
  assert.equal(bad.view, 'board');
  assert.equal(bad.filters.type, '');
  assert.equal(bad.filters.priority, '');
  assert.equal(bad.issue, null);
  assert.equal(writeTrackerParams(new URLSearchParams('view=list'), { view: 'board' }).has('view'), false);
  assert.deepEqual(issueQuery({ q: ' a ', assignee: 'me', type: '' }), { sprint: 'all', q: 'a', assignee: 'me' });
});

test('board shows the active sprint, or everything not parked in another sprint', () => {
  const issues = [issue(1, { sprintId: 11 }), issue(2), issue(3, { sprintId: 12 }), issue(4, { sprintId: 10 })];
  assert.deepEqual(boardIssues(issues, project).map((i) => i.id), [1]);
  const noActive = { ...project, sprints: project.sprints.filter((s) => s.status !== 'active') };
  assert.deepEqual(boardIssues(issues, noActive).map((i) => i.id), [1, 2]);
  assert.equal(activeSprintOf(project).id, 11);
  assert.equal(sprintProgressPct(activeSprintOf(project)), 25);
  assert.equal(sprintProgressPct({ progressPct: 140 }), 100);
});

test('groupByColumn orders by position and wipState flags the limit', () => {
  const groups = groupByColumn([issue(2, { columnId: 2, position: 5 }), issue(3, { columnId: 2, position: 1 }), issue(4, { columnId: 99 })], columns);
  assert.deepEqual(groups.get(2).map((i) => i.id), [3, 2]);
  assert.equal(groups.get(1).length, 0);
  assert.deepEqual(wipState(columns[1], 3), { limit: 2, over: true, label: '3/2' });
  assert.deepEqual(wipState(columns[0], 3), { limit: 0, over: false, label: '3' });
});

test('computeMove returns the drop index and new order', () => {
  const list = [issue(1), issue(2), issue(3)];
  assert.deepEqual(computeMove(list, 3, 1), { position: 0, order: [3, 1, 2] });
  assert.deepEqual(computeMove(list, 1, null), { position: 2, order: [2, 3, 1] });
  assert.deepEqual(computeMove(list, 9, 2), { position: 1, order: [1, 9, 2, 3] });
  const moved = applyIssuePatch(list, 2, { columnId: 3, position: 0 }, columns);
  assert.equal(moved[1].status, 'done');
  assert.equal(moved[1].statusName, 'Done');
});

test('backlog sections: active, planned, backlog; completed sprint issues hidden', () => {
  const issues = [issue(1, { sprintId: 11 }), issue(2), issue(3, { sprintId: 12 }), issue(4, { sprintId: 10 })];
  const sections = backlogSections(issues, project);
  assert.deepEqual(sections.map((s) => [s.kind, s.issues.map((i) => i.id)]), [['active', [1]], ['planned', [3]], ['backlog', [2]]]);
  assert.deepEqual(sprintTargets(project, 11).map((t) => t.sprintId), [12, null]);
  assert.deepEqual(sprintTargets(project, null).map((t) => t.sprintId), [11, 12]);
  assert.deepEqual(sectionTotals([issue(1, { storyPoints: 2.5 }), issue(2, { storyPoints: '3', status: 'done' })]), { count: 2, points: 5.5, done: 1, open: 1 });
});

test('issue form validation and payload', () => {
  assert.deepEqual(Object.keys(validateIssueForm({ title: ' ', storyPoints: '101' })), ['title', 'storyPoints']);
  assert.deepEqual(validateIssueForm({ title: 'Ok', storyPoints: '' }), {});
  assert.deepEqual(issuePayload({ title: ' Fix ', type: 'bug', priority: 'high', storyPoints: '3', sprintId: '11', parentId: '', labels: ['a'], assigneeEmail: '' }),
    { title: 'Fix', type: 'bug', priority: 'high', storyPoints: 3, sprintId: 11, labels: ['a'] });
  assert.deepEqual(addLabel(['a'], ' needs review '), ['a', 'needs-review']);
  assert.deepEqual(addLabel(['a'], 'a'), ['a']);
  assert.deepEqual(parentOptions([issue(1, { type: 'epic' }), issue(2, { type: 'subtask' }), issue(3)], 3).map((o) => o.value), ['1']);
});

test('dates, overdue, initials, rows', () => {
  const now = new Date(2026, 8, 28);
  assert.equal(isOverdue({ dueDate: '2026-09-27', status: 'todo' }, now), true);
  assert.equal(isOverdue({ dueDate: '2026-09-27T00:00:00.000Z', status: 'done' }, now), false);
  assert.equal(isOverdue({ dueDate: '2026-09-28', status: 'todo' }, now), false);
  assert.equal(addDaysIso('2026-09-28', 14), '2026-10-12');
  assert.equal(initials('Budi Santoso'), 'BS');
  assert.equal(initials('mwahyudi@prakasafoods.com'), 'MW');
  const [row] = issueRows([issue(1, { assignee: { name: 'Ani' }, priority: 'urgent' })]);
  assert.equal(row.assigneeName, 'Ani');
  assert.equal(row.prioritySort, 3);
  assert.equal(row.dueDateSort, '9999-12-31');
});

test('categories map onto shared status tones', () => {
  assert.equal(statusTone(categoryStatus('todo')), 'default');
  assert.equal(statusTone(categoryStatus('in_progress')), 'info');
  assert.equal(statusTone(categoryStatus('done')), 'success');
});

test('chart geometry stays inside the plot and scales to a nice max', () => {
  const g = burndownGeometry([
    { date: '2026-09-01', remainingPoints: 20, idealPoints: 20 },
    { date: '2026-09-02', remainingPoints: 14, idealPoints: 10 },
    { date: '2026-09-03', remainingPoints: null, idealPoints: 0 },
  ]);
  assert.equal(g.maxValue, 20);
  assert.match(g.actual, /^M36\.0,12\.0 L/);
  assert.equal(g.actual.split('L').length, 2, 'null days are skipped');
  const v = velocityGeometry([{ sprintId: 1, name: 'S1', completedPoints: 8 }, { sprintId: 2, name: 'S2', completedPoints: 0 }]);
  assert.equal(v.maxValue, 10);
  assert.ok(v.bars.every((b) => b.y >= v.pad.top && b.y + b.h <= v.baseline + 0.001));
  assert.equal(barPath(v.bars[1]), '');
  assert.match(barPath(v.bars[0]), /^M.*Z$/);
  assert.deepEqual(shareRows([{ n: 1 }, { n: 3 }], 'n').map((r) => r.pct), [25, 75]);
});

test('portfolio normalisation and misc', () => {
  const p = normalizePortfolio({ totals: { projects: 2 }, workload: [{ email: 'a', open: 1 }, { email: 'b', open: 4 }] });
  assert.equal(p.totals.overdue, 0);
  assert.deepEqual(p.workload.map((w) => w.email), ['b', 'a']);
  assert.equal(spaceIdFromName('spaces/AAAAbbbb12'), 'AAAAbbbb12');
  assert.equal(spaceIdFromName('spaces/../x'), '');
  assert.equal(activityText({ actor: { name: 'Ani' }, event: 'tracker.issue_moved', metadata: { to: 'Done' } }), 'Ani memindahkan ke Done');
  assert.equal(activityText({ actor: { name: 'Ani' }, event: 'tracker.status_changed', metadata: { to: 'done' } }), 'Ani mengubah status → Selesai');
  assert.equal(activityText({ actor: { name: 'Ani' }, event: 'tracker.issue_updated', metadata: { fields: ['priority', 'title'] } }), 'Ani memperbarui prioritas, judul');
});

test('portfolio defaults the division/trend/aging sections when the API omits them', () => {
  for (const payload of [null, {}, { byDivision: 'nope', trend: null, aging: 7, scope: 'entity' }]) {
    const p = normalizePortfolio(payload);
    assert.deepEqual(p.byDivision, []);
    assert.deepEqual(p.trend, []);
    assert.deepEqual(p.aging, []);
    // No scope from the API means nothing was filtered out — never claim a narrower view.
    assert.deepEqual(p.scope, { entityWide: true, departmentId: null, departmentName: null });
  }
});

test('portfolio keeps a well-formed division/trend/aging payload', () => {
  const p = normalizePortfolio({
    byDivision: [{ departmentId: 3, departmentName: 'Sales', projects: 2, open: 5, inProgress: 3, done: 9, overdue: 1 }],
    trend: [{ weekStart: '2026-09-14', created: 4, completed: 2 }, { weekStart: '2026-09-21', created: 6, completed: 7 }],
    aging: [{
      issueId: 12, issueKey: 'SAL-12', title: 'Kontrak', projectName: 'Sales', assigneeName: 'Ani',
      statusName: 'Sedang dikerjakan', category: 'in_progress', daysSinceUpdate: 21,
    }],
    scope: { entityWide: false, departmentId: 3, departmentName: 'Sales' },
  });
  assert.deepEqual(p.byDivision, [{ departmentId: 3, departmentName: 'Sales', projects: 2, open: 5, inProgress: 3, done: 9, overdue: 1 }]);
  assert.deepEqual(p.trend.map((w) => w.weekStart), ['2026-09-14', '2026-09-21']);
  assert.equal(p.trend[1].completed, 7);
  assert.equal(p.aging[0].category, 'in_progress');
  assert.equal(p.aging[0].daysSinceUpdate, 21);
  assert.deepEqual(p.scope, { entityWide: false, departmentId: 3, departmentName: 'Sales' });
});

test('portfolio drops or coerces malformed division/trend/aging entries', () => {
  const p = normalizePortfolio({
    byDivision: [null, 'x', { departmentId: 'abc', projects: '4', open: -2, overdue: 1.7 }],
    trend: [{ weekStart: 'kemarin', created: 3 }, { created: 1 }, { weekStart: '2026-09-21T00:00:00.000Z', created: '5', completed: null }],
    aging: [{ title: 'tanpa id' }, { issueId: 0 }, { issueId: '8', title: ' Spasi ', category: 'ngawur', daysSinceUpdate: 'x', assigneeName: '' }],
    scope: { entityWide: false, departmentId: 'x', departmentName: '  ' },
  });
  assert.equal(p.byDivision.length, 1);
  assert.deepEqual(p.byDivision[0], { departmentId: null, departmentName: 'Tanpa divisi', projects: 4, open: 0, inProgress: 0, done: 0, overdue: 1 });
  assert.deepEqual(p.trend, [{ weekStart: '2026-09-21', created: 5, completed: 0 }]);
  assert.equal(p.aging.length, 1);
  assert.deepEqual(p.aging[0], {
    issueId: 8, issueKey: '', title: 'Spasi', projectName: '', assigneeName: null,
    statusName: '', category: 'todo', daysSinceUpdate: 0,
  });
  assert.deepEqual(p.scope, { entityWide: false, departmentId: null, departmentName: null });
});

test('trend rows count weeks and label them as short dates', () => {
  const rows = trendRows([
    { weekStart: '2026-09-14', created: 4, completed: 8 },
    { weekStart: '2026-09-22T00:00:00.000Z', created: '2', completed: null },
  ]);
  assert.deepEqual(rows.map((r) => r.label), ['14 Sep', '22 Sep']);
  assert.deepEqual(rows.map((r) => r.created), [4, 2]);
  assert.deepEqual(rows.map((r) => r.completed), [8, 0]);
  assert.deepEqual(trendRows(null), []);
  assert.equal(formatWeekLabel('bukan tanggal'), '');
});

// Every geometry number ends up in an SVG attribute: one NaN and the chart
// disappears silently, so the sweep below is part of each chart's contract.
const numbers = (value) => {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(numbers);
  if (value && typeof value === 'object') return Object.values(value).flatMap(numbers);
  return [];
};
const allFinite = (geometry) => numbers(geometry).every((n) => Number.isFinite(n));

test('donut arcs share the ring in proportion and stay inside the viewBox', () => {
  const g = donutGeometry([
    { key: 'todo', value: 5 }, { key: 'in_progress', value: 3 }, { key: 'done', value: 2 },
  ], { size: 168, thickness: 22 });
  assert.equal(g.total, 10);
  assert.equal(g.empty, false);
  assert.deepEqual(g.arcs.map((a) => a.pct), [50, 30, 20]);
  assert.ok(allFinite(g));
  // Arcs run clockwise from 12 o'clock: each offset is the sum of the ones before.
  assert.ok(g.arcs[0].offset === 0 && g.arcs[1].offset > 0 && g.arcs[2].offset > g.arcs[1].offset);
  assert.ok(g.arcs.every((a, i) => a.dashOffset === -a.offset && a.length <= g.circumference && (i === 0 || a.offset <= g.circumference)));
  assert.ok(g.arcs.reduce((sum, a) => sum + a.length, 0) <= g.circumference + 0.1);
  // The stroke is centred on the radius, so the ring must not spill out of the box.
  assert.ok(g.cx - g.radius - g.thickness / 2 >= 0);
  assert.ok(g.cx + g.radius + g.thickness / 2 <= g.size);
});

test('donut survives empty, zero and single-slice input without NaN', () => {
  for (const empty of [donutGeometry(null), donutGeometry([]), donutGeometry([{ key: 'a', value: 0 }, { key: 'b', value: 'x' }])]) {
    assert.equal(empty.total, 0);
    assert.equal(empty.empty, true);
    assert.ok(allFinite(empty));
    assert.ok(empty.arcs.every((a) => a.length === 0 && a.pct === 0 && a.fraction === 0));
    assert.ok(empty.circumference > 0);
  }
  // A single slice gets no spacer: it must close the ring completely.
  const one = donutGeometry([{ key: 'todo', value: 7 }], { size: 120, thickness: 16 });
  assert.equal(one.arcs[0].pct, 100);
  assert.equal(one.arcs[0].length, one.circumference);
  assert.equal(one.arcs[0].dashOffset, 0);
  // A silly thickness is clamped instead of inverting the radius.
  const fat = donutGeometry([{ key: 'a', value: 1 }], { size: 100, thickness: 400 });
  assert.ok(fat.radius > 0 && fat.cx - fat.radius - fat.thickness / 2 >= 0);
});

const SERIES = [
  { key: 'open', label: 'Belum selesai', tone: 'todo' },
  { key: 'inProgress', label: 'Dikerjakan', tone: 'in-progress' },
  { key: 'done', label: 'Selesai', tone: 'done' },
];

test('grouped bars scale to a nice max and keep every bar inside the viewBox', () => {
  const rows = [
    { key: 1, label: 'Sales', open: 5, inProgress: 3, done: 9, overdue: 1 },
    { key: 2, label: 'Warehouse Operations', open: 2, inProgress: 0, done: 4, overdue: 0 },
  ];
  const g = groupedBarGeometry(rows, SERIES, { width: 520, height: 220 });
  assert.equal(g.maxValue, 10); // niceMax(9)
  assert.equal(g.groups.length, 2);
  assert.ok(allFinite(g));
  const innerH = g.height - g.pad.top - g.pad.bottom;
  const done = g.groups[0].bars[2];
  assert.equal(done.value, 9);
  assert.equal(done.h, Math.round((9 / 10) * innerH * 10) / 10);
  assert.equal(done.y, Math.round((g.baseline - done.h) * 10) / 10);
  // A zero value is a zero-height bar, never a negative one.
  assert.equal(g.groups[1].bars[1].h, 0);
  assert.equal(barPath(g.groups[1].bars[1]), '');
  for (const group of g.groups) {
    for (const b of group.bars) {
      assert.ok(b.x >= 0 && b.x + b.w <= g.width, `bar x ${b.x}+${b.w} outside ${g.width}`);
      assert.ok(b.y >= g.pad.top - 0.05 && b.y + b.h <= g.height, `bar y ${b.y}+${b.h} outside ${g.height}`);
    }
    assert.ok(group.hit.x >= 0 && group.hit.x + group.hit.w <= g.width);
  }
  // A wide chart prints division names in full.
  assert.equal(g.groups[1].short, 'Warehouse Operations');
  // A narrow one truncates them for the axis; the full name stays on the row.
  const narrow = groupedBarGeometry(rows, SERIES, { width: 300, height: 200 });
  assert.ok(narrow.groups[1].short.length < narrow.groups[1].label.length);
  assert.ok(narrow.groups[1].short.endsWith('…'));
  assert.equal(narrow.groups[0].short, 'Sales');
});

test('grouped bars handle empty, single and all-zero rows', () => {
  for (const empty of [groupedBarGeometry(null, SERIES), groupedBarGeometry([], SERIES), groupedBarGeometry([{ label: 'X' }], null)]) {
    assert.deepEqual(empty.groups.flatMap((g) => g.bars), []);
    assert.equal(empty.maxValue, 1);
    assert.ok(allFinite(empty));
  }
  const one = groupedBarGeometry([{ key: 'a', label: 'Sales', open: 4, inProgress: 1, done: 0 }], SERIES, { width: 400, height: 200 });
  assert.equal(one.groups.length, 1);
  assert.equal(one.maxValue, 5); // niceMax(4)
  assert.ok(one.groups[0].bars.every((b) => b.x >= one.pad.left && b.x + b.w <= one.width - one.pad.right));
  const zero = groupedBarGeometry([{ key: 'a', label: 'Sales', open: 0, inProgress: 0, done: 0 }], SERIES);
  assert.ok(allFinite(zero));
  assert.equal(zero.maxValue, 1);
  assert.ok(zero.groups[0].bars.every((b) => b.h === 0 && b.y === zero.baseline));
});

test('trend geometry draws two series with an area and stays inside the viewBox', () => {
  const weeks = [
    { weekStart: '2026-09-14', created: 4, completed: 2 },
    { weekStart: '2026-09-21', created: 6, completed: 2 },
    { weekStart: '2026-09-28', created: 1, completed: 9 },
  ];
  const g = trendGeometry(weeks, { width: 520, height: 220 });
  assert.equal(g.maxValue, 10); // niceMax(9)
  assert.equal(g.points.length, 3);
  assert.ok(allFinite(g));
  assert.deepEqual(g.points.map((p) => p.label), ['14 Sep', '21 Sep', '28 Sep']);
  // First point on the left edge of the plot, last on the right, in order.
  assert.equal(g.points[0].x, g.pad.left);
  assert.equal(g.points[2].x, g.width - g.pad.right);
  assert.ok(g.points[0].x < g.points[1].x && g.points[1].x < g.points[2].x);
  // Higher counts sit higher on the plot; the tallest is not above the top pad.
  assert.ok(g.points[1].yCreated < g.points[0].yCreated);
  assert.ok(g.points[2].yCompleted >= g.pad.top);
  for (const p of g.points) {
    for (const y of [p.yCreated, p.yCompleted]) {
      assert.ok(y >= g.pad.top - 0.05 && y <= g.baseline + 0.05, `y ${y} outside plot`);
    }
    assert.ok(p.x >= 0 && p.x <= g.width);
  }
  assert.ok(g.lines.created.startsWith('M') && g.lines.created.includes('L'));
  // Axis labels never collide, and the newest week always keeps its label.
  const narrow = trendGeometry([...weeks, ...weeks], { width: 300, height: 200 });
  assert.ok(narrow.labels.every((l, i) => i === 0 || l.x - narrow.labels[i - 1].x >= 48));
  assert.equal(narrow.labels[narrow.labels.length - 1].i, narrow.points.length - 1);
  // The area closes on the baseline under the line.
  assert.ok(g.areas.completed.endsWith('Z') && g.areas.completed.includes(`,${g.baseline}`));
  assert.ok(!/NaN|undefined/.test(g.lines.created + g.areas.created));
});

test('trend geometry handles no weeks, one week and an all-zero stretch', () => {
  const none = trendGeometry(null, { width: 400, height: 180 });
  assert.deepEqual(none.points, []);
  assert.equal(none.lines.created, '');
  assert.equal(none.areas.created, '');
  assert.equal(none.maxValue, 1);
  assert.ok(allFinite(none));
  // One week has no line: it is centred and the area stays empty.
  const one = trendGeometry([{ weekStart: '2026-09-28', created: 3, completed: 1 }], { width: 400, height: 180 });
  assert.equal(one.points.length, 1);
  assert.equal(one.points[0].x, one.pad.left + (one.width - one.pad.left - one.pad.right) / 2);
  assert.equal(one.areas.created, '');
  assert.ok(one.lines.created.startsWith('M') && !one.lines.created.includes('L'));
  // Every week at zero: both lines sit on the baseline, no division by zero.
  const flat = trendGeometry([{ weekStart: '2026-09-21', created: 0, completed: 0 }, { weekStart: '2026-09-28', created: 0, completed: 0 }]);
  assert.ok(allFinite(flat));
  assert.equal(flat.maxValue, 1);
  assert.ok(flat.points.every((p) => p.yCreated === flat.baseline && p.yCompleted === flat.baseline));
  assert.ok(!/NaN/.test(flat.areas.completed));
  // Weeks without a usable date still count, they just lose their axis label.
  assert.equal(trendGeometry([{ weekStart: 'kemarin', created: 2 }]).points[0].label, '');
});

test('issue composition never double-counts in-progress work', () => {
  // openIssues counts everything not done, in-progress included.
  const slices = issueComposition({ openIssues: 10, inProgress: 4, doneThisWeek: 3 });
  assert.equal(slices[2].label, 'Selesai');
  assert.deepEqual(slices.map((s) => s.value), [6, 4, 3]);
  assert.deepEqual(slices.map((s) => s.key), ['todo', 'in_progress', 'done']);
  // A backend that reports more in-progress than open must not go negative.
  assert.deepEqual(issueComposition({ openIssues: 2, inProgress: 5 }).map((s) => s.value), [0, 5, 0]);
  assert.deepEqual(issueComposition(null).map((s) => s.value), [0, 0, 0]);
  assert.equal(donutGeometry(issueComposition(null)).empty, true);
});

test('workload rows split overdue out of the open bar and scale to the busiest person', () => {
  const rows = workloadRows([
    { email: 'a@x.id', name: 'Ani', open: 10, overdue: 4 },
    { email: 'b@x.id', name: 'Budi', open: 5, overdue: 0 },
    { email: 'c@x.id', open: 0, overdue: 0 },
  ]);
  assert.deepEqual(rows.map((r) => r.onTime), [6, 5, 0]);
  assert.deepEqual(rows.map((r) => r.onTimePct), [60, 50, 0]);
  assert.deepEqual(rows.map((r) => r.overduePct), [40, 0, 0]);
  assert.equal(rows[2].name, 'c@x.id');
  assert.ok(rows.every((r) => r.onTimePct + r.overduePct <= 100));
  assert.deepEqual(workloadRows(null), []);
  assert.deepEqual(workloadRows([{ open: 0, overdue: 0 }]).map((r) => r.onTimePct), [0]);
  assert.equal(workloadRows([{ open: 1 }, { open: 2 }], 1).length, 1);
});

test('unwrap reads the {success,data} envelope and bare bodies', async () => {
  const { unwrap, apiPatch } = await import('../src/pages/projects/trackerModel.js');
  assert.deepEqual(unwrap({ data: { success: true, data: { projects: [] } } }), { projects: [] });
  assert.deepEqual(unwrap({ data: { projects: [1] } }), { projects: [1] });
  assert.deepEqual(apiPatch({ columnId: 2, position: 0, status: 'done', statusName: 'Done', assignee: {}, assigneeEmail: null }), { columnId: 2, position: 0, assigneeEmail: null });
});

test('assignee choices fall back to "me" when members are unavailable', async () => {
  const { assigneeChoices, isChatSpace } = await import('../src/pages/projects/trackerModel.js');
  const me = { email: 'me@x.id', name: 'Saya' };
  assert.deepEqual(assigneeChoices({ membersAvailable: true, members: [{ email: 'a@x.id', name: 'A' }] }, me).map((o) => o.value), ['a@x.id']);
  assert.deepEqual(assigneeChoices({ membersAvailable: false, members: [] }, me, { email: 'b@x.id', name: 'B' }).map((o) => o.value), ['me@x.id', 'b@x.id']);
  assert.equal(isChatSpace({ spaceType: 'DIRECT_MESSAGE' }), false);
  assert.equal(isChatSpace({ spaceType: 'SPACE' }), true);
});


// Regression: the ring has to keep adding up to the real issue count. Before,
// the done slice came from `doneThisWeek`, so anything finished earlier simply
// vanished from the chart.
test('issueComposition counts every issue once, using current state not this week', () => {
  const projects = [
    { open: 4, inProgress: 2, done: 9 },   // 9 done, only some of them this week
    { open: 3, inProgress: 1, done: 1 },
  ];
  const slices = issueComposition({ openIssues: 7, inProgress: 3, doneThisWeek: 2 }, projects);
  // open counts everything not done, so todo = open - inProgress = 7 - 3.
  assert.deepEqual(slices.map((s) => s.value), [4, 3, 10], 'todo / dikerjakan / selesai');
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  assert.equal(total, 17, 'every issue of both projects, counted exactly once');
  // Without projects it still degrades to the totals it is given.
  assert.deepEqual(issueComposition({ openIssues: 7, inProgress: 3, doneThisWeek: 2 }, []).map((s) => s.value), [4, 3, 2]);
  assert.deepEqual(issueComposition(null, null).map((s) => s.value), [0, 0, 0]);
});

test('the issue form carries a start date and keeps it before the due date', () => {
  assert.equal(EMPTY_ISSUE_FORM.startDate, '');
  const base = { ...EMPTY_ISSUE_FORM, title: 'Audit rak' };
  assert.deepEqual(validateIssueForm({ ...base, startDate: '2026-10-05', dueDate: '2026-10-20' }), {});
  assert.deepEqual(validateIssueForm({ ...base, startDate: '2026-10-05', dueDate: '2026-10-05' }), {}, 'one-day issue');
  assert.ok(validateIssueForm({ ...base, startDate: '2026-11-01', dueDate: '2026-10-01' }).startDate);
  assert.ok(validateIssueForm({ ...base, startDate: 'besok' }).startDate);
  assert.equal(issuePayload({ ...base, startDate: '2026-10-05' }).startDate, '2026-10-05');
  assert.equal('startDate' in issuePayload(base), false, 'an empty start date is not sent');
  assert.equal(apiPatch({ startDate: '2026-10-05', key: 'X-1' }).startDate, '2026-10-05', 'PATCH forwards it');
});
