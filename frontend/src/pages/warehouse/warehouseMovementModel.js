import { numberLocale } from '../../i18n/language.js';
// Pure helpers for the Warehouse movement screens. The server re-validates everything;
// these give people exact feedback before they submit.

export const MOVEMENT_STATUSES = ['draft', 'pending_approval', 'revision_requested', 'approved', 'rejected', 'cancelled'];

const STATUS_COPY = {
  draft: { label: 'Draft', tone: 'default' },
  pending_approval: { label: 'Menunggu review', tone: 'warning' },
  revision_requested: { label: 'Perlu revisi', tone: 'warning' },
  approved: { label: 'Disetujui', tone: 'success' },
  rejected: { label: 'Ditolak', tone: 'error' },
  cancelled: { label: 'Dibatalkan', tone: 'default' },
};

export const MOVEMENT_TYPE_COPY = {
  inbound: { label: 'Barang masuk', partyLabel: 'Supplier', partyPlaceholder: 'Nama supplier' },
  // Never an address (D5): it would be stored and shown in the reconciliation.
  outbound: { label: 'Barang keluar', partyLabel: 'Tujuan', partyPlaceholder: 'Cabang atau nama pelanggan (tanpa alamat)', partyHint: 'Alamat lengkap ada di surat jalan Accurate.' },
};

let keySeed = 0;

export function emptyMovementItem() {
  keySeed += 1;
  return {
    key: `item-${Date.now().toString(36)}-${keySeed}`,
    sku: '',
    product: '',
    quantity: '',
    unit: '',
    batchNo: '',
    expiresOn: '',
    location: '',
    note: '',
  };
}

const blankToNull = (value) => {
  const text = value == null ? '' : String(value).trim();
  return text ? text : null;
};

export function parseQuantity(value) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim().replace(',', '.');
  return text === '' ? NaN : Number(text);
}

export function normalizeMovementItem(item) {
  return {
    sku: blankToNull(item.sku),
    product: blankToNull(item.product) || '',
    quantity: parseQuantity(item.quantity),
    unit: blankToNull(item.unit) || '',
    batchNo: blankToNull(item.batchNo),
    expiresOn: blankToNull(item.expiresOn),
    location: blankToNull(item.location),
    note: blankToNull(item.note),
  };
}

export function movementValidationSummary(input) {
  const messages = [];
  if (!input?.movementDate) messages.push('Tanggal transaksi wajib diisi.');
  const items = input?.items || [];
  if (!items.length) {
    messages.push('Tambahkan minimal satu barang.');
    return messages;
  }

  const seen = new Map();
  items.forEach((raw, index) => {
    const row = `Baris ${index + 1}`;
    const item = normalizeMovementItem(raw);
    if (!item.product) messages.push(`${row}: produk wajib diisi.`);
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) messages.push(`${row}: jumlah harus lebih dari 0.`);
    if (!item.unit) messages.push(`${row}: satuan wajib diisi.`);
    if (item.sku) {
      const key = [item.sku, item.batchNo || '', item.location || ''].join('|').toLowerCase();
      if (seen.has(key)) {
        messages.push(`SKU ${item.sku.toUpperCase()} muncul di baris ${seen.get(key) + 1} dan ${index + 1} dengan batch dan lokasi yang sama.`);
      } else {
        seen.set(key, index);
      }
    }
  });
  return messages;
}

// The same checks as movementValidationSummary, keyed by field so each message
// shows on its own field (docs/ui-guideline.md §4.3): { movementDate, items:
// [{ sku, product, quantity, unit }] }. A duplicate SKU marks the later row.
export function movementFieldErrors(input) {
  const errors = { items: [] };
  if (!input?.movementDate) errors.movementDate = 'Tanggal transaksi wajib diisi.';
  const seen = new Map();
  (input?.items || []).forEach((raw, index) => {
    const item = normalizeMovementItem(raw);
    const row = {};
    if (!item.product) row.product = 'Produk wajib diisi.';
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) row.quantity = 'Jumlah harus lebih dari 0.';
    if (!item.unit) row.unit = 'Satuan wajib diisi.';
    if (item.sku) {
      const key = [item.sku, item.batchNo || '', item.location || ''].join('|').toLowerCase();
      if (seen.has(key)) row.sku = `Sama dengan baris ${seen.get(key) + 1} (batch dan lokasi sama).`;
      else seen.set(key, index);
    }
    errors.items[index] = row;
  });
  return errors;
}

// What would refuse a fill by Prakasa AI (usePrakasaAIForm `validate`): the same
// checks as movementFieldErrors, keyed by the registered field. A missing
// quantity is not reported: the quantity is the physical count, typed by the
// user after the AI filled the other columns.
export function movementAiErrors(input) {
  const found = movementFieldErrors(input);
  const errors = {};
  if (found.movementDate) errors.movementDate = found.movementDate;
  const duplicates = found.items.map((row, index) => (row?.sku ? `Baris ${index + 1}: ${row.sku}` : '')).filter(Boolean);
  if (duplicates.length) errors.items = duplicates.join(' ');
  return errors;
}

export function movementStatusLabel(status) {
  return STATUS_COPY[status] || { label: status || 'Tidak diketahui', tone: 'default' };
}

export function nextActorText(movement) {
  switch (movement?.status) {
    case 'draft':
      return 'Pembuat perlu melengkapi lalu mengajukan pergerakan ini.';
    case 'pending_approval':
      return 'Menunggu keputusan Warehouse Supervisor. Data dikunci selama review.';
    case 'revision_requested':
      return 'Supervisor meminta revisi. Pembuat perlu memperbaiki lalu mengajukan ulang.';
    case 'approved':
      return 'Sudah disetujui dan tidak dapat diubah. Warehouse Head dapat membatalkan dengan alasan.';
    case 'rejected':
      return 'Ditolak Supervisor dan tidak dapat diubah. Buat pergerakan baru bila perlu.';
    case 'cancelled':
      return 'Dibatalkan Warehouse Head dan tidak dapat diubah.';
    default:
      return '';
  }
}

const hasPerm = (user, code) => (user?.permissions || []).includes(code);
const editable = (status) => status === 'draft' || status === 'revision_requested';

export function canEditMovement(user, movement) {
  if (!movement || !editable(movement.status) || !hasPerm(user, 'warehouse.movement.update')) return false;
  return movement.permissions ? Boolean(movement.permissions.canEdit) : true;
}

export function canCancelMovement(user, movement) {
  if (!movement || movement.status !== 'approved' || !hasPerm(user, 'warehouse.movement.cancel')) return false;
  return movement.permissions ? Boolean(movement.permissions.canCancel) : true;
}

export function movementPayload(input) {
  return {
    movementDate: input.movementDate,
    referenceNo: blankToNull(input.referenceNo),
    party: blankToNull(input.party),
    notes: blankToNull(input.notes),
    items: (input.items || []).map(normalizeMovementItem),
  };
}

export function formFromMovement(movement) {
  return {
    movementDate: movement.movementDate || '',
    referenceNo: movement.referenceNo || '',
    party: movement.party || '',
    notes: movement.notes || '',
    items: (movement.items || []).map((item) => ({
      ...emptyMovementItem(),
      ...Object.fromEntries(Object.entries(item).map(([key, value]) => [key, value == null ? '' : String(value)])),
    })),
  };
}

export function todayLocal() {
  const date = new Date();
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const QUANTITY = new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 3 });

export function formatQuantity(value) {
  const number = Number(value);
  return Number.isFinite(number) ? QUANTITY.format(number) : String(value ?? '');
}
