import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VIEW, DEFAULT_ZOOM, defaultRange, divisionLabel, divisionSummary, groupByDivision,
  initialView, isIsoDate, NO_DIVISION_KEY, NO_DIVISION_LABEL, normalizeRange, normalizeRoadmap,
  readRoadmapParams, readStoredView, roadmapQuery, taskTarget, toGanttTasks, VIEW_STORAGE_KEY,
  writeRoadmapParams, writeStoredView, ZOOMS,
} from '../src/pages/advanced/roadmapModel.js';

const NOW = new Date('2026-09-28T03:00:00.000Z');

const project = (extra = {}) => ({
  id: 'project:4',
  kind: 'project',
  parentId: null,
  title: 'Revamp Gudang',
  startDate: '2026-09-01',
  dueDate: '2026-11-30',
  status: 'in_progress',
  progressPercent: 40,
  departmentId: 3,
  departmentName: 'Warehouse',
  projectKey: 'WRH',
  spaceId: 'spaces-abc123',
  open: 4,
  inProgress: 2,
  done: 6,
  overdue: 1,
  isFallbackStart: false,
  isFallbackDue: false,
  ...extra,
});

const sprint = (extra = {}) => project({
  id: 'sprint:7',
  kind: 'sprint',
  parentId: 'project:4',
  title: 'Sprint 1',
  startDate: '2026-09-01',
  dueDate: '2026-09-14',
  progressPercent: 80,
  overdue: 1,
  ...extra,
});

const payload = (extra = {}) => ({
  scope: { entityWide: true, departmentId: null, departmentName: null },
  range: { from: '2026-08-01', to: '2026-12-31' },
  items: [project()],
  links: [],
  ...extra,
});

const items = (rows) => normalizeRoadmap(payload({ items: rows }), NOW).items;

/* ---------------------------------------------------------------- dates */

test('only a real YYYY-MM-DD date is accepted', () => {
  assert.equal(isIsoDate('2026-02-28'), true);
  for (const value of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '2026-01-01T00:00:00Z', '', null, 20260101]) {
    assert.equal(isIsoDate(value), false, String(value));
  }
});

test('the default window runs from last month to the end of the third month ahead', () => {
  assert.deepEqual(defaultRange(NOW), { from: '2026-08-01', to: '2026-12-31' });
  // Crossing the year boundary in both directions.
  assert.deepEqual(defaultRange(new Date('2026-01-15T00:00:00Z')), { from: '2025-12-01', to: '2026-04-30' });
  assert.deepEqual(defaultRange(new Date('2026-12-15T00:00:00Z')), { from: '2026-11-01', to: '2027-03-31' });
  // A clock that isn't one still yields a window.
  assert.equal(isIsoDate(defaultRange('nonsense').from), true);
});

test('a window the chart could not draw falls back to the default one', () => {
  assert.deepEqual(normalizeRange({ from: '2026-01-01', to: '2026-03-31' }, NOW), { from: '2026-01-01', to: '2026-03-31' });
  assert.deepEqual(normalizeRange({ from: '2026-03-31', to: '2026-01-01' }, NOW), defaultRange(NOW));
  assert.deepEqual(normalizeRange({ from: '2026-01-01' }, NOW), defaultRange(NOW));
  assert.deepEqual(normalizeRange(null, NOW), defaultRange(NOW));
});

/* ----------------------------------------------------------- normalising */

test('an absent payload still yields the full shape, entity-wide and empty', () => {
  const data = normalizeRoadmap(null, NOW);
  assert.deepEqual(data.scope, { entityWide: true, departmentId: null, departmentName: null });
  assert.deepEqual(data.range, defaultRange(NOW));
  assert.deepEqual(data.items, []);
  assert.deepEqual(data.links, []);
});

test('scope only reads as narrowed when the API says so', () => {
  const narrowed = normalizeRoadmap(payload({ scope: { entityWide: false, departmentId: '3', departmentName: ' Warehouse ' } }), NOW);
  assert.deepEqual(narrowed.scope, { entityWide: false, departmentId: 3, departmentName: 'Warehouse' });
  assert.equal(normalizeRoadmap(payload({ scope: { departmentId: 3 } }), NOW).scope.entityWide, true);
});

