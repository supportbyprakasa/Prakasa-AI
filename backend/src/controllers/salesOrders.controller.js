const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const records = require('../services/salesRecords.service');
const { ownScope } = require('../services/salesOwners.service');
const {
  paging, searchClause, isDate, money, int, positiveId, unitQuantities, baseQtyOf,
} = require('../services/salesQuery');
const { ORDER_CHANNELS, documentNumber } = require('../services/salesNumbers');
const { decryptBuffer } = require('../services/signature.service');
const { log } = require('../services/activityLog.service');
const { accurateScope } = require('../services/salesFacts');
const { numbersFromAccurate } = require('../services/salesSource');
const receivables = require('../services/salesReceivables.service');
const { receivableSql } = require('../services/invoiceRules');
const { todayWib } = require('../utils/wibTime');

// Data Sales: sales orders with their surat jalan (DO), invoice and payments,
// and the SKU list. Entered and processed in the app; every list pages on the
// server so any amount of data can be browsed.

const ORDER_STATUS = {
  no_do: "(o.do_numbers IS NULL OR o.do_numbers = '')",
  no_invoice: "(o.invoice_numbers IS NULL OR o.invoice_numbers = '')",
  unpaid: 'o.outstanding_amount > 0',
  overdue: 'o.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) AND o.outstanding_amount > 0',
  paid: 'o.outstanding_amount <= 0',
};

function handle(fn) {
  return async (req, res, next) => {
    try {
      return await fn(req, res);
    } catch (e) {
      if (e.status && e.code) return fail(res, e.code, e.message, e.status);
      return next(e);
    }
  };
}

function orderFilters(req) {
  const os = ownScope(req.user, 'order', 'o.id');
  const where = [`o.entity_id = ?${os.sql}`, 'o.deleted_at IS NULL'];
  const args = [req.user.entityId, ...os.args];
  const { from, to, channel, status, customerId, q } = req.query;
  if (from !== undefined && from !== '' && !isDate(from)) return { error: 'from harus YYYY-MM-DD' };
  if (to !== undefined && to !== '' && !isDate(to)) return { error: 'to harus YYYY-MM-DD' };
  if (status && !ORDER_STATUS[status]) return { error: 'status tidak dikenal' };
  if (from) { where.push('o.transaction_date >= ?'); args.push(from); }
  if (to) { where.push('o.transaction_date <= ?'); args.push(to); }
  if (channel) { where.push('o.channel = ?'); args.push(String(channel).slice(0, 40)); }
  if (status) where.push(ORDER_STATUS[status]);
  if (customerId) {
    const id = positiveId(customerId);
    if (!id) return { error: 'customerId tidak valid' };
    where.push('o.customer_id = ?'); args.push(id);
  }
  const s = searchClause(q, ['o.order_number', 'o.customer_name', 'o.do_numbers', 'o.invoice_numbers', 'o.sales_person_name']);
  return { where: where.join(' AND ') + s.sql, args: [...args, ...s.args] };
}

// ------------------------------------------------------------------ Tahap B: approved Accurate data

// Invoices linked to an Accurate SO (the invoice lines name their SO).
const LINKED = (so) => `FROM sales_invoices_accurate li
  WHERE li.entity_id = ${so}.entity_id AND JSON_CONTAINS(li.so_numbers, JSON_QUOTE(${so}.order_number))`;

const ACCURATE_SO_STATUS = {
  no_do: 's.percent_shipped < 100',
  no_invoice: `NOT EXISTS (SELECT 1 ${LINKED('s')})`,
  unpaid: `EXISTS (SELECT 1 ${LINKED('s')} AND li.outstanding_amount > 0)`,
  overdue: `EXISTS (SELECT 1 ${LINKED('s')} AND li.outstanding_amount > 0 AND li.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR))`,
  paid: `EXISTS (SELECT 1 ${LINKED('s')}) AND NOT EXISTS (SELECT 1 ${LINKED('s')} AND li.outstanding_amount > 0)`,
};

