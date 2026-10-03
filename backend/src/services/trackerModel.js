// Pure helpers for the Project Tracker: validation, row → API shape mapping and
// the short texts posted to the Chat space. No I/O here (easy to unit test).

const CATEGORIES = ['todo', 'in_progress', 'done'];
const STATUS_FOR_CATEGORY = { todo: 'open', in_progress: 'in_progress', done: 'done' };
const ISSUE_TYPES = ['task', 'bug', 'story', 'epic', 'subtask'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const SPRINT_STATUSES = ['planned', 'active', 'completed'];
const SPACE_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const KEY_RE = /^[A-Z0-9]{2,10}$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const LIMITS = {
  title: 255,
  description: 20000,
  labels: 10,
  labelLength: 30,
  storyPointsMax: 100,
  comment: 5000,
  projectName: 190,
  columnName: 100,
  maxColumns: 12,
  wipMax: 999,
  sprintName: 100,
  sprintGoal: 1000,
  query: 100,
};

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
const invalid = (message) => httpError(400, 'VALIDATION_ERROR', message);
const notFound = (message) => httpError(404, 'NOT_FOUND', message);
const conflict = (code, message) => httpError(409, code, message);

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const lower = (value) => String(value || '').trim().toLowerCase();

function positiveInt(value, field) {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^[1-9]\d{0,9}$/.test(text)) throw invalid(`${field} tidak valid`);
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n > 4294967295) throw invalid(`${field} tidak valid`);
  return n;
}

function optionalPositiveInt(value, field) {
  if (value === null || value === undefined || value === '') return null;
  return positiveInt(value, field);
}

function spaceNameFromId(spaceId) {
  if (typeof spaceId !== 'string' || !SPACE_ID_RE.test(spaceId)) throw invalid('ID space tidak valid');
  return `spaces/${spaceId}`;
}

function spaceIdOf(spaceName) {
  return String(spaceName || '').split('/')[1] || null;
}

function enumValue(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.includes(value)) throw invalid(`${field} tidak valid`);
  return value;
}

function text(value, field, { min = 1, max, trim = true, allowNull = false } = {}) {
  if (value === null || value === undefined) {
    if (allowNull) return null;
    throw invalid(`${field} wajib diisi`);
  }
  if (typeof value !== 'string') throw invalid(`${field} tidak valid`);
  const out = trim ? value.trim() : value;
  if (out.length < min) {
    if (allowNull && out.length === 0) return null;
    throw invalid(min <= 1 ? `${field} wajib diisi` : `${field} minimal ${min} karakter`);
  }
  if (out.length > max) throw invalid(`${field} maksimal ${max} karakter`);
  return out;
}

function dateValue(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const match = DATE_RE.exec(typeof value === 'string' ? value : '');
  if (!match) throw invalid(`${field} harus berformat YYYY-MM-DD`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw invalid(`${field} tidak valid`);
  }
  return value;
}

function storyPointsValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\d{1,3}(\.\d)?$/.test(value) ? Number(value) : NaN);
  if (!Number.isFinite(n) || n < 0 || n > LIMITS.storyPointsMax) throw invalid('storyPoints harus 0–100');
  if (Math.abs(Math.round(n * 10) - n * 10) > 1e-9) throw invalid('storyPoints maksimal 1 angka desimal');
  return Math.round(n * 10) / 10;
}

function labelsValue(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw invalid('labels harus berupa daftar');
  if (value.length > LIMITS.labels) throw invalid(`labels maksimal ${LIMITS.labels}`);
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') throw invalid('label tidak valid');
    const label = item.trim();
    if (!label) continue;
    if (label.length > LIMITS.labelLength) throw invalid(`label maksimal ${LIMITS.labelLength} karakter`);
    if (/[\u0000-\u001f]/.test(label)) throw invalid('label tidak valid');
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

function emailValue(value, field = 'assigneeEmail') {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !EMAIL_RE.test(value.trim())) throw invalid(`${field} tidak valid`);
  return lower(value);
}

function keyValue(value) {
  if (typeof value !== 'string') throw invalid('key tidak valid');
  const key = value.trim().toUpperCase();
  if (!KEY_RE.test(key)) throw invalid('key harus 2–10 huruf/angka (A-Z, 0-9)');
  return key;
}

function booleanValue(value, field) {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  throw invalid(`${field} harus true/false`);
}

