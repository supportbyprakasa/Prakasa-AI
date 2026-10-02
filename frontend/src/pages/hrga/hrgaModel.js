// Onboarding & offboarding (People & Culture wave 2, row 2.1): labels for the
// workflow codes, list chips, the checklist grouped per team, which action a
// task row and the detail header offer, the create/edit form ↔ API body, and
// the checklist template editor. Pure: the pages and tests import it.
// Contract: scratchpad pc2/api-2.1.md; spec docs/rancangan-people-culture-g2.md
// §2.1.6 (Bagian 5 wins on conflicts). The server enforces every rule again.

export const WORKFLOW_TYPE_LABELS = { onboarding: 'Onboarding', offboarding: 'Offboarding' };

export const CHECKLIST_CATEGORY_LABELS = {
  google_workspace_access: 'Akses Google Workspace',
  shared_drive_access: 'Akses Shared Drive',
  device_handover: 'Serah terima perangkat',
  device_return: 'Pengembalian perangkat',
  email_account: 'Akun email',
  software_license: 'Lisensi software',
  account_deactivation: 'Penonaktifan akun Google',
  document_handover: 'Serah terima dokumen',
  exit_interview: 'Exit interview',
  custom: 'Lainnya',
  app_account: 'Akun Prakasa Workspace',
  app_account_deactivation: 'Penonaktifan akun Prakasa Workspace',
  phone_line: 'Nomor perusahaan',
  phone_line_return: 'Pengembalian nomor perusahaan',
  desk_setup: 'Meja kerja',
  id_card: 'Kartu akses',
  id_card_return: 'Pengembalian kartu akses',
  access_revoke: 'Cabut akses server/NAS dan aplikasi lain',
  team_orientation: 'Orientasi tim',
};
export const categoryLabel = (category) => CHECKLIST_CATEGORY_LABELS[category] || category;

// Who works a task: IT and GA use the PIC set in the settings, Atasan the
// direct manager, People & Culture the workflow's PIC (decision 12).
export const OWNER_GROUPS = ['it', 'ga', 'manager', 'pc'];
export const OWNER_GROUP_LABELS = { it: 'IT', ga: 'GA', manager: 'Atasan', pc: 'People & Culture' };
export const ownerGroupLabel = (group) => OWNER_GROUP_LABELS[group] || 'Lainnya';

// Offboarding reason is a category only, never a story (decision 2).
export const REASON_LABELS = { resign: 'Resign', contract_end: 'Kontrak selesai', other: 'Lainnya' };
export const reasonLabel = (code) => REASON_LABELS[code] || null;

export const DEVICE_NEED_LABELS = { laptop: 'Laptop', pc: 'PC', none: 'Tidak' };
export const PHONE_NEED_LABELS = { mobile: 'HP', ip_phone: 'Telepon IP', none: 'Tidak' };
export const APPROVER_BASIS_LABELS = {
  manager: 'Atasan langsung',
  division_head: 'Head divisi',
  management_office: 'Head Management Office',
};
export const IT_TICKET_CATEGORY_LABELS = { new_device_request: 'Permintaan perangkat baru', access_software: 'Akses software' };

// Template item "Hanya bila": the onboarding need that must be on.
export const REQUIRES_LABELS = {
  google: 'Akun Google',
  app: 'Akun Prakasa Workspace',
  device: 'Perangkat',
  licenses: 'Lisensi',
  phone: 'Nomor perusahaan',
  desk: 'Meja',
  idCard: 'Kartu akses',
};

// Uploadable attachment types (decision 2: contracts, KTP, offer letters and
// resign letters belong in KantorKu). Older attachments keep their label.
export const ATTACHMENT_TYPES = [
  { value: 'handover_note', label: 'Catatan serah terima' },
  { value: 'other', label: 'Lainnya' },
];
const LEGACY_ATTACHMENT_LABELS = {
  offer_letter: 'Surat penawaran kerja',
  contract: 'Kontrak',
  id_document: 'Identitas',
  resignation_letter: 'Surat pengunduran diri',
};
export const attachmentTypeLabel = (type) => ATTACHMENT_TYPES.find((entry) => entry.value === type)?.label
  || LEGACY_ATTACHMENT_LABELS[type] || type;

