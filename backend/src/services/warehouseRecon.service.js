const pool = require('../db/pool');
const { log } = require('./activityLog.service');
const { likeTerm } = require('./salesQuery');
const model = require('./warehouseReconModel');

// Pencocokan Barang Masuk/Keluar ↔ dokumen Accurate (program 3.2). Reads the
// views of migrations 094 and 104 (app movements vs approved Accurate warehouse
// documents, quantities only; a difference the mirror cannot judge yet — a
// Warehouse batch still waiting — is "waiting"). The Warehouse Supervisor/Head may pair a
// movement with a document by hand or explain a difference; both are kept in
// app tables (093) and are cancelled, never deleted. Accurate is never written.
// The company always comes from the signed-in user.

const TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
const RESOLVE = 'warehouse.recon.resolve';
const WAITING = "('draft', 'pending_approval', 'revision_requested')";
const MOVEMENTS = Object.freeze({
  inbound: { table: 'warehouse_inbound', dateColumn: 'inbound_date' },
  outbound: { table: 'warehouse_outbound', dateColumn: 'outbound_date' },
});

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
const notFound = () => httpError(404, 'NOT_FOUND', 'Pencocokan tidak ditemukan');
// A real calendar date only (2026-02-31 is not), so MySQL never has to guess.
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const qty = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 10000) / 10000);
const has = (user, perm) => (user?.permissions || []).includes(perm);

const LIST_COLUMNS = `g.direction, g.group_key, g.status, g.explained, g.reference_no, g.party, g.movement_count, g.movement_ids,
  g.first_movement_id, g.first_date, g.last_date, g.doc_count, g.doc_numbers, g.match_kinds, g.first_doc_id, g.item_count,
  g.diff_items, g.unknown_lines, g.missing_item_lines, g.pending_movements, g.since, g.judged, g.data_through, g.signature,
  g.note_id, g.note_reason, g.note_at`;
const GROUP_SELECT = `SELECT ${LIST_COLUMNS}, nu.name AS note_by_name, DATEDIFF(${TODAY}, g.since) AS days_open
  FROM wh_recon_groups g LEFT JOIN users nu ON nu.id = g.note_by`;
const STATUS_ORDER = "'qty_diff', 'app_only', 'acc_only', 'uncomparable', 'matched'";

// ------------------------------------------------------------------ list

