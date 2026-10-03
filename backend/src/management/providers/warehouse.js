const pool = require('../../db/pool');
const { COVER_DAYS, MIN_HISTORY_DAYS } = require('../../services/warehouseStock.service');
const rules = require('../../services/warehouseRules');
const salesSource = require('../../services/salesSource');
// Accurate SOs are the source of truth only when Sales transactions come from Accurate.
const soFromApp = () => salesSource.transactionSource() === 'app';
const {
  MAX_ITEMS_PER_SOURCE, int, num, round1, scope, escalationItem, byDepartment, grouping,
} = require('../helpers');
const recon = require('../../services/warehouseReconModel');

// Warehouse reports what is specific to the warehouse floor: movement paperwork
// that never entered the approval flow, incidents left open, and daily
// checklists left unticked.
//
// Deliberately NOT here: a movement waiting too long for a decision. Submitting
// a movement creates an approval_request (and a revision keeps that request in
// 'revision_requested'), which the `approvals` provider already escalates as
// `approval_aged`, measures as `approval_days` and counts in its `pending` KPI.
// Reporting it again here would put the same movement in Pusat Eskalasi twice.
//
// None of the warehouse_* tables carry deleted_at (see migrations 006 and 033).
//
// Pencocokan gudang ↔ Accurate (program 3.2, views of migration 094): an
// approved movement with no matching Accurate document, a quantity (or a line
// without item code) that differs from the document, and an Accurate receipt or
// delivery the Warehouse never recorded. All three are the Warehouse's (D4),
// count once they are older than RECON_GRACE_DAYS, skip what a Supervisor/Head
// explained, stay silent until Warehouse documents exist in the mirror, and
// wait while the mirror is not complete that far (a Warehouse batch waiting
// for approval, pulls stopped; `judged`, migration 104). Quantities only (D1).

// A draft dated this many days in the past (movement date or creation, whichever
// is later) means goods physically moved but the paperwork never reached the
// Supervisor — stock records are wrong until it is submitted.
const DRAFT_GRACE_DAYS = 2;
// A high or critical incident (damage, loss) still open after this long is
// blocking stock or a customer delivery.
const INCIDENT_URGENT_DAYS = 2;
// Any other incident should be investigated and closed within a week.
const INCIDENT_NORMAL_DAYS = 7;
// A daily checklist not completed by the end of the following day was skipped.
const CHECKLIST_GRACE_DAYS = 1;

// Stock from Accurate (Warehouse stage 1). A position (item × gudang) below
// zero in Accurate for this long means goods left without being booked in:
// the books and the shelf disagree, so management sees it (per gudang).
const NEGATIVE_STOCK_DAYS = 3;
// Stock older than this has not been refreshed by an approved pull.
const STOCK_STALE_HOURS = 48;

const OPEN_INCIDENT = "('open', 'investigating')";
const URGENT_SEVERITY = "('high', 'critical')";

const MOVEMENTS = Object.freeze({
  inbound: { type: 'inbound', table: 'warehouse_inbound', dateColumn: 'inbound_date', partyColumn: 'supplier', label: 'Barang Masuk' },
  outbound: { type: 'outbound', table: 'warehouse_outbound', dateColumn: 'outbound_date', partyColumn: 'destination', label: 'Barang Keluar' },
});

const INCIDENT_STATUS_LABEL = { open: 'Terbuka', investigating: 'Diselidiki' };
const SEVERITY_LABEL = { low: 'rendah', medium: 'sedang', high: 'tinggi', critical: 'kritis' };

function located(row) {
  return row
    ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null }
    : null;
}

// ---------------------------------------------------------------------------
// Escalations
// ---------------------------------------------------------------------------

// Inbound and outbound live in separate tables with overlapping ids, and a
// follow-up is keyed by (source, source_id) — so each table is its own source.
function draftSource(config, key, label) {
  const since = `GREATEST(m.${config.dateColumn}, DATE(m.created_at + INTERVAL 7 HOUR))`;
  return {
    key,
    label,
    async list(entityId, { departmentId }) {
      const s = scope(departmentId, 'm.department_id');
      const [rows] = await pool.query(
        `SELECT m.id, m.reference_no, m.${config.partyColumn} AS party,
                m.department_id, d.name AS department_name, u.name AS owner_name,
                ${since} AS since, DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), ${since}) AS days_late
           FROM ${config.table} m
           LEFT JOIN departments d ON d.id = m.department_id
           LEFT JOIN users u ON u.id = m.created_by
          WHERE m.entity_id = ?${s.sql}
            AND m.status = 'draft'
            AND m.approval_request_id IS NULL
            AND ${since} < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) - INTERVAL ${DRAFT_GRACE_DAYS} DAY
          ORDER BY days_late DESC, m.id ASC
          LIMIT ${MAX_ITEMS_PER_SOURCE}`,
        [entityId, ...s.args]
      );
      return rows.map((row) => escalationItem({
        sourceId: row.id,
        title: `${config.label} ${row.reference_no || `#${row.id}`}`,
        reference: row.reference_no,
        context: row.party ? `Draft belum diajukan · ${row.party}` : 'Draft belum diajukan',
        departmentId: row.department_id,
        departmentName: row.department_name,
        ownerName: row.owner_name,
        daysLate: row.days_late,
        since: row.since,
        link: `/warehouse/movements/${config.type}/${row.id}`,
      }));
    },
    async locate(id) {
      const [[row]] = await pool.query(`SELECT entity_id, department_id FROM ${config.table} WHERE id = ? LIMIT 1`, [id]);
      return located(row);
    },
  };
}