export const GOOGLE_ADMIN_URL = 'https://admin.google.com/ac/users';
export const KANTORKU_NOTE = 'Data pribadi, kontrak, dan dokumen gaji disimpan di KantorKu, bukan di sini.';

const DONE_TASK = new Set(['completed', 'skipped']);
const RUNNING = new Set(['approved', 'in_progress']);
export const isTaskDone = (task) => DONE_TASK.has(task?.status);
export const isRunning = (workflow) => RUNNING.has(workflow?.status);
export const isDraftLike = (workflow) => ['draft', 'revision_requested'].includes(workflow?.status);

// ------------------------------------------------------------ list

// Workflow status as shown: approved and in_progress both read "Berjalan"
// (the shared `running` key keeps the tone in statusTone.js).
export const WORKFLOW_STATUS_LABELS = {
  draft: 'Draf',
  pending_approval: 'Menunggu approval',
  revision_requested: 'Perlu revisi',
  approved: 'Berjalan',
  in_progress: 'Berjalan',
  completed: 'Selesai',
  rejected: 'Ditolak',
  cancelled: 'Dibatalkan',
};
export function workflowBadge(status) {
  return { status: RUNNING.has(status) ? 'running' : status, label: WORKFLOW_STATUS_LABELS[status] || undefined };
}

// Status chips of the lists, with meta.counts (counts ignore the status filter).
// "Perlu revisi" shows only when there is one, or it is the selected chip.
export const STATUS_CHIPS = [
  { key: '', label: 'Semua', count: 'all' },
  { key: 'draft', label: 'Draf' },
  { key: 'pending_approval', label: 'Menunggu approval' },
  { key: 'revision_requested', label: 'Perlu revisi', optional: true },
  { key: 'running', label: 'Berjalan' },
  { key: 'completed', label: 'Selesai' },
  { key: 'closed', label: 'Ditolak/dibatalkan' },
];
export function statusChips(counts, selected = '') {
  return STATUS_CHIPS
    .map((chip) => {
      const raw = counts ? counts[chip.count || chip.key] : undefined;
      const count = raw === undefined || raw === null ? null : Number(raw) || 0;
      return { key: chip.key, label: count === null ? chip.label : `${chip.label} (${count})`, count, selected: chip.key === (selected || ''), optional: Boolean(chip.optional) };
    })
    .filter((chip) => !chip.optional || chip.selected || (chip.count || 0) > 0);
}
export const LIST_STATUS_KEYS = STATUS_CHIPS.map((chip) => chip.key).filter(Boolean);

// Query of GET /hrga/workflows from the page's state.
export function workflowListQuery({ type, status, q, departmentId, page = 1, limit = 20 } = {}) {
  const params = { type, page, limit };
  if (status && LIST_STATUS_KEYS.includes(status)) params.status = status;
  if (q && String(q).trim()) params.q = String(q).trim();
  if (departmentId) params.departmentId = String(departmentId);
  return params;
}

// "5/9" and the percentage; done = completed + skipped.
export function progressText(done, total) {
  return `${Number(done) || 0}/${Number(total) || 0}`;
}
export function progressPct(done, total) {
  const t = Number(total) || 0;
  return t ? Math.round(((Number(done) || 0) / t) * 100) : 0;
}

// Checklist tasks done (completed or skipped) out of all.
export function checklistProgress(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const done = list.filter(isTaskDone).length;
  return { done, total: list.length, pct: progressPct(done, list.length) };
}

// ------------------------------------------------------------ checklist

// Tasks (or preview items) grouped IT / GA / Atasan / People & Culture, each
// group in sortOrder; empty groups are dropped; unknown groups go last.
export function groupTasks(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const order = [...OWNER_GROUPS, ...new Set(list.map((t) => t.ownerGroup).filter((g) => !OWNER_GROUPS.includes(g)))];
  return order
    .map((group) => ({
      group,
      label: ownerGroupLabel(group),
      tasks: list.filter((t) => t.ownerGroup === group)
        .map((t, index) => ({ t, index }))
        .sort((a, b) => (Number(a.t.sortOrder ?? a.index) - Number(b.t.sortOrder ?? b.index)) || a.index - b.index)
        .map(({ t }) => t),
    }))
    .filter((entry) => entry.tasks.length);
}