async function list(entityId, {
  status = 'open', direction, from, to, q, page = 1, limit = 25,
} = {}) {
  const filter = model.FILTERS.includes(status) ? status : 'open';
  let base = 'g.entity_id = ?';
  const args = [entityId];
  if (model.DIRECTIONS.includes(direction)) { base += ' AND g.direction = ?'; args.push(direction); }
  if (isDay(from)) { base += ' AND g.last_date >= ?'; args.push(from); }
  if (isDay(to)) { base += ' AND g.first_date <= ?'; args.push(to); }
  const like = likeTerm(q);
  if (like) { base += ' AND (g.reference_no LIKE ? OR g.doc_numbers LIKE ? OR g.party LIKE ?)'; args.push(like, like, like); }
  const sf = model.statusFilter(filter);
  const size = Math.min(100, Math.max(1, Number(limit) || 25));
  const offset = (Math.max(1, Number(page) || 1) - 1) * size;
  // Problems oldest first (the longest-open on top, those still waiting for
  // Accurate data after them); matched/explained newest first.
  const order = ['matched', 'explained', 'all'].includes(filter) ? 'DESC' : 'ASC';
  const orderBy = (a) => `${filter === 'open' ? `${a}.judged DESC, ` : ''}FIELD(${a}.status, ${STATUS_ORDER}), ${a}.since ${order}, ${a}.group_key`;

  const [[rows], [[ready]]] = await Promise.all([
    // Counts and the page in one statement: the groups are computed once.
    // DISTINCT changes nothing (a group is one row) but keeps MySQL from
    // merging g into both references, which would evaluate the view twice.
    pool.query(
      `WITH g AS (SELECT DISTINCT ${LIST_COLUMNS}, g.note_by FROM wh_recon_groups g WHERE ${base})
       SELECT c.c_open, c.c_qty_diff, c.c_app_only, c.c_acc_only, c.c_uncomparable, c.c_waiting, c.c_explained, c.c_matched, c.c_all,
              c.c_data_through, p.*
         FROM (SELECT COALESCE(SUM(g.status <> 'matched' AND g.explained = 0), 0) AS c_open,
                      COALESCE(SUM(g.status = 'qty_diff' AND g.explained = 0 AND g.judged = 1), 0) AS c_qty_diff,
                      COALESCE(SUM(g.status = 'app_only' AND g.explained = 0 AND g.judged = 1), 0) AS c_app_only,
                      COALESCE(SUM(g.status = 'acc_only' AND g.explained = 0 AND g.judged = 1), 0) AS c_acc_only,
                      COALESCE(SUM(g.status = 'uncomparable' AND g.explained = 0 AND g.judged = 1), 0) AS c_uncomparable,
                      COALESCE(SUM(g.status <> 'matched' AND g.explained = 0 AND g.judged = 0), 0) AS c_waiting,
                      COALESCE(SUM(g.explained = 1), 0) AS c_explained,
                      COALESCE(SUM(g.status = 'matched'), 0) AS c_matched,
                      COUNT(*) AS c_all, MAX(g.data_through) AS c_data_through
                 FROM g) c
         LEFT JOIN (SELECT g.*, nu.name AS note_by_name, DATEDIFF(${TODAY}, g.since) AS days_open
                      FROM g LEFT JOIN users nu ON nu.id = g.note_by
                     WHERE 1 = 1${sf.sql}
                     ORDER BY ${orderBy('g')}
                     LIMIT ? OFFSET ?) p ON TRUE
        ORDER BY ${orderBy('p')}`,
      [...args, ...sf.args, size, offset],
    ),
    // The day each direction's check starts = the first APPROVAL that way (a
    // back-dated first movement does not pull older Accurate documents in).
    pool.query(
      `SELECT (SELECT COUNT(*) FROM accurate_records r
                WHERE r.entity_id = ? AND r.record_type IN ('wh_receipt', 'wh_delivery', 'wh_transfer', 'wh_adjustment')) AS docs,
              (SELECT COUNT(*) FROM accurate_records r WHERE r.entity_id = ? AND r.record_type = 'wh_item_unit') AS units,
              (SELECT MIN(h.approved_day) FROM wh_recon_movements_app h WHERE h.entity_id = ? AND h.direction = 'inbound' AND h.in_scope = 1) AS inbound_from,
              (SELECT MIN(h.approved_day) FROM wh_recon_movements_app h WHERE h.entity_id = ? AND h.direction = 'outbound' AND h.in_scope = 1) AS outbound_from`,
      [entityId, entityId, entityId, entityId],
    ),
  ]);

  const c = rows[0] || {};
  const countMap = Object.fromEntries(model.FILTERS.map((key) => [key, model.int(c[`c_${key}`])]));
  return {
    items: rows.filter((r) => r.group_key != null).map(model.groupDto),
    total: countMap[filter],
    counts: countMap,
    readiness: {
      documents: model.int(ready?.docs),
      units: model.int(ready?.units),
      inboundFrom: model.day(ready?.inbound_from),
      outboundFrom: model.day(ready?.outbound_from),
      reconFrom: model.RECON_FROM,
      windowDays: model.RECON_WINDOW_DAYS,
      graceDays: model.RECON_GRACE_DAYS,
      // The day through which the Warehouse mirror is complete (null: no pull recorded yet).
      dataThrough: model.day(c.c_data_through),
    },
  };
}

// ------------------------------------------------------------------ detail

function assertKey(direction, groupKey) {
  if (!model.DIRECTIONS.includes(direction) || !model.GROUP_KEY_RE.test(String(groupKey || ''))) throw notFound();
}

async function loadGroup(entityId, direction, groupKey) {
  const [[row]] = await pool.query(
    `${GROUP_SELECT} WHERE g.entity_id = ? AND g.direction = ? AND g.group_key = ? LIMIT 1`,
    [entityId, direction, groupKey],
  );
  if (!row) throw notFound();
  return row;
}