test('a row the chart could not place is dropped, not drawn at day zero', () => {
  const rows = [
    project(),
    project({ id: '', title: 'tanpa id' }),
    project({ id: 'project:5', kind: 'epic' }),
    project({ id: 'project:6', startDate: null }),
    project({ id: 'project:7', dueDate: '31-12-2026' }),
    null,
    'nonsense',
  ];
  assert.deepEqual(items(rows).map((item) => item.id), ['project:4']);
});

test('a duplicate id is kept once — it is the chart row key', () => {
  const rows = [project(), project({ title: 'Salinan' })];
  const list = items(rows);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Revamp Gudang');
});

test('fields are defaulted, enums validated and progress clamped', () => {
  const [row] = items([project({
    title: '   ',
    status: 'archived',
    progressPercent: 140,
    departmentId: 0,
    departmentName: '',
    projectKey: '',
    open: -2,
    overdue: '3',
    isFallbackStart: 'yes',
    isFallbackDue: true,
  })]);
  assert.equal(row.title, 'Tanpa judul');
  assert.equal(row.status, 'open');
  assert.equal(row.progressPercent, 100);
  assert.equal(row.departmentId, null);
  assert.equal(row.departmentName, null);
  assert.equal(row.projectKey, null);
  assert.equal(row.open, 0);
  assert.equal(row.overdue, 3);
  // Only a real boolean marks a date as inferred — otherwise every row would
  // claim its dates were estimated.
  assert.equal(row.isFallbackStart, false);
  assert.equal(row.isFallbackDue, true);
  assert.equal(items([project({ progressPercent: -5 })])[0].progressPercent, 0);
  assert.equal(items([project({ progressPercent: 'x' })])[0].progressPercent, 0);
});

test('a bar that would end before it starts becomes a single day', () => {
  const [row] = items([project({ startDate: '2026-11-30', dueDate: '2026-09-01' })]);
  assert.equal(row.startDate, '2026-11-30');
  assert.equal(row.dueDate, '2026-11-30');
});

test('spaceId is only kept when it is a usable route segment', () => {
  assert.equal(items([project({ spaceId: 'spaces-abc123' })])[0].spaceId, 'spaces-abc123');
  for (const bad of ['../admin', 'ab', '', null, 'has space']) {
    assert.equal(items([project({ spaceId: bad })])[0].spaceId, null, String(bad));
  }
});

test('a dependency is dropped unless both of its rows are on the timeline', () => {
  const data = normalizeRoadmap(payload({
    items: [project(), sprint()],
    links: [
      { id: 'l1', fromTaskId: 'project:4', toTaskId: 'sprint:7', type: 'blocks' },
      { id: 'l2', fromTaskId: 'project:4', toTaskId: 'sprint:99' },
      { id: '', fromTaskId: 'project:4', toTaskId: 'sprint:7' },
    ],
  }), NOW);
  assert.deepEqual(data.links, [{ id: 'l1', fromTaskId: 'project:4', toTaskId: 'sprint:7', type: 'blocks' }]);
  assert.equal(normalizeRoadmap(payload({ links: 'nope' }), NOW).links.length, 0);
});

/* -------------------------------------------------------------- grouping */

test('divisions are ordered by name, with the unassigned bucket last', () => {
  const rows = items([
    project({ id: 'project:1', title: 'A', departmentId: 9, departmentName: 'sales' }),
    project({ id: 'project:2', title: 'B', departmentId: null, departmentName: null }),
    project({ id: 'project:3', title: 'C', departmentId: 3, departmentName: 'Finance' }),
  ]);
  const groups = groupByDivision(rows);
  assert.deepEqual(groups.map((group) => divisionLabel(group)), ['Finance', 'sales', NO_DIVISION_LABEL]);
  assert.equal(groups[2].key, NO_DIVISION_KEY);
  assert.equal(groups[2].hasDivision, false);
  // A division with no name still gets a heading a reader can act on.
  const unnamed = groupByDivision(items([project({ departmentName: '' })]));
  assert.equal(divisionLabel(unnamed[0]), 'Divisi #3');
});

