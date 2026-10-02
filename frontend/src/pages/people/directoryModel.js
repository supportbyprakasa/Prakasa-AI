// Direktori (People & Culture wave 1, row 1.1): labels, list filters, the
// person form ↔ API body, and the org chart forest. Pure: the pages and the
// tests import it. Contract: API §2 (docs/rancangan-people-culture-g1.md
// Part 1, rules 5–11).
import { formatDate, formatNumber, toDate } from '../../components/format.js';

export const PERSON_KIND_LABELS = {
  employee: 'Karyawan',
  group_staff: 'Staf grup (entitas lain)',
  excluded: 'Dikecualikan',
};
export const PERSON_STATUS_LABELS = { active: 'Aktif', resigned: 'Resign' };
export const RESIGN_SOURCE_LABELS = {
  entered: 'Diisi People & Culture',
  import: 'Tanggal resign tidak ada di file',
  account: 'Akun aplikasi dinonaktifkan',
};
export const ACCOUNT_STATUS_LABELS = { active: 'Aktif', inactive: 'Nonaktif', deleted: 'Dihapus' };

// Personal mail domains the server always refuses (rule 9); checked here too
// so the mistake shows on the field before the request.
export const PERSONAL_EMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.id', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'ymail.com',
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+0-9(][0-9()\-\s./]*(\s*(ext\.?|x)\s*\d{1,6})?$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------ list

// Status chips (People & Culture only; everyone else sees active people).
export const STATUS_FILTERS = [
  { key: 'active', label: 'Aktif', params: { status: 'active' } },
  { key: 'resigned', label: 'Resign', params: { status: 'resigned' } },
  { key: 'excluded', label: 'Dikecualikan', params: { status: 'all', kind: 'excluded' } },
];
export const ACCOUNT_FILTERS = [
  { value: '', label: 'Semua' },
  { value: 'yes', label: 'Punya akun' },
  { value: 'no', label: 'Tanpa akun' },
];

// Query params of GET /people/directory for the page's filters. Viewers never
// send the manage-only filters (the server ignores them anyway).
export function directoryQuery({ status = 'active', q, departmentId, locationId, account, unreviewed, page = 1, limit = 50 }, manage) {
  const params = { page, limit };
  if (q && String(q).trim()) params.q = String(q).trim();
  if (departmentId) params.departmentId = String(departmentId);
  if (locationId) params.locationId = String(locationId);
  if (account === 'yes' || account === 'no') params.hasAccount = account;
  if (manage) {
    if (unreviewed) params.reviewed = 'no';
    else Object.assign(params, (STATUS_FILTERS.find((f) => f.key === status) || STATUS_FILTERS[0]).params);
  }
  return params;
}

// The small status marks beside a name: "Tanpa akun", "Staf grup", and for
// People & Culture "Belum ditinjau" (an account without a directory row).
export function personMarks(entry, manage) {
  const marks = [];
  if (!entry) return marks;
  if (!entry.hasAccount) marks.push('no_account');
  if (entry.groupStaff) marks.push('group_staff');
  if (manage && entry.reviewed === false) marks.push('unreviewed');
  return marks;
}

// Onboarding/offboarding dates beside a name (wave 2, row 2.1): "Bergabung
// 12 Okt" for a future join date, "Hari terakhir 15 Okt" while the last
// working day is today or later. The year shows only when it is not this year.
export function shortDate(value, today = new Date()) {
  const date = toDate(value);
  if (!date) return '';
  const text = formatDate(date);
  return date.getFullYear() === today.getFullYear() ? text.replace(/ \d{4}$/, '') : text;
}
export function personDateMarks(entry, today = new Date()) {
  const marks = [];
  if (!entry) return marks;
  if (entry.startsOn) marks.push({ status: 'person_starting', label: `Bergabung ${shortDate(entry.startsOn, today)}` });
  if (entry.lastDay) marks.push({ status: 'person_last_day', label: `Hari terakhir ${shortDate(entry.lastDay, today)}` });
  return marks;
}
// The running onboarding/offboarding on a profile (People & Culture only).
const WORKFLOW_TYPES = { onboarding: 'Onboarding', offboarding: 'Offboarding' };
export function runningWorkflowLabel(workflow) {
  if (!workflow) return '';
  return [WORKFLOW_TYPES[workflow.workflowType] || 'Workflow', workflow.workflowNumber].filter(Boolean).join(' ');
}

export const personStatusKey = (entry) => {
  if (entry?.kind === 'excluded') return 'person_excluded';
  return entry?.status === 'resigned' ? 'person_resigned' : 'person_active';
};

