// Pure helpers for Peta Program (no React, no DOM) — unit tested in
// test/roadmapModel.test.js. API: GET /management-dashboard/roadmap.
//
// The page draws its bars with the shared components in components/gantt/, so
// this module's job is to turn one loosely-typed payload into exactly what those
// components accept: rows that are safe to place on a timeline (both dates
// present and ordered), grouped so a reader can tell which division a bar
// belongs to. A row the chart could not place is dropped rather than drawn at
// day zero, where it would read as a real project starting on the range's first day.

import { SPACE_ID_RE } from '../projects/trackerModel.js';

export const KINDS = ['project', 'sprint'];

// The three the API promises. They are also three of the statuses gantt.css
// already colours (.gantt-status--*), so no status mapping is needed here.
export const STATUSES = ['open', 'in_progress', 'done'];

// Zoom keys come from DAY_PX / TICK_EVERY in components/gantt/GanttChart.jsx.
export const ZOOMS = ['week', 'month'];
export const DEFAULT_ZOOM = 'week';

export const VIEWS = ['timeline', 'list'];
export const DEFAULT_VIEW = 'timeline';
export const VIEW_STORAGE_KEY = 'prakasa.roadmap.view';

export const NO_DIVISION_KEY = 'none';
export const NO_DIVISION_LABEL = 'Tanpa divisi';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const isRow = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');
const count = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const idOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

// A date the chart can place: the component does its own Date math on this exact
// shape, so anything else (timestamp, empty, '2026-13-99') is treated as missing.
export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const isoOrNull = (value) => (isIsoDate(value) ? value : null);

// ---------------------------------------------------------------------------
// Default window