function periodFilters(req, alias, dateColumn) {
  const { from, to, channel, customerId } = req.query;
  if (from !== undefined && from !== '' && !isDate(from)) return { error: 'from harus YYYY-MM-DD' };
  if (to !== undefined && to !== '' && !isDate(to)) return { error: 'to harus YYYY-MM-DD' };
  const where = [];
  const args = [];
  if (from) { where.push(`${alias}.${dateColumn} >= ?`); args.push(from); }
  if (to) { where.push(`${alias}.${dateColumn} <= ?`); args.push(to); }
  if (channel) { where.push(`${alias}.channel = ?`); args.push(String(channel).slice(0, 40)); }
  if (customerId) {
    const id = positiveId(customerId);
    if (!id) return { error: 'customerId tidak valid' };
    where.push(`${alias}.customer_id = ?`); args.push(id);
  }
  return { where, args };
}

// Sales orders from Accurate; the summary line (omzet, piutang) comes from the
// invoices of the same period — revenue is invoice DPP (owner's decision).
async function listAccurateOrders(req, res) {
  const { status, q } = req.query;
  if (status && !ACCURATE_SO_STATUS[status]) return fail(res, 'VALIDATION_ERROR', 'status tidak dikenal', 400);
  const pf = periodFilters(req, 's', 'trans_date');
  if (pf.error) return fail(res, 'VALIDATION_ERROR', pf.error, 400);
  const sc = accurateScope(req.user, 's', { salesman: false });
  const sq = searchClause(q, ['s.order_number', 's.customer_name', 's.customer_code']);
  const where = [`s.entity_id = ?${sc.sql}`, ...pf.where, ...(status ? [ACCURATE_SO_STATUS[status]] : [])].join(' AND ') + sq.sql;
  const args = [req.user.entityId, ...sc.args, ...pf.args, ...sq.args];
  const { page, limit, offset } = paging(req.query);
  const [rows] = await pool.query(
    `SELECT s.id, s.order_number AS orderNumber, s.trans_date AS transactionDate, s.channel,
            s.customer_id AS customerId, s.customer_code AS customerCode, s.customer_name AS customerName,
            NULL AS salesPersonName, CONCAT('Terkirim ', FLOOR(COALESCE(s.percent_shipped, 0)), '%') AS doNumbers,
            (SELECT GROUP_CONCAT(li.invoice_number ORDER BY li.trans_date SEPARATOR ', ') ${LINKED('s')}) AS invoiceNumbers,
            s.total_amount AS totalAmount,
            (SELECT COALESCE(SUM(li.outstanding_amount), 0) ${LINKED('s')} AND ${receivableSql('li')}) AS outstandingAmount,
            (SELECT MIN(li.due_date) ${LINKED('s')} AND ${receivableSql('li')} AND li.outstanding_amount > 0) AS dueDate,
            s.status, 'accurate' AS source
       FROM sales_so_accurate s
      WHERE ${where}
      ORDER BY s.trans_date DESC, s.id DESC
      LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );
  // The footnote sums the SOs listed (same filters): "Nilai SO" is their DPP,
  // "piutang" what their invoices still owe (down payments left out, invoiceRules).
  const [[count]] = await pool.query(
    `SELECT COUNT(*) AS n, SUM(s.dpp_amount) AS revenue,
            SUM((SELECT COALESCE(SUM(li.outstanding_amount), 0) ${LINKED('s')} AND ${receivableSql('li')})) AS outstanding
       FROM sales_so_accurate s WHERE ${where}`,
    args,
  );
  const sum = count;
  const [channels] = await pool.query(
    'SELECT DISTINCT channel FROM sales_so_accurate WHERE entity_id = ? AND channel IS NOT NULL ORDER BY channel',
    [req.user.entityId],
  );
  const today = todayWib();
  return ok(res, rows.map((r) => {
    const due = r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : null;
    return {
      ...r, totalAmount: money(r.totalAmount), outstandingAmount: money(r.outstandingAmount), settledAmount: null,
      daysOverdue: due && due < today && money(r.outstandingAmount) > 0 ? Math.round((new Date(today) - new Date(due)) / 86400000) : null,
    };
  }), {
    page, limit, total: int(count.n), revenue: money(sum.revenue), outstanding: money(sum.outstanding),
    channels: channels.map((c) => c.channel), source: 'accurate',
  });
}

async function listAccurateInvoices(req, res) {
  const pf = periodFilters(req, 'i', 'trans_date');
  if (pf.error) return fail(res, 'VALIDATION_ERROR', pf.error, 400);
  const ic = accurateScope(req.user, 'i');
  const sq = searchClause(req.query.q, ['i.invoice_number', 'i.customer_name', 'i.customer_code']);
  // Owed / past due (the aging table links here); anything else lists every invoice.
  const owed = req.query.status === 'overdue'
    ? ['i.outstanding_amount > 0', 'i.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)']
    : req.query.status === 'open' ? ['i.outstanding_amount > 0'] : [];
  const where = [`i.entity_id = ?${ic.sql}`, ...pf.where, ...owed].join(' AND ') + sq.sql;
  const args = [req.user.entityId, ...ic.args, ...pf.args, ...sq.args];
  const { page, limit, offset } = paging(req.query);
  const [rows] = await pool.query(
    `SELECT i.invoice_number AS number, i.trans_date AS date, i.due_date AS dueDate,
            (SELECT GROUP_CONCAT(j.v SEPARATOR ', ') FROM JSON_TABLE(i.so_numbers, '$[*]' COLUMNS (v VARCHAR(120) PATH '$')) j) AS orderNumbers,
            NULL AS orderId, i.customer_name AS customerName, i.customer_id AS customerId, i.channel,
            i.sales_person_name AS salesPersonName, i.status, i.dpp_amount AS dppAmount,
            i.total_amount AS totalAmount, i.outstanding_amount AS outstandingAmount, 'accurate' AS source
       FROM sales_invoices_accurate i
      WHERE ${where}
      ORDER BY i.trans_date DESC, i.id DESC
      LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );
  const [[count]] = await pool.query(
    `SELECT COUNT(*) AS n, SUM(i.dpp_amount) AS revenue,
            SUM(CASE WHEN ${receivableSql('i')} THEN i.outstanding_amount ELSE 0 END) AS outstanding
       FROM sales_invoices_accurate i WHERE ${where}`,
    args,
  );
  return ok(res, rows.map((r) => ({
    ...r, dppAmount: money(r.dppAmount), totalAmount: money(r.totalAmount), outstandingAmount: money(r.outstandingAmount),
  })), {
    page, limit, total: int(count.n), revenue: money(count.revenue), outstanding: money(count.outstanding), source: 'accurate',
  });
}