const incidentOpen = {
  key: 'warehouse_incident_open',
  label: 'Incident gudang belum selesai',
  async list(entityId, { departmentId }) {
    const s = scope(departmentId, 'i.department_id');
    const [rows] = await pool.query(
      `SELECT i.id, i.category, i.severity, i.status,
              i.department_id, d.name AS department_name, u.name AS owner_name,
              i.created_at AS since, DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), DATE(i.created_at + INTERVAL 7 HOUR)) AS days_late
         FROM warehouse_incidents i
         LEFT JOIN departments d ON d.id = i.department_id
         LEFT JOIN users u ON u.id = i.reported_by
        WHERE i.entity_id = ?${s.sql}
          AND i.status IN ${OPEN_INCIDENT}
          AND i.created_at < NOW() - INTERVAL
              (CASE WHEN i.severity IN ${URGENT_SEVERITY} THEN ${INCIDENT_URGENT_DAYS} ELSE ${INCIDENT_NORMAL_DAYS} END) DAY
        ORDER BY days_late DESC, i.id ASC
        LIMIT ${MAX_ITEMS_PER_SOURCE}`,
      [entityId, ...s.args]
    );
    return rows.map((row) => escalationItem({
      sourceId: row.id,
      title: row.category,
      context: `${INCIDENT_STATUS_LABEL[row.status] || row.status} · tingkat ${SEVERITY_LABEL[row.severity] || row.severity}`,
      departmentId: row.department_id,
      departmentName: row.department_name,
      ownerName: row.owner_name,
      daysLate: row.days_late,
      since: row.since,
      link: '/warehouse/operations?tab=incidents',
    }));
  },
  async locate(id) {
    const [[row]] = await pool.query('SELECT entity_id, department_id FROM warehouse_incidents WHERE id = ? LIMIT 1', [id]);
    return located(row);
  },
};

// One row per gudang holding stock below zero for longer than
// NEGATIVE_STOCK_DAYS, counted from the oldest position's negative streak (a
// quantity that changes but stays below zero keeps its clock). The row's id is
// the gudang plus the day its NEWEST streak began: any position that newly goes
// below zero gives a new id, so a follow-up closed earlier never hides it.
// Nothing before the first approved Warehouse pull (there is no stock data yet).
const EPISODE_FACTOR = 1000000;
// Rows keyed by an Accurate id are bound to the company (ids repeat across Accurate databases).
const byEntity = (entityId) => (entityId == null ? { sql: '', args: [] } : { sql: ' AND entity_id = ?', args: [Number(entityId)] });
const episodeId = (warehouseId, sinceDay) => Number(warehouseId) * EPISODE_FACTOR + Number(sinceDay);
const warehouseOfEpisode = (id) => Math.floor(Number(id) / EPISODE_FACTOR);

const stockNegative = {
  key: 'warehouse_stock_negative',
  label: 'Stok minus di Accurate',
  async list(entityId, { departmentId }) {
    const s = scope(departmentId, 'n.department_id');
    const [rows] = await pool.query(
      `SELECT n.warehouse_id, n.warehouse_name, n.department_id, d.name AS department_name,
              COUNT(*) AS positions, MIN(n.negative_since) AS since,
              DATEDIFF(DATE(MAX(n.negative_since) + INTERVAL 7 HOUR), '2000-01-01') AS since_day,
              DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), DATE(MIN(n.negative_since) + INTERVAL 7 HOUR)) - ${NEGATIVE_STOCK_DAYS} AS days_late
         FROM wh_stock_negative_accurate n
         LEFT JOIN departments d ON d.id = n.department_id
        WHERE n.entity_id = ?${s.sql}
        GROUP BY n.warehouse_id, n.warehouse_name, n.department_id, d.name
       HAVING MIN(n.negative_since) <= NOW() - INTERVAL ${NEGATIVE_STOCK_DAYS} DAY
        ORDER BY positions DESC, n.warehouse_id
        LIMIT ${MAX_ITEMS_PER_SOURCE}`,
      [entityId, ...s.args]
    );
    return rows.map((row) => escalationItem({
      sourceId: episodeId(row.warehouse_id, row.since_day),
      title: row.warehouse_name || 'Gudang',
      context: `${int(row.positions)} barang stoknya minus di Accurate — cek penerimaan/penyesuaian yang belum dicatat.`,
      departmentId: row.department_id,
      departmentName: row.department_name,
      daysLate: row.days_late,
      since: row.since,
      link: `/warehouse/stock?status=minus&warehouseId=${row.warehouse_id}`,
    }));
  },
  async locate(id, { entityId } = {}) {
    const e = byEntity(entityId);
    const [[row]] = await pool.query(`SELECT entity_id, department_id FROM wh_warehouses_accurate WHERE id = ?${e.sql} LIMIT 1`, [warehouseOfEpisode(id), ...e.args]);
    return located(row);
  },
};