// Who recorded/submitted the group's movements (for segregation of duties only; never returned).
async function groupMovers(entityId, direction, groupKey) {
  const [rows] = await pool.query(
    `SELECT h.movement_id, h.created_by, h.submitted_by FROM wh_recon_movements_app h
      WHERE h.entity_id = ? AND h.direction = ? AND h.group_key = ? AND h.in_scope = 1`,
    [entityId, direction, groupKey],
  );
  return rows;
}

const lineDto = (l) => ({
  docType: l.doc_type || undefined,
  docId: l.doc_id == null ? undefined : Number(l.doc_id),
  number: l.number || undefined,
  movementId: l.movement_id == null ? undefined : Number(l.movement_id),
  lineNo: model.int(l.line_no),
  itemNo: (l.item_no ?? l.sku) || null,
  itemName: (l.item_name ?? l.product) || null,
  qty: qty(l.qty),
  unit: l.unit || null,
  unitRatio: qty(l.unit_ratio),
  qtyBase: qty(l.qty_base),
});

const documentDto = (d) => ({
  docType: d.doc_type,
  docId: Number(d.doc_id ?? d.id),
  number: d.number,
  date: model.day(d.trans_date),
  party: d.party || null,
  supplierDo: d.supplier_do || null,
  lineCount: model.int(d.line_count),
  matchKind: d.match_kind || null,
  link: d.link_id ? { id: Number(d.link_id), reason: d.link_reason || null, at: d.link_at || null, byName: d.link_by_name || null } : null,
});

async function liveNote(entityId, direction, groupKey, signature) {
  const [[n]] = await pool.query(
    `SELECT n.id, n.status, n.signature, n.reason, n.created_at, u.name AS by_name
       FROM warehouse_recon_notes n LEFT JOIN users u ON u.id = n.created_by
      WHERE n.entity_id = ? AND n.direction = ? AND n.group_key = ? AND n.cancelled_at IS NULL
      LIMIT 1`,
    [entityId, direction, groupKey],
  );
  if (!n) return null;
  return { id: Number(n.id), status: n.status, reason: n.reason, at: n.created_at || null, byName: n.by_name || null, lapsed: n.signature !== signature };
}

// Base unit per item: the approved "Satuan barang", else the unit a line used at ratio 1.
async function baseUnitsFor(entityId, keys, lines) {
  const map = new Map();
  for (const l of lines) {
    const key = String(l.item_no ?? l.sku ?? '').trim().toUpperCase();
    if (key && Number(l.unit_ratio) === 1 && l.unit && !map.has(key)) map.set(key, l.unit);
  }
  if (keys.length) {
    const [rows] = await pool.query(
      'SELECT u.item_no, u.base_unit FROM item_units_accurate u WHERE u.entity_id = ? AND u.is_base = 1 AND u.item_no IN (?)',
      [entityId, keys],
    );
    for (const r of rows) if (r.item_no && r.base_unit) map.set(String(r.item_no).toUpperCase(), r.base_unit);
  }
  return map;
}

