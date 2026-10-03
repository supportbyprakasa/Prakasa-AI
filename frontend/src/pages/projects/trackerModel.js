// Pure helpers for the Project Tracker (no React, no DOM) — unit tested in
// test/trackerModel.test.js. API shapes: /private contract "tracker-contract.md".
import { EMPTY, formatDate as formatDay, formatDateTime as formatMoment } from '../../components/format.js';

export const VIEWS = [
  { value: 'board', label: 'Papan' },
  { value: 'backlog', label: 'Backlog' },
  { value: 'list', label: 'Daftar' },
  { value: 'reports', label: 'Laporan' },
];

export const ISSUE_TYPES = [
  { value: 'task', label: 'Task' },
  { value: 'bug', label: 'Bug' },
  { value: 'story', label: 'Story' },
  { value: 'epic', label: 'Epic' },
  { value: 'subtask', label: 'Sub-task' },
];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export const CATEGORIES = [
  { value: 'todo', label: 'Belum dikerjakan' },
  { value: 'in_progress', label: 'Dikerjakan' },
  { value: 'done', label: 'Selesai' },
];

// Category → status key understood by components/statusTone.js (tone never local).
const CATEGORY_STATUS = { todo: 'open', in_progress: 'in_progress', done: 'done' };
export function categoryStatus(category) { return CATEGORY_STATUS[category] || 'open'; }
export function categoryLabel(category) {
  return CATEGORIES.find((c) => c.value === category)?.label || 'Belum dikerjakan';
}
export function typeLabel(type) { return ISSUE_TYPES.find((t) => t.value === type)?.label || 'Task'; }

export const SPACE_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
export const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;

// "Sales Ops Dept" → "SOD"; single word → first 4 letters. Always 2-10 of A-Z0-9, starting with a letter.
export function deriveProjectKey(name) {
  const words = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let key = '';
  if (words.length >= 2) key = words.map((w) => w[0]).join('');
  else if (words.length === 1) key = words[0].slice(0, 4);
  key = key.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^[0-9]+/, '').slice(0, 10);
  if (key.length < 2) key = (key + 'PRJ').slice(0, Math.max(3, key.length));
  return key;
}