// Checklist preview of a draft (GET …/checklist-preview), grouped like the
// real checklist, with a count line.
export function previewGroups(items) {
  const list = (Array.isArray(items) ? items : []).map((item, index) => ({ ...item, sortOrder: index }));
  return { total: list.length, groups: groupTasks(list) };
}

const GOOGLE_CATEGORIES = new Set(['google_workspace_access', 'account_deactivation']);
// Google account tasks are done in the admin console; completing one needs the
// "Sudah dilakukan di konsol admin Google" confirmation (no Google mutation).
export const needsAdminConsoleConfirm = (task) => GOOGLE_CATEGORIES.has(task?.category);
export const adminConsoleLink = (task) => (needsAdminConsoleConfirm(task) ? GOOGLE_ADMIN_URL : null);

const has = (permissions, code) => Array.isArray(permissions) && permissions.includes(code);
const ACTION_DEFS = {
  device_handover: { label: 'Serahkan perangkat', icon: 'devices', permission: 'device.assign' },
  device_return: { label: 'Terima kembali', icon: 'assignment_return', permission: 'device.assign' },
  license_assign: { label: 'Berikan lisensi', icon: 'key', permission: 'subscription.license.manage' },
  license_revoke: { label: 'Cabut lisensi', icon: 'key_off', permission: 'subscription.license.manage' },
  phone_line: { label: 'Serahkan nomor', icon: 'smartphone', permission: 'it.infra.manage' },
  phone_line_return: { label: 'Terima kembali nomor', icon: 'phonelink_erase', permission: 'it.infra.manage' },
  google_complete: { label: 'Tandai selesai', icon: 'check' },
  complete: { label: 'Tandai selesai', icon: 'check' },
};
const PERMISSION_NAMES = {
  'device.assign': 'serah terima perangkat',
  'subscription.license.manage': 'pengelolaan lisensi',
  'it.infra.manage': 'pengelolaan nomor perusahaan',
};

// The action key a task row offers (contract "Which action a task row
// offers"); null when the row offers none (done, not the viewer's, workflow
// not running). `allowed` false = the viewer can act on the task but lacks
// the record permission; the button shows disabled with `blockedReason`.
export function taskActionKey(task, workflow) {
  if (!task || isTaskDone(task) || !task.canAct) return null;
  if (workflow && !isRunning(workflow)) return null;
  const type = workflow?.workflowType;
  switch (task.category) {
    case 'device_handover':
      if (type === 'offboarding') return 'complete';
      return task.linkedDeviceAssignmentId && task.linkedAssignmentActive ? 'complete' : 'device_handover';
    case 'device_return':
      return task.linkedAssignmentActive ? 'device_return' : 'complete';
    case 'software_license':
      if (type === 'offboarding') return task.linkedSubscriptionLicenseId && task.linkedLicenseActive ? 'license_revoke' : 'complete';
      if (task.linkedSubscriptionId && !task.linkedLicenseActive) return 'license_assign';
      return 'complete';
    case 'phone_line':
      return task.linkedPhoneLineId ? 'complete' : 'phone_line';
    case 'phone_line_return':
      return 'phone_line_return';
    case 'google_workspace_access':
    case 'account_deactivation':
      return 'google_complete';
    default:
      return 'complete';
  }
}

export function taskPrimaryAction(task, workflow, permissions) {
  const key = taskActionKey(task, workflow);
  if (!key) return null;
  const def = ACTION_DEFS[key];
  const allowed = !def.permission || has(permissions, def.permission);
  return {
    key,
    label: def.label,
    icon: def.icon,
    permission: def.permission || null,
    allowed,
    blockedReason: allowed ? null : `Butuh izin ${PERMISSION_NAMES[def.permission]}.`,
    confirm: key === 'google_complete',
  };
}

// ⋮ on a task row: skip (any actionable open task), reassign (hrga.manage),
// IT ticket (IT tasks the viewer can act on).
export function taskMenuActions(task, workflow) {
  if (!task || isTaskDone(task)) return [];
  if (workflow && !isRunning(workflow)) return [];
  const viewer = workflow?.viewer || {};
  const out = [];
  if (task.canAct) out.push('skip');
  if (viewer.canManage) out.push('assign');
  if (task.ownerGroup === 'it' && task.canAct) out.push('it_ticket');
  return out;
}

