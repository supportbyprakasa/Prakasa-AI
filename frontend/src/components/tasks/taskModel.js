// Pure helpers for the Task Board and task detail (no React) — unit tested in
// test/taskModel.test.js. Status tones always come from components/statusTone.js;
// this file only holds the task wording and date rules.
import { formatDate } from '../format.js';
import { PRIORITY_LABELS, statusLabel } from '../statusTone.js';

export const FINAL_STATUSES = new Set(['done', 'closed', 'completed', 'cancelled']);
export const DONE_STATUSES = new Set(['done', 'closed', 'completed']);

// Task status wording (Indonesian); the same list on the board and the detail.
export const TASK_STATUS_LABELS = {
  open: 'Terbuka',
  in_progress: 'Dikerjakan',
  review: 'Review',
  done: 'Selesai',
  closed: 'Ditutup',
  completed: 'Tuntas',
  cancelled: 'Dibatalkan',
};
export const TASK_STATUS_OPTIONS = Object.entries(TASK_STATUS_LABELS).map(([value, label]) => ({ value, label }));
export const TASK_PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent'].map((value) => ({ value, label: PRIORITY_LABELS[value] }));

export function taskStatusLabel(status) {
  return TASK_STATUS_LABELS[status] || statusLabel(status);
}

// Calendar day in the browser's own time zone ("2026-09-30").
export function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isOverdue(task, now = new Date()) {
  if (!task?.dueDate || FINAL_STATUSES.has(task.status)) return false;
  return String(task.dueDate).slice(0, 10) < localDateKey(now);
}

export function isDueToday(task, now = new Date()) {
  if (!task?.dueDate || FINAL_STATUSES.has(task.status)) return false;
  return String(task.dueDate).slice(0, 10) === localDateKey(now);
}

// "30 Sep 2026" for a task date (the API sends YYYY-MM-DD or an ISO timestamp).
export function taskDate(value) {
  if (!value) return '';
  return formatDate(String(value).slice(0, 10));
}

// Assignees seen on the board so far, for the assignee filter — the board API
// has no member list, and a filtered answer only holds the chosen person, so
// earlier options are kept.
export function mergeAssignees(known, tasks) {
  const map = new Map((known || []).map((option) => [option.value, option]));
  (tasks || []).forEach((task) => {
    if (task?.assigneeId == null) return;
    const value = String(task.assigneeId);
    if (!map.has(value)) map.set(value, { value, label: task.assigneeName || `Pengguna #${value}` });
  });
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// Form checks, shown on the fields (never as toasts).
export function validateTaskForm(form, { requireTitle = true } = {}) {
  const errors = {};
  if (requireTitle && !String(form.title || '').trim()) errors.title = 'Judul wajib diisi.';
  if (form.startDate && form.dueDate && form.startDate > form.dueDate) errors.dueDate = 'Jatuh tempo tidak boleh sebelum tanggal mulai.';
  if (form.assigneeId !== undefined && form.assigneeId !== '' && form.assigneeId !== null) {
    const id = Number(form.assigneeId);
    if (!Number.isInteger(id) || id <= 0) errors.assigneeId = 'ID penanggung jawab harus bilangan bulat positif.';
  }
  if (form.progressPercent !== undefined && form.progressPercent !== '' && form.progressPercent !== null) {
    const progress = Number(form.progressPercent);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) errors.progressPercent = 'Progres harus bilangan bulat 0–100.';
  }
  return errors;
}

// Activity entries: the event as a sentence, and only the metadata a person can
// read (no internal ids).
const EVENT_LABELS = {
  'task.created': 'Task dibuat',
  'task.updated': 'Task diperbarui',
  'task.moved': 'Task dipindahkan',
  'task.assigned': 'Penanggung jawab ditetapkan',
  'task.reassigned': 'Penanggung jawab diganti',
  'task.unassigned': 'Penanggung jawab dilepas',
  'task.status_changed': 'Status berubah',
  'task.completed': 'Task selesai',
  'task.reopened': 'Task dibuka kembali',
  'task.comment_added': 'Komentar ditambahkan',
  'task.checklist_added': 'Checklist ditambahkan',
  'task.checklist_completed': 'Checklist selesai',
  'task.checklist_reopened': 'Checklist dibuka kembali',
  'task.checklist_deleted': 'Checklist dihapus',
  'task.watcher_added': 'Pemantau ditambahkan',
  'task.watcher_removed': 'Pemantau dihapus',
  'task.dependency_added': 'Dependensi ditambahkan',
  'task.dependency_removed': 'Dependensi dihapus',
};

export function activityLabel(event) {
  if (EVENT_LABELS[event]) return EVENT_LABELS[event];
  const text = String(event || '').replace(/^task\./, '').replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Aktivitas';
}

const FIELD_LABELS = {
  title: 'judul', description: 'deskripsi', priority: 'prioritas', status: 'status', dueDate: 'jatuh tempo',
  startDate: 'tanggal mulai', progressPercent: 'progres', assigneeId: 'penanggung jawab', columnId: 'kolom',
};

// One entry per detail: a sentence of the app (a string), or a label with a
// text someone typed ({ label, value }) — the timeline never translates `value`.
export function activityParts(metadata) {
  if (!metadata || typeof metadata !== 'object') return [];
  const out = [];
  if (typeof metadata.title === 'string' && metadata.title) out.push({ label: 'Judul:', value: metadata.title.slice(0, 80) });
  if (metadata.from !== undefined && metadata.to !== undefined && (TASK_STATUS_LABELS[metadata.from] || TASK_STATUS_LABELS[metadata.to])) {
    out.push(`${taskStatusLabel(metadata.from)} → ${taskStatusLabel(metadata.to)}`);
  }
  if (Array.isArray(metadata.fields) && metadata.fields.length) {
    const names = metadata.fields.map((field) => FIELD_LABELS[field]).filter(Boolean);
    if (names.length) out.push(`Diubah: ${[...new Set(names)].join(', ')}`);
  }
  return out;
}

// The same details as plain text ("Judul: …").
export function activityDetails(metadata) {
  return activityParts(metadata).map((part) => (typeof part === 'string' ? part : `${part.label} ${part.value}`));
}