// "12 akun belum ditinjau People & Culture" (rule 7), '' when none.
export function unreviewedNote(count) {
  const n = Number(count) || 0;
  return n > 0 ? `${formatNumber(n)} akun belum ditinjau People & Culture` : '';
}

// Picker options from directory entries: "Nama — Jabatan · Divisi".
export function entryLabel(entry) {
  const meta = [entry.position, entry.departmentName].filter(Boolean).join(' · ');
  return meta ? `${entry.name} — ${meta}` : entry.name;
}
// Manager picker: everyone but the person themself (the server refuses a
// cycle further up the chain with its own message on the field).
export function managerOptions(entries, selfKey) {
  return (entries || [])
    .filter((entry) => entry.key !== selfKey)
    .map((entry) => ({ value: entry.key, label: entryLabel(entry) }));
}

// The same people for Prakasa AI's search (docs/prakasa-ai-rencana.md §9.9):
// name, with position and division as the hint — work contact only.
export function managerChoices(entries, selfKey) {
  return (entries || [])
    .filter((entry) => entry.key !== selfKey)
    .map((entry) => ({ value: entry.key, label: entry.name, hint: [entry.position, entry.departmentName].filter(Boolean).join(' · ') }));
}

// ------------------------------------------------------------ form

export function personFormValues(entry) {
  const e = entry || {};
  return {
    name: e.name || '',
    workEmail: e.workEmail || '',
    departmentId: e.departmentId ? String(e.departmentId) : '',
    position: e.position || '',
    managerKey: e.managerKey || '',
    workPhone: e.workPhone || '',
    locationId: e.locationId ? String(e.locationId) : '',
    kind: e.kind || 'employee',
    excludedReason: e.excludedReason || '',
    status: e.status || 'active',
    resignedOn: e.resignedOn ? String(e.resignedOn).slice(0, 10) : '',
    notes: e.notes || '',
  };
}

const text = (value) => String(value ?? '').trim();
const nullable = (value) => text(value) || null;
const idOrNull = (value) => (value ? Number(value) : null);

// Field → request value. Account fields are never sent for a person with an
// app account (they are edited in Admin → Pengguna).
function fieldValue(field, values) {
  switch (field) {
    case 'name': return text(values.name);
    case 'departmentId': case 'locationId': return idOrNull(values[field]);
    case 'managerKey': return values.managerKey || null;
    case 'kind': return values.kind || 'employee';
    case 'status': return values.status || 'active';
    case 'excludedReason': return values.kind === 'excluded' ? nullable(values.excludedReason) : null;
    case 'resignedOn': return values.status === 'resigned' ? text(values.resignedOn) : null;
    default: return nullable(values[field]);
  }
}
const ACCOUNT_FIELDS = ['name', 'workEmail', 'departmentId'];
const FORM_FIELDS = ['name', 'workEmail', 'departmentId', 'position', 'managerKey', 'workPhone', 'locationId', 'kind', 'excludedReason', 'status', 'resignedOn', 'notes'];

// POST body (no `entry`) or PATCH body (only changed fields). Resign always
// travels with its date; reactivating sends the status alone (the server
// clears the date).
export function personBody(values, entry) {
  const fields = entry?.hasAccount ? FORM_FIELDS.filter((f) => !ACCOUNT_FIELDS.includes(f)) : FORM_FIELDS;
  const body = {};
  if (!entry) {
    for (const field of fields) {
      const value = fieldValue(field, values);
      if (field === 'resignedOn' && value === null) continue;
      if (field === 'excludedReason' && value === null) continue;
      if (value !== null && value !== '') body[field] = value;
    }
    return body;
  }
  const before = personFormValues(entry);
  for (const field of fields) {
    const next = fieldValue(field, values);
    const prev = fieldValue(field, before);
    if (next === prev) continue;
    if (field === 'resignedOn') { if (next !== null) body.resignedOn = next; continue; }
    if (field === 'excludedReason' && next === null && values.kind !== 'excluded' && before.kind !== 'excluded') continue;
    body[field] = next;
  }
  if (body.status === 'resigned' || (values.status === 'resigned' && body.resignedOn)) {
    body.status = 'resigned';
    body.resignedOn = fieldValue('resignedOn', values);
  }
  if (body.kind === 'excluded') body.excludedReason = fieldValue('excludedReason', values);
  return body;
}