// Task meta: responsible, due (late flagged), done/skip notes.
// Parts for <Mixed> (i18n/NoTranslate.jsx): a person's name is record data,
// the sentences around a name are interface text.
export function taskMeta(task) {
  const parts = [task.responsibleName ? { text: task.responsibleName, data: true } : 'Belum ada penanggung jawab'];
  if (task.status === 'completed' && task.completedByName) parts.push(`Diselesaikan ${task.completedByName}`);
  if (task.status === 'skipped' && task.skippedReason) parts.push(`Dilewati: ${task.skippedReason}`);
  return parts;
}
export const isTaskLate = (task) => Boolean(task?.late) && !isTaskDone(task);

// What a linked record shows under a task ("Laptop Lenovo · aktif").
export function taskLinkNote(task) {
  // Each note is a list of parts for <Mixed separator=" ">: the label and
  // the state are interface text, the record's name is data.
  const own = (text) => ({ text, data: true });
  const notes = [];
  if (task.linkedDeviceName) notes.push(['Perangkat:', own(task.linkedDeviceName), task.linkedAssignmentActive ? null : '(sudah kembali)']);
  if (task.linkedSubscriptionName) notes.push(['Lisensi:', own(task.linkedSubscriptionName), task.linkedLicenseActive ? null : (task.linkedSubscriptionLicenseId ? '(dicabut)' : '(belum diberikan)')]);
  if (task.linkedPhoneLineLabel) notes.push(['Nomor:', own(task.linkedPhoneLineLabel)]);
  return notes;
}

// ------------------------------------------------------------ header

// Header actions by state, from the server's `viewer` (decision actions in
// the header; at most one primary and two secondary, the rest in ⋮).
export function headerActions(workflow) {
  const v = workflow?.viewer || {};
  const limited = Boolean(workflow?.limited);
  const primary = [];
  const secondary = [];
  const menu = [];
  if (v.canDecide && workflow?.status === 'pending_approval') {
    primary.push('approve');
    secondary.push('reject', 'request_revision');
  }
  if (v.canSubmit && isDraftLike(workflow)) primary.push('submit');
  if (v.canWithdraw && workflow?.status === 'pending_approval') secondary.push('withdraw');
  if (!limited) {
    if (v.canEdit && isDraftLike(workflow)) menu.push('edit');
    if (v.canHoldingsSync && workflow?.workflowType === 'offboarding' && isRunning(workflow)) menu.push('holdings_sync');
    if (v.canEditKantorku) menu.push('kantorku');
    if (v.canCancel && isRunning(workflow)) menu.push('cancel');
    if (v.canDelete && workflow?.status === 'draft') menu.push('delete');
  }
  // Never more than one primary / two secondary: the overflow goes into ⋮.
  return { primary: primary.slice(0, 1), secondary: [...primary.slice(1), ...secondary].slice(0, 2), menu: [...[...primary.slice(1), ...secondary].slice(2), ...menu] };
}

// Ringkasan description line: "Berjalan · ONB-2026-004 · Mulai 12 Okt 2026".
export const baseDateLabel = (type) => (type === 'offboarding' ? 'Hari terakhir' : 'Mulai');

// Onboarding needs as one readable line.
export function needsSummary(needs, licenses) {
  if (!needs) return '';
  const parts = [];
  if (needs.google) parts.push('Akun Google');
  if (needs.app) parts.push('Akun Prakasa Workspace');
  if (needs.device && needs.device !== 'none') parts.push(DEVICE_NEED_LABELS[needs.device] || needs.device);
  if (needs.phone && needs.phone !== 'none') parts.push(PHONE_NEED_LABELS[needs.phone] || needs.phone);
  if (needs.desk) parts.push('Meja');
  if (needs.idCard) parts.push('Kartu akses');
  const names = (licenses || []).map((l) => l.productName).filter(Boolean);
  if (names.length) parts.push(`Lisensi ${names.join(', ')}`);
  return parts.join(' · ');
}

// Offboarding holdings: "2 perangkat · 1 lisensi · 0 nomor".
export function holdingsCounts(holdings) {
  const h = holdings || {};
  return { devices: (h.devices || []).length, licenses: (h.licenses || []).length, phoneLines: (h.phoneLines || []).length };
}
export function holdingsSummary(holdings) {
  const c = holdingsCounts(holdings);
  return `${c.devices} perangkat · ${c.licenses} lisensi · ${c.phoneLines} nomor`;
}