async function detail(user, direction, groupKey) {
  assertKey(direction, groupKey);
  const entityId = user.entityId;
  const row = await loadGroup(entityId, direction, groupKey);
  const group = model.groupDto(row);
  const canResolve = has(user, RESOLVE);

  if (row.status === 'acc_only') {
    const doc = model.parseDocGroupKey(groupKey);
    const [[[d]], [lines], [waiting], note] = await Promise.all([
      pool.query(
        `SELECT d.id, d.doc_type, d.number, d.trans_date, d.party, d.supplier_do, d.so_numbers, d.po_numbers, d.line_count
           FROM wh_documents_accurate d WHERE d.entity_id = ? AND d.doc_type = ? AND d.id = ?`,
        [entityId, doc.docType, doc.docId],
      ),
      pool.query(
        `SELECT l.doc_type, l.doc_id, l.number, l.line_no, l.item_no, l.item_name, l.qty, l.unit, l.unit_ratio, l.qty_base
           FROM wh_recon_doc_lines_accurate l
          WHERE l.entity_id = ? AND l.record_type = ? AND l.doc_id = ? AND l.direction = ?
          ORDER BY l.line_no`,
        [entityId, `wh_${doc.docType}`, doc.docId, direction],
      ),
      pool.query(
        `SELECT h.movement_id, h.status, h.reference_no, h.movement_date
           FROM wh_recon_doc_keys_accurate k
           JOIN wh_recon_movements_app h ON h.match_key = k.match_key
          WHERE k.entity_id = ? AND k.doc_type = ? AND k.doc_id = ? AND h.status IN ${WAITING}
          GROUP BY h.movement_id, h.status, h.reference_no, h.movement_date
          ORDER BY h.movement_id`,
        [entityId, doc.docType, doc.docId],
      ),
      liveNote(entityId, direction, groupKey, row.signature),
    ]);
    return {
      group,
      documents: d ? [documentDto(d)] : [],
      movements: [],
      items: [],
      lines: { app: [], accurate: lines.map(lineDto) },
      waitingMovements: waiting.map((w) => ({ id: Number(w.movement_id), status: w.status, referenceNo: w.reference_no || null, date: model.day(w.movement_date) })),
      note,
      permissions: {
        canExplain: canResolve && !group.explained,
        canUnexplain: canResolve && Boolean(note),
        canLink: false,
        canUnlink: false,
        resolveBlockedReason: null,
      },
    };
  }

  const args = [entityId, direction, groupKey];
  const [[movements], [documents], [items], [appLines], [accLines], note] = await Promise.all([
    pool.query(
      `SELECT h.movement_id, h.movement_date, h.status, h.reference_no, h.party, h.approved_at, h.created_by, h.submitted_by,
              cu.name AS created_by_name
         FROM wh_recon_movements_app h LEFT JOIN users cu ON cu.id = h.created_by
        WHERE h.entity_id = ? AND h.direction = ? AND h.group_key = ? AND h.in_scope = 1
        ORDER BY h.movement_id`,
      args,
    ),
    pool.query(
      `SELECT s.doc_type, s.doc_id, s.match_kind, d.number, d.trans_date, d.party, d.supplier_do, d.line_count,
              k.id AS link_id, k.reason AS link_reason, k.created_at AS link_at, ku.name AS link_by_name
         FROM wh_recon_assign s
         JOIN wh_documents_accurate d ON d.entity_id = s.entity_id AND d.doc_type = s.doc_type AND d.id = s.doc_id
         LEFT JOIN warehouse_recon_links k ON k.entity_id = s.entity_id AND s.match_kind = 'manual'
              AND k.live_doc = CONCAT(s.direction, ':', s.doc_type, ':', s.doc_id)
         LEFT JOIN users ku ON ku.id = k.created_by
        WHERE s.entity_id = ? AND s.direction = ? AND s.group_key = ?
        ORDER BY d.trans_date, d.number`,
      args,
    ),
    pool.query(
      `SELECT i.item_key, i.item_name, i.app_qty_base, i.acc_qty_base, i.app_lines, i.acc_lines, i.unknown_lines
         FROM wh_recon_items i
        WHERE i.entity_id = ? AND i.direction = ? AND i.group_key = ?
        ORDER BY i.item_key IS NULL, i.item_key`,
      args,
    ),
    pool.query(
      `SELECT a.movement_id, a.line_no, a.sku, a.product, a.qty, a.unit, a.unit_ratio, a.qty_base
         FROM wh_recon_app_lines a
        WHERE a.entity_id = ? AND a.direction = ? AND a.group_key = ? AND a.in_scope = 1
        ORDER BY a.movement_id, a.line_no`,
      args,
    ),
    pool.query(
      `SELECT l.doc_type, l.doc_id, l.number, l.line_no, l.item_no, l.item_name, l.qty, l.unit, l.unit_ratio, l.qty_base
         FROM wh_recon_assign s
         JOIN wh_recon_doc_lines_accurate l
           ON l.entity_id = s.entity_id AND l.record_type = CONCAT('wh_', s.doc_type) AND l.doc_id = s.doc_id AND l.direction = s.direction
        WHERE s.entity_id = ? AND s.direction = ? AND s.group_key = ?
        ORDER BY l.doc_type, l.doc_id, l.line_no`,
      args,
    ),
    liveNote(entityId, direction, groupKey, row.signature),
  ]);

  const keys = [...new Set(items.map((i) => i.item_key).filter(Boolean))];
  const baseUnits = await baseUnitsFor(entityId, keys, [...accLines, ...appLines]);
  const blocked = canResolve ? model.selfResolveReason(user.sub, movements) : null;
  const may = canResolve && !blocked;
  return {
    group,
    movements: movements.map((m) => ({
      id: Number(m.movement_id),
      date: model.day(m.movement_date),
      status: m.status,
      referenceNo: m.reference_no || null,
      party: m.party || null,
      approvedAt: m.approved_at || null,
      createdByName: m.created_by_name || null,
    })),
    documents: documents.map(documentDto),
    items: items.map((i) => model.itemDto(i, baseUnits)),
    lines: { app: appLines.map(lineDto), accurate: accLines.map(lineDto) },
    waitingMovements: [],
    note,
    permissions: {
      canExplain: may && group.status !== 'matched' && !group.explained,
      canUnexplain: may && Boolean(note),
      canLink: may && group.status !== 'matched' && group.movementCount > 0,
      canUnlink: may,
      resolveBlockedReason: blocked,
    },
  };
}

