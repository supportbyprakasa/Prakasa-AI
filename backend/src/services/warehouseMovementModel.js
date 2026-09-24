// Warehouse inbound/outbound movement rules, independent of Express and MySQL.
// Approved movements stay in Prakasa Workspace; no external posting happens here.

const MOVEMENT_TYPES = Object.freeze({
  inbound: Object.freeze({
    type: 'inbound',
    table: 'warehouse_inbound',
    dateColumn: 'inbound_date',
    partyColumn: 'supplier',
    partyMaxLength: 190,
    legacyUserColumn: 'received_by',
    requestType: 'warehouse_inbound',
    subjectType: 'warehouse_inbound',
    label: 'Barang Masuk',
  }),
  outbound: Object.freeze({
    type: 'outbound',
    table: 'warehouse_outbound',
    dateColumn: 'outbound_date',
    partyColumn: 'destination',
    partyMaxLength: 255,
    legacyUserColumn: 'released_by',
    requestType: 'warehouse_outbound',
    subjectType: 'warehouse_outbound',
    label: 'Barang Keluar',
  }),
});

const STATUS = Object.freeze({
  DRAFT: 'draft',
  PENDING: 'pending_approval',
  REVISION: 'revision_requested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
});

const TRANSITIONS = Object.freeze({
  [STATUS.DRAFT]: [STATUS.PENDING],
  [STATUS.PENDING]: [STATUS.APPROVED, STATUS.REVISION, STATUS.REJECTED],
  [STATUS.REVISION]: [STATUS.DRAFT],
  [STATUS.APPROVED]: [STATUS.CANCELLED],
  [STATUS.REJECTED]: [],
  [STATUS.CANCELLED]: [],
});

const MAX_ITEMS = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function movementError(message, status = 400, code = 'VALIDATION_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function typeConfig(type) {
  const config = MOVEMENT_TYPES[type];
  if (!config) throw movementError('Jenis pergerakan tidak dikenal', 400);
  return config;
}

function typeForSubject(subjectType) {
  return Object.values(MOVEMENT_TYPES).find((config) => config.subjectType === subjectType)?.type || null;
}

function assertMovementTransition(from, to) {
  if (!(TRANSITIONS[from] || []).includes(to)) {
    throw movementError(`Status tidak dapat berubah dari ${from} ke ${to}`, 409, 'INVALID_TRANSITION');
  }
}

const isEditableStatus = (status) => status === STATUS.DRAFT || status === STATUS.REVISION;

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function optionalText(value, maxLength, label) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > maxLength) throw movementError(`${label} maksimal ${maxLength} karakter`);
  return text;
}

function normalizeItem(raw, index) {
  const row = `Baris ${index + 1}`;
  if (!raw || typeof raw !== 'object') throw movementError(`${row}: data barang tidak valid`);

  const product = optionalText(raw.product, 190, `${row}: Produk`);
  if (!product) throw movementError(`${row}: Produk wajib diisi`);
  const unit = optionalText(raw.unit, 40, `${row}: Satuan`);
  if (!unit) throw movementError(`${row}: Satuan wajib diisi`);

  const quantity = raw.quantity === '' || raw.quantity === null ? NaN : Number(raw.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw movementError(`${row}: Jumlah harus angka lebih dari 0`);
  }

  const expiresOn = optionalText(raw.expiresOn, 10, `${row}: Tanggal kedaluwarsa`);
  if (expiresOn && !isValidDate(expiresOn)) {
    throw movementError(`${row}: Tanggal kedaluwarsa harus berformat YYYY-MM-DD`);
  }

  return {
    sku: optionalText(raw.sku, 80, `${row}: SKU`),
    product,
    quantity,
    unit,
    batchNo: optionalText(raw.batchNo, 80, `${row}: Batch`),
    expiresOn,
    location: optionalText(raw.location, 120, `${row}: Lokasi`),
    note: optionalText(raw.note, 500, `${row}: Catatan`),
  };
}

function assertUniqueSkuRows(items) {
  const seen = new Map();
  items.forEach((item, index) => {
    if (!item.sku) return;
    const key = [item.sku.toLowerCase(), (item.batchNo || '').toLowerCase(), (item.location || '').toLowerCase()].join('|');
    if (seen.has(key)) {
      throw movementError(
        `SKU ${item.sku} muncul di baris ${seen.get(key) + 1} dan ${index + 1} dengan batch dan lokasi yang sama`,
      );
    }
    seen.set(key, index);
  });
}

function validateMovementInput(input, { partyMaxLength = 255 } = {}) {
  if (!input || typeof input !== 'object') throw movementError('Data pergerakan tidak valid');
  if (!isValidDate(input.movementDate)) throw movementError('Tanggal transaksi harus berformat YYYY-MM-DD');
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw movementError('Pergerakan barang memerlukan minimal satu barang');
  }
  if (input.items.length > MAX_ITEMS) throw movementError(`Maksimal ${MAX_ITEMS} baris barang`);

  const items = input.items.map(normalizeItem);
  assertUniqueSkuRows(items);

  return {
    movementDate: input.movementDate,
    referenceNo: optionalText(input.referenceNo, 80, 'Nomor referensi'),
    party: optionalText(input.party, partyMaxLength, 'Supplier/tujuan'),
    notes: optionalText(input.notes, 5000, 'Catatan'),
    items,
  };
}

function requireDecisionNote(action, note) {
  if ((action === 'reject' || action === 'request_revision') && !String(note || '').trim()) {
    throw movementError('Catatan wajib untuk permintaan revisi atau penolakan');
  }
}

function parseItems(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Local calendar date: DATE columns come back as local-midnight Date objects.
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const nullable = (value) => (value === undefined || value === '' ? null : value);

function movementDto(row, type) {
  const config = typeConfig(type);
  return {
    id: row.id,
    type: config.type,
    typeLabel: config.label,
    entityId: row.entity_id,
    departmentId: row.department_id,
    movementDate: dateOnly(row[config.dateColumn]),
    referenceNo: row.reference_no || null,
    party: row[config.partyColumn] || null,
    notes: row.notes || null,
    items: parseItems(row.items).map((item) => ({
      sku: nullable(item.sku) ?? null,
      product: item.product,
      quantity: Number(item.quantity),
      unit: item.unit,
      batchNo: nullable(item.batchNo) ?? null,
      expiresOn: nullable(item.expiresOn) ?? null,
      location: nullable(item.location) ?? null,
      note: nullable(item.note) ?? null,
    })),
    status: row.status,
    version: Number(row.version || 1),
    createdBy: row.created_by ?? null,
    createdByName: row.created_by_name ?? null,
    submittedBy: row.submitted_by ?? null,
    submittedByName: row.submitted_by_name ?? null,
    submittedAt: row.submitted_at ?? null,
    approvalRequestId: row.approval_request_id ?? null,
    approvedBy: row.approved_by ?? null,
    approvedByName: row.approved_by_name ?? null,
    approvedAt: row.approved_at ?? null,
    rejectedBy: row.rejected_by ?? null,
    rejectedAt: row.rejected_at ?? null,
    decisionNote: row.decision_note ?? null,
    cancelledBy: row.cancelled_by ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancellationReason: row.cancellation_reason ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

module.exports = {
  MOVEMENT_TYPES,
  STATUS,
  TRANSITIONS,
  movementError,
  typeConfig,
  typeForSubject,
  assertMovementTransition,
  isEditableStatus,
  isValidDate,
  validateMovementInput,
  requireDecisionNote,
  movementDto,
};
