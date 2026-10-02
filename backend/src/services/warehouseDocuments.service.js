const pool = require('../db/pool');
const { promisedSql } = require('./warehouseRules');
const { lateFrom } = require('./procurementRules');
const { int, likeTerm, isDate } = require('./salesQuery');
const { cityFromCustomerCode } = require('./salesNumbers');

// Warehouse stage 2: the documents that move goods, from approved Accurate data
// (surat jalan, penerimaan barang, pindah gudang, penyesuaian stok). Read-only;
// quantities only. No delivery address is kept; a delivery shows where it goes
// as the city in the customer number. The company always comes from the
// signed-in user.

const DOC_TYPES = Object.freeze(['delivery', 'receipt', 'transfer', 'adjustment']);
// Goods sent to another gudang and not received after this long are stuck.
const TRANSFER_STUCK_DAYS = 3;
const TODAY_LIMIT = 50;

const LIST_COLUMNS = `d.id, d.doc_type, d.number, d.trans_date, d.status, d.party, d.channel, d.from_wh, d.to_wh,
  d.transfer_type, d.out_status, d.kind, d.supplier_do, d.so_numbers, d.po_numbers, d.line_count, d.approved_at`;

const list = (v) => {
  if (!v) return [];
  const parsed = typeof v === 'string' ? JSON.parse(v) : v;
  return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
};
const num = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 10000) / 10000);

function documentDto(row) {
  return {
    id: Number(row.id),
    type: row.doc_type,
    number: row.number,
    date: row.trans_date,
    status: row.status || null,
    party: row.party || null,
    channel: row.channel || null,
    fromWarehouse: row.from_wh || null,
    toWarehouse: row.to_wh || null,
    transferType: row.transfer_type || null,
    outStatus: row.out_status || null,
    kind: row.kind || null,
    supplierDo: row.supplier_do || null,
    soNumbers: list(row.so_numbers),
    poNumbers: list(row.po_numbers),
    lineCount: int(row.line_count),
    approvedAt: row.approved_at || null,
  };
}

function lineDto(row) {
  return {
    lineNo: int(row.line_no),
    itemNo: row.item_no,
    itemName: row.item_name,
    qty: num(row.qty),
    unit: row.unit || null,
    unitRatio: num(row.unit_ratio),
    warehouse: row.warehouse || null,
    direction: row.direction || null,
    receivedQty: num(row.received_qty),
    reference: row.reference || null,
  };
}

// status 'in_transit': transfers sent out and not received yet.
async function listDocuments(entityId, {
  type = 'delivery', q = '', from = null, to = null, warehouse = '', status = '', page = 1, limit = 25,
} = {}) {
  const docType = DOC_TYPES.includes(type) ? type : 'delivery';
  const where = ['d.entity_id = ?', 'd.doc_type = ?'];
  const args = [entityId, docType];
  if (isDate(from)) { where.push('d.trans_date >= ?'); args.push(from); }
  if (isDate(to)) { where.push('d.trans_date <= ?'); args.push(to); }
  const like = likeTerm(q);
  // JSON values come back with a binary collation: searched case-insensitively.
  const ci = (column) => `${column} COLLATE utf8mb4_unicode_ci`;
  if (like) {
    where.push(`(d.number LIKE ? OR ${ci('d.party')} LIKE ? OR ${ci('d.supplier_do')} LIKE ?)`);
    args.push(like, like, like);
  }
  if (docType === 'transfer' && status === 'in_transit') {
    where.push("d.transfer_type = 'TRANSFER_OUT' AND d.out_status = 'SENDING'");
  }
  const gudang = String(warehouse || '').trim().slice(0, 120);
  if (gudang) {
    // Not correlated: the lines view is unnested once for the whole statement.
    where.push(`(${ci('d.from_wh')} = ? OR ${ci('d.to_wh')} = ? OR d.id IN (SELECT l.document_id FROM wh_document_lines_accurate l
                  WHERE l.entity_id = ? AND l.doc_type = ? AND ${ci('l.warehouse')} = ?))`);
    args.push(gudang, gudang, entityId, docType, gudang);
  }
  const whereSql = where.join(' AND ');
  const [rows] = await pool.query(
    `SELECT ${LIST_COLUMNS} FROM wh_documents_accurate d WHERE ${whereSql}
      ORDER BY d.trans_date DESC, d.id DESC LIMIT ? OFFSET ?`,
    [...args, limit, (page - 1) * limit],
  );
  const [[count]] = await pool.query(`SELECT COUNT(*) AS n FROM wh_documents_accurate d WHERE ${whereSql}`, args);
  const [perType] = await pool.query(
    'SELECT doc_type, COUNT(*) AS n FROM wh_documents_accurate WHERE entity_id = ? GROUP BY doc_type',
    [entityId],
  );
  return {
    items: rows.map(documentDto),
    total: int(count.n),
    counts: Object.fromEntries(DOC_TYPES.map((t) => [t, int(perType.find((r) => r.doc_type === t)?.n)])),
  };
}