// Client checks; field → message. The company domain itself is checked by
// the server (it knows GOOGLE_ALLOWED_DOMAIN) and its message lands on the
// same field.
export function personFormErrors(values, { hasAccount = false } = {}) {
  const errors = {};
  if (!hasAccount) {
    const name = text(values.name);
    if (!name) errors.name = 'Nama wajib diisi';
    else if (name.length > 150) errors.name = 'Nama maksimal 150 karakter.';
    const email = text(values.workEmail).toLowerCase();
    if (email) {
      if (!EMAIL_RE.test(email) || email.length > 190) errors.workEmail = 'Format email kerja tidak valid';
      else if (PERSONAL_EMAIL_DOMAINS.includes(email.split('@').pop())) errors.workEmail = 'Email pribadi tidak boleh dipakai sebagai email kerja.';
    }
  }
  if (text(values.position).length > 150) errors.position = 'Jabatan maksimal 150 karakter.';
  const phone = text(values.workPhone);
  if (phone && (phone.length > 40 || !PHONE_RE.test(phone))) errors.workPhone = 'Nomor telepon kerja tidak valid. Contoh: +62 21 555 1234 ext 12.';
  if (values.kind === 'excluded') {
    const reason = text(values.excludedReason);
    if (!reason) errors.excludedReason = 'Alasan dikecualikan wajib diisi';
    else if (reason.length > 160) errors.excludedReason = 'Alasan maksimal 160 karakter.';
  }
  if (values.status === 'resigned' && !DATE_RE.test(text(values.resignedOn))) errors.resignedOn = 'Tanggal resign wajib diisi';
  if (text(values.notes).length > 500) errors.notes = 'Catatan maksimal 500 karakter.';
  return errors;
}

// Server error → the form field that shows it.
const ERROR_FIELDS = {
  NAME_REQUIRED: 'name',
  WORK_EMAIL_INVALID: 'workEmail',
  WORK_EMAIL_PERSONAL: 'workEmail',
  WORK_EMAIL_DOMAIN: 'workEmail',
  WORK_EMAIL_DOMAINS_UNSET: 'workEmail',
  WORK_EMAIL_IS_ACCOUNT: 'workEmail',
  WORK_EMAIL_TAKEN: 'workEmail',
  DEPARTMENT_INVALID: 'departmentId',
  LOCATION_INVALID: 'locationId',
  LOCATION_INACTIVE: 'locationId',
  MANAGER_INVALID: 'managerKey',
  MANAGER_SELF: 'managerKey',
  MANAGER_CYCLE: 'managerKey',
  MANAGER_EXCLUDED: 'managerKey',
  MANAGER_RESIGNED: 'managerKey',
  EXCLUDED_REASON_REQUIRED: 'excludedReason',
  RESIGN_DATE_REQUIRED: 'resignedOn',
  NOT_RESIGNED: 'resignedOn',
};
export function personFieldErrorFromApi(error) {
  const data = error?.response?.data?.error;
  if (!data) return null;
  if (ERROR_FIELDS[data.code]) return { [ERROR_FIELDS[data.code]]: data.message };
  const fields = data.details?.fieldErrors;
  if (data.code === 'VALIDATION_ERROR' && fields) {
    const out = {};
    for (const [field, messages] of Object.entries(fields)) if (messages?.length) out[field] = messages[0];
    return Object.keys(out).length ? out : null;
  }
  return null;
}
// NAME_EXISTS is a question, not an error: the same name exists; saving
// again with the confirmation creates a second person.
export const isDuplicateName = (error) => error?.response?.data?.error?.code === 'NAME_EXISTS';

// ------------------------------------------------------------ org chart

// GET /people/directory/org → one tree per division, each root with its
// children resolved; a node is placed once (a broken chain never loops).
export function orgForest(org) {
  const nodes = new Map((org?.nodes || []).map((node) => [node.key, node]));
  const placed = new Set();
  const build = (key) => {
    const node = nodes.get(key);
    if (!node || placed.has(key)) return null;
    placed.add(key);
    const children = (node.childKeys || []).map(build).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'id'));
    return { ...node, children };
  };
  const roots = (org?.roots || []).map(build).filter(Boolean);
  // Nodes no root reaches (should not happen) still show, as roots.
  for (const key of nodes.keys()) if (!placed.has(key)) { const node = build(key); if (node) roots.push(node); }
  const groups = new Map();
  for (const root of roots) {
    const name = root.departmentName || 'Tanpa divisi';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(root);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'Tanpa divisi') - (b === 'Tanpa divisi') || a.localeCompare(b, 'id'))
    .map(([division, list]) => ({
      division,
      roots: list.sort((a, b) => countTree(b) - countTree(a) || a.name.localeCompare(b.name, 'id')),
      people: list.reduce((n, root) => n + countTree(root), 0),
    }));
}
export function countTree(node) {
  return 1 + (node?.children || []).reduce((n, child) => n + countTree(child), 0);
}