// Goods sent to another gudang (Accurate "pindah gudang", sent and not yet
// received) for longer than this are stuck between gudang.
const TRANSFER_STUCK_DAYS = 3;

const transferStuck = {
  key: 'warehouse_transfer_stuck',
  label: 'Pindah gudang tertahan',
  async list(entityId, { departmentId }) {
    const s = scope(departmentId, 't.department_id');
    const [rows] = await pool.query(
      `SELECT t.id, t.number, t.from_wh, t.to_wh, t.trans_date, t.line_count, t.department_id, d.name AS department_name,
              DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), t.trans_date) - ${TRANSFER_STUCK_DAYS} AS days_late
         FROM wh_documents_accurate t
         LEFT JOIN departments d ON d.id = t.department_id
        WHERE t.entity_id = ?${s.sql}
          AND t.doc_type = 'transfer' AND t.transfer_type = 'TRANSFER_OUT' AND t.out_status = 'SENDING'
          AND t.trans_date <= DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) - INTERVAL ${TRANSFER_STUCK_DAYS} DAY
        ORDER BY t.trans_date ASC, t.id ASC
        LIMIT ${MAX_ITEMS_PER_SOURCE}`,
      [entityId, ...s.args]
    );
    return rows.map((row) => escalationItem({
      sourceId: row.id,
      title: `${row.from_wh || 'Gudang'} → ${row.to_wh || 'gudang'}`,
      reference: row.number,
      context: `${int(row.line_count)} barang dikirim antar gudang, belum diterima di Accurate.`,
      departmentId: row.department_id,
      departmentName: row.department_name,
      daysLate: row.days_late,
      since: row.trans_date,
      link: `/warehouse/stock?tab=documents&type=transfer&status=in_transit&q=${encodeURIComponent(row.number || '')}`,
    }));
  },
  async locate(id, { entityId } = {}) {
    const e = byEntity(entityId);
    const [[row]] = await pool.query(`SELECT entity_id, department_id FROM wh_documents_accurate WHERE id = ? AND doc_type = 'transfer'${e.sql} LIMIT 1`, [id, ...e.args]);
    return located(row);
  },
};

// SO lewat janji kirim (program 3.4; owner: pengiriman terlambat → Warehouse):
// open or part-shipped SOs past their promise (warehouseRules), dated from
// OTIF_FROM, and only while the mirror can judge them (no Sales/RC batch of
// that SO waiting). A new promise is a new episode.
const dateOnly = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null));
const soEpisodeId = (soId, dueDay) => Number(soId) * rules.SO_EPISODE_FACTOR + Number(dueDay);

// OTIF and days-to-ship per division, or (whole) over every division at once.
async function otifRows(entityId, period, departmentId, whole) {
  const s = scope(departmentId, 'x.department_id');
  const g = grouping('x.department_id', whole);
  const [rows] = await pool.query(
    `SELECT ${g.select}, COUNT(*) AS due, COALESCE(SUM(x.on_time_in_full), 0) AS otif
       FROM wh_so_fulfilment_accurate x
      WHERE x.entity_id = ?${s.sql} AND x.trans_date >= ? AND x.in_otif AND x.judged
        AND x.promised_date BETWEEN ? AND LEAST(?, ${rules.TODAY} - INTERVAL 1 DAY)
      ${g.group}`,
    [entityId, ...s.args, rules.otifFrom(), period.start, period.end]
  );
  return rows;
}

async function shipDaysRows(entityId, period, departmentId, whole) {
  const s = scope(departmentId, 'x.department_id');
  const g = grouping('x.department_id', whole);
  const [rows] = await pool.query(
    `SELECT ${g.select}, COUNT(*) AS n, AVG(GREATEST(DATEDIFF(x.shipped_on, x.trans_date), 0)) AS days
       FROM wh_so_fulfilment_accurate x
      WHERE x.entity_id = ?${s.sql} AND x.trans_date >= ? AND x.so_state = 'shipped' AND x.shipped_on BETWEEN ? AND ?
      ${g.group}`,
    [entityId, ...s.args, rules.otifFrom(), period.start, period.end]
  );
  return rows;
}

const soLate = {
  key: 'warehouse_so_late',
  label: 'SO lewat janji kirim',
  async list(entityId, { departmentId }) {
    if (soFromApp()) return [];
    const s = scope(departmentId, 'x.department_id');
    const [rows] = await pool.query(
      `SELECT x.id, x.number, x.customer_name, x.percent_shipped, x.promised_date, x.promised_in_so, x.department_id, d.name AS department_name,
              ${rules.promiseShiftedSql('x')} AS promise_shifted,
              DATEDIFF(${rules.TODAY}, x.promised_date) AS days_late, DATEDIFF(x.promised_date, '2000-01-01') AS due_day
         FROM wh_so_fulfilment_accurate x
         LEFT JOIN departments d ON d.id = x.department_id
        WHERE x.entity_id = ?${s.sql} AND ${rules.lateSoSql('x')}
        ORDER BY x.promised_date, x.id
        LIMIT ${MAX_ITEMS_PER_SOURCE}`,
      [entityId, ...s.args]
    );
    return rows.map((row) => escalationItem({
      sourceId: soEpisodeId(row.id, row.due_day),
      title: `${row.number} · ${row.customer_name || '-'}`,
      reference: row.number,
      context: `${round1(num(row.percent_shipped) || 0)}% terkirim · janji kirim ${dateOnly(row.promised_date)}`
        + ` (${int(row.promised_in_so) ? 'Tgl kirim SO' : rules.standardPromiseText(int(row.promise_shifted))})`,
      departmentId: row.department_id,
      departmentName: row.department_name,
      daysLate: row.days_late,
      since: row.promised_date,
      link: `/warehouse/shipping?status=late&q=${encodeURIComponent(row.number || '')}`,
    }));
  },
  async locate(id, { entityId } = {}) {
    const e = byEntity(entityId);
    const [[row]] = await pool.query(
      `SELECT entity_id, department_id FROM wh_so_fulfilment_accurate WHERE id = ?${e.sql} LIMIT 1`,
      [Math.floor(Number(id) / rules.SO_EPISODE_FACTOR), ...e.args]
    );
    return located(row);
  },
};