test('each project is immediately followed by its own sprints', () => {
  const rows = items([
    sprint({ id: 'sprint:2', title: 'Sprint 2', startDate: '2026-09-15', dueDate: '2026-09-28' }),
    project({ id: 'project:9', title: 'Audit Stok' }),
    sprint({ id: 'sprint:1', title: 'Sprint 1', startDate: '2026-09-01', dueDate: '2026-09-14' }),
    sprint({ id: 'sprint:9', title: 'Sprint Audit', parentId: 'project:9' }),
    project(),
  ]);
  const [group] = groupByDivision(rows);
  assert.deepEqual(group.items.map((item) => item.id), ['project:9', 'sprint:9', 'project:4', 'sprint:1', 'sprint:2']);
});

test('a sprint whose project is missing still shows, at the end of its division', () => {
  const rows = items([
    sprint({ id: 'sprint:5', parentId: 'project:404', title: 'Sprint yatim' }),
    project(),
    sprint(),
  ]);
  const [group] = groupByDivision(rows);
  assert.deepEqual(group.items.map((item) => item.id), ['project:4', 'sprint:7', 'sprint:5']);
});

test('a division heading counts its rows and never double-counts what slipped', () => {
  // The sprint's single overdue issue is one of its project's — summing both
  // would report two late items where there is one.
  const [group] = groupByDivision(items([project(), sprint()]));
  assert.equal(group.projects, 1);
  assert.equal(group.sprints, 1);
  assert.equal(group.overdue, 1);
  assert.equal(divisionSummary(group), '1 program · 1 sprint · 1 terlambat');
  const [clean] = groupByDivision(items([project({ overdue: 0 })]));
  assert.equal(divisionSummary(clean), '1 program');
});

test('grouping survives junk input', () => {
  assert.deepEqual(groupByDivision(null), []);
  assert.deepEqual(groupByDivision([null, undefined]), []);
});

/* ------------------------------------------------------------ gantt shape */

test('rows become exactly the task shape the gantt components read', () => {
  const [task, sprintTask] = toGanttTasks(items([project(), sprint()]));
  assert.deepEqual(task, {
    id: 'project:4',
    title: 'Revamp Gudang',
    startDate: '2026-09-01',
    dueDate: '2026-11-30',
    status: 'in_progress',
    progressPercent: 40,
    assigneeName: null,
    isCancelled: false,
    isFallbackStart: false,
    isFallbackDue: false,
  });
  // A sprint reads as part of the project above it in the flat list.
  assert.equal(sprintTask.title, '↳ Sprint 1');
  assert.deepEqual(toGanttTasks(null), []);
});

test('an inferred date stays flagged all the way to the bar', () => {
  const [task] = toGanttTasks(items([project({ isFallbackStart: true, isFallbackDue: true })]));
  assert.equal(task.isFallbackStart, true);
  assert.equal(task.isFallbackDue, true);
});

test('a row opens its project, a sprint opens the project that owns it', () => {
  const rows = items([project(), sprint(), project({ id: 'project:8', spaceId: null, departmentId: 3 })]);
  assert.equal(taskTarget(rows, 'project:4'), '/projects/spaces-abc123');
  assert.equal(taskTarget(rows, 'sprint:7'), '/projects/spaces-abc123');
  // Nothing to open: no Chat Space, or a row that isn't there.
  assert.equal(taskTarget(rows, 'project:8'), null);
  assert.equal(taskTarget(rows, 'project:404'), null);
  assert.equal(taskTarget(null, 'project:4'), null);
});

test('an orphan sprint falls back to its own space', () => {
  const rows = items([sprint({ parentId: 'project:404' })]);
  assert.equal(taskTarget(rows, 'sprint:7'), '/projects/spaces-abc123');
});