// ------------------------------------------------------------------ movement card

async function forMovement(entityId, type, id) {
  if (!model.DIRECTIONS.includes(type) || !Number.isInteger(id) || id <= 0) throw notFound();
  const [[row]] = await pool.query(
    `SELECT h.direction, h.group_key, h.in_scope, h.status AS movement_status, h.movement_date
       FROM wh_recon_movements_app h
      WHERE h.entity_id = ? AND h.direction = ? AND h.movement_id = ?
      LIMIT 1`,
    [entityId, type, id],
  );
  if (!row) throw httpError(404, 'NOT_FOUND', 'Pergerakan tidak ditemukan');
  if (!model.int(row.in_scope)) {
    // An approved movement out of scope lies before the window: before RECON_FROM
    // while the window has not moved past it, else more than RECON_WINDOW_DAYS ago.
    const windowFrom = model.windowFrom();
    const reason = row.movement_status !== 'approved' ? 'not_approved' : windowFrom > model.RECON_FROM ? 'outside_window' : 'before_recon_from';
    return { inScope: false, reason, reconFrom: model.RECON_FROM, windowFrom, windowDays: model.RECON_WINDOW_DAYS };
  }
  // The group only for a movement in scope (the view is the expensive part).
  const [[g]] = await pool.query(
    `SELECT g.status, g.explained, g.doc_numbers, g.doc_count, g.since, g.docs_ready, g.judged, g.data_through
       FROM wh_recon_groups g
      WHERE g.entity_id = ? AND g.direction = ? AND g.group_key = ?
      LIMIT 1`,
    [entityId, row.direction, row.group_key],
  );
  return {
    inScope: true,
    direction: row.direction,
    groupKey: row.group_key,
    status: g?.status || null,
    explained: Boolean(model.int(g?.explained)),
    docsReady: Boolean(model.int(g?.docs_ready)),
    judged: g?.judged == null ? true : Boolean(model.int(g.judged)),
    dataThrough: model.day(g?.data_through),
    docNumbers: g?.doc_numbers ? String(g.doc_numbers).split(', ').filter(Boolean) : [],
    docCount: model.int(g?.doc_count),
    link: model.reconLink(row.direction, row.group_key),
  };
}

// ------------------------------------------------------------------ manual pairing

