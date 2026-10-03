// Pengajuan ke Accurate: a customer or vendor proposed from the app, decided by
// the division's Supervisor or Head, then queued for Accurate. Pure helpers for
// the pages (status labels, the form's fields and checks, the request key).

export const RECORD_LABEL = { customer: 'Pelanggan', vendor: 'Pemasok' };
export const ACTION_LABEL = { create: 'Data baru', update: 'Perubahan' };

// Tones from components/statusTone.js.
export const REQUEST_STATUS = {
  pending: { status: 'pending_approval', label: 'Menunggu persetujuan' },
  queued: { status: 'queued', label: 'Disetujui, antre kirim' },
  sent: { status: 'sent', label: 'Terkirim ke Accurate' },
  confirmed: { status: 'approved', label: 'Terkonfirmasi di Accurate' },
  rejected: { status: 'rejected', label: 'Ditolak' },
  failed: { status: 'failed', label: 'Gagal dikirim' },
  cancelled: { status: 'cancelled', label: 'Dibatalkan' },
};
export const STATUS_FILTERS = [
  { key: '', label: 'Semua' },
  { key: 'open', label: 'Belum selesai' },
  { key: 'pending', label: 'Menunggu persetujuan' },
  { key: 'queued', label: 'Antre kirim' },
  { key: 'confirmed', label: 'Terkonfirmasi' },
  { key: 'rejected', label: 'Ditolak' },
];
export const requestStatus = (s) => REQUEST_STATUS[s] || { status: s, label: s };

// What a request can be at each status: cancel while nothing has left the app.
export const CANCELLABLE = new Set(['pending', 'queued']);
export const canCancel = (request, user) => Boolean(request) && CANCELLABLE.has(request.status)
  && (Number(request.requestedBy) === Number(user?.sub ?? user?.id) || (user?.permissions || []).includes('accurate.batch.view'));

// The one line under the status that says what happens next.
export function nextStepText(request) {
  if (!request) return '';
  switch (request.status) {
    case 'pending': return 'Supervisor atau Head divisi memutuskan. Belum ada yang dikirim ke Accurate.';
    case 'queued': return request.lastError
      ? `Disetujui. ${request.lastError}`
      : 'Disetujui. Menunggu giliran dikirim ke Accurate.';
    case 'sent': return 'Sudah dikirim ke Accurate. Terkonfirmasi setelah tarikan berikutnya menampilkannya.';
    case 'confirmed': return request.lastError || 'Accurate sudah menampilkan data ini sama seperti yang diajukan.';
    case 'rejected': return request.decisionNote ? `Ditolak: ${request.decisionNote}` : 'Ditolak.';
    case 'failed': return request.lastError ? `Accurate menolak: ${request.lastError}` : 'Gagal dikirim.';
    case 'cancelled': return request.decisionNote ? `Dibatalkan: ${request.decisionNote}` : 'Dibatalkan.';
    default: return '';
  }
}

// The fields a proposal carries, in the order the decider reads them. The
// server's allowlist (accurateWriteRequests.service.js RECORD_TYPES) is the same.
export const FIELDS = [
  { key: 'number', label: { customer: 'ID pelanggan', vendor: 'ID pemasok' }, max: 60, hint: 'Kosongkan bila Accurate yang memberi nomor.' },
  { key: 'name', label: 'Nama', max: 120, required: true },
  { key: 'category', label: 'Kategori', max: 60 },
  { key: 'contactPerson', label: 'Kontak', max: 120 },
  { key: 'phone', label: 'Telepon', max: 40 },
  { key: 'businessPhone', label: 'Telepon usaha', max: 40 },
  { key: 'email', label: 'Email', max: 120, type: 'email' },
  { key: 'address', label: 'Alamat', max: 500, multiline: true },
  { key: 'city', label: 'Kota', max: 100 },
  { key: 'notes', label: 'Catatan', max: 500, multiline: true },
];
export const fieldLabel = (key, recordType = 'customer') => {
  const field = FIELDS.find((f) => f.key === key);
  if (!field) return key;
  return typeof field.label === 'string' ? field.label : field.label[recordType] || field.label.customer;
};

export const EMPTY_FORM = Object.freeze(Object.fromEntries(FIELDS.map((f) => [f.key, ''])));

// Form values from an app customer (the reconciliation row) or a mirror record.
export function formFrom(source = {}) {
  const out = { ...EMPTY_FORM };
  for (const field of FIELDS) {
    const value = source[field.key];
    if (value !== undefined && value !== null) out[field.key] = String(value);
  }
  return out;
}

export function formErrors(values) {
  const errors = {};
  for (const field of FIELDS) {
    const value = String(values[field.key] || '').trim();
    if (field.required && !value) errors[field.key] = `${fieldLabel(field.key)} wajib diisi.`;
    else if (value.length > field.max) errors[field.key] = `Maksimal ${field.max} karakter.`;
    else if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors[field.key] = 'Email tidak valid.';
  }
  return errors;
}

// Only filled fields go to the server (its allowlist refuses nothing else).
export function toPayload(values) {
  const out = {};
  for (const field of FIELDS) {
    const value = String(values[field.key] || '').trim();
    if (value) out[field.key] = value;
  }
  return out;
}

// One key per opened form: a retried submit (double click, flaky network) is
// the same request on the server, never a second one.
export function newRequestKey(random = Math.random) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = 'pw-';
  for (let i = 0; i < 24; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

// What the decider reads: each changed field as "label: before → after".
export function changeLines(request) {
  const type = request?.recordType || 'customer';
  const order = (field) => { const i = FIELDS.findIndex((f) => f.key === field); return i < 0 ? FIELDS.length : i; };
  return [...(request?.changes || [])]
    .sort((a, b) => order(a.field) - order(b.field))
    .map((c) => ({ field: c.field, label: fieldLabel(c.field, type), before: c.before ?? null, after: c.after ?? null }));
}

export const KIND_LABEL = { missing: 'Belum ada di Accurate', name: 'Nama berbeda' };
export const KIND_STATUS = { missing: 'batch_create', name: 'batch_update' };