const checklistMissed = {
  key: 'warehouse_checklist_missed',
  label: 'Checklist gudang terlewat',
  async list(entityId, { departmentId }) {
    const s = scope(departmentId, 'c.department_id');
    const [rows] = await pool.query(
      `SELECT c.id, c.title, c.checklist_date,
              c.department_id, d.name AS department_name, u.name AS owner_name,
              DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), c.checklist_date) AS days_late
         FROM warehouse_checklists c
         LEFT JOIN departments d ON d.id = c.department_id
         LEFT JOIN users u ON u.id = c.created_by
        WHERE c.entity_id = ?${s.sql}
          AND COALESCE(c.completed, 0) = 0
          AND c.checklist_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) - INTERVAL ${CHECKLIST_GRACE_DAYS} DAY
        ORDER BY days_late DESC, c.id ASC
        LIMIT ${MAX_ITEMS_PER_SOURCE}`,
      [entityId, ...s.args]
    );
    return rows.map((row) => escalationItem({
      sourceId: row.id,
      title: row.title,
      context: 'Belum diselesaikan',
      departmentId: row.department_id,
      departmentName: row.department_name,
      ownerName: row.owner_name,
      daysLate: row.days_late,
      since: row.checklist_date,
      link: '/warehouse/operations?tab=checklist',
    }));
  },
  async locate(id) {
    const [[row]] = await pool.query('SELECT entity_id, department_id FROM warehouse_checklists WHERE id = ? LIMIT 1', [id]);
    return located(row);
  },
};

// Pencocokan gudang ↔ Accurate (program 3.2). One row per reconciliation group
// (wh_recon_groups), past the grace period, not explained, only once the
// mirror holds Warehouse documents, and only once the mirror is complete that
// far (`judged`, migration 104 — until then the matching document may sit in a
// Warehouse batch waiting for approval). Source ids carry the direction in
// their lowest bit (inbound/outbound ids and receipt/delivery ids overlap); a
// movement group's id also carries the day of its `since`, so a new difference
// in a group whose earlier follow-up was closed opens a new one.
const RECON_TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
const RECON_DUE = `g.since <= ${RECON_TODAY} - INTERVAL ${recon.RECON_GRACE_DAYS} DAY`;
// "A, B, C +2 lainnya": the view lists at most DOC_NUMBERS_SHOWN numbers; doc_count is the total.
function docNumbersText(row) {
  const shown = String(row.doc_numbers || '').split(', ').filter(Boolean);
  const more = int(row.doc_count) - shown.length;
  return `${shown.join(', ') || '—'}${more > 0 ? ` +${more} lainnya` : ''}`;
}

// The three sources and the KPI read the same groups — every open problem that
// is due — so the view (the expensive part) is evaluated once per company and
// division: one statement, shared for RECON_MEMO_MS (Pusat Eskalasi and the
// dashboard ask for all four at once). `docs` = the division's Accurate
// Warehouse documents, for the KPI's "nothing to compare yet".
const RECON_MEMO_MS = 5000;
const reconMemo = new Map();
async function loadReconProblems(entityId, departmentId) {
  const x = scope(departmentId, 'x.department_id');
  const s = scope(departmentId, 'g.department_id');
  const [rows] = await pool.query(
    `SELECT c.docs, p.*
       FROM (SELECT COUNT(*) AS docs FROM wh_documents_accurate x WHERE x.entity_id = ?${x.sql}) c
       LEFT JOIN (SELECT g.direction, g.group_key, g.status, g.first_movement_id, g.first_doc_id, g.reference_no, g.party,
                         g.movement_count, g.doc_count, g.doc_numbers, g.diff_items, g.missing_item_lines, g.pending_movements,
                         g.department_id, d.name AS department_name, g.since,
                         DATEDIFF(${RECON_TODAY}, g.since) - ${recon.RECON_GRACE_DAYS} AS days_late,
                         DATEDIFF(g.since, '2000-01-01') AS ep_day
                    FROM wh_recon_groups g
                    LEFT JOIN departments d ON d.id = g.department_id
                   WHERE g.entity_id = ?${s.sql} AND g.status <> 'matched' AND g.explained = 0 AND g.docs_ready = 1
                     AND g.judged = 1 AND ${RECON_DUE}) p ON TRUE`,
    [entityId, ...x.args, entityId, ...s.args]
  );
  return { docs: int(rows[0]?.docs), groups: rows.filter((row) => row.group_key != null) };
}
function reconProblems(entityId, departmentId) {
  const key = `${entityId}:${departmentId ?? 'all'}`;
  const now = Date.now();
  const hit = reconMemo.get(key);
  if (hit && hit.until > now) return hit.promise;
  for (const [k, v] of reconMemo) if (v.until <= now) reconMemo.delete(k);
  const promise = loadReconProblems(entityId, departmentId);
  reconMemo.set(key, { promise, until: now + RECON_MEMO_MS });
  // A failed read is never shared: the next caller asks again.
  promise.catch(() => { if (reconMemo.get(key)?.promise === promise) reconMemo.delete(key); });
  return promise;
}
const resetReconMemo = () => reconMemo.clear();