/* ------------------------------------------------------------ params ⇄ URL */

const read = (query) => readRoadmapParams(new URLSearchParams(query));

test('the window is only read from the URL when it is complete and ordered', () => {
  assert.deepEqual(read('from=2026-01-01&to=2026-03-31&zoom=month'), { from: '2026-01-01', to: '2026-03-31', zoom: 'month' });
  assert.deepEqual(read('from=2026-01-01'), { from: '', to: '', zoom: DEFAULT_ZOOM });
  assert.deepEqual(read('from=2026-03-31&to=2026-01-01'), { from: '', to: '', zoom: DEFAULT_ZOOM });
  assert.deepEqual(read('from=kemarin&to=besok'), { from: '', to: '', zoom: DEFAULT_ZOOM });
  assert.deepEqual(read(''), { from: '', to: '', zoom: DEFAULT_ZOOM });
  assert.deepEqual(read('zoom=year'), { from: '', to: '', zoom: DEFAULT_ZOOM });
  assert.deepEqual(readRoadmapParams(null), { from: '', to: '', zoom: DEFAULT_ZOOM });
  for (const zoom of ZOOMS) assert.equal(read(`zoom=${zoom}`).zoom, zoom);
});

test('writing a param keeps foreign params and drops what is implied', () => {
  const current = new URLSearchParams('tab=detail&zoom=month&from=2026-01-01&to=2026-03-31');
  const next = writeRoadmapParams(current, { zoom: DEFAULT_ZOOM });
  assert.equal(next.get('tab'), 'detail');
  assert.equal(next.has('zoom'), false, 'the default zoom is not worth a query param');
  assert.equal(next.get('from'), '2026-01-01');
  // An unusable date never reaches the URL, and an unknown key is ignored.
  const cleared = writeRoadmapParams(current, { from: '', to: 'besok', status: 'open' });
  assert.equal(cleared.has('from'), false);
  assert.equal(cleared.has('to'), false);
  assert.equal(cleared.has('status'), false);
  assert.equal(writeRoadmapParams(current, null).get('zoom'), 'month');
});

test('the query only asks for a window it can defend — the server picks otherwise', () => {
  assert.deepEqual(roadmapQuery({ from: '2026-01-01', to: '2026-03-31' }), { from: '2026-01-01', to: '2026-03-31' });
  assert.deepEqual(roadmapQuery({ from: '2026-03-31', to: '2026-01-01' }), {});
  assert.deepEqual(roadmapQuery({ from: '2026-01-01' }), {});
  assert.deepEqual(roadmapQuery(), {});
});

/* ------------------------------------------------------- view preference */

test('the remembered view survives a storage that is empty, junk or throwing', () => {
  const store = new Map();
  const ok = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(readStoredView(ok), '');
  assert.equal(writeStoredView(ok, 'list'), true);
  assert.equal(store.get(VIEW_STORAGE_KEY), 'list');
  assert.equal(readStoredView(ok), 'list');
  assert.equal(writeStoredView(ok, 'kanban'), false, 'an unknown view is never stored');

  store.set(VIEW_STORAGE_KEY, 'kanban');
  assert.equal(readStoredView(ok), '');

  // Private mode: touching localStorage throws, and the page must still render.
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readStoredView(throwing), '');
  assert.equal(writeStoredView(throwing, 'list'), false);
  assert.equal(readStoredView(null), '');
  assert.equal(writeStoredView(null, 'list'), true);
});

test('a phone opens the list, unless this device already chose otherwise', () => {
  assert.equal(initialView({ stored: '', isPhone: false }), DEFAULT_VIEW);
  assert.equal(initialView({ stored: '', isPhone: true }), 'list');
  assert.equal(initialView({ stored: 'timeline', isPhone: true }), 'timeline');
  assert.equal(initialView({ stored: 'list', isPhone: false }), 'list');
  assert.equal(initialView(), DEFAULT_VIEW);
});