// Surat jalan, penerimaan and retur from Accurate: same period/channel/customer
// filters; a member sees the documents of the customers they own. A surat jalan
// is also found by its SO number (the link of "Surat jalan belum difaktur").
const ACCURATE_DOCUMENTS = {
  do: {
    from: 'sales_do_accurate d', date: 'trans_date', search: ['d.do_number', 'd.customer_name', 'd.customer_code', 'CAST(d.so_numbers AS CHAR)'],
    select: `d.do_number AS number, d.trans_date AS date,
             (SELECT GROUP_CONCAT(j.v SEPARATOR ', ') FROM JSON_TABLE(d.so_numbers, '$[*]' COLUMNS (v VARCHAR(120) PATH '$')) j) AS orderNumbers,
             d.customer_name AS customerName, d.customer_id AS customerId, d.channel, d.status`,
  },
  receipt: {
    from: 'sales_receipts_accurate d', date: 'trans_date', search: ['d.receipt_number', 'd.customer_name', 'd.customer_code', 'd.bank'],
    select: `d.receipt_number AS number, d.trans_date AS date, d.customer_name AS customerName, d.customer_id AS customerId,
             d.channel, d.bank, d.total_amount AS totalAmount,
             (SELECT GROUP_CONCAT(j.n SEPARATOR ', ') FROM JSON_TABLE(d.invoices, '$[*]' COLUMNS (n VARCHAR(120) PATH '$.number')) j) AS invoiceNumbers`,
  },
  return: {
    from: 'sales_returns_accurate d', date: 'trans_date', search: ['d.return_number', 'd.customer_name', 'd.customer_code'],
    select: `d.return_number AS number, d.trans_date AS date, d.customer_name AS customerName, d.customer_id AS customerId,
             d.channel, d.status, d.dpp_amount AS dppAmount, d.total_amount AS totalAmount`,
  },
};