async function candidates(user, direction, groupKey, q) {
  assertKey(direction, groupKey);
  const entityId = user.entityId;
  const row = await loadGroup(entityId, direction, groupKey);
  if (row.status === 'acc_only') throw httpError(409, 'CONFLICT', 'Pasangkan dari sisi pergerakan: buka pergerakannya, lalu pilih dokumen Accurate ini.');
  const from = model.day(row.first_date);
  const to = model.day(row.last_date);
  const like = likeTerm(q);
  const cond = like ? 'k.number LIKE ?' : 's.doc_id IS NULL AND k.trans_date BETWEEN ? - INTERVAL 14 DAY AND ? + INTERVAL 14 DAY';
  const [[appKeys], [docs]] = await Promise.all([
    pool.query(
      `SELECT DISTINCT a.item_key FROM wh_recon_app_lines a
        WHERE a.entity_id = ? AND a.direction = ? AND a.group_key = ? AND a.in_scope = 1 AND a.item_key IS NOT NULL`,
      [entityId, direction, groupKey],
    ),
    pool.query(
      `SELECT k.doc_type, k.doc_id, k.number, k.trans_date, d.party, d.line_count, s.group_key AS assigned_to
         FROM (SELECT DISTINCT entity_id, doc_type, doc_id, number, trans_date, direction
                 FROM wh_recon_doc_keys_accurate WHERE priority = 1) k
         JOIN wh_documents_accurate d ON d.entity_id = k.entity_id AND d.doc_type = k.doc_type AND d.id = k.doc_id
         LEFT JOIN wh_recon_assign s ON s.entity_id = k.entity_id AND s.doc_type = k.doc_type AND s.doc_id = k.doc_id AND s.direction = k.direction
        WHERE k.entity_id = ? AND k.direction = ? AND ${cond}
        ORDER BY k.trans_date DESC, k.number
        LIMIT 50`,
      like ? [entityId, direction, like] : [entityId, direction, from, to],
    ),
  ]);
  const others = docs.filter((d) => d.assigned_to !== groupKey);
  if (!others.length) return [];
  const [lines] = await pool.query(
    `SELECT l.doc_type, l.doc_id, l.item_key FROM wh_recon_doc_lines_accurate l
      WHERE l.entity_id = ? AND l.direction = ? AND (l.doc_type, l.doc_id) IN (?)`,
    [entityId, direction, others.map((d) => [d.doc_type, Number(d.doc_id)])],
  );
  const keysOf = new Map();
  for (const l of lines) {
    const k = `${l.doc_type}:${l.doc_id}`;
    if (!keysOf.has(k)) keysOf.set(k, []);
    keysOf.get(k).push(l.item_key);
  }
  return model.rankCandidates(
    appKeys.map((a) => a.item_key),
    others.map((d) => ({
      docType: d.doc_type,
      docId: Number(d.doc_id),
      number: d.number,
      date: model.day(d.trans_date),
      party: d.party || null,
      lineCount: model.int(d.line_count),
      assignedTo: d.assigned_to || null,
      itemKeys: keysOf.get(`${d.doc_type}:${d.doc_id}`) || [],
    })),
    { from, to },
  ).map(({ itemKeys, ...rest }) => rest);
}