// "Sales Order Domestik" → "SOD"; "Marketing" → "MARK"; "" → "PRJ".
function autoKey(displayName) {
  const words = String(displayName || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  let key = '';
  if (words.length >= 2) key = words.slice(0, 4).map((w) => w[0]).join('');
  if (key.length < 2 && words[0]) key = words[0].slice(0, 4);
  if (key.length < 2) key = 'PRJ';
  return key.slice(0, 10);
}

// Instants come back as UNIX seconds (the DB session zone differs from UTC).
function iso(unixSeconds) {
  if (unixSeconds === null || unixSeconds === undefined) return null;
  const n = Number(unixSeconds);
  return Number.isFinite(n) ? new Date(n * 1000).toISOString() : null;
}

// DATE columns arrive as UTC-midnight Dates (mysql2 timezone 'Z') or strings.
function dateString(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  const match = /^\d{4}-\d{2}-\d{2}/.exec(String(value));
  return match ? match[0] : null;
}

function parseLabels(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string');
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

const num = (value) => (value === null || value === undefined ? null : Number(value));

function issueKey(projectKey, number) {
  return projectKey && number ? `${projectKey}-${number}` : null;
}

// memberNames: Map(email → display name) from the space member list, used for
// assignees without a Prakasa account.
function mapIssue(row, memberNames = new Map()) {
  const assigneeEmail = lower(row.assignee_email || row.assignee_user_email) || null;
  const hasAssignee = Boolean(assigneeEmail || row.assignee_id);
  return {
    id: Number(row.id),
    key: issueKey(row.project_key, row.issue_number),
    number: num(row.issue_number),
    title: row.title,
    description: row.description || '',
    type: row.issue_type || 'task',
    priority: row.priority || 'normal',
    columnId: num(row.column_id),
    status: row.category || 'todo',
    statusName: row.column_name || null,
    assignee: hasAssignee ? {
      email: assigneeEmail,
      name: row.assignee_name || (assigneeEmail && memberNames.get(assigneeEmail)) || assigneeEmail || 'Pengguna',
      userId: num(row.assignee_id),
    } : null,
    reporter: row.reporter_id ? { userId: Number(row.reporter_id), name: row.reporter_name || 'Pengguna' } : null,
    startDate: dateString(row.start_date),
    dueDate: dateString(row.due_date),
    storyPoints: num(row.story_points),
    labels: parseLabels(row.labels),
    sprintId: num(row.sprint_id),
    parentId: num(row.parent_id),
    parentKey: row.parent_number ? issueKey(row.project_key, row.parent_number) : null,
    childCount: Number(row.child_count || 0),
    commentCount: Number(row.comment_count || 0),
    position: Number(row.position || 0),
    createdAt: iso(row.created_ts),
    updatedAt: iso(row.updated_ts),
    completedAt: iso(row.completed_ts),
  };
}

function mapColumn(row) {
  return {
    id: Number(row.id),
    name: row.name,
    category: row.category || 'todo',
    position: Number(row.position || 0),
    wipLimit: num(row.wip_limit),
  };
}

function mapSprint(row) {
  return {
    id: Number(row.id),
    name: row.name,
    goal: row.goal || '',
    startDate: dateString(row.start_date),
    endDate: dateString(row.end_date),
    status: row.status,
    issueCount: Number(row.issue_count || 0),
    points: Number(row.points || 0),
    donePoints: Number(row.done_points || 0),
  };
}

function mapCounts(row = {}) {
  return {
    open: Number(row.open_count || 0),
    inProgress: Number(row.in_progress_count || 0),
    done: Number(row.done_count || 0),
    overdue: Number(row.overdue_count || 0),
  };
}

// Reorders ids so `movedId` sits at `index` (clamped). Pure; used by drag & drop.
function placeAt(ids, movedId, index) {
  const rest = ids.filter((id) => Number(id) !== Number(movedId));
  const at = index === null || index === undefined ? rest.length : Math.max(0, Math.min(Number(index), rest.length));
  rest.splice(at, 0, Number(movedId));
  return rest;
}

const shortTitle = (title) => {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  return t.length > 120 ? `${t.slice(0, 119)}…` : t;
};

// One short message per mutation; several changes in one PATCH become lines.
function spaceUpdateText({ key, title, changes = [] }) {
  const head = `${key} ${shortTitle(title)}`;
  const lines = [];
  for (const change of changes) {
    if (change.kind === 'created') {
      lines.push(`🆕 ${head}${change.assigneeName ? ` · ditugaskan ke ${change.assigneeName}` : ''}`);
    } else if (change.kind === 'assigned' && change.assigneeName) {
      lines.push(`👤 ${head} · ditugaskan ke ${change.assigneeName}`);
    } else if (change.kind === 'completed') {
      lines.push(`✅ ${head} · selesai`);
    } else if (change.kind === 'status') {
      lines.push(`🔄 ${head} · ${change.from || '-'} → ${change.to || '-'}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  CATEGORIES,
  STATUS_FOR_CATEGORY,
  ISSUE_TYPES,
  PRIORITIES,
  SPRINT_STATUSES,
  SPACE_ID_RE,
  KEY_RE,
  EMAIL_RE,
  LIMITS,
  httpError,
  invalid,
  notFound,
  conflict,
  has,
  lower,
  positiveInt,
  optionalPositiveInt,
  spaceNameFromId,
  spaceIdOf,
  enumValue,
  text,
  dateValue,
  storyPointsValue,
  labelsValue,
  emailValue,
  keyValue,
  booleanValue,
  autoKey,
  iso,
  dateString,
  parseLabels,
  issueKey,
  mapIssue,
  mapColumn,
  mapSprint,
  mapCounts,
  placeAt,
  spaceUpdateText,
};