async function getDocument(entityId, type, id) {
  if (!DOC_TYPES.includes(type)) return null;
  const [[row]] = await pool.query(
    `SELECT ${LIST_COLUMNS}, d.customer_no FROM wh_documents_accurate d WHERE d.entity_id = ? AND d.doc_type = ? AND d.id = ? LIMIT 1`,
    [entityId, type, id],
  );
  if (!row) return null;
  const [lines] = await pool.query(
    `SELECT line_no, item_no, item_name, qty, unit, unit_ratio, warehouse, direction, received_qty, reference
       FROM wh_document_lines_accurate WHERE entity_id = ? AND doc_type = ? AND document_id = ? ORDER BY line_no`,
    [entityId, type, id],
  );
  return {
    ...documentDto(row),
    // Where the goods go: the customer and the city in its customer number — no
    // address is kept (the full address is on the Accurate delivery order).
    destination: type === 'delivery' ? cityFromCustomerCode(row.customer_no) : null,
    lines: lines.map(lineDto),
  };
}

// The Warehouse's day: what ships today, what arrives today, and what needs a look.
async function today(entityId) {
  // Each kind with its own limit and its real count, so a busy day of surat
  // jalan never hides the goods arriving.
  const ofToday = async (type) => {
    const [rows] = await pool.query(
      `SELECT ${LIST_COLUMNS} FROM wh_documents_accurate d
        WHERE d.entity_id = ? AND d.doc_type = ? AND d.trans_date = DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) ORDER BY d.number LIMIT ${TODAY_LIMIT}`,
      [entityId, type],
    );
    const [[count]] = await pool.query(
      'SELECT COUNT(*) AS n FROM wh_documents_accurate d WHERE d.entity_id = ? AND d.doc_type = ? AND d.trans_date = DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)',
      [entityId, type],
    );
    return { items: rows.map(documentDto), total: int(count.n) };
  };
  const [deliveries, receipts] = [await ofToday('delivery'), await ofToday('receipt')];
  const [[attention]] = await pool.query(
    `SELECT DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-%m-%d') AS today,
            (SELECT COUNT(*) FROM wh_documents_accurate t WHERE t.entity_id = ? AND t.doc_type = 'transfer'
               AND t.transfer_type = 'TRANSFER_OUT' AND t.out_status = 'SENDING') AS in_transit,
            (SELECT COUNT(*) FROM wh_documents_accurate t WHERE t.entity_id = ? AND t.doc_type = 'transfer'
               AND t.transfer_type = 'TRANSFER_OUT' AND t.out_status = 'SENDING'
               AND t.trans_date <= DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) - INTERVAL ${TRANSFER_STUCK_DAYS} DAY) AS stuck,
            (SELECT COUNT(*) FROM wh_stock_total_accurate s WHERE s.entity_id = ? AND s.qty < 0) AS minus,
            (SELECT COUNT(*) FROM wh_so_open_accurate o WHERE o.entity_id = ? AND ${promisedSql('o')} <= DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)) AS so_due`,
    [entityId, entityId, entityId, entityId],
  );
  // POs the Warehouse will receive this week (program 2.2): quantities and dates
  // only (P1 lets the Warehouse see them), from approved Procurement data;
  // "PO lama" (dated before LATE_FROM) left out.
  const [incoming] = await pool.query(
    `SELECT p.id, p.number, p.vendor_name, p.due_date_eff, p.expected_date, p.percent_received, p.line_count
       FROM pc_po_accurate p
      WHERE p.entity_id = ? AND p.po_state IN ('open', 'partial') AND p.trans_date >= ?
        AND p.due_date_eff <= DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) + INTERVAL 6 DAY
      ORDER BY p.due_date_eff, p.number LIMIT ${TODAY_LIMIT}`,
    [entityId, lateFrom()],
  );
  return {
    // The database's date (local time), the same one "today" was filtered on.
    date: attention.today,
    deliveries: deliveries.items,
    receipts: receipts.items,
    totals: { deliveries: deliveries.total, receipts: receipts.total },
    attention: { inTransit: int(attention.in_transit), stuckTransfers: int(attention.stuck), stockMinus: int(attention.minus), soDue: int(attention.so_due) },
    incomingPos: incoming.map((p) => ({
      id: Number(p.id), number: p.number, vendorName: p.vendor_name, dueDate: p.due_date_eff, estimated: !p.expected_date,
      percentReceived: Number(p.percent_received || 0), lineCount: int(p.line_count),
    })),
  };
}

module.exports = { DOC_TYPES, TRANSFER_STUCK_DAYS, listDocuments, getDocument, today };