async function link(user, {
  direction, movementId, docType, docId, reason,
}) {
  const config = MOVEMENTS[direction];
  if (!config || !model.DOC_TYPES.includes(docType)) throw httpError(400, 'VALIDATION_ERROR', 'Arah atau jenis dokumen tidak dikenal');
  const entityId = user.entityId;
  const [[movement]] = await pool.query(
    `SELECT id, status, created_by, submitted_by, ${config.dateColumn} AS movement_date
       FROM ${config.table} WHERE id = ? AND entity_id = ? LIMIT 1`,
    [movementId, entityId],
  );
  if (!movement) throw httpError(404, 'NOT_FOUND', 'Pergerakan tidak ditemukan');
  if (movement.status !== 'approved') throw httpError(409, 'MOVEMENT_NOT_APPROVED', 'Hanya pergerakan yang sudah disetujui yang dapat dipasangkan');
  // The window of the views: a pair outside it would never count.
  const windowFrom = model.windowFrom();
  if (model.day(movement.movement_date) < windowFrom) {
    throw httpError(409, 'OUT_OF_SCOPE', windowFrom > model.RECON_FROM
      ? `Pergerakan lebih dari ${model.RECON_WINDOW_DAYS} hari lalu tidak dicocokkan dengan Accurate — selisihnya diselesaikan lewat stock opname`
      : `Pergerakan sebelum ${model.dayText(model.RECON_FROM)} tidak dicocokkan dengan Accurate`);
  }
  // Every movement of the group the document will join, plus this one.
  const [group] = await pool.query(
    `SELECT h.movement_id, h.created_by, h.submitted_by FROM wh_recon_movements_app h
      WHERE h.entity_id = ? AND h.direction = ? AND h.in_scope = 1
        AND h.group_key = (SELECT x.group_key FROM wh_recon_movements_app x WHERE x.entity_id = ? AND x.direction = ? AND x.movement_id = ?)`,
    [entityId, direction, entityId, direction, movementId],
  );
  const blocked = model.selfResolveReason(user.sub, [movement, ...group]);
  if (blocked) throw httpError(403, 'SELF_RESOLVE_FORBIDDEN', blocked);
  const [[doc]] = await pool.query(
    `SELECT k.doc_id, MAX(k.number) AS number FROM wh_recon_doc_keys_accurate k
      WHERE k.entity_id = ? AND k.doc_type = ? AND k.doc_id = ? AND k.direction = ?
      GROUP BY k.doc_id`,
    [entityId, docType, docId, direction],
  );
  if (!doc) throw httpError(404, 'NOT_FOUND', 'Dokumen Accurate tidak ditemukan untuk arah ini');
  let insertId;
  try {
    const [r] = await pool.query(
      `INSERT INTO warehouse_recon_links (entity_id, movement_type, movement_id, doc_type, doc_id, doc_number, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, direction, movementId, docType, docId, doc.number, reason ? String(reason).trim() || null : null, user.sub],
    );
    insertId = r.insertId;
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw httpError(409, 'CONFLICT', 'Dokumen ini sudah dipasangkan manual. Lepas pasangan lama dulu.');
    throw e;
  }
  await log({
    entityId, userId: user.sub, action: 'warehouse.recon.link', subjectType: `warehouse_${direction}`, subjectId: movementId,
    metadata: { linkId: insertId, docType, docId, number: doc.number },
  }).catch(() => {});
  return { id: insertId };
}

async function unlink(user, id, reason) {
  const entityId = user.entityId;
  const [[k]] = await pool.query(
    `SELECT id, movement_type, movement_id, doc_type, doc_id FROM warehouse_recon_links
      WHERE id = ? AND entity_id = ? AND cancelled_at IS NULL LIMIT 1`,
    [id, entityId],
  );
  if (!k) throw httpError(404, 'NOT_FOUND', 'Pasangan manual tidak ditemukan atau sudah dilepas');
  const config = MOVEMENTS[k.movement_type];
  const [[movement]] = config ? await pool.query(
    `SELECT created_by, submitted_by FROM ${config.table} WHERE id = ? AND entity_id = ? LIMIT 1`,
    [k.movement_id, entityId],
  ) : [[null]];
  const blocked = model.selfResolveReason(user.sub, movement ? [movement] : []);
  if (blocked) throw httpError(403, 'SELF_RESOLVE_FORBIDDEN', blocked);
  const [r] = await pool.query(
    `UPDATE warehouse_recon_links SET cancelled_at = NOW(), cancelled_by = ?, cancel_reason = ?
      WHERE id = ? AND entity_id = ? AND cancelled_at IS NULL`,
    [user.sub, String(reason).trim(), id, entityId],
  );
  if (!r.affectedRows) throw httpError(409, 'CONFLICT', 'Pasangan ini baru saja dilepas orang lain');
  await log({
    entityId, userId: user.sub, action: 'warehouse.recon.unlink', subjectType: `warehouse_${k.movement_type}`, subjectId: k.movement_id,
    metadata: { linkId: Number(k.id), docType: k.doc_type, docId: Number(k.doc_id), reason: String(reason).trim() },
  }).catch(() => {});
  return { id: Number(k.id) };
}

// ------------------------------------------------------------------ explanations

async function explain(user, {
  direction, groupKey, signature, reason,
}) {
  assertKey(direction, groupKey);
  const entityId = user.entityId;
  const row = await loadGroup(entityId, direction, groupKey);
  if (row.status === 'matched') throw httpError(409, 'NOTHING_TO_EXPLAIN', 'Kelompok ini sudah cocok, tidak perlu dijelaskan');
  if (signature !== row.signature) throw httpError(409, 'STALE', 'Data pencocokan berubah sejak Anda membukanya. Muat ulang lalu periksa lagi.');
  if (model.int(row.explained)) throw httpError(409, 'CONFLICT', 'Kelompok ini sudah dijelaskan');
  const blocked = model.selfResolveReason(user.sub, await groupMovers(entityId, direction, groupKey));
  if (blocked) throw httpError(403, 'SELF_RESOLVE_FORBIDDEN', blocked);

  const text = String(reason || '').trim();
  const conn = await pool.getConnection();
  let noteId;
  let replacedNoteIds = [];
  try {
    await conn.beginTransaction();
    // A lapsed explanation (given for data that has changed since) makes room for
    // the new one. One given for this very data — a colleague a moment ago — is
    // left alone: the INSERT then meets the one-live-note key and answers 409.
    const [lapsed] = await conn.query(
      `SELECT id FROM warehouse_recon_notes
        WHERE entity_id = ? AND direction = ? AND group_key = ? AND cancelled_at IS NULL AND signature <> ?
        FOR UPDATE`,
      [entityId, direction, groupKey, signature],
    );
    replacedNoteIds = lapsed.map((n) => Number(n.id));
    if (replacedNoteIds.length) {
      await conn.query(
        `UPDATE warehouse_recon_notes SET cancelled_at = NOW(), cancelled_by = ?, cancel_reason = 'Diganti penjelasan baru (data berubah)'
          WHERE entity_id = ? AND direction = ? AND group_key = ? AND cancelled_at IS NULL AND signature <> ?`,
        [user.sub, entityId, direction, groupKey, signature],
      );
    }
    const [r] = await conn.query(
      `INSERT INTO warehouse_recon_notes (entity_id, direction, group_key, status, signature, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entityId, direction, groupKey, row.status, signature, text, user.sub],
    );
    noteId = r.insertId;
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    // Two Supervisors explaining the same group at once: one wins, the other is told.
    if (e.code === 'ER_DUP_ENTRY' || e.code === 'ER_LOCK_DEADLOCK') throw httpError(409, 'CONFLICT', 'Kelompok ini baru saja dijelaskan orang lain');
    throw e;
  } finally {
    conn.release();
  }
  await log({
    entityId, userId: user.sub, action: 'warehouse.recon.explain', subjectType: 'warehouse_recon', subjectId: noteId,
    metadata: { direction, groupKey, status: row.status, replacedNoteIds },
  }).catch(() => {});
  return { id: noteId };
}