// ------------------------------------------------------------ form

export const DEFAULT_NEEDS = { google: true, app: true, device: 'laptop', licenses: [], phone: 'none', desk: true, idCard: true };
const str = (value) => (value === null || value === undefined ? '' : String(value));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function workflowFormValues(workflow, type) {
  const w = workflow || {};
  const needs = { ...DEFAULT_NEEDS, ...(w.needs || {}) };
  return {
    workflowType: w.workflowType || type || 'onboarding',
    employeeFullName: str(w.employeeName),
    employeePosition: str(w.position),
    departmentId: str(w.departmentId),
    managerKey: str(w.managerKey),
    locationId: str(w.locationId),
    plannedWorkEmail: str(w.plannedWorkEmail),
    personKey: str(w.personKey),
    joinDate: str(w.joinDate),
    lastWorkingDate: str(w.lastWorkingDate),
    reasonCode: str(w.reasonCode),
    hrgaPicUserId: str(w.picUserId),
    notes: str(w.notes),
    needs: { ...needs, licenses: (needs.licenses || []).map(String) },
  };
}

// Strict body (unknown keys are refused by the server): only the contract's
// fields for the type. Empty optional values go as null. PATCH adds version
// and drops workflowType.
export function workflowBody(values, { version } = {}) {
  const v = values || {};
  const opt = (x) => (str(x).trim() ? str(x).trim() : null);
  const num = (x) => (str(x).trim() ? Number(x) : null);
  let body;
  if (v.workflowType === 'offboarding') {
    body = {
      workflowType: 'offboarding',
      personKey: opt(v.personKey),
      lastWorkingDate: opt(v.lastWorkingDate),
      reasonCode: opt(v.reasonCode),
      hrgaPicUserId: num(v.hrgaPicUserId),
      notes: opt(v.notes),
    };
  } else {
    const n = { ...DEFAULT_NEEDS, ...(v.needs || {}) };
    body = {
      workflowType: 'onboarding',
      employeeFullName: str(v.employeeFullName).trim(),
      employeePosition: opt(v.employeePosition),
      departmentId: num(v.departmentId),
      managerKey: opt(v.managerKey),
      locationId: num(v.locationId),
      plannedWorkEmail: opt(v.plannedWorkEmail),
      personKey: opt(v.personKey),
      joinDate: opt(v.joinDate),
      needs: {
        google: Boolean(n.google),
        app: Boolean(n.app),
        device: n.device || 'none',
        licenses: (n.licenses || []).map(Number).filter(Number.isFinite),
        phone: n.phone || 'none',
        desk: Boolean(n.desk),
        idCard: Boolean(n.idCard),
      },
      hrgaPicUserId: num(v.hrgaPicUserId),
      notes: opt(v.notes),
    };
  }
  if (version !== undefined) {
    delete body.workflowType;
    body.version = version;
  }
  return body;
}

export function workflowFormErrors(values) {
  const v = values || {};
  const errors = {};
  if (v.workflowType === 'offboarding') {
    if (!str(v.personKey)) errors.personKey = 'Pilih karyawan.';
    if (!DATE_RE.test(str(v.lastWorkingDate))) errors.lastWorkingDate = 'Isi hari terakhir.';
    if (!REASON_LABELS[v.reasonCode]) errors.reasonCode = 'Pilih alasan.';
  } else {
    if (!str(v.employeeFullName).trim()) errors.employeeFullName = 'Nama wajib diisi.';
    if (!str(v.departmentId)) errors.departmentId = 'Pilih divisi.';
    if (!DATE_RE.test(str(v.joinDate))) errors.joinDate = 'Isi tanggal mulai.';
    if (str(v.plannedWorkEmail).trim() && !EMAIL_RE.test(str(v.plannedWorkEmail).trim())) errors.plannedWorkEmail = 'Format email tidak valid.';
  }
  return errors;
}

