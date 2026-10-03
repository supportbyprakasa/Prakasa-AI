// "Periksa dengan AI" on a Data Accurate batch (Prakasa AI Wave D2).
//
// A review is a set of NOTES for the Supervisor or Head who decides the batch.
// It reads; it never decides. Nothing in this file (or in the route and tool
// that use it) touches the approval engine, the batch status or the mirror:
// the only rows it writes are its own (accurate_batch_reviews), one audit row
// (activity_logs `accurate.batch_review`) and the AI usage count.
//
// Two parts:
//   1. findingsFor — deterministic, no model: the batch contents already stored
//      here (sales_accurate_batch_items) against the approved mirror
//      (accurate_latest). Accurate itself is never called.
//   2. writeNote — on demand, one model run: Prakasa AI (the Command Center's
//      own provider path) reads those findings through ONE read tool
//      (`periksa_batch_accurate`) and writes a short plain-language note.
//
// Who may see what: the batch service's own rule (batches.getBatch — the
// caller's division, or a batch they stand in to decide; anyone else gets 404).
// Rupiah appears only for a reader who holds the batch division's money
// permission, and never for purchase orders (purchase prices stay closed).
const pool = require('../db/pool');
const batches = require('./salesAccurateBatches.service');
const { log } = require('./activityLog.service');
const { memo } = require('../utils/memo');
const { WIB_OFFSET_MS } = require('../utils/wibTime');
const logger = require('../utils/logger');

const NAMESPACE = 'review:';
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_EXAMPLES = 5;
const MAX_NOTE_CHARS = 6000;
const AI_MODULE = 'ai_command_center';
const TOOL_NAME = 'periksa_batch_accurate';
const PURPOSE = 'accurate_batch_review';