// What each source takes from the shared groups (a unit Accurate has not
// approved yet is counted by none: master data, not a gudang error).
const RECON_PICK = Object.freeze({
  notInAccurate: (row) => row.status === 'app_only',
  // A line without item code hides every difference, so it is escalated with them:
  // the Warehouse fills the Accurate item code (a data-entry gap, not a master-data wait).
  qtyDiff: (row) => row.status === 'qty_diff' || (row.status === 'uncomparable' && int(row.missing_item_lines) > 0),
  // A document a draft/pending movement already references is on its way.
  notInApp: (row) => row.status === 'acc_only' && int(row.pending_movements) === 0,
});
const bySince = (a, b) => String(recon.day(a.since)).localeCompare(String(recon.day(b.since)))
  || (a.group_key < b.group_key ? -1 : a.group_key > b.group_key ? 1 : 0);

async function locateMovement(id) {
  const { direction, movementId } = recon.decodeEpisodeSourceId(id);
  const [[row]] = await pool.query(`SELECT entity_id, department_id FROM ${MOVEMENTS[direction].table} WHERE id = ? LIMIT 1`, [movementId]);
  return located(row);
}
async function locateDocument(id, { entityId } = {}) {
  // docType is one of two literals from the decoder, never user text.
  const { docType, docId } = recon.decodeDocSourceId(id);
  const e = byEntity(entityId);
  const [[row]] = await pool.query(
    `SELECT entity_id, department_id FROM wh_documents_accurate WHERE id = ? AND doc_type = '${docType === 'delivery' ? 'delivery' : 'receipt'}'${e.sql} LIMIT 1`,
    [docId, ...e.args],
  );
  return located(row);
}

function reconSource({ key, label, pick, item, locate }) {
  return {
    key,
    label,
    async list(entityId, { departmentId }) {
      const { groups } = await reconProblems(entityId, departmentId);
      const rows = groups.filter(pick).sort(bySince).slice(0, MAX_ITEMS_PER_SOURCE);
      return rows.map((row) => escalationItem({
        ...item(row),
        departmentId: row.department_id,
        departmentName: row.department_name,
        daysLate: row.days_late,
        since: row.since,
        link: recon.reconLink(row.direction, row.group_key),
      }));
    },
    locate,
  };
}

const movementTitle = (row) => `${recon.MOVEMENT_LABEL[row.direction] || 'Pergerakan'} ${row.reference_no || `#${row.first_movement_id}`}`;

const reconNotInAccurate = reconSource({
  key: 'warehouse_recon_not_in_accurate',
  label: 'Barang masuk/keluar belum tercatat di Accurate',
  pick: RECON_PICK.notInAccurate,
  item: (row) => {
    const n = int(row.movement_count);
    return {
      sourceId: recon.episodeSourceId(row.first_movement_id, row.direction, row.ep_day),
      title: movementTitle(row),
      reference: row.reference_no,
      context: `${n > 1 ? `${n} pergerakan · ` : ''}disetujui di aplikasi, belum ada dokumen Accurate yang cocok${row.party ? ` · ${row.party}` : ''}`,
    };
  },
  locate: locateMovement,
});

const reconQtyDiff = reconSource({
  key: 'warehouse_recon_qty_diff',
  label: 'Jumlah barang beda dengan Accurate',
  pick: RECON_PICK.qtyDiff,
  item: (row) => ({
    sourceId: recon.episodeSourceId(row.first_movement_id, row.direction, row.ep_day),
    title: movementTitle(row),
    reference: String(row.doc_numbers || '').split(', ')[0] || null,
    context: row.status === 'uncomparable'
      ? `${int(row.missing_item_lines)} baris tanpa kode barang — belum bisa dicocokkan dengan ${docNumbersText(row)}`
      : `${int(row.diff_items)} barang beda jumlah dengan ${docNumbersText(row)} (satuan dasar)`,
  }),
  locate: locateMovement,
});

// Per document: an Accurate receipt/delivery is its own episode.
const reconNotInApp = reconSource({
  key: 'warehouse_recon_not_in_app',
  label: 'Dokumen Accurate belum dicatat gudang',
  pick: RECON_PICK.notInApp,
  item: (row) => ({
    sourceId: recon.docSourceId(row.first_doc_id, row.direction),
    title: `${row.direction === 'inbound' ? 'Penerimaan' : 'Surat jalan'} ${row.doc_numbers || `#${row.first_doc_id}`}`,
    reference: row.doc_numbers,
    context: `${row.party || '—'} · belum dicatat sebagai ${recon.MOVEMENT_LABEL[row.direction] || 'pergerakan'} di aplikasi`,
  }),
  locate: locateDocument,
});