async function unexplain(user, id, reason) {
  const entityId = user.entityId;
  const [[n]] = await pool.query(
    `SELECT id, direction, group_key FROM warehouse_recon_notes
      WHERE id = ? AND entity_id = ? AND cancelled_at IS NULL LIMIT 1`,
    [id, entityId],
  );
  if (!n) throw httpError(404, 'NOT_FOUND', 'Penjelasan tidak ditemukan atau sudah dibatalkan');
  const blocked = model.selfResolveReason(user.sub, await groupMovers(entityId, n.direction, n.group_key));
  if (blocked) throw httpError(403, 'SELF_RESOLVE_FORBIDDEN', blocked);
  const [r] = await pool.query(
    `UPDATE warehouse_recon_notes SET cancelled_at = NOW(), cancelled_by = ?, cancel_reason = ?
      WHERE id = ? AND entity_id = ? AND cancelled_at IS NULL`,
    [user.sub, String(reason).trim(), id, entityId],
  );
  if (!r.affectedRows) throw httpError(409, 'CONFLICT', 'Penjelasan ini baru saja dibatalkan orang lain');
  await log({
    entityId, userId: user.sub, action: 'warehouse.recon.unexplain', subjectType: 'warehouse_recon', subjectId: Number(n.id),
    metadata: { direction: n.direction, groupKey: n.group_key, reason: String(reason).trim() },
  }).catch(() => {});
  return { id: Number(n.id) };
}

module.exports = {
  list, detail, forMovement, candidates, link, unlink, explain, unexplain,
};