// Server error → the form field it belongs to.
const FIELD_CODES = { OPEN_WORKFLOW_EXISTS: 'personKey' };
export function workflowFieldErrorFromApi(error) {
  const data = error?.response?.data?.error;
  if (!data) return null;
  if (FIELD_CODES[data.code]) return { [FIELD_CODES[data.code]]: data.message };
  const fields = data.details?.fieldErrors;
  if (fields && typeof fields === 'object') {
    const out = {};
    for (const [field, messages] of Object.entries(fields)) {
      const message = Array.isArray(messages) ? messages[0] : messages;
      if (message) out[field] = message;
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}
export const apiErrorCode = (error) => error?.response?.data?.error?.code || null;
export const apiErrorMessage = (error, fallback) => error?.response?.data?.error?.message || fallback;

// Pickers from GET /hrga/lookups.
export function personLabel(person) {
  const meta = [person.position, person.departmentName].filter(Boolean).join(' · ');
  const base = meta ? `${person.name} — ${meta}` : person.name;
  return person.status === 'resigned' ? `${base} (resign)` : base;
}
// Offboarding: active people only. Manager: active people. Re-hire: everyone.
export function personOptions(people, { activeOnly = false, exclude } = {}) {
  return (people || [])
    .filter((p) => !activeOnly || p.status === 'active')
    .filter((p) => !exclude || p.key !== exclude)
    .map((p) => ({ value: p.key, label: personLabel(p) }));
}
export const optionsFrom = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
export const userOptions = (users) => (users || []).map((u) => ({ value: String(u.id), label: u.departmentName ? `${u.name} — ${u.departmentName}` : u.name }));

// Devices offered by Serahkan perangkat: "Lenovo ThinkPad · SN123 · Kantor".
export const deviceOptionLabel = (d) => [d.name, d.serialNumber, d.locationName].filter(Boolean).join(' · ');
// Licences of the task's subscription when it names one.
export function licenseOptions(licenses, subscriptionId) {
  const list = licenses || [];
  const own = subscriptionId ? list.filter((l) => String(l.subscriptionId) === String(subscriptionId)) : list;
  return own.map((l) => ({ value: String(l.id), label: [l.productName, l.seatLabel].filter(Boolean).join(' · ') }));
}

// ------------------------------------------------------------ templates

// Generated from holdings, never allowed in a template.
export function templateCategoryAllowed(category, workflowType) {
  if (category === 'device_return' || category === 'phone_line_return') return false;
  if (category === 'software_license' && workflowType === 'offboarding') return false;
  return Boolean(CHECKLIST_CATEGORY_LABELS[category]);
}
export function templateCategoryOptions(workflowType) {
  return Object.keys(CHECKLIST_CATEGORY_LABELS)
    .filter((c) => templateCategoryAllowed(c, workflowType))
    .map((value) => ({ value, label: CHECKLIST_CATEGORY_LABELS[value] }))
    .sort((a, b) => a.label.localeCompare(b.label, 'id'));
}

// A checklist template's items arrive as JSON text or an array.
export function templateItemCount(items) {
  if (Array.isArray(items)) return items.length;
  if (typeof items === 'string') {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

export const emptyTemplateItem = () => ({ ownerGroup: 'pc', category: 'custom', title: '', description: '', offsetDays: '0', requires: '' });
export function templateItemValues(item) {
  return {
    ownerGroup: item?.ownerGroup || 'pc',
    category: item?.category || 'custom',
    title: str(item?.title),
    description: str(item?.description),
    offsetDays: str(item?.offsetDays ?? 0),
    requires: str(item?.requires),
  };
}
// Editor rows → API items; requires only applies to onboarding needs.
export function templateItemsBody(rows, workflowType) {
  return (rows || []).map((row) => {
    const item = {
      category: row.category,
      title: str(row.title).trim(),
      ownerGroup: row.ownerGroup,
      offsetDays: Number(row.offsetDays) || 0,
    };
    if (str(row.description).trim()) item.description = str(row.description).trim();
    if (workflowType === 'onboarding' && row.requires) item.requires = row.requires;
    return item;
  });
}
// Per-row errors keyed by index, plus a form error when there are no rows.
export function templateErrors({ name, rows, workflowType }) {
  const errors = { rows: {} };
  if (!str(name).trim()) errors.name = 'Nama template wajib diisi.';
  if (!(rows || []).length) errors.form = 'Tambahkan minimal satu item.';
  (rows || []).forEach((row, index) => {
    const e = {};
    if (!str(row.title).trim()) e.title = 'Judul wajib diisi.';
    const offset = Number(row.offsetDays);
    if (str(row.offsetDays).trim() === '' || !Number.isInteger(offset) || offset < -30 || offset > 30) e.offsetDays = 'Antara -30 dan 30.';
    if (!templateCategoryAllowed(row.category, workflowType)) e.category = 'Kategori ini dibuat otomatis dari kepemilikan.';
    if (!OWNER_GROUPS.includes(row.ownerGroup)) e.ownerGroup = 'Pilih tim.';
    if (Object.keys(e).length) errors.rows[index] = e;
  });
  const found = Boolean(errors.name || errors.form || Object.keys(errors.rows).length);
  return found ? errors : null;
}
export function offsetLabel(days, workflowType) {
  const n = Number(days) || 0;
  const base = workflowType === 'offboarding' ? 'hari terakhir' : 'tanggal mulai';
  if (n === 0) return `Pada ${base}`;
  return n < 0 ? `${Math.abs(n)} hari sebelum ${base}` : `${n} hari setelah ${base}`;
}

// ------------------------------------------------------------ Prakasa AI

// Pickers as Prakasa AI searches them (docs/prakasa-ai-rencana.md §9.9): the
// same loaded lists the Selects show, as { value, label, hint }. `value` is
// what the form's state holds; `hint` is work contact only (position,
// division) — never a phone number, an address or an ID number.
const plainText = (text) => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// The choices that hold every word of the text (at most 20). No word: nothing.
export function searchChoices(choices, text) {
  const words = plainText(text).split(' ').filter(Boolean);
  if (!words.length) return [];
  return (choices || []).filter((choice) => {
    const hay = plainText(`${choice.label} ${choice.hint || ''}`);
    return words.every((word) => hay.includes(word));
  }).slice(0, 20);
}
export const choiceLabel = (choices, value) => (choices || []).find((choice) => String(choice.value) === String(value ?? ''))?.label || '';
// People of the directory (GET /hrga/lookups): same filter as personOptions.
export function personChoices(people, { activeOnly = false, exclude } = {}) {
  return (people || [])
    .filter((p) => !activeOnly || p.status === 'active')
    .filter((p) => !exclude || p.key !== exclude)
    .map((p) => ({ value: p.key, label: p.name, hint: [p.position, p.departmentName].filter(Boolean).join(' · ') }));
}
// App users (GET /hrga/lookups users, or the PIC candidates).
export const userChoices = (users) => (users || []).map((u) => ({ value: String(u.id), label: u.name, hint: u.departmentName || '' }));
// Cadangan devices of a hand-over task, as deviceOptionLabel shows them.
export const deviceChoices = (devices) => (devices || []).map((d) => ({ value: String(d.id), label: d.name, hint: [d.serialNumber, d.locationName].filter(Boolean).join(' · ') }));

// The onboarding form keeps its needs in one object; Prakasa AI sees one field
// per need. NEED_FIELDS: AI field name → key in values.needs.
export const NEED_FIELDS = Object.freeze({
  needGoogle: 'google', needApp: 'app', needIdCard: 'idCard', needDesk: 'desk', needDevice: 'device', needPhone: 'phone', needLicenses: 'licenses',
});
export function workflowAiValues(values) {
  const needs = values?.needs || {};
  return { ...values, ...Object.fromEntries(Object.entries(NEED_FIELDS).map(([name, key]) => [name, needs[key]])) };
}
// A patch of AI fields → the next form values (needs go back into the object).
export function workflowAiPatch(values, patch) {
  const next = { ...values };
  const needs = { ...(values?.needs || {}) };
  for (const [name, value] of Object.entries(patch || {})) {
    if (NEED_FIELDS[name]) needs[NEED_FIELDS[name]] = value;
    else if (name !== 'needs' && name !== 'workflowType') next[name] = value;
  }
  return { ...next, needs };
}

// The template editor's own rules as { field: message } for Prakasa AI
// (`items` = the rows): the first complaint of the rows, or the form's.
export function templateAiErrors({ name, rows, workflowType }) {
  const found = templateErrors({ name, rows, workflowType });
  if (!found) return {};
  const out = {};
  if (found.name) out.name = found.name;
  const firstRow = Object.values(found.rows || {})[0];
  const rowMessage = firstRow ? Object.values(firstRow)[0] : null;
  if (found.form || rowMessage) out.items = found.form || rowMessage;
  return out;
}