// ---------------------------------------------------------------------------
// Shared queries
// ---------------------------------------------------------------------------

// One SELECT per movement table, each carrying its own entity + division filter,
// glued with UNION ALL. `build(config)` returns { select, where, args } for one table.
async function acrossMovements(outer, build) {
  const parts = Object.values(MOVEMENTS).map(build);
  const [rows] = await pool.query(
    outer(parts.map((p) => p.sql).join('\n UNION ALL \n')),
    parts.flatMap((p) => p.args)
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

module.exports = {
  key: 'warehouse',
  label: 'Warehouse',
  navPaths: ['/warehouse', '/warehouse/movements', '/warehouse/stock', '/warehouse/shipping', '/warehouse/operations'],

  escalations: [
    draftSource(MOVEMENTS.inbound, 'warehouse_inbound_draft', 'Draft barang masuk belum diajukan'),
    draftSource(MOVEMENTS.outbound, 'warehouse_outbound_draft', 'Draft barang keluar belum diajukan'),
    incidentOpen,
    checklistMissed,
    stockNegative,
    transferStuck,
    soLate,
    reconNotInAccurate,
    reconQtyDiff,
    reconNotInApp,
  ],

  metrics: [
    {
      // Program 3.4: of the SOs promised in the period (up to yesterday), the
      // share shipped in full by the promise. Open ones past it count against
      // it; a rate only from OTIF_MIN_SOS SOs.
      key: 'warehouse_so_otif',
      label: 'SO terkirim tepat waktu & lengkap',
      unit: '%',
      better: 'higher',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        if (soFromApp()) return new Map();
        const rows = await otifRows(entityId, period, departmentId, false);
        return byDepartment(rows.filter((r) => int(r.due) >= rules.OTIF_MIN_SOS), (r) => round1((100 * int(r.otif)) / int(r.due)));
      },
      // Company-wide: every SO due in the period together (exact).
      async entityActuals(entityId, period) {
        if (soFromApp()) return null;
        const [row] = await otifRows(entityId, period, null, true);
        return row && int(row.due) >= rules.OTIF_MIN_SOS ? round1((100 * int(row.otif)) / int(row.due)) : null;
      },
    },
    {
      key: 'warehouse_ship_days',
      label: 'Rata-rata hari SO sampai terkirim lengkap',
      unit: 'hari',
      better: 'lower',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        if (soFromApp()) return new Map();
        const rows = await shipDaysRows(entityId, period, departmentId, false);
        return byDepartment(rows.filter((r) => int(r.n) >= rules.OTIF_MIN_SOS), (r) => round1(num(r.days)));
      },
      async entityActuals(entityId, period) {
        if (soFromApp()) return null;
        const [row] = await shipDaysRows(entityId, period, null, true);
        return row && int(row.n) >= rules.OTIF_MIN_SOS ? round1(num(row.days)) : null;
      },
    },
    {
      key: 'warehouse_movements_approved',
      label: 'Pergerakan barang disetujui',
      unit: 'item',
      better: 'higher',
      cumulative: true,
      emptyIsZero: true,
      // Approved and still standing: a movement cancelled after approval was reversed.
      async actuals(entityId, period, { departmentId }) {
        const rows = await acrossMovements(
          (union) => `SELECT department_id, COUNT(*) AS total FROM (${union}) x GROUP BY department_id`,
          (config) => {
            const s = scope(departmentId, 'm.department_id');
            return {
              sql: `SELECT m.department_id FROM ${config.table} m
                     WHERE m.entity_id = ?${s.sql}
                       AND m.status = 'approved'
                       AND m.approved_at BETWEEN ? - INTERVAL 7 HOUR AND ? - INTERVAL 7 HOUR`,
              args: [entityId, ...s.args, period.start, `${period.end} 23:59:59`],
            };
          },
        );
        return byDepartment(rows, (r) => int(r.total));
      },
    },
    {
      // Program 3.2: of the approved movements past the grace period in the
      // period, the share whose group matches Accurate. Explained groups stay
      // in the denominator, so explaining never raises the rate. Target-able
      // in Target & realisasi.
      key: 'warehouse_recon_match_rate',
      label: 'Pergerakan cocok dengan Accurate',
      unit: '%',
      better: 'higher',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        const s = scope(departmentId, 'g.department_id');
        const [rows] = await pool.query(
          `SELECT g.department_id, 100 * SUM(IF(g.status = 'matched', g.movement_count, 0)) / NULLIF(SUM(g.movement_count), 0) AS pct
             FROM wh_recon_groups g
            WHERE g.entity_id = ?${s.sql} AND g.movement_count > 0 AND g.docs_ready = 1 AND g.judged = 1
              AND g.last_date BETWEEN ? AND ? AND ${RECON_DUE}
            GROUP BY g.department_id`,
          [entityId, ...s.args, period.start, period.end]
        );
        return byDepartment(rows.filter((r) => r.pct !== null && r.pct !== undefined), (r) => round1(num(r.pct)));
      },
    },
  ],

  kpis: [
    {
      key: 'warehouse_pending_approval',
      label: 'Pergerakan menunggu approval',
      unit: 'item',
      // Warehouse's own view of its Supervisor queue. It never alerts and has no
      // escalation twin here: a wait that runs too long is already flagged by the
      // approvals provider (approval_aged / its `pending` KPI), so it is not
      // counted twice in Pusat Eskalasi.
      async value(entityId, { departmentId }) {
        const rows = await acrossMovements(
          (union) => `SELECT type, COUNT(*) AS total FROM (${union}) x GROUP BY type`,
          (config) => {
            const s = scope(departmentId, 'm.department_id');
            return {
              sql: `SELECT '${config.type}' AS type FROM ${config.table} m
                     WHERE m.entity_id = ?${s.sql} AND m.status = 'pending_approval'`,
              args: [entityId, ...s.args],
            };
          },
        );
        const count = (type) => int(rows.find((r) => r.type === type)?.total);
        const inbound = count('inbound');
        const outbound = count('outbound');
        return { value: inbound + outbound, sub: `${inbound} masuk · ${outbound} keluar`, alert: false };
      },
    },
    {
      key: 'warehouse_movements_week',
      label: 'Pergerakan minggu ini',
      unit: 'item',
      // By movement date in the current Monday-based week; rejected and cancelled
      // movements did not happen, drafts are counted and shown in the subtitle.
      async value(entityId, { departmentId }) {
        const rows = await acrossMovements(
          (union) => `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'draft'), 0) AS drafts FROM (${union}) x`,
          (config) => {
            const s = scope(departmentId, 'm.department_id');
            return {
              sql: `SELECT m.status FROM ${config.table} m
                     WHERE m.entity_id = ?${s.sql}
                       AND m.status NOT IN ('rejected', 'cancelled')
                       AND YEARWEEK(m.${config.dateColumn}, 1) = YEARWEEK(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), 1)`,
              args: [entityId, ...s.args],
            };
          },
        );
        const row = rows[0];
        return { value: int(row?.total), sub: `${int(row?.drafts)} masih draft`, alert: false };
      },
    },
    {
      key: 'warehouse_open_incidents',
      label: 'Insiden terbuka',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'i.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS open_total, COALESCE(SUM(i.severity IN ${URGENT_SEVERITY}), 0) AS urgent
             FROM warehouse_incidents i
            WHERE i.entity_id = ?${s.sql} AND i.status IN ${OPEN_INCIDENT}`,
          [entityId, ...s.args]
        );
        const urgent = int(row?.urgent);
        return { value: int(row?.open_total), sub: `${urgent} tingkat tinggi/kritis`, alert: urgent > 0 };
      },
    },
    {
      key: 'warehouse_stock_minus',
      label: 'Barang stok minus',
      unit: 'item',
      // From approved Accurate stock; before the first approved pull there is no data.
      async value(entityId, { departmentId }) {
        const w = scope(departmentId, 'w.department_id');
        const g = scope(departmentId, 'g.department_id');
        const t = scope(departmentId, 't.department_id');
        const [[row]] = await pool.query(
          `SELECT (SELECT COUNT(*) FROM wh_stock_accurate w WHERE w.entity_id = ?${w.sql} AND w.qty < 0) AS positions,
                  (SELECT COUNT(*) FROM wh_warehouses_accurate g WHERE g.entity_id = ?${g.sql}) AS warehouses,
                  COUNT(*) AS items
             FROM wh_stock_total_accurate t
            WHERE t.entity_id = ?${t.sql} AND t.qty < 0`,
          [entityId, ...w.args, entityId, ...g.args, entityId, ...t.args]
        );
        if (!int(row?.warehouses)) return { value: 0, sub: 'Belum ada data stok dari Accurate', alert: false };
        const items = int(row?.items);
        return { value: items, sub: `${int(row?.positions)} posisi gudang`, alert: items > 0 };
      },
    },
    {
      key: 'warehouse_stock_low',
      label: 'Barang menipis',
      unit: 'item',
      // Stock that lasts fewer than COVER_DAYS at the last 30 days' outflow (D7),
      // counted only once there are MIN_HISTORY_DAYS of approved history.
      async value(entityId, { departmentId }) {
        const t = scope(departmentId, 't.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS n
             FROM wh_stock_total_accurate t
             JOIN wh_stock_cover_accurate c ON c.entity_id = t.entity_id AND c.item_id = t.item_id
            WHERE t.entity_id = ?${t.sql} AND t.qty > 0 AND c.history_days >= ${MIN_HISTORY_DAYS} AND c.out_30d > 0
              AND t.qty / (c.out_30d / c.history_days) < ${COVER_DAYS}`,
          [entityId, ...t.args]
        );
        const n = int(row?.n);
        return { value: n, sub: `stok cukup < ${COVER_DAYS} hari`, alert: n > 0 };
      },
    },
    {
      key: 'warehouse_ship_today',
      label: 'Surat jalan hari ini',
      unit: 'item',
      // Accurate delivery orders dated today (approved Warehouse data).
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'o.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS n, COALESCE(SUM(o.line_count), 0) AS line_total
             FROM wh_documents_accurate o
            WHERE o.entity_id = ?${s.sql} AND o.doc_type = 'delivery' AND o.trans_date = DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)`,
          [entityId, ...s.args]
        );
        return { value: int(row?.n), sub: `${int(row?.line_total)} baris barang`, alert: false };
      },
    },
    {
      // The last 30 days up to yesterday, so the card is never empty at the
      // start of a month; no rate (—) rather than a false 0% when nothing is due.
      key: 'warehouse_so_otif_month',
      label: 'SO tepat waktu & lengkap (30 hari)',
      unit: '%',
      async value(entityId, { departmentId }) {
        if (soFromApp()) return { value: null, sub: 'Transaksi Sales dicatat di aplikasi', alert: false };
        const s = scope(departmentId, 'x.department_id');
        const due = `x.judged AND x.promised_date BETWEEN ${rules.TODAY} - INTERVAL 30 DAY AND ${rules.TODAY} - INTERVAL 1 DAY`;
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS total, COALESCE(SUM(x.in_otif AND ${due}), 0) AS due, COALESCE(SUM(x.on_time_in_full AND ${due}), 0) AS otif,
                  COALESCE(SUM(${rules.lateSoSql('x')}), 0) AS late
             FROM wh_so_fulfilment_accurate x WHERE x.entity_id = ?${s.sql} AND x.trans_date >= ?`,
          [entityId, ...s.args, rules.otifFrom()]
        );
        const late = int(row?.late);
        if (!int(row?.total)) return { value: null, sub: `Belum ada SO dari Accurate sejak ${rules.otifFrom()}`, alert: false };
        if (!int(row.due)) return { value: null, sub: `Belum ada SO jatuh tempo 30 hari terakhir · ${late} lewat janji belum terkirim`, alert: late > 0 };
        return { value: round1((100 * int(row.otif)) / int(row.due)), sub: `${int(row.otif)} dari ${int(row.due)} SO · ${late} lewat janji belum terkirim`, alert: late > 0 };
      },
    },
    {
      key: 'warehouse_stock_age',
      label: 'Umur data stok',
      unit: 'hari',
      // Since the stock shown was approved. A pull that finds nothing new needs no
      // batch, so age alone is no alarm: it alerts only when a Warehouse update has
      // been waiting for a decision longer than STOCK_STALE_HOURS.
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'b.department_id');
        const [[row]] = await pool.query(
          `SELECT TIMESTAMPDIFF(HOUR, MAX(CASE WHEN b.status = 'applied' THEN b.applied_at END), NOW()) AS hours,
                  TIMESTAMPDIFF(HOUR, MIN(CASE WHEN b.status = 'pending' THEN b.created_at END), NOW()) AS waiting_hours
             FROM sales_accurate_batches b JOIN departments d ON d.id = b.department_id AND d.code = 'warehouse'
            WHERE b.entity_id = ?${s.sql} AND b.status IN ('applied', 'pending')`,
          [entityId, ...s.args]
        );
        if (row?.hours == null) return { value: 0, sub: 'Belum ada data stok dari Accurate', alert: false };
        const hours = int(row.hours);
        const waiting = row.waiting_hours == null ? null : int(row.waiting_hours);
        const age = hours < 24 ? `${hours} jam lalu` : `${Math.floor(hours / 24)} hari lalu`;
        return {
          value: Math.floor(hours / 24),
          sub: waiting === null ? `disetujui ${age}` : `disetujui ${age} · pembaruan menunggu ${waiting} jam`,
          alert: waiting !== null && waiting > STOCK_STALE_HOURS,
        };
      },
    },
    {
      // Program 3.2: groups past the grace period that need the Warehouse —
      // not in Accurate, a quantity difference, a line without item code, or an
      // Accurate document not recorded in the app — counted from the same groups
      // as the three escalations (reconProblems), so the card and the queue agree.
      // A unit Accurate has not approved yet is shown but not counted (master
      // data, not a gudang error).
      key: 'warehouse_recon_open',
      label: 'Selisih gudang vs Accurate',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const { docs, groups } = await reconProblems(entityId, departmentId);
        if (!docs) return { value: 0, sub: 'Menunggu dokumen gudang dari Accurate', alert: false };
        const count = (pick) => groups.filter(pick).length;
        const a = count(RECON_PICK.notInAccurate);
        const q = count((row) => row.status === 'qty_diff');
        const c = count(RECON_PICK.notInApp);
        const noCode = count((row) => row.status === 'uncomparable' && int(row.missing_item_lines) > 0);
        const unknown = count((row) => row.status === 'uncomparable' && int(row.missing_item_lines) === 0);
        const value = a + q + c + noCode;
        return {
          value,
          sub: `${a} belum di Accurate · ${q} selisih · ${noCode} tanpa kode barang · ${c} belum di aplikasi${unknown ? ` · ${unknown} satuan belum dikenal` : ''}`,
          alert: value > 0,
        };
      },
    },
  ],
};

Object.assign(module.exports, {
  NEGATIVE_STOCK_DAYS, STOCK_STALE_HOURS, TRANSFER_STUCK_DAYS, episodeId, warehouseOfEpisode, soEpisodeId,
  DRAFT_GRACE_DAYS, INCIDENT_URGENT_DAYS, INCIDENT_NORMAL_DAYS, CHECKLIST_GRACE_DAYS,
  RECON_GRACE_DAYS: recon.RECON_GRACE_DAYS, RECON_MEMO_MS, resetReconMemo,
});