function isoUtc(year, month, day) {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

// Management reads this page to see what is running *now* and what is coming:
// one month back (so slipped work is still visible) and the current quarter plus
// one month ahead. Whole months keep the axis ticks on recognisable dates.
export function defaultRange(now = new Date()) {
  const base = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  return { from: isoUtc(year, month - 1, 1), to: isoUtc(year, month + 4, 0) };
}

export function normalizeRange(range, now = new Date()) {
  const source = isRow(range) ? range : {};
  const from = isoOrNull(source.from);
  const to = isoOrNull(source.to);
  if (!from || !to || from > to) return defaultRange(now);
  return { from, to };
}

// ---------------------------------------------------------------------------
// Normalising

export const EMPTY_SCOPE = { entityWide: true, departmentId: null, departmentName: null };

// An absent scope must read as the widest view: never tell the user their view is
// narrowed to one division when the API didn't say so.
function normalizeScope(scope) {
  if (!isRow(scope)) return { ...EMPTY_SCOPE };
  return {
    entityWide: scope.entityWide !== false,
    departmentId: idOrNull(scope.departmentId),
    departmentName: text(scope.departmentName) || null,
  };
}

// spaceId becomes a URL (/projects/:spaceId), so it is validated against the same
// shape the tracker accepts instead of being pasted into a route as-is.
function spaceIdOrNull(value) {
  const id = text(value);
  return SPACE_ID_RE.test(id) ? id : null;
}

function normalizeItem(row) {
  if (!isRow(row)) return null;
  const id = text(row.id);
  const startDate = isoOrNull(row.startDate);
  const dueDate = isoOrNull(row.dueDate);
  if (!id || !KINDS.includes(row.kind) || !startDate || !dueDate) return null;
  return {
    id,
    kind: row.kind,
    parentId: text(row.parentId) || null,
    title: text(row.title) || 'Tanpa judul',
    startDate,
    // A bar that ends before it starts cannot be drawn; a single-day bar is the
    // honest reading of "we only know one of the two dates".
    dueDate: dueDate < startDate ? startDate : dueDate,
    status: STATUSES.includes(row.status) ? row.status : 'open',
    progressPercent: Math.max(0, Math.min(100, Math.round(Number(row.progressPercent)) || 0)),
    departmentId: idOrNull(row.departmentId),
    departmentName: text(row.departmentName) || null,
    projectKey: text(row.projectKey) || null,
    spaceId: spaceIdOrNull(row.spaceId),
    open: count(row.open),
    inProgress: count(row.inProgress),
    done: count(row.done),
    overdue: count(row.overdue),
    isFallbackStart: row.isFallbackStart === true,
    isFallbackDue: row.isFallbackDue === true,
  };
}

const LINK_TYPES = ['blocks', 'related'];

// Dependencies are always empty for now, but the chart draws whatever it is
// given: a link pointing at a row that was dropped would render as an arrow into
// nothing, so both endpoints must still be on the timeline.
function normalizeLink(row, ids) {
  if (!isRow(row)) return null;
  const id = text(row.id);
  const fromTaskId = text(row.fromTaskId);
  const toTaskId = text(row.toTaskId);
  if (!id || !ids.has(fromTaskId) || !ids.has(toTaskId)) return null;
  return { id, fromTaskId, toTaskId, type: LINK_TYPES.includes(row.type) ? row.type : 'related' };
}

export function normalizeRoadmap(payload, now = new Date()) {
  const data = isRow(payload) ? payload : {};
  const items = [];
  const seen = new Set();
  for (const row of Array.isArray(data.items) ? data.items : []) {
    const item = normalizeItem(row);
    // Ids are the chart's row keys; a duplicate would make React and the
    // geometry map disagree about which row a bar belongs to.
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  const links = (Array.isArray(data.links) ? data.links : [])
    .map((row) => normalizeLink(row, seen))
    .filter(Boolean);
  return { scope: normalizeScope(data.scope), range: normalizeRange(data.range, now), items, links };
}

// ---------------------------------------------------------------------------
// Grouping

const byName = (a, b) => a.localeCompare(b, 'id', { sensitivity: 'base' });

// Within a division: projects by name, each immediately followed by its own
// sprints (earliest first), so a project and its sprints never drift apart.
function sortGroupItems(items) {
  const projects = items.filter((item) => item.kind === 'project')
    .sort((a, b) => byName(a.title, b.title) || a.id.localeCompare(b.id));
  const sprints = items.filter((item) => item.kind === 'sprint')
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || byName(a.title, b.title) || a.id.localeCompare(b.id));

  const taken = new Set();
  const ordered = [];
  for (const project of projects) {
    ordered.push(project);
    for (const sprint of sprints) {
      if (sprint.parentId !== project.id) continue;
      taken.add(sprint.id);
      ordered.push(sprint);
    }
  }
  // A sprint whose project is missing (or sits in another division) still belongs
  // to this division's plan — it goes last rather than disappearing.
  for (const sprint of sprints) if (!taken.has(sprint.id)) ordered.push(sprint);
  return ordered;
}

/**
 * [{ key, departmentId, departmentName, hasDivision, items, projects, sprints, overdue }]
 * ordered by division name, with the "no division" bucket last.
 */
export function groupByDivision(items) {
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue;
    const key = item.departmentId === null || item.departmentId === undefined
      ? NO_DIVISION_KEY
      : `dept:${item.departmentId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        departmentId: key === NO_DIVISION_KEY ? null : item.departmentId,
        departmentName: key === NO_DIVISION_KEY ? null : (item.departmentName || `Divisi #${item.departmentId}`),
        hasDivision: key !== NO_DIVISION_KEY,
        items: [],
      });
    }
    groups.get(key).items.push(item);
  }

  return [...groups.values()]
    .sort((a, b) => {
      if (a.hasDivision !== b.hasDivision) return a.hasDivision ? -1 : 1;
      return byName(a.departmentName || '', b.departmentName || '');
    })
    .map((group) => {
      const ordered = sortGroupItems(group.items);
      const projects = ordered.filter((item) => item.kind === 'project');
      return {
        ...group,
        items: ordered,
        projects: projects.length,
        sprints: ordered.length - projects.length,
        // Sprint rows count the same issues their project does, so only projects
        // are summed — otherwise the heading would double-count what slipped.
        overdue: projects.reduce((total, item) => total + item.overdue, 0),
      };
    });
}

export function divisionLabel(group) {
  return group?.hasDivision ? (group.departmentName || NO_DIVISION_LABEL) : NO_DIVISION_LABEL;
}