export function normalizeKeyInput(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

export function validateProjectKey(key) {
  if (!key) return 'Kunci project wajib diisi.';
  if (!KEY_RE.test(key)) return 'Gunakan 2–10 huruf/angka kapital, diawali huruf.';
  return '';
}

// What "Aktifkan project tracker" sends. The "Kirim update ke space" choice is
// always sent: the server's default for a missing value is "post to the space",
// so leaving it out would announce every change in Google Chat even when the
// box is unticked.
export function enableProjectBody(key, postUpdatesToSpace) {
  return { key, postUpdatesToSpace: postUpdatesToSpace === true };
}

// ---------------------------------------------------------------------------
// Filters ⇄ URL. Embedded (inside Chat) prefixes keys so they never collide with
// the host page's own query params.
export const FILTER_KEYS = ['q', 'assignee', 'type', 'priority', 'label'];
const PARAM_NAMES = ['view', 'issue', ...FILTER_KEYS];

export function paramKey(name, embedded = false) {
  return embedded ? `tr${name.charAt(0).toUpperCase()}${name.slice(1)}` : name;
}

export function readTrackerParams(searchParams, embedded = false) {
  const get = (name) => searchParams.get(paramKey(name, embedded)) || '';
  const view = VIEWS.some((v) => v.value === get('view')) ? get('view') : 'board';
  const issueRaw = get('issue');
  const issue = /^[1-9][0-9]{0,11}$/.test(issueRaw) ? Number(issueRaw) : null;
  const filters = {};
  for (const name of FILTER_KEYS) filters[name] = get(name).slice(0, 190);
  if (filters.type && !ISSUE_TYPES.some((t) => t.value === filters.type)) filters.type = '';
  if (filters.priority && !PRIORITIES.includes(filters.priority)) filters.priority = '';
  return { view, issue, filters };
}

// Returns a NEW URLSearchParams with only the tracker's own keys changed.
export function writeTrackerParams(searchParams, patch, embedded = false) {
  const next = new URLSearchParams(searchParams);
  for (const [name, value] of Object.entries(patch)) {
    if (!PARAM_NAMES.includes(name)) continue;
    const k = paramKey(name, embedded);
    const empty = value === null || value === undefined || value === '' || (name === 'view' && value === 'board');
    if (empty) next.delete(k);
    else next.set(k, String(value));
  }
  return next;
}

export function hasActiveFilters(filters) {
  return FILTER_KEYS.some((k) => Boolean(filters?.[k]));
}

export function issueQuery(filters, sprint = 'all') {
  const params = { sprint };
  for (const name of FILTER_KEYS) {
    const value = String(filters?.[name] || '').trim();
    if (value) params[name] = value;
  }
  return params;
}

// ---------------------------------------------------------------------------
// Sprints & scope

export function activeSprintOf(project) {
  if (project?.activeSprint !== undefined) return project.activeSprint;
  return (project?.sprints || []).find((s) => s.status === 'active') || null;
}

export function plannedSprints(project) {
  return (project?.sprints || []).filter((s) => s.status === 'planned');
}

export function sprintProgressPct(sprint) {
  if (!sprint) return 0;
  if (Number.isFinite(sprint.progressPct)) return clampPct(sprint.progressPct);
  const points = Number(sprint.points) || 0;
  if (points > 0) return clampPct((Number(sprint.donePoints) || 0) / points * 100);
  return 0;
}

export function clampPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Issues the board shows: the active sprint when there is one, otherwise every
// issue that isn't parked in a planned/completed sprint.
export function boardIssues(issues, project) {
  const active = activeSprintOf(project);
  if (active) return issues.filter((i) => i.sprintId === active.id);
  const parked = new Set((project?.sprints || []).filter((s) => s.status !== 'active').map((s) => s.id));
  return issues.filter((i) => !i.sprintId || !parked.has(i.sprintId));
}

export function groupByColumn(issues, columns) {
  const groups = new Map((columns || []).map((c) => [c.id, []]));
  for (const issue of issues) {
    if (!groups.has(issue.columnId)) continue;
    groups.get(issue.columnId).push(issue);
  }
  for (const list of groups.values()) list.sort(byPosition);
  return groups;
}

function byPosition(a, b) {
  return (a.position ?? 0) - (b.position ?? 0) || a.id - b.id;
}

export function sortedColumns(columns) {
  return [...(columns || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
}

export function wipState(column, count) {
  const limit = Number(column?.wipLimit) || 0;
  if (!limit) return { limit: 0, over: false, label: String(count) };
  return { limit, over: count > limit, label: `${count}/${limit}` };
}

// Backlog sections: active sprint, planned sprints, then the backlog itself.
export function backlogSections(issues, project) {
  const active = activeSprintOf(project);
  const planned = plannedSprints(project);
  const known = new Set([active?.id, ...planned.map((s) => s.id)].filter(Boolean));
  const sections = [];
  if (active) sections.push({ id: `sprint-${active.id}`, sprintId: active.id, sprint: active, title: active.name, kind: 'active', issues: [] });
  for (const s of planned) sections.push({ id: `sprint-${s.id}`, sprintId: s.id, sprint: s, title: s.name, kind: 'planned', issues: [] });
  const backlog = { id: 'backlog', sprintId: null, sprint: null, title: 'Backlog', kind: 'backlog', issues: [] };
  sections.push(backlog);
  const byId = new Map(sections.map((s) => [s.sprintId, s]));
  for (const issue of issues) {
    if (!issue.sprintId) backlog.issues.push(issue);
    else if (known.has(issue.sprintId)) byId.get(issue.sprintId).issues.push(issue);
    // issues of completed sprints stay out of the backlog view
  }
  for (const s of sections) s.issues.sort(byPosition);
  return sections;
}

export function sectionTotals(issues) {
  let points = 0;
  let done = 0;
  for (const i of issues) {
    points += Number(i.storyPoints) || 0;
    if (i.status === 'done') done += 1;
  }
  return { count: issues.length, points: Math.round(points * 10) / 10, done, open: issues.length - done };
}

// Where an issue may be moved (menu alternative to drag & drop).
export function sprintTargets(project, currentSprintId) {
  const targets = [];
  const active = activeSprintOf(project);
  if (active && active.id !== currentSprintId) targets.push({ sprintId: active.id, label: `Pindahkan ke ${active.name}` });
  for (const s of plannedSprints(project)) {
    if (s.id !== currentSprintId) targets.push({ sprintId: s.id, label: `Pindahkan ke ${s.name}` });
  }
  if (currentSprintId) targets.push({ sprintId: null, label: 'Pindahkan ke Backlog' });
  return targets;
}

// Board drop: new list for the column after moving `issueId` before `beforeId`
// (null = end). Returns { position, order } where position is the 0-based index.
export function computeMove(columnIssues, issueId, beforeId) {
  const without = columnIssues.filter((i) => i.id !== issueId);
  let index = beforeId == null ? without.length : without.findIndex((i) => i.id === beforeId);
  if (index < 0) index = without.length;
  const moving = columnIssues.find((i) => i.id === issueId) || { id: issueId };
  const order = [...without.slice(0, index), moving, ...without.slice(index)];
  return { position: index, order: order.map((i) => i.id) };
}

// Optimistic local update for a move/patch.
export function applyIssuePatch(issues, issueId, patch, columns) {
  return issues.map((issue) => {
    if (issue.id !== issueId) return issue;
    const next = { ...issue, ...patch };
    if (patch.columnId !== undefined) {
      const column = (columns || []).find((c) => c.id === patch.columnId);
      if (column) { next.status = column.category; next.statusName = column.name; }
    }
    return next;
  });
}

// ---------------------------------------------------------------------------
// Issues, people, dates

export function initials(nameOrEmail) {
  const text = String(nameOrEmail || '').replace(/@.*/, '').trim();
  if (!text) return '?';
  const parts = text.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
  return letters.toUpperCase();
}

export function todayIso(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDaysIso(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function dateOnly(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

export function isOverdue(issue, now = new Date()) {
  if (!issue?.dueDate || issue.status === 'done') return false;
  return dateOnly(issue.dueDate) < todayIso(now);
}

// Dates go through components/format.js ("30 Sep 2026"); an empty or unreadable
// value is '' here so callers can fall back with `||`.
export function formatDate(value) {
  const iso = dateOnly(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  return formatDay(iso);
}

export function formatDateTime(value) {
  if (!value) return '';
  const text = formatMoment(value);
  return text === EMPTY ? '' : text;
}

export function formatPoints(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '';
}

export function memberOptions(members) {
  return (members || []).map((m) => ({ value: m.email, label: m.name ? `${m.name}` : m.email }));
}

export function parentOptions(issues, selfId = null) {
  return (issues || [])
    .filter((i) => i.type !== 'subtask' && i.id !== selfId)
    .sort((a, b) => (a.type === 'epic' ? 0 : 1) - (b.type === 'epic' ? 0 : 1) || a.number - b.number)
    .map((i) => ({ value: String(i.id), label: `${i.key} · ${i.title}`.slice(0, 90) }));
}

export function normalizeLabel(value) {
  return String(value || '').trim().replace(/\s+/g, '-').slice(0, 30);
}

export function addLabel(labels, value) {
  const label = normalizeLabel(value);
  const list = Array.isArray(labels) ? labels : [];
  if (!label || list.includes(label) || list.length >= 10) return list;
  return [...list, label];
}

export function allLabels(issues) {
  const set = new Set();
  for (const i of issues || []) for (const l of i.labels || []) set.add(l);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export const EMPTY_ISSUE_FORM = {
  title: '', type: 'task', description: '', priority: 'normal', assigneeEmail: '',
  startDate: '', dueDate: '', storyPoints: '', labels: [], sprintId: '', parentId: '', columnId: '',
};

export function validateIssueForm(form) {
  const errors = {};
  const title = String(form.title || '').trim();
  if (!title) errors.title = 'Judul wajib diisi.';
  else if (title.length > 255) errors.title = 'Maksimal 255 karakter.';
  if (String(form.description || '').length > 20000) errors.description = 'Deskripsi terlalu panjang (maks. 20.000 karakter).';
  if (form.storyPoints !== '' && form.storyPoints !== null && form.storyPoints !== undefined) {
    const n = Number(form.storyPoints);
    if (!Number.isFinite(n) || n < 0 || n > 100) errors.storyPoints = 'Isi 0–100.';
  }
  if (form.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.startDate)) errors.startDate = 'Tanggal tidak valid.';
  if (form.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.dueDate)) errors.dueDate = 'Tanggal tidak valid.';
  // Same rule as the API, caught before the round trip.
  if (!errors.startDate && !errors.dueDate && form.startDate && form.dueDate && form.startDate > form.dueDate) {
    errors.startDate = 'Tanggal mulai harus sebelum atau sama dengan jatuh tempo.';
  }
  if ((form.labels || []).length > 10) errors.labels = 'Maksimal 10 label.';
  return errors;
}

export function issuePayload(form) {
  const payload = { title: String(form.title || '').trim(), type: form.type || 'task', priority: form.priority || 'normal' };
  const description = String(form.description || '').trim();
  if (description) payload.description = description;
  if (form.assigneeEmail) payload.assigneeEmail = form.assigneeEmail;
  if (form.startDate) payload.startDate = form.startDate;
  if (form.dueDate) payload.dueDate = form.dueDate;
  if (form.storyPoints !== '' && form.storyPoints != null) payload.storyPoints = Number(form.storyPoints);
  if (form.labels?.length) payload.labels = form.labels;
  if (form.sprintId) payload.sprintId = Number(form.sprintId);
  if (form.parentId) payload.parentId = Number(form.parentId);
  if (form.columnId) payload.columnId = Number(form.columnId);
  return payload;
}

// Grid rows for the "Daftar" view (sortable scalar values alongside the issue).
const PRIORITY_RANK = { low: 0, normal: 1, high: 2, urgent: 3 };
export function priorityRank(priority) { return PRIORITY_RANK[priority] ?? 1; }

export function issueRows(issues) {
  return (issues || []).map((i) => ({
    ...i,
    assigneeName: i.assignee?.name || i.assignee?.email || '',
    typeName: typeLabel(i.type),
    dueDateSort: dateOnly(i.dueDate) || '9999-12-31',
    pointsSort: Number(i.storyPoints) || 0,
    prioritySort: priorityRank(i.priority),
  }));
}

export function issueLink(origin, spaceId, issueId) {
  return `${origin}/projects/${encodeURIComponent(spaceId)}?issue=${issueId}`;
}

export function apiErrorMessage(error, fallback = 'Terjadi kesalahan.') {
  return error?.response?.data?.error?.message || error?.response?.data?.message || fallback;
}

// ---------------------------------------------------------------------------
// Activity wording

const EVENT_LABELS = {
  issue_created: 'membuat issue',
  created: 'membuat issue',
  issue_updated: 'memperbarui',
  updated: 'memperbarui issue',
  issue_moved: 'memindahkan ke',
  issue_reordered: 'mengubah urutan',
  status_changed: 'mengubah status',
  assigned: 'menugaskan ke',
  reassigned: 'mengalihkan tugas ke',
  unassigned: 'melepas penanggung jawab',
  comment_added: 'menambahkan komentar',
  completed: 'menyelesaikan issue',
  reopened: 'membuka kembali issue',
  sprint_changed: 'memindahkan sprint',
  ticket_sync_failed: 'memindahkan issue, tetapi Tiket IT tidak ikut berubah',
};
const FIELD_LABELS = {
  title: 'judul', description: 'deskripsi', type: 'tipe', priority: 'prioritas', startDate: 'tanggal mulai',
  start_date: 'tanggal mulai', dueDate: 'jatuh tempo',
  due_date: 'jatuh tempo', storyPoints: 'story points', story_points: 'story points', labels: 'label',
  parentId: 'induk', parent_id: 'induk',
};

// The pieces of an activity line: [{ text, data? }]. `data` marks what users
// typed or named (the actor, a board column, an assignee) — never translated;
// the other pieces are interface text the language switch translates one by one.
export function activityParts(entry) {
  const actor = typeof entry?.actor === 'object' ? (entry.actor?.name || entry.actor?.email) : entry?.actor;
  const event = String(entry?.event || '').replace(/^tracker\./, '');
  const meta = entry?.metadata || {};
  const label = EVENT_LABELS[event] || event.replace(/[._]/g, ' ') || 'aktivitas';
  const who = actor ? { text: String(actor), data: true } : { text: 'Seseorang' };
  let detail = [];
  if (event === 'issue_updated' && Array.isArray(meta.fields)) {
    const fields = meta.fields.map((f) => FIELD_LABELS[f] || f).join(', ');
    detail = fields ? [{ text: fields }] : [];
  } else if (event === 'status_changed') detail = meta.to ? [{ text: '→' }, { text: categoryLabel(meta.to) }] : [];
  else if (event === 'issue_moved' || event === 'assigned' || event === 'reassigned') detail = meta.to ? [{ text: String(meta.to), data: true }] : [];
  else if (event === 'ticket_sync_failed' && meta.ticketId) detail = [{ text: `(Tiket IT #${Number(meta.ticketId)})` }];
  if (event === 'issue_updated' && !detail.length) return [who, { text: 'memperbarui issue' }];
  return [who, { text: label }, ...detail];
}

// What the board says after a move of an issue linked to an IT ticket: the
// ticket follows only when the server says it did.
export function ticketSyncMessage(sync) {
  if (!sync || !sync.ticketId) return null;
  if (sync.synced) return { tone: 'success', text: `Tiket IT #${sync.ticketId} ikut diperbarui.` };
  return { tone: 'warning', text: `Issue dipindahkan, tetapi Tiket IT #${sync.ticketId} tidak ikut berubah. Periksa halaman tiket.` };
}

export function activityText(entry) {
  return activityParts(entry).map((part) => part.text).join(' ');
}

// ---------------------------------------------------------------------------
// Charts (inline SVG geometry)

export function niceMax(value) {
  const v = Math.max(1, Number(value) || 0);
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export function burndownGeometry(days, { width = 560, height = 220, pad = { top: 12, right: 12, bottom: 28, left: 36 } } = {}) {
  const list = Array.isArray(days) ? days : [];
  const maxValue = niceMax(Math.max(0, ...list.map((d) => Math.max(Number(d.remainingPoints) || 0, Number(d.idealPoints) || 0))));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (i) => pad.left + (list.length <= 1 ? innerW / 2 : (i / (list.length - 1)) * innerW);
  const y = (v) => pad.top + innerH - (Math.max(0, Number(v) || 0) / maxValue) * innerH;
  const path = (key) => list
    .map((d, i) => (d[key] === null || d[key] === undefined ? null : `${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`))
    .filter(Boolean)
    .map((p, i) => `${i ? 'L' : 'M'}${p}`)
    .join(' ');
  const ticks = [0, 0.5, 1].map((f) => ({ value: Math.round(maxValue * f * 10) / 10, y: y(maxValue * f) }));
  const step = Math.max(1, Math.ceil(list.length / 6));
  const labels = list.map((d, i) => ({ i, x: x(i), text: String(d.date || '').slice(5) })).filter((l) => l.i % step === 0 || l.i === list.length - 1);
  const points = list.map((d, i) => ({ ...d, x: x(i), y: y(d.remainingPoints) }));
  return { width, height, pad, maxValue, actual: path('remainingPoints'), ideal: path('idealPoints'), ticks, labels, points, baseline: pad.top + innerH };
}

export function velocityGeometry(rows, { width = 560, height = 200, pad = { top: 12, right: 12, bottom: 28, left: 36 } } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const maxValue = niceMax(Math.max(0, ...list.map((r) => Number(r.completedPoints) || 0)));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = list.length ? innerW / list.length : innerW;
  const barW = Math.max(8, Math.min(48, slot * 0.6));
  const bars = list.map((r, i) => {
    const value = Number(r.completedPoints) || 0;
    const h = (value / maxValue) * innerH;
    return { ...r, value, x: pad.left + slot * i + (slot - barW) / 2, y: pad.top + innerH - h, w: barW, h, cx: pad.left + slot * i + slot / 2 };
  });
  const ticks = [0, 0.5, 1].map((f) => ({ value: Math.round(maxValue * f * 10) / 10, y: pad.top + innerH - f * innerH }));
  return { width, height, pad, maxValue, bars, ticks, baseline: pad.top + innerH };
}

// Rounded-top bar path (4px data-end, square at the baseline).
export function barPath({ x, y, w, h }, radius = 4) {
  if (h <= 0) return '';
  const r = Math.min(radius, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

export function shareRows(rows, valueKey) {
  const total = (rows || []).reduce((s, r) => s + (Number(r[valueKey]) || 0), 0);
  return (rows || []).map((r) => ({ ...r, pct: total ? clampPct((Number(r[valueKey]) || 0) / total * 100) : 0, total }));
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const r1 = (n) => Math.round(n * 10) / 10;

// Donut as dash-offset arcs on one circle: `arcs[i].dash` goes straight into
// stroke-dasharray and `dashOffset` into stroke-dashoffset, with the group rotated
// -90° so the first slice starts at 12 o'clock. A zero total yields zero-length
// arcs (empty=true) instead of NaN, so the ring still renders.
export function donutGeometry(slices, { size = 168, thickness = 22, gap = 2 } = {}) {
  const box = Math.max(24, num(size) || 24);
  const stroke = Math.max(4, Math.min(num(thickness) || 4, box / 3));
  const radius = Math.max(1, (box - stroke) / 2);
  const circumference = 2 * Math.PI * radius;
  const list = (Array.isArray(slices) ? slices : []).map((s) => ({ ...s, value: Math.floor(num(s?.value)) }));
  const total = list.reduce((sum, s) => sum + s.value, 0);
  const drawn = list.filter((s) => s.value > 0).length;
  // The gap between slices is a spacer, never so wide that a thin slice vanishes.
  const spacer = drawn > 1 ? Math.max(0, Math.min(num(gap), circumference / (drawn * 6))) : 0;
  let offset = 0;
  const arcs = list.map((s) => {
    const fraction = total ? s.value / total : 0;
    const span = fraction * circumference;
    const length = s.value > 0 ? Math.max(1, span - spacer) : 0;
    const arc = {
      ...s,
      fraction,
      pct: clampPct(fraction * 100),
      offset: r1(offset),
      length: r1(length),
      dash: `${r1(length)} ${r1(Math.max(0, circumference - length))}`,
      dashOffset: r1(-offset) || 0, // never "-0" in the attribute
    };
    offset += span;
    return arc;
  });
  return {
    size: box, thickness: stroke, radius: r1(radius), cx: box / 2, cy: box / 2,
    circumference: r1(circumference), total, arcs, empty: total === 0,
  };
}

// One group per row, one bar per series — grouped, not stacked: the series are
// separate measures, so nothing is summed. `barPath` draws each bar.
export function groupedBarGeometry(rows, series, {
  width = 560, height = 220, pad = { top: 12, right: 12, bottom: 32, left: 36 }, gap = 2,
} = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const keys = (Array.isArray(series) ? series : []).filter((s) => s && s.key);
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = Math.max(1, height - pad.top - pad.bottom);
  const values = [];
  for (const row of list) for (const s of keys) values.push(num(row?.[s.key]));
  const maxValue = niceMax(Math.max(0, ...values));
  const slot = list.length ? innerW / list.length : innerW;
  const columns = Math.max(1, keys.length);
  const spacer = Math.max(0, num(gap));
  const barW = Math.max(1, Math.min(28, (Math.max(1, slot * 0.78 - spacer * (columns - 1))) / columns));
  const groupW = barW * columns + spacer * (columns - 1);
  const chars = Math.max(4, Math.floor(slot / 7));
  const groups = list.map((row, i) => {
    const left = pad.left + slot * i + (slot - groupW) / 2;
    const label = String(row?.label ?? '');
    return {
      ...row,
      key: row?.key ?? i,
      label,
      short: label.length > chars ? `${label.slice(0, Math.max(1, chars - 1))}…` : label,
      x: r1(left), w: r1(groupW), cx: r1(left + groupW / 2),
      hit: { x: r1(pad.left + slot * i), w: r1(slot) },
      bars: keys.map((s, j) => {
        const value = Math.floor(num(row?.[s.key]));
        const h = (value / maxValue) * innerH;
        return {
          key: s.key, label: s.label, tone: s.tone || 'default', value,
          x: r1(left + j * (barW + spacer)), w: r1(barW), h: r1(h), y: r1(pad.top + innerH - h),
        };
      }),
    };
  });
  const ticks = [0, 0.5, 1].map((f) => ({ value: Math.round(maxValue * f * 10) / 10, y: r1(pad.top + innerH - f * innerH) }));
  return { width, height, pad, maxValue, slot: r1(slot), barW: r1(barW), groups, ticks, baseline: pad.top + innerH };
}

// ---------------------------------------------------------------------------
// Management dashboard

// A view without a division filter is the widest one, so an absent scope must read
// as entity-wide: never tell the user their view is narrowed when the API didn't say so.
export const EMPTY_SCOPE = { entityWide: true, departmentId: null, departmentName: null };
export const NO_DIVISION_LABEL = 'Tanpa divisi';
// Untouched this long and the issue is reported as stalled.
export const AGING_ALERT_DAYS = 14;

export const EMPTY_PORTFOLIO = {
  totals: { projects: 0, openIssues: 0, inProgress: 0, doneThisWeek: 0, overdue: 0 },
  projects: [], workload: [], recent: [], byDivision: [], trend: [], aging: [], scope: EMPTY_SCOPE,
};

const count = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const idOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};
const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');
const isRow = (row) => Boolean(row) && typeof row === 'object' && !Array.isArray(row);

function normalizeDivisions(rows) {
  return (Array.isArray(rows) ? rows : []).filter(isRow).map((row) => ({
    departmentId: idOrNull(row.departmentId),
    departmentName: text(row.departmentName) || NO_DIVISION_LABEL,
    projects: count(row.projects),
    open: count(row.open),
    inProgress: count(row.inProgress),
    done: count(row.done),
    overdue: count(row.overdue),
  }));
}

// A week without a usable weekStart can't be placed on the axis, so it is dropped.
function normalizeTrend(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => isRow(row) && /^\d{4}-\d{2}-\d{2}$/.test(dateOnly(row.weekStart)))
    .map((row) => ({ weekStart: dateOnly(row.weekStart), created: count(row.created), completed: count(row.completed) }));
}

function normalizeAging(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => isRow(row) && idOrNull(row.issueId) !== null)
    .map((row) => ({
      issueId: idOrNull(row.issueId),
      issueKey: text(row.issueKey),
      title: text(row.title),
      projectName: text(row.projectName),
      assigneeName: text(row.assigneeName) || null,
      statusName: text(row.statusName),
      category: CATEGORIES.some((c) => c.value === row.category) ? row.category : 'todo',
      daysSinceUpdate: count(row.daysSinceUpdate),
    }));
}

function normalizeScope(scope) {
  if (!isRow(scope)) return { ...EMPTY_SCOPE };
  return {
    entityWide: scope.entityWide !== false,
    departmentId: idOrNull(scope.departmentId),
    departmentName: text(scope.departmentName) || null,
  };
}

export function normalizePortfolio(data) {
  const d = data || {};
  return {
    totals: { ...EMPTY_PORTFOLIO.totals, ...(d.totals || {}) },
    projects: Array.isArray(d.projects) ? d.projects : [],
    workload: Array.isArray(d.workload) ? [...d.workload].sort((a, b) => (b.open || 0) - (a.open || 0)) : [],
    recent: Array.isArray(d.recent) ? d.recent : [],
    byDivision: normalizeDivisions(d.byDivision),
    trend: normalizeTrend(d.trend),
    aging: normalizeAging(d.aging),
    scope: normalizeScope(d.scope),
  };
}

// "2026-09-22" → "22 Sep". Short enough for a bar axis on a phone; the full week
// stays in the chart's text alternative.
export function formatWeekLabel(value) {
  return formatDate(value).replace(/ \d{4}$/, '');
}

// Weekly rows both trend variants read: the line/area chart and, via
// groupedBarGeometry, the bar variant.
export function trendRows(trend) {
  return (Array.isArray(trend) ? trend : []).map((w) => ({
    key: dateOnly(w?.weekStart) || String(w?.weekStart || ''),
    weekStart: dateOnly(w?.weekStart),
    label: formatWeekLabel(w?.weekStart),
    created: count(w?.created),
    completed: count(w?.completed),
  }));
}

// Two series (created / completed) as a line plus a soft area down to the
// baseline. One week has no line to draw, so the areas stay empty and the
// component shows the two dots instead.
export function trendGeometry(weeks, {
  width = 560, height = 220, pad = { top: 12, right: 12, bottom: 28, left: 36 },
} = {}) {
  const list = trendRows(weeks);
  const maxValue = niceMax(Math.max(0, ...list.flatMap((w) => [w.created, w.completed])));
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = Math.max(1, height - pad.top - pad.bottom);
  const baseline = pad.top + innerH;
  const at = (i) => pad.left + (list.length <= 1 ? innerW / 2 : (i / (list.length - 1)) * innerW);
  const y = (v) => baseline - (v / maxValue) * innerH;
  const points = list.map((w, i) => ({ ...w, i, x: r1(at(i)), yCreated: r1(y(w.created)), yCompleted: r1(y(w.completed)) }));
  const line = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p[key]}`).join(' ');
  const area = (key) => (points.length < 2
    ? ''
    : `${line(key)} L${points[points.length - 1].x},${baseline} L${points[0].x},${baseline} Z`);
  // Every nth week, then thinned again so two dates can never touch on a narrow
  // plot. The newest week always keeps its label — it is the one being read.
  const step = Math.max(1, Math.ceil(points.length / 6));
  const labels = [];
  for (const p of points.filter((x) => x.i % step === 0 || x.i === points.length - 1)) {
    const previous = labels[labels.length - 1];
    if (previous && p.x - previous.x < 48) {
      if (p.i !== points.length - 1) continue;
      labels.pop();
    }
    labels.push({ i: p.i, x: p.x, text: p.label });
  }
  const ticks = [0, 0.5, 1].map((f) => ({ value: Math.round(maxValue * f * 10) / 10, y: r1(baseline - f * innerH) }));
  return {
    width, height, pad, maxValue, points, labels, ticks, baseline,
    lines: { created: line('yCreated'), completed: line('yCompleted') },
    areas: { created: area('yCreated'), completed: area('yCompleted') },
  };
}

// Donut slices for "Komposisi issue". `openIssues` counts everything not done —
// in-progress included — so the waiting slice subtracts it, otherwise the same
// issue would be drawn twice in a part-of-whole chart.
export function issueComposition(totals, projects) {
  const t = totals || {};
  const list = Array.isArray(projects) ? projects : [];
  // Every issue must land in exactly one slice, so all three numbers have to
  // describe the same moment. `totals.openIssues` already contains the
  // in-progress ones (the API counts "not done"), and `totals.doneThisWeek` is
  // a time window, not the done pile — mixing them makes the ring stop adding
  // up to the issue count as soon as anything was finished before this week.
  // The per-project counts are all current state, so prefer summing those.
  const sum = (key) => list.reduce((total, p) => total + count(p?.[key]), 0);
  const open = list.length ? sum('open') : count(t.openIssues);
  const inProgress = list.length ? sum('inProgress') : count(t.inProgress);
  const done = list.length ? sum('done') : count(t.doneThisWeek);
  return [
    { key: 'todo', label: 'Belum dikerjakan', tone: 'todo', value: Math.max(0, open - inProgress) },
    { key: 'in_progress', label: 'Dikerjakan', tone: 'in-progress', value: inProgress },
    { key: 'done', label: 'Selesai', tone: 'done', value: done },
  ];
}

// Horizontal workload bars: each row is open work, with the overdue part as its
// own segment. Rows are scaled against the busiest person so the bars compare.
export function workloadRows(rows, limit = 12) {
  const list = (Array.isArray(rows) ? rows : []).slice(0, Math.max(0, limit)).map((w) => {
    const open = count(w?.open);
    const overdue = count(w?.overdue);
    const total = Math.max(open, overdue);
    return {
      key: text(w?.email) || text(w?.name) || 'none',
      name: text(w?.name) || text(w?.email) || 'Belum ditugaskan',
      open, overdue, onTime: Math.max(0, total - overdue), total,
    };
  });
  const max = Math.max(1, ...list.map((w) => w.total));
  return list.map((w) => ({
    ...w,
    onTimePct: clampPct((w.onTime / max) * 100),
    overduePct: clampPct((w.overdue / max) * 100),
  }));
}

export function spaceIdFromName(spaceName) {
  const id = String(spaceName || '').replace(/^spaces\//, '');
  return SPACE_ID_RE.test(id) ? id : '';
}

// Tiny trailing debounce usable outside React.
export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  wrapped.cancel = () => { clearTimeout(timer); timer = null; };
  return wrapped;
}

// Only the fields PATCH /issues/:id accepts (local display fields are dropped).
const PATCHABLE = ['title', 'description', 'type', 'priority', 'columnId', 'position', 'sprintId', 'parentId', 'assigneeEmail', 'startDate', 'dueDate', 'storyPoints', 'labels'];
export function apiPatch(patch) {
  const body = {};
  for (const key of PATCHABLE) if (patch[key] !== undefined) body[key] = patch[key];
  return body;
}

// API responses come wrapped as { success, data: {...} }; tolerate a bare body too.
export function unwrap(response) {
  const body = response?.data;
  return body && typeof body === 'object' && 'data' in body && body.success !== undefined ? (body.data || {}) : (body || {});
}

// Who can be picked as assignee. When the backend couldn't load the space's member
// list (membersAvailable=false) only "me" (and the current assignee) are offered.
export function assigneeChoices(project, me, current = null) {
  if (project?.membersAvailable !== false) return memberOptions(project?.members);
  const options = [];
  if (me?.email) options.push({ value: me.email, label: me.name || me.email, suffix: '(saya)' });
  if (current?.email && current.email !== me?.email) options.push({ value: current.email, label: current.name || current.email });
  return options;
}

export function isChatSpace(space) {
  return !space?.spaceType || space.spaceType === 'SPACE';
}