async function listAccurateDocuments(req, res, type) {
  const def = ACCURATE_DOCUMENTS[type];
  const pf = periodFilters(req, 'd', def.date);
  if (pf.error) return fail(res, 'VALIDATION_ERROR', pf.error, 400);
  const sc = accurateScope(req.user, 'd', { salesman: false });
  const sq = searchClause(req.query.q, def.search);
  const where = [`d.entity_id = ?${sc.sql}`, ...pf.where].join(' AND ') + sq.sql;
  const args = [req.user.entityId, ...sc.args, ...pf.args, ...sq.args];
  const { page, limit, offset } = paging(req.query);
  const [rows] = await pool.query(
    `SELECT ${def.select}, 'accurate' AS source FROM ${def.from} WHERE ${where} ORDER BY d.${def.date} DESC, d.id DESC LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );
  const [[count]] = await pool.query(`SELECT COUNT(*) AS n${type === 'do' ? '' : ', SUM(d.total_amount) AS total'} FROM ${def.from} WHERE ${where}`, args);
  return ok(res, rows.map((r) => ({
    ...r,
    ...(r.totalAmount !== undefined ? { totalAmount: money(r.totalAmount) } : {}),
    ...(r.dppAmount !== undefined ? { dppAmount: money(r.dppAmount) } : {}),
  })), { page, limit, total: int(count.n), sum: count.total === undefined ? undefined : money(count.total), source: 'accurate' });
}

// Products from Accurate with what sold in the period (invoice lines, before PPN).
async function listAccurateProducts(req, res) {
  const { from, to } = req.query;
  if (from && !isDate(from)) return fail(res, 'VALIDATION_ERROR', 'from harus YYYY-MM-DD', 400);
  if (to && !isDate(to)) return fail(res, 'VALIDATION_ERROR', 'to harus YYYY-MM-DD', 400);
  const { page, limit, offset } = paging(req.query, { defaultLimit: 25, maxLimit: 100 });
  const where = ['p.entity_id = ?'];
  const args = [req.user.entityId];
  if (req.query.active !== 'all') where.push("p.status = 'Aktif'");
  const sq = searchClause(req.query.q, ['p.item_code', 'p.name', 'p.category']);
  const whereSql = where.join(' AND ') + sq.sql;
  const period = [from ? 'l.trans_date >= ?' : null, to ? 'l.trans_date <= ?' : null].filter(Boolean);
  const periodArgs = [from, to].filter(Boolean);
  const lc = accurateScope(req.user, 'l');
  // Revenue per product = each line's share of its invoice DPP (before PPN, as
  // Marketing and the overview), down payments left out.
  const lines = `FROM sales_invoice_lines_accurate l
                   WHERE l.entity_id = ?${lc.sql} AND NOT l.is_dp${period.map((w) => ` AND ${w}`).join('')}`;
  const lineArgs = [req.user.entityId, ...lc.args, ...periodArgs];
  // Quantities per unit (cartons and packs are never added up as they are);
  // once Accurate's units are approved (program 1.3), also one total in the
  // base unit — only when every unit it sold in has a known ratio.
  const [rows] = await pool.query(
    `SELECT p.id, p.item_code AS skuCode, p.name, p.category, p.unit_price AS price, p.status, 'accurate' AS source,
            s.revenue, s.invoices, q.units, q.base_qty, q.base_unit
       FROM sales_items_accurate p
       LEFT JOIN (SELECT l.item_code, SUM(l.revenue) AS revenue, COUNT(DISTINCT l.invoice_id) AS invoices
                    ${lines}
                   GROUP BY l.item_code) s ON s.item_code COLLATE utf8mb4_unicode_ci = p.item_code
       LEFT JOIN (SELECT u.item_code, JSON_ARRAYAGG(JSON_OBJECT('unit', u.unit, 'qty', u.qty)) AS units,
                         CASE WHEN SUM(iu.ratio IS NULL) = 0 THEN SUM(u.qty * iu.ratio) END AS base_qty, MIN(iu.base_unit) AS base_unit
                    FROM (SELECT l.item_code, l.unit, SUM(l.qty) AS qty ${lines} GROUP BY l.item_code, l.unit) u
                    LEFT JOIN item_units_accurate iu ON iu.entity_id = ? AND iu.item_no = u.item_code COLLATE utf8mb4_unicode_ci
                          AND iu.unit_name = u.unit COLLATE utf8mb4_unicode_ci
                   GROUP BY u.item_code) q ON q.item_code COLLATE utf8mb4_unicode_ci = p.item_code
      WHERE ${whereSql}
      ORDER BY COALESCE(s.revenue, 0) DESC, p.name, p.id
      LIMIT ? OFFSET ?`,
    [...lineArgs, ...lineArgs, req.user.entityId, ...args, ...sq.args, limit, offset],
  );
  const [[count]] = await pool.query(`SELECT COUNT(*) AS n FROM sales_items_accurate p WHERE ${whereSql}`, [...args, ...sq.args]);
  return ok(res, rows.map(({ units, base_qty: baseQty, base_unit: baseUnit, ...r }) => ({
    ...r, price: r.price === null ? null : money(r.price), revenue: money(r.revenue || 0),
    qtyByUnit: unitQuantities(units), baseQty: baseQtyOf(baseQty, baseUnit), invoices: int(r.invoices), isActive: r.status === 'Aktif',
  })), { page, limit, total: int(count.n), source: 'accurate' });
}

const listOrders = handle(async (req, res) => {
  if (await numbersFromAccurate(req.user.entityId)) return listAccurateOrders(req, res);
  const f = orderFilters(req);
  if (f.error) return fail(res, 'VALIDATION_ERROR', f.error, 400);
  const { page, limit, offset } = paging(req.query);
  const [rows] = await pool.query(
    `SELECT o.id, o.order_number AS orderNumber, o.transaction_date AS transactionDate,
            o.order_date AS orderDate, o.delivery_date AS deliveryDate, o.channel,
            o.customer_id AS customerId, o.customer_code AS customerCode, o.customer_name AS customerName,
            o.sales_person_name AS salesPersonName, o.do_numbers AS doNumbers, o.invoice_numbers AS invoiceNumbers,
            o.line_count AS lineCount, o.total_amount AS totalAmount, o.outstanding_amount AS outstandingAmount,
            o.settled_amount AS settledAmount, o.due_date AS dueDate,
            IF(o.outstanding_amount > 0 AND o.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), o.due_date), NULL) AS daysOverdue
       FROM sales_orders o
      WHERE ${f.where}
      ORDER BY o.transaction_date DESC, o.id DESC
      LIMIT ? OFFSET ?`,
    [...f.args, limit, offset],
  );
  const [[sum]] = await pool.query(
    `SELECT COUNT(*) AS orders, SUM(o.dpp_amount) AS revenue, SUM(o.outstanding_amount) AS outstanding
       FROM sales_orders o WHERE ${f.where}`,
    f.args,
  );
  const [channels] = await pool.query(
    'SELECT DISTINCT channel FROM sales_orders WHERE entity_id = ? AND deleted_at IS NULL AND channel IS NOT NULL ORDER BY channel',
    [req.user.entityId],
  );
  return ok(res, rows.map((r) => ({
    ...r, totalAmount: money(r.totalAmount), outstandingAmount: money(r.outstandingAmount), settledAmount: money(r.settledAmount),
  })), {
    page, limit, total: int(sum.orders), revenue: money(sum.revenue), outstanding: money(sum.outstanding),
    channels: [...new Set([...ORDER_CHANNELS, ...channels.map((c) => c.channel)])],
  });
});

// One order the caller may see, with its lines and payments; null otherwise.
async function loadOrder(req, id) {
  const s = ownScope(req.user, 'order', 'o.id');
  const [[order]] = await pool.query(
    `SELECT o.id, o.order_number AS orderNumber, o.transaction_date AS transactionDate,
            o.order_date AS orderDate, o.delivery_date AS deliveryDate, o.channel,
            o.customer_id AS customerId, o.customer_code AS customerCode, o.customer_name AS customerName,
            o.sales_person_name AS salesPersonName, o.owner_user_id AS ownerUserId,
            o.do_numbers AS doNumbers, o.do_date AS doDate, o.invoice_numbers AS invoiceNumbers, o.invoice_date AS invoiceDate,
            o.due_date AS dueDate, IF(o.outstanding_amount > 0 AND o.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), o.due_date), NULL) AS daysOverdue,
            o.subtotal, o.dpp_amount AS dppAmount, o.tax_amount AS taxAmount, o.delivery_fee AS deliveryFee, o.total_amount AS totalAmount,
            o.outstanding_amount AS outstandingAmount, o.settled_amount AS settledAmount,
            o.notes, o.source, o.created_at AS createdAt, u.name AS createdByName, o.department_id AS departmentId,
            c.address AS customerAddress, c.phone AS customerPhone, c.contact_person AS customerContact
       FROM sales_orders o
       LEFT JOIN users u ON u.id = o.created_by
       LEFT JOIN sales_customers c ON c.id = o.customer_id
      WHERE o.id = ? AND o.entity_id = ?${s.sql} AND o.deleted_at IS NULL`,
    [id, req.user.entityId, ...s.args],
  );
  if (!order) return null;
  const [lines] = await pool.query(
    `SELECT l.line_no AS lineNo, l.sku_code AS skuCode, l.product_name AS productName, l.qty,
            l.unit_price AS unitPrice, l.line_total AS lineTotal, l.taxable, l.tax_amount AS taxAmount,
            l.delivery_fee AS deliveryFee, l.outstanding_amount AS outstandingAmount,
            l.settled_amount AS settledAmount, l.do_number AS doNumber, l.invoice_number AS invoiceNumber
       FROM sales_order_lines l WHERE l.order_id = ? ORDER BY l.line_no`,
    [id],
  );
  const [payments] = await pool.query(
    `SELECT p.id, p.paid_at AS paidAt, p.amount, p.method, p.note, p.created_at AS createdAt, u.name AS createdByName
       FROM sales_order_payments p LEFT JOIN users u ON u.id = p.created_by
      WHERE p.order_id = ? ORDER BY p.paid_at, p.id`,
    [id],
  );
  const locked = Boolean(order.invoiceNumbers) || money(order.settledAmount) > 0;
  return {
    order: { ...order, editable: !locked, cancellable: money(order.settledAmount) <= 0 },
    lines: lines.map((l) => ({ ...l, qty: Number(l.qty), taxable: Boolean(l.taxable) })),
    payments: payments.map((p) => ({ ...p, amount: money(p.amount) })),
    suggested: { doNumber: documentNumber(order.orderNumber, 'DO'), invoiceNumber: documentNumber(order.orderNumber, 'SI') },
  };
}

const orderDetail = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  const data = await loadOrder(req, id);
  if (!data) return fail(res, 'NOT_FOUND', 'Sales order tidak ditemukan', 404);
  return ok(res, data);
});

// ------------------------------------------------------------------ printing

const SETTINGS_FIELDS = {
  companyName: 'company_name', address: 'address', phone: 'phone', email: 'email', npwp: 'npwp',
  bankAccounts: 'bank_accounts', paymentTermsDays: 'payment_terms_days', invoiceNote: 'invoice_note', deliveryNote: 'delivery_note',
};

async function documentSettings(entityId) {
  const [[row]] = await pool.query('SELECT * FROM sales_document_settings WHERE entity_id = ?', [entityId]);
  const [[entity]] = await pool.query('SELECT name, logo_url FROM entities WHERE id = ?', [entityId]);
  const out = Object.fromEntries(Object.entries(SETTINGS_FIELDS).map(([k, col]) => [k, row?.[col] ?? null]));
  return { ...out, entityName: entity?.name || null, logoUrl: entity?.logo_url || null };
}

const getDocumentSettings = handle(async (req, res) => ok(res, await documentSettings(req.user.entityId)));

const saveDocumentSettings = handle(async (req, res) => {
  const cols = Object.entries(SETTINGS_FIELDS).filter(([k]) => req.body[k] !== undefined);
  if (!cols.length) return fail(res, 'VALIDATION_ERROR', 'Tidak ada perubahan', 400);
  const values = cols.map(([k]) => (req.body[k] === '' ? null : req.body[k]));
  await pool.query(
    `INSERT INTO sales_document_settings (entity_id, ${cols.map(([, c]) => c).join(', ')}, updated_by)
     VALUES (?, ${cols.map(() => '?').join(', ')}, ?)
     ON DUPLICATE KEY UPDATE ${cols.map(([, c]) => `${c} = VALUES(${c})`).join(', ')}, updated_by = VALUES(updated_by)`,
    [req.user.entityId, ...values, req.user.sub],
  );
  await log({
    entityId: req.user.entityId, userId: req.user.sub, action: 'sales_document_settings.update',
    subjectType: 'sales_document_settings', subjectId: req.user.entityId, metadata: { fields: cols.map(([k]) => k) },
  });
  return ok(res, await documentSettings(req.user.entityId));
});

// Everything one printed document needs: the order, the company details and
// the order's division letterhead (decrypted here, so printing does not depend
// on the printer's own division).
const printData = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  const data = await loadOrder(req, id);
  if (!data) return fail(res, 'NOT_FOUND', 'Sales order tidak ditemukan', 404);
  let letterhead = null;
  if (data.order.departmentId) {
    const [[asset]] = await pool.query(
      'SELECT encrypted_blob, iv, auth_tag, mime_type FROM letterhead_assets WHERE department_id = ? AND entity_id = ? LIMIT 1',
      [data.order.departmentId, req.user.entityId],
    );
    if (asset) {
      const image = decryptBuffer({ encrypted: asset.encrypted_blob, iv: asset.iv, authTag: asset.auth_tag });
      letterhead = { mimeType: asset.mime_type, imageBase64: image.toString('base64') };
    }
  }
  const settings = await documentSettings(req.user.entityId);
  const [[me]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.user.sub]);
  return ok(res, { ...data, settings, letterhead, printedBy: me?.name || null });
});

// One row per surat jalan or invoice number, paged on the server.
const listDocuments = handle(async (req, res) => {
  if (await numbersFromAccurate(req.user.entityId)) {
    if (req.query.type === 'invoice') return listAccurateInvoices(req, res);
    if (ACCURATE_DOCUMENTS[req.query.type]) return listAccurateDocuments(req, res, req.query.type);
    return fail(res, 'VALIDATION_ERROR', 'type harus do, invoice, receipt atau return', 400);
  }
  const column = { do: 'l.do_number', invoice: 'l.invoice_number' }[req.query.type];
  if (!column) return fail(res, 'VALIDATION_ERROR', 'type harus do atau invoice', 400);
  const { from, to, q } = req.query;
  if (from && !isDate(from)) return fail(res, 'VALIDATION_ERROR', 'from harus YYYY-MM-DD', 400);
  if (to && !isDate(to)) return fail(res, 'VALIDATION_ERROR', 'to harus YYYY-MM-DD', 400);
  const os = ownScope(req.user, 'order', 'o.id');
  const where = [`o.entity_id = ?${os.sql}`, 'o.deleted_at IS NULL', `${column} IS NOT NULL`];
  const args = [req.user.entityId, ...os.args];
  if (from) { where.push('o.transaction_date >= ?'); args.push(from); }
  if (to) { where.push('o.transaction_date <= ?'); args.push(to); }
  const s = searchClause(q, [column, 'o.order_number', 'o.customer_name']);
  const whereSql = where.join(' AND ') + s.sql;
  const allArgs = [...args, ...s.args];
  const { page, limit, offset } = paging(req.query);
  const [rows] = await pool.query(
    `SELECT ${column} AS number, MIN(o.transaction_date) AS date,
            GROUP_CONCAT(DISTINCT o.order_number ORDER BY o.order_number SEPARATOR ', ') AS orderNumbers,
            MIN(o.id) AS orderId, COUNT(DISTINCT o.id) AS orderCount,
            MIN(o.customer_name) AS customerName, MIN(o.customer_id) AS customerId, MIN(o.channel) AS channel,
            COUNT(*) AS lineCount, SUM(l.line_total + l.delivery_fee) AS totalAmount,
            SUM(l.outstanding_amount) AS outstandingAmount
       FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
      WHERE ${whereSql}
      GROUP BY ${column}
      ORDER BY date DESC, number DESC
      LIMIT ? OFFSET ?`,
    [...allArgs, limit, offset],
  );
  const [[count]] = await pool.query(
    `SELECT COUNT(DISTINCT ${column}) AS n FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id WHERE ${whereSql}`,
    allArgs,
  );
  return ok(res, rows.map((r) => ({
    ...r, orderCount: int(r.orderCount), lineCount: int(r.lineCount),
    totalAmount: money(r.totalAmount), outstandingAmount: money(r.outstandingAmount),
  })), { page, limit, total: int(count.n) });
});

const nextNumber = handle(async (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : todayWib();
  return ok(res, { orderNumber: await records.nextOrderNumber(req.user, { date, channel: req.query.channel }) });
});

const createOrder = handle(async (req, res) => ok(res, await records.createOrder(req.user, req.body), undefined, 201));
const updateOrder = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  return ok(res, await records.updateOrder(req.user, id, req.body));
});
const cancelOrder = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  return ok(res, await records.cancelOrder(req.user, id));
});
const setDelivery = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  return ok(res, await records.setDocument(req.user, id, 'DO', req.body));
});
const setInvoice = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  return ok(res, await records.setDocument(req.user, id, 'SI', req.body));
});
const addPayment = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  return ok(res, await records.addPayment(req.user, id, req.body), undefined, 201);
});

// ------------------------------------------------------------------ products

const listProducts = handle(async (req, res) => {
  // The order form needs the app's own product list; Data Sales shows Accurate's.
  if (req.query.source !== 'app' && !req.query.customerId && await numbersFromAccurate(req.user.entityId)) {
    return listAccurateProducts(req, res);
  }
  const { page, limit, offset } = paging(req.query, { defaultLimit: 25, maxLimit: 100 });
  const where = ['p.entity_id = ?'];
  const args = [req.user.entityId];
  if (req.query.active !== 'all') where.push('p.is_active = 1');
  const s = searchClause(req.query.q, ['p.sku_code', 'p.name']);
  const whereSql = where.join(' AND ') + s.sql;
  // With a customer: the price this customer last paid, so a repeat order
  // starts from the agreed price instead of the list price.
  const customerId = positiveId(req.query.customerId);
  const lastPrice = customerId
    ? `, (SELECT l.unit_price FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
          WHERE o.customer_id = ? AND o.entity_id = p.entity_id AND o.deleted_at IS NULL AND l.sku_code = p.sku_code
          ORDER BY o.transaction_date DESC, l.id DESC LIMIT 1) AS lastPrice`
    : ', NULL AS lastPrice';
  const [rows] = await pool.query(
    `SELECT p.id, p.sku_code AS skuCode, p.name, p.category, p.unit, p.price, p.cost_price AS costPrice,
            p.is_active AS isActive, p.source${lastPrice}
       FROM sales_products p WHERE ${whereSql}
      ORDER BY p.name, p.id LIMIT ? OFFSET ?`,
    [...(customerId ? [customerId] : []), ...args, ...s.args, limit, offset],
  );
  const [[count]] = await pool.query(`SELECT COUNT(*) AS n FROM sales_products p WHERE ${whereSql}`, [...args, ...s.args]);
  return ok(res, rows.map((r) => ({
    ...r, price: r.price === null ? null : money(r.price), costPrice: r.costPrice === null ? null : money(r.costPrice),
    lastPrice: r.lastPrice === null ? null : money(r.lastPrice), isActive: Boolean(r.isActive),
  })), { page, limit, total: int(count.n) });
});

const createProduct = handle(async (req, res) => ok(res, await records.createProduct(req.user, req.body), undefined, 201));
const updateProduct = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  return ok(res, await records.updateProduct(req.user, id, req.body));
});

// Umur piutang per syarat bayar (program 2.3), from approved Accurate invoices;
// the same rows the viewer sees in the invoice list.
const receivablesAging = handle(async (req, res) => {
  if (!(await numbersFromAccurate(req.user.entityId))) return ok(res, null, { source: 'recap' });
  const customerId = positiveId(req.query.customerId) || null;
  return ok(res, await receivables.aging(req.user, { customerId }), { source: 'accurate' });
});

module.exports = {
  receivablesAging,
  getDocumentSettings, saveDocumentSettings, printData,
  listOrders, orderDetail, listDocuments, nextNumber, createOrder, updateOrder, cancelOrder,
  setDelivery, setInvoice, addPayment, listProducts, createProduct, updateProduct,
};