function numberFromEnv(name, fallback, { min = 0 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min ? value : fallback;
}
// A value change on an existing document is "large" from this share, or this many rupiah.
const thresholds = () => ({
  valuePercent: numberFromEnv('ACCURATE_REVIEW_VALUE_PERCENT', 20, { min: 1 }),
  valueRupiah: numberFromEnv('ACCURATE_REVIEW_VALUE_RUPIAH', 10000000, { min: 1 }),
  backdatedDays: numberFromEnv('ACCURATE_REVIEW_BACKDATED_DAYS', 30, { min: 1 }),
});

// Whose money permission opens the rupiah of a batch, per division. A division
// not listed (Warehouse: no values; Procurement: purchase prices) shows none.
const MONEY_PERMISSION = Object.freeze({
  sales: 'sales.order.view',
  retail_commerce: 'sales.order.view',
  finance: 'finance.payable.view',
});
// The column that is "the value" of a document. Purchase orders are compared
// (so a large change is flagged) but their amounts are never shown to anyone.
const VALUE_COLUMN = Object.freeze({
  sales_order: 'dpp', sales_invoice: 'dpp', sales_return: 'dpp', sales_receipt: 'total',
  fin_purchase_invoice: 'total', fin_purchase_payment: 'total', pc_po: 'dpp',
});
const NEVER_SHOW_VALUE = new Set(['pc_po']);
// Documents sold to a customer: channel and customer master apply.
const CUSTOMER_DOCUMENTS = new Set(['sales_order', 'sales_invoice', 'delivery_order', 'sales_receipt', 'sales_return']);
const CHANNEL_TYPES = new Set(['customer', 'sales_order', 'sales_invoice', 'sales_return']);

const typeLabel = (type) => batches.RECORD_TYPES[type]?.label || type;
const isDocument = (type) => (batches.RECORD_TYPES[type]?.required || []).includes('trans_date');
const hasPerm = (user, code) => (user?.permissions || []).includes(code);

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

const wibDay = (value) => {
  const at = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(at) ? new Date(at + WIB_OFFSET_MS).toISOString().slice(0, 10) : null;
};
const dayOf = (value) => {
  if (!value) return null;
  if (value instanceof Date) return wibDay(value);
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};
const addDays = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const num = (value) => (value === null || value === undefined || value === '' || value === 'null' || !Number.isFinite(Number(value)) ? null : Number(value));
const parseJson = (value) => {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
};
const list = (value) => { const parsed = parseJson(value); return Array.isArray(parsed) ? parsed : []; };

// ------------------------------------------------------------------ reading

// One row per batch item: only the fields the checks need (never the whole
// document), next to the mirror's current version of the same record.
const scalar = (source, path) => `NULLIF(JSON_UNQUOTE(JSON_EXTRACT(${source}, '${path}')), 'null')`;
const ITEMS_SQL = `
  SELECT i.record_type AS type, i.action, i.external_key AS extKey, i.label,
         ${scalar('COALESCE(i.after_data, i.before_data)', '$.number')} AS number,
         ${scalar('COALESCE(i.after_data, i.before_data)', '$.trans_date')} AS transDate,
         ${scalar('COALESCE(i.after_data, i.before_data)', '$.customer_no')} AS customerNo,
         ${scalar('COALESCE(i.after_data, i.before_data)', '$.channel')} AS channel,
         ${scalar('i.after_data', '$.dpp_amount')} AS afterDpp, ${scalar('i.after_data', '$.total_amount')} AS afterTotal,
         ${scalar('i.before_data', '$.dpp_amount')} AS beforeDpp, ${scalar('i.before_data', '$.total_amount')} AS beforeTotal,
         JSON_EXTRACT(i.after_data, '$.data.so_numbers') AS soNumbers,
         JSON_EXTRACT(i.after_data, '$.data.lines[*].item_no') AS itemNos,
         m.version AS mirrorVersion, m.dpp_amount AS mirrorDpp, m.total_amount AS mirrorTotal
    FROM sales_accurate_batch_items i
    LEFT JOIN accurate_latest m
      ON m.entity_id = ? AND m.record_type = i.record_type AND m.accurate_id = CAST(i.external_key AS UNSIGNED)
   WHERE i.batch_id = ?
   ORDER BY i.id`;

// A number of this batch that another record of the approved mirror already uses.
const MIRROR_DUPLICATES_SQL = `
  SELECT i.record_type AS type, m.number
    FROM sales_accurate_batch_items i
    JOIN accurate_latest m
      ON m.entity_id = ? AND m.record_type = i.record_type AND m.accurate_id <> CAST(i.external_key AS UNSIGNED)
     AND m.number = ${scalar('i.after_data', '$.number')} COLLATE utf8mb4_unicode_ci
   WHERE i.batch_id = ? AND i.action = 'create' AND i.record_type IN (?)
   LIMIT 200`;

async function divisionCode(departmentId) {
  const [[row]] = await pool.query('SELECT code FROM departments WHERE id = ? LIMIT 1', [departmentId]);
  return row?.code || null;
}

async function knownCustomers(entityId, codes) {
  if (!codes.length) return new Set();
  const [rows] = await pool.query(
    'SELECT customer_code AS code FROM sales_customers WHERE entity_id = ? AND deleted_at IS NULL AND customer_code IN (?)',
    [entityId, codes],
  );
  return new Set(rows.map((r) => String(r.code)));
}

// Items with at least one unit in the approved unit master; null when the
// master is not approved yet (the check cannot say anything then).
async function itemsWithUnits(entityId, itemNos) {
  const [[any]] = await pool.query('SELECT EXISTS(SELECT 1 FROM item_units_accurate WHERE entity_id = ?) AS live', [entityId]);
  if (!Number(any?.live)) return null;
  if (!itemNos.length) return new Set();
  const [rows] = await pool.query('SELECT DISTINCT item_no AS itemNo FROM item_units_accurate WHERE entity_id = ? AND item_no IN (?)', [entityId, itemNos]);
  return new Set(rows.map((r) => String(r.itemNo)));
}

// ------------------------------------------------------------------ checks

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const rupiah = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

function finding({ code, severity, title, why, rows, example = null }) {
  if (!rows.length) return null;
  const seen = new Set();
  const examples = [];
  for (const r of rows) {
    const number = String(r.number || r.label || r.extKey || '').slice(0, 120);
    if (!number || seen.has(number)) continue;
    seen.add(number);
    examples.push({ number, type: r.type, ...(example ? example(r) : {}) });
    if (examples.length >= MAX_EXAMPLES) break;
  }
  return { code, severity, title, count: rows.length, examples, why };
}

/**
 * The deterministic checks over one batch. Pure: `items` are the rows of
 * ITEMS_SQL, everything else is passed in. Returns { contents, findings, notChecked }
 * with every value still attached (present() takes them out per reader).
 */
function check({ items, summary = null, pulledOn, mirrorDuplicates = [], customers = new Set(), unitItems = null, limits = thresholds() }) {
  const contents = new Map();
  for (const item of items) {
    if (!contents.has(item.type)) contents.set(item.type, { type: item.type, label: typeLabel(item.type), create: 0, update: 0, missing: 0 });
    const action = item.action === 'delete' ? 'missing' : item.action;
    if (contents.get(item.type)[action] !== undefined) contents.get(item.type)[action] += 1;
  }
  const docs = items.filter((i) => isDocument(i.type)).map((i) => ({ ...i, day: dayOf(i.transDate) }));
  const gone = (i) => i.action === 'missing' || i.action === 'delete';
  const monthStart = `${pulledOn.slice(0, 7)}-01`;
  const oldBefore = addDays(pulledOn, -limits.backdatedDays);
  const notChecked = [];

  // 1. a large change of value on a document the app already holds
  const changed = [];
  for (const i of items) {
    const column = VALUE_COLUMN[i.type];
    if (!column || i.action !== 'update') continue;
    const after = num(column === 'dpp' ? i.afterDpp : i.afterTotal);
    const before = num(column === 'dpp' ? (i.mirrorVersion != null ? i.mirrorDpp : i.beforeDpp) : (i.mirrorVersion != null ? i.mirrorTotal : i.beforeTotal));
    if (after == null || before == null || after === before) continue;
    const diff = Math.abs(after - before);
    const percent = before !== 0 ? (diff / Math.abs(before)) * 100 : 100;
    if (percent >= limits.valuePercent || diff >= limits.valueRupiah) changed.push({ ...i, before, after, diff, percent: Math.round(percent * 10) / 10 });
  }
  changed.sort((a, b) => b.diff - a.diff);

  // 2. the same number twice — inside the batch, or against the approved data
  const byNumber = new Map();
  for (const i of docs) {
    if (gone(i) || !i.number) continue;
    const key = `${i.type}|${String(i.number).trim().toLowerCase()}`;
    if (!byNumber.has(key)) byNumber.set(key, []);
    byNumber.get(key).push(i);
  }
  const duplicates = [...byNumber.values()].filter((rows) => rows.length > 1).map((rows) => rows[0]);
  const known = new Set(duplicates.map((d) => `${d.type}|${d.number}`));
  for (const d of mirrorDuplicates) if (!known.has(`${d.type}|${d.number}`)) { known.add(`${d.type}|${d.number}`); duplicates.push(d); }

  // 3. invoices without a sales order
  const noSo = items.filter((i) => i.type === 'sales_invoice' && !gone(i) && list(i.soNumbers).filter(Boolean).length === 0);

  // 4. customers the app master does not know
  const unknownCustomer = docs.filter((i) => CUSTOMER_DOCUMENTS.has(i.type) && !gone(i) && i.customerNo && !customers.has(String(i.customerNo)));
  const unknownCustomers = new Set(unknownCustomer.map((i) => String(i.customerNo)));

  // 5. items sold without a unit conversion
  let noUnit = [];
  if (unitItems === null) {
    if (items.some((i) => i.type === 'sales_invoice' && list(i.itemNos).length)) {
      notChecked.push({ code: 'BARANG_TANPA_KONVERSI_SATUAN', title: 'Barang tanpa konversi satuan', reason: 'Master satuan barang dari Accurate belum disetujui, jadi belum bisa dibandingkan.' });
    }
  } else {
    noUnit = items.filter((i) => i.type === 'sales_invoice' && !gone(i) && list(i.itemNos).some((no) => no && !unitItems.has(String(no))));
  }

  // 6. an empty channel (the channel decides the division and the dashboards)
  const noChannel = items.filter((i) => CHANNEL_TYPES.has(i.type) && !gone(i) && !String(i.channel || '').trim());

  // 7. dates
  const future = docs.filter((i) => !gone(i) && i.day && i.day > pulledOn);
  const backdated = docs.filter((i) => i.action !== 'create' && i.day && i.day < oldBefore);
  const earlierMonth = docs.filter((i) => i.day && i.day < monthStart);
  const earlierChanged = earlierMonth.filter((i) => i.action !== 'create');
  const missing = items.filter(gone);

  // 8. what the pull itself flagged (the batch summary)
  const checks = summary?.checks || {};
  const stockMismatch = Math.max(0, Number(checks.stock_sum?.mismatched) || 0);
  const unread = Object.values(checks.unread_documents || {}).reduce((n, v) => n + Number(v || 0), 0);
  const counted = (code, severity, title, count, why) => (count > 0 ? { code, severity, title, count, examples: [], why } : null);

  const findings = [
    finding({
      code: 'NILAI_BERUBAH_BESAR', severity: 'high', rows: changed,
      title: 'Nilai dokumen yang sudah ada berubah besar',
      why: `Nilainya berubah ${limits.valuePercent}% atau lebih, atau Rp ${rupiah.format(limits.valueRupiah)} atau lebih, dibanding data yang sudah disetujui. Pastikan perubahan di Accurate memang disengaja sebelum angka omzet, piutang atau utang ikut berubah.`,
      example: (r) => ({ percent: r.percent, ...(NEVER_SHOW_VALUE.has(r.type) ? {} : { before: r.before, after: r.after }) }),
    }),
    finding({
      code: 'TIDAK_ADA_LAGI', severity: missing.some((i) => isDocument(i.type)) ? 'high' : 'medium', rows: missing,
      title: 'Data yang tidak ada lagi di Accurate',
      why: 'Dokumen atau data ini pernah disetujui, tetapi sekarang tidak ditemukan di Accurate (dihapus atau dibatalkan). Bila disetujui, data itu ditandai "tidak ada lagi" dan keluar dari angka aplikasi.',
    }),
    finding({
      code: 'NOMOR_GANDA', severity: 'high', rows: duplicates,
      title: 'Nomor dokumen yang sama muncul dua kali',
      why: 'Nomor yang sama dipakai dua dokumen berbeda, di dalam batch ini atau dengan data yang sudah disetujui. Dokumen ganda membuat omzet, piutang atau stok terhitung dua kali.',
    }),
    finding({
      code: 'PERIODE_LALU', severity: earlierChanged.length ? 'high' : 'low', rows: earlierChanged.length ? earlierChanged : earlierMonth,
      title: earlierChanged.length ? 'Perubahan pada dokumen bulan sebelumnya' : 'Dokumen baru bertanggal bulan sebelumnya',
      why: earlierChanged.length
        ? 'Dokumen bertanggal bulan sebelumnya diubah atau hilang. Bila periodenya sudah ditutup atau dilaporkan, angka bulan itu ikut berubah.'
        : 'Dokumen baru bertanggal sebelum bulan berjalan. Wajar untuk tarikan pertama; untuk tarikan rutin, pastikan periodenya memang masih dibuka.',
    }),
    finding({
      code: 'UBAH_DOKUMEN_LAMA', severity: 'medium', rows: backdated,
      title: 'Perubahan pada dokumen lama',
      why: `Dokumen bertanggal lebih dari ${limits.backdatedDays} hari sebelum tarikan ini diubah atau hilang. Tanyakan siapa yang mengubahnya dan mengapa.`,
    }),
    finding({
      code: 'TANGGAL_MASA_DEPAN', severity: 'medium', rows: future,
      title: 'Dokumen bertanggal setelah hari tarikan',
      why: 'Tanggal dokumen lebih maju dari hari data ini ditarik. Biasanya salah ketik tanggal di Accurate.',
    }),
    finding({
      code: 'CUSTOMER_BELUM_DI_MASTER', severity: 'medium', rows: unknownCustomer,
      title: 'Dokumen untuk customer yang belum ada di master aplikasi',
      why: `Kode customer pada dokumen ini belum ada di master customer aplikasi (${unknownCustomers.size} kode). Dokumennya tidak terhubung ke customer mana pun sampai customer itu dibuat atau kodenya dibetulkan.`,
      example: (r) => ({ customerNo: String(r.customerNo) }),
    }),
    finding({
      code: 'CHANNEL_KOSONG', severity: 'medium', rows: noChannel,
      title: 'Channel kosong',
      why: 'Channel menentukan divisi pemilik data dan pengelompokan di dashboard. Tanpa channel, datanya masuk ke Sales dan tidak terhitung di channel mana pun.',
    }),
    finding({
      code: 'FAKTUR_TANPA_SO', severity: 'low', rows: noSo,
      title: 'Faktur tanpa sales order',
      why: 'Faktur ini tidak merujuk sales order. Status pengiriman dan pemenuhan order tidak bisa ditelusuri dari faktur seperti ini.',
    }),
    finding({
      code: 'BARANG_TANPA_KONVERSI_SATUAN', severity: 'low', rows: noUnit,
      title: 'Barang tanpa konversi satuan',
      why: 'Faktur memuat barang yang belum punya konversi satuan di master satuan. Jumlahnya tidak bisa dijumlahkan dalam satuan dasar.',
    }),
    counted('TARIKAN_TIDAK_LENGKAP', 'high', 'Bacaan Accurate tidak lengkap', checks.complete === false ? 1 : 0,
      'Tarikan ini tidak sempat membaca semua data dari Accurate. Tidak ada yang dinolkan, tetapi isi batch belum tentu lengkap; tarikan berikutnya membawa sisanya.'),
    counted('STOK_TIDAK_COCOK', 'medium', 'Stok per gudang tidak cocok dengan total', stockMismatch,
      'Untuk barang ini, jumlah stok di semua gudang tidak sama dengan total stoknya di Accurate. Periksa barangnya di Accurate sebelum stok dipakai di aplikasi.'),
    counted('DOKUMEN_BELUM_TERBACA', 'low', 'Dokumen belum terbaca pada tarikan ini', unread,
      'Sebagian dokumen belum sempat dibaca dan ikut tarikan berikutnya. Angka yang bergantung pada dokumen itu belum lengkap.'),
  ].filter(Boolean).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return { contents: [...contents.values()], findings, notChecked };
}

// ------------------------------------------------------------------ findings of one batch

async function computeFindings(batch, entityId) {
  const [items] = await pool.query(ITEMS_SQL, [entityId, batch.id]);
  const documentTypes = [...new Set(items.filter((i) => isDocument(i.type) && i.action === 'create').map((i) => i.type))];
  const [mirrorDuplicates] = documentTypes.length
    ? await pool.query(MIRROR_DUPLICATES_SQL, [entityId, batch.id, documentTypes])
    : [[]];
  const customerNos = [...new Set(items.filter((i) => CUSTOMER_DOCUMENTS.has(i.type) && i.customerNo).map((i) => String(i.customerNo)))];
  const itemNos = [...new Set(items.filter((i) => i.type === 'sales_invoice').flatMap((i) => list(i.itemNos)).filter(Boolean).map(String))];
  const customers = await knownCustomers(entityId, customerNos);
  const unitItems = itemNos.length ? await itemsWithUnits(entityId, itemNos) : new Set();
  const limits = thresholds();
  return {
    ...check({ items, summary: batch.summary, pulledOn: wibDay(batch.createdAt) || wibDay(Date.now()), mirrorDuplicates, customers, unitItems, limits }),
    itemCount: items.length,
    thresholds: limits,
  };
}

/**
 * What a reader may see of the stored findings: rupiah only with `money`.
 * Everything else — codes, counts, document numbers — is the same for everyone
 * who may open the batch.
 */
function present(result, { money = false } = {}) {
  return {
    ...result,
    money: Boolean(money),
    findings: (result.findings || []).map((f) => ({
      ...f,
      examples: (f.examples || []).map(({ before, after, ...rest }) => (money && before != null && after != null ? { ...rest, before, after } : rest)),
    })),
  };
}

async function scopeOf(user, batchId) {
  const id = Number(batchId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(404, 'NOT_FOUND', 'Batch data Accurate tidak ditemukan');
  // The batch service's own rule: own division, or a batch this user stands in
  // to decide. Another division's batch does not exist for this caller (404).
  const batch = await batches.getBatch(user, id);
  const code = await divisionCode(batch.departmentId);
  const permission = MONEY_PERMISSION[code] || null;
  return { batch, divisionCode: code, money: Boolean(permission && hasPerm(user, permission)) };
}

const batchOut = (batch) => ({
  id: batch.id, departmentName: batch.departmentName, status: batch.status, itemCount: batch.itemCount, createdAt: batch.createdAt,
});

/** The deterministic findings of a batch this user may see (cached per batch; no write). */
async function findingsFor(user, batchId, { money: wantMoney = true } = {}) {
  const { batch, money } = await scopeOf(user, batchId);
  const raw = await memo.get(`${NAMESPACE}${user.entityId}|${batch.id}|${batch.status}|${batch.itemCount}`, CACHE_TTL_MS,
    () => computeFindings(batch, user.entityId));
  return { batch: batchOut(batch), ...present(raw, { money: wantMoney && money }) };
}

// ------------------------------------------------------------------ stored review

const reviewOut = (row, findings, { money }) => ({
  ...present(findings, { money }),
  requestedByName: row.requested_by_name || null,
  createdAt: row.created_at,
  aiNote: row.ai_note || null,
  aiStatus: row.ai_status || null,
});

/** The last review of a batch (who ran it, when, findings, AI note), or null. */
async function latest(user, batchId) {
  const { batch, money } = await scopeOf(user, batchId);
  const [[row]] = await pool.query(
    `SELECT r.findings, r.ai_note, r.ai_status, r.created_at, u.name AS requested_by_name
       FROM accurate_batch_reviews r LEFT JOIN users u ON u.id = r.requested_by
      WHERE r.batch_id = ? AND r.entity_id = ? LIMIT 1`,
    [batch.id, user.entityId],
  );
  if (!row) return null;
  return { batch: batchOut(batch), ...reviewOut(row, parseJson(row.findings) || { findings: [], contents: [], notChecked: [] }, { money }) };
}

/**
 * Runs the deterministic review and keeps it as THE review of the batch (a
 * re-run replaces the earlier one, and clears its AI note). Audited with the
 * batch id and the finding codes only — never a value.
 */
async function run(user, batchId, { ai = false } = {}) {
  const { batch, money } = await scopeOf(user, batchId);
  const raw = await memo.get(`${NAMESPACE}${user.entityId}|${batch.id}|${batch.status}|${batch.itemCount}`, CACHE_TTL_MS,
    () => computeFindings(batch, user.entityId));
  await pool.query(
    `INSERT INTO accurate_batch_reviews (entity_id, batch_id, requested_by, findings, ai_note, ai_status)
     VALUES (?, ?, ?, ?, NULL, NULL)
     ON DUPLICATE KEY UPDATE requested_by = VALUES(requested_by), findings = VALUES(findings), ai_note = NULL, ai_status = NULL, created_at = CURRENT_TIMESTAMP`,
    [user.entityId, batch.id, user.sub, JSON.stringify(raw)],
  );
  await log({
    entityId: user.entityId, userId: user.sub, action: 'accurate.batch_review', subjectType: batches.SUBJECT_TYPE, subjectId: batch.id,
    metadata: { codes: raw.findings.map((f) => f.code), ai: Boolean(ai) },
  });
  return { batch: batchOut(batch), ...present(raw, { money }), requestedByName: null, createdAt: new Date().toISOString(), aiNote: null, aiStatus: null };
}

// ------------------------------------------------------------------ the AI note

// Never a verdict: a sentence that tells the human to approve or reject is
// taken out (the prompt forbids it; this is the second line).
const VERDICT = /[^.!?\n]*\b(sebaiknya|saya (?:me)?(?:sarankan|rekomendasikan)|rekomendasi saya|direkomendasikan|disarankan|should|recommend(?:ed)?|i suggest)\b[^.!?\n]*\b(setujui|menyetujui|disetujui|tolak|menolak|ditolak|approve[ds]?|reject(?:ed)?)\b[^.!?\n]*[.!?]?/gi;
const VERDICT_REMOVED = '(Kalimat yang menyarankan keputusan dihapus: keputusan ada pada Anda.)';
function cleanNote(text) {
  return String(text || '').replace(VERDICT, VERDICT_REMOVED).trim().slice(0, MAX_NOTE_CHARS);
}

function notePrompt(batch) {
  return [
    `TUGAS: tulis catatan pemeriksaan untuk batch Data Accurate #${batch.id} (divisi ${batch.departmentName}), untuk Supervisor atau Head yang akan memutuskannya sendiri.`,
    'Langkah: baca hasil pemeriksaan otomatis batch itu lewat alat pemeriksaan batch (cukup satu kali), lalu tulis catatan singkat, paling banyak 220 kata, dengan bahasa sehari-hari, dalam tiga bagian berjudul:',
    '1. "Isi batch" — apa saja yang ada di dalamnya (jenis data dan jumlah baru, berubah, tidak ada lagi).',
    '2. "Yang perlu dicermati" — setiap temuan, mengapa itu penting, dan paling banyak tiga nomor dokumen contoh, ditulis persis. Bila tidak ada temuan, tulis: "Tidak ada yang janggal menurut pemeriksaan otomatis."',
    '3. "Pertanyaan untuk tim sebelum memutuskan" — dua sampai empat pertanyaan konkret yang bisa ditanyakan ke admin Accurate atau tim terkait.',
    'ATURAN: kamu tidak memutuskan. Jangan menyarankan, merekomendasikan, atau menyimpulkan bahwa batch ini sebaiknya disetujui atau ditolak. Jangan menyebut angka rupiah. Jangan menambah temuan yang tidak ada di hasil alat. Jangan menutup dengan saran membuka halaman.',
  ].join('\n');
}

async function saveNote(entityId, batchId, { note = null, status }) {
  await pool.query('UPDATE accurate_batch_reviews SET ai_note = ?, ai_status = ? WHERE batch_id = ? AND entity_id = ?', [note, status, batchId, entityId]);
}

const UNAVAILABLE = Object.freeze({
  disabled: 'Prakasa AI sedang dimatikan, jadi catatan AI tidak dibuat. Hasil pemeriksaan otomatis di atas tetap berlaku.',
  provider: 'Mesin Prakasa AI untuk divisi Anda belum mendukung pemeriksaan ini. Hasil pemeriksaan otomatis di atas tetap berlaku.',
  not_configured: 'Prakasa AI belum diatur di server ini. Hasil pemeriksaan otomatis di atas tetap berlaku.',
  no_tools: 'Prakasa AI tidak tersedia untuk akun Anda. Hasil pemeriksaan otomatis di atas tetap berlaku.',
  failed: 'Prakasa AI belum bisa menulis catatan sekarang. Hasil pemeriksaan otomatis di atas tetap berlaku; coba lagi nanti.',
});

/**
 * One model run: Prakasa AI reads the findings through `periksa_batch_accurate`
 * (and nothing else) and writes the note. Private, no web research. Returns
 * { status: 'ok', note } or { status: <reason>, notice } — it never throws for
 * an unavailable engine or a reached daily limit: the findings stay.
 */
async function writeNote(user, batchId, { onDelta = null, onStatus = null } = {}) {
  const { batch } = await scopeOf(user, batchId);
  // Loaded here: the provider and the agent load the tools, which load this file.
  const agentRun = require('./ai/agent/agentRun');
  const aiProvider = require('./ai/provider');
  const done = async (status, notice) => {
    await saveNote(user.entityId, batch.id, { note: null, status }).catch(() => {});
    return { status, notice };
  };
  let decision;
  let agent = null;
  try {
    // The engine this user's answers run on (their division's, else the module's
    // default) — decided before anything is sent: tools exist on Claude Team only.
    const moduleContext = await aiProvider.getModuleContext(AI_MODULE);
    const access = await aiProvider.withAccessContext({ userId: user.sub });
    decision = await agentRun.decide({ user, session: agentRun.SCOPED_SESSION, provider: access.resolvedProvider || moduleContext.provider });
    if (!decision.ok) return done(decision.reason, decision.reason === 'daily_limit' ? `${decision.notice} Hasil pemeriksaan otomatis di atas tetap berlaku.` : (UNAVAILABLE[decision.reason] || UNAVAILABLE.failed));
    agent = await agentRun.prepareScoped({ user, toolNames: [TOOL_NAME], purpose: PURPOSE, subjectId: batch.id });
  } catch (error) {
    logger.error({ err: error.message, batchId: batch.id }, 'accurate batch review: agent not available');
    return done('failed', UNAVAILABLE.failed);
  }
  const startedAt = Date.now();
  try {
    const language = await agentRun.userLanguage(user.sub);
    const result = await aiProvider.runModule(AI_MODULE, notePrompt(batch), {
      entityId: user.entityId, userId: user.sub, subjectType: batches.SUBJECT_TYPE, subjectId: batch.id, userEmail: user.email || null,
      onDelta: typeof onDelta === 'function' ? onDelta : () => {},
      onStatus: typeof onStatus === 'function' ? onStatus : null,
      agent, language, webResearch: null,
    });
    if (!result.agentUsed) return done('provider', UNAVAILABLE.provider);
    const note = cleanNote(result.content);
    if (!note) return done('failed', UNAVAILABLE.failed);
    await saveNote(user.entityId, batch.id, { note, status: 'ok' });
    // Counts toward the user's daily agent limit, like an answer in the chat.
    await pool.query(
      `INSERT INTO ai_usage_events (session_id, message_id, entity_id, department_id, user_id, module, provider, model, event_type, tokens_in, tokens_out, duration_ms, metadata_json)
       VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, 'agent_message', ?, ?, ?, ?)`,
      [user.entityId, user.departmentId || null, user.sub, PURPOSE, result.provider || null, result.model || null,
        result.tokensIn ?? null, result.tokensOut ?? null, Date.now() - startedAt, JSON.stringify({ batchId: batch.id, tools: [TOOL_NAME] })],
    ).catch(() => {});
    return { status: 'ok', note };
  } catch (error) {
    logger.error({ err: error.message, code: error.code, batchId: batch.id }, 'accurate batch review: AI note failed');
    return done('failed', UNAVAILABLE.failed);
  } finally {
    await agent.cleanup();
  }
}

module.exports = {
  NAMESPACE, TOOL_NAME, PURPOSE, MAX_EXAMPLES, MONEY_PERMISSION, thresholds, check, present, findingsFor, latest, run, writeNote, cleanNote, notePrompt,
};