// "5 program · 3 sprint · 2 terlambat" — the counts a division heading carries.
export function divisionSummary(group) {
  const parts = [`${group?.projects || 0} program`];
  if (group?.sprints) parts.push(`${group.sprints} sprint`);
  if (group?.overdue) parts.push(`${group.overdue} terlambat`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Gantt shape

/**
 * Roadmap rows → the task shape GanttChart/GanttListView accept. Sprint titles
 * are marked so a sprint reads as part of the project above it in the flat list
 * the components render.
 */
export function toGanttTasks(items) {
  return (Array.isArray(items) ? items : []).filter(Boolean).map((item) => ({
    id: item.id,
    title: item.kind === 'sprint' ? `↳ ${item.title}` : item.title,
    startDate: item.startDate,
    dueDate: item.dueDate,
    status: item.status,
    progressPercent: item.progressPercent,
    // Roadmap rows are whole projects and sprints — nobody is "the assignee" of
    // one, so the components' assignee slot stays empty.
    assigneeName: null,
    isCancelled: false,
    isFallbackStart: item.isFallbackStart,
    isFallbackDue: item.isFallbackDue,
  }));
}

// Where a row click goes. A sprint has no page of its own, so it opens the
// project that owns it; a row whose project has no Chat Space is not navigable.
export function taskTarget(items, id) {
  const list = Array.isArray(items) ? items : [];
  const item = list.find((entry) => entry?.id === id);
  if (!item) return null;
  const owner = item.kind === 'sprint' && item.parentId
    ? (list.find((entry) => entry?.id === item.parentId) || item)
    : item;
  return owner.spaceId ? `/projects/${owner.spaceId}` : null;
}

// ---------------------------------------------------------------------------
// Params ⇄ URL. The window and the zoom live in the query string so a view can
// be shared ("this quarter, per month"); the view toggle does not, because it is
// a per-device reading preference, not part of what the link is about.

const PARAM_NAMES = ['from', 'to', 'zoom'];

export function readRoadmapParams(searchParams) {
  const get = (name) => searchParams?.get?.(name) || '';
  const from = isoOrNull(get('from'));
  const to = isoOrNull(get('to'));
  return {
    // Half a window, or a backwards one, is not a window: fall back to the
    // server's choice rather than requesting something nonsensical.
    from: from && to && from <= to ? from : '',
    to: from && to && from <= to ? to : '',
    zoom: ZOOMS.includes(get('zoom')) ? get('zoom') : DEFAULT_ZOOM,
  };
}

// Returns a NEW URLSearchParams with only this page's keys changed, so a param
// another feature put on the URL survives a zoom click.
export function writeRoadmapParams(searchParams, patch) {
  const next = new URLSearchParams(searchParams);
  for (const [name, value] of Object.entries(patch || {})) {
    if (!PARAM_NAMES.includes(name)) continue;
    const empty = value === null || value === undefined || value === ''
      || (name === 'zoom' && value === DEFAULT_ZOOM)
      || (name !== 'zoom' && !isIsoDate(value));
    if (empty) next.delete(name);
    else next.set(name, String(value));
  }
  return next;
}

// Both params are optional — the server picks the window when they are absent.
export function roadmapQuery({ from, to } = {}) {
  const query = {};
  if (isIsoDate(from) && isIsoDate(to) && from <= to) {
    query.from = from;
    query.to = to;
  }
  return query;
}

// ---------------------------------------------------------------------------
// View preference. localStorage throws in private mode and is empty in tests,
// so every access is guarded and the page still renders without it.

export function readStoredView(storage) {
  try {
    const value = storage?.getItem?.(VIEW_STORAGE_KEY);
    return VIEWS.includes(value) ? value : '';
  } catch {
    return '';
  }
}

export function writeStoredView(storage, view) {
  if (!VIEWS.includes(view)) return false;
  try {
    storage?.setItem?.(VIEW_STORAGE_KEY, view);
    return true;
  } catch {
    return false;
  }
}

// A Gantt is unreadable on a phone, so a first visit there opens the list — but a
// choice the user made on that device always wins over the guess.
export function initialView({ stored, isPhone } = {}) {
  if (VIEWS.includes(stored)) return stored;
  return isPhone ? 'list' : DEFAULT_VIEW;
}
