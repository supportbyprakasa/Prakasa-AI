const pool = require('../db/pool');
const { log } = require('./activityLog.service');
const salesOwners = require('./salesOwners.service');
const notif = require('./notification.service');
const numbers = require('./salesNumbers');
const { DEFAULT_DIVISION, divisionForOrderChannel, divisionForCustomerCategory } = require('./salesStatus');
const { todayWib } = require('../utils/wibTime');

// Writes for Sales records entered in the app: customers, leads and their
// visits, sales orders with surat jalan, invoice and payments, and the SKU list.
// Every write is bound to the caller's entity and, for users without
// sales.data.view_all, to the records they own — the same rule as the reads.

const PPN_RATE = 0.11;

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const viewAll = (user) => (user?.permissions || []).includes('sales.data.view_all');

async function inTx(fn) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const result = await fn(db);
    await db.commit();
    return result;
  } catch (e) {
    await db.rollback().catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}

// department code → id for the entity; a division missing here falls back to Sales.
async function divisionIds(db, entityId) {
  const [rows] = await db.query(
    `SELECT id, code FROM departments WHERE entity_id = ? AND deleted_at IS NULL AND code IN ('sales', 'retail_commerce')`,
    [entityId],
  );
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  const fallback = byCode.get(DEFAULT_DIVISION) || null;
  return (code) => byCode.get(code) || fallback;
}

// The PIC of a record. Without view_all a user only ever assigns records to
// themselves; others pick any active account of Sales or Retail Commerce.
async function resolveOwner(db, user, requestedId) {
  const wanted = viewAll(user) ? (requestedId || null) : Number(user.sub);
  const id = wanted || Number(user.sub);
  const [[account]] = await db.query(
    `SELECT u.id, u.name FROM users u JOIN departments d ON d.id = u.department_id
      WHERE u.id = ? AND u.entity_id = ? AND u.deleted_at IS NULL AND u.status = 'active'
        AND d.code IN ('sales', 'retail_commerce')`,
    [id, user.entityId],
  );
  if (account) return account;
  if (requestedId && viewAll(user)) throw httpError(400, 'VALIDATION_ERROR', 'PIC harus akun aktif divisi Sales atau Retail Commerce.');
  return null; // e.g. a Super Admin entering data: no PIC until one is chosen
}

// Loads one record the caller may touch, or throws 404.
async function ownRecord(db, user, table, type, id, columns = '*') {
  const s = salesOwners.ownScope(user, type, 'x.id');
  const [[row]] = await db.query(
    `SELECT ${columns} FROM ${table} x WHERE x.id = ? AND x.entity_id = ?${s.sql} AND x.deleted_at IS NULL`,
    [id, user.entityId, ...s.args],
  );
  if (!row) throw httpError(404, 'NOT_FOUND', 'Data tidak ditemukan');
  return row;
}

// Tell a salesperson when someone else makes them PIC of a record. In-app
// only (no rule sends it anywhere else); never blocks the write.
async function notifyAssigned(user, owner, { type, id, name }) {
  if (!owner || Number(owner.id) === Number(user.sub)) return;
  const what = { customer: 'Customer', lead: 'Lead', order: 'Sales order' }[type];
  const url = { customer: `/sales/customers/${id}`, lead: `/sales/leads?lead=${id}`, order: `/sales/orders/${id}` }[type];
  try {
    await notif.create({
      userId: owner.id, entityId: user.entityId, title: `${what} ditugaskan ke Anda`, body: name,
      event: 'sales.assigned', subjectType: `sales_${type}`, subjectId: id, actionUrl: url,
    });
  } catch { /* the assignment stands even if the notification fails */ }
}

// Order dates move the customer's status: the later of the imported last order
// and the app's latest order; NOO the earlier.
async function refreshCustomerDates(db, customerIds) {
  const ids = [...new Set(customerIds.filter(Boolean))];
  if (!ids.length) return;
  await db.query(
    `UPDATE sales_customers c
       LEFT JOIN (SELECT customer_id, MIN(transaction_date) AS first_at, MAX(transaction_date) AS last_at
                    FROM sales_orders WHERE deleted_at IS NULL AND customer_id IN (?) GROUP BY customer_id) o
         ON o.customer_id = c.id
        SET c.last_order_date = NULLIF(GREATEST(COALESCE(c.last_order_import, '1000-01-01'), COALESCE(o.last_at, '1000-01-01')), '1000-01-01'),
            c.noo_date = NULLIF(LEAST(COALESCE(c.noo_import, '9999-12-31'), COALESCE(o.first_at, '9999-12-31')), '9999-12-31'),
            c.department_id = COALESCE(
              (SELECT x.department_id FROM sales_orders x
                WHERE x.customer_id = c.id AND x.deleted_at IS NULL AND x.department_id IS NOT NULL
                ORDER BY x.transaction_date DESC, x.id DESC LIMIT 1),
              c.department_id)
      WHERE c.id IN (?)`,
    [ids, ids],
  );
}

// ------------------------------------------------------------------ customers

const CUSTOMER_FIELDS = {
  name: 'name', contactPerson: 'contact_person', phone: 'phone', businessPhone: 'business_phone', email: 'email',
  address: 'address', city: 'city', segment: 'segment', notes: 'notes', channel: 'channel', legalForm: 'legal_form',
};

async function createCustomer(user, input, db = null) {
  const run = async (tx) => {
    const entityId = user.entityId;
    const owner = await resolveOwner(tx, user, input.ownerUserId);
    const [codes] = await tx.query('SELECT customer_code AS code FROM sales_customers WHERE entity_id = ? AND customer_code IS NOT NULL FOR UPDATE', [entityId]);
    const code = input.customerCode || numbers.customerCode(input, codes.map((c) => c.code));
    if (codes.some((c) => c.code === code)) throw httpError(409, 'DUPLICATE', `ID pelanggan ${code} sudah dipakai.`);
    const division = await divisionIds(tx, entityId);
    const [r] = await tx.query(
      `INSERT INTO sales_customers
         (entity_id, department_id, customer_code, name, channel, legal_form, contact_person, phone, business_phone,
          email, address, city, segment, notes, owner_user_id, sales_person_name, source, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'app', ?)`,
      [entityId, division(divisionForCustomerCategory(input.channel)), code, input.name, input.channel || null,
        input.legalForm || null, input.contactPerson || null, input.phone || null, input.businessPhone || null,
        input.email || null, input.address || null, input.city || null, input.segment || null, input.notes || null,
        owner?.id || null, owner?.name || null, user.sub],
    );
    await salesOwners.refreshRecords(tx, entityId, { customers: [r.insertId] });
    await notifyAssigned(user, owner, { type: 'customer', id: r.insertId, name: input.name });
    await log({ entityId, userId: user.sub, action: 'sales_customer.create', subjectType: 'sales_customer', subjectId: r.insertId, metadata: { code, name: input.name } });
    return { id: r.insertId, code };
  };
  return db ? run(db) : inTx(run);
}

async function updateCustomer(user, id, input) {
  return inTx(async (db) => {
    const current = await ownRecord(db, user, 'sales_customers', 'customer', id, 'x.id, x.name, x.owner_user_id');
    const sets = [];
    const args = [];
    for (const [field, column] of Object.entries(CUSTOMER_FIELDS)) {
      if (input[field] !== undefined) { sets.push(`${column} = ?`); args.push(input[field] === '' ? null : input[field]); }
    }
    let newOwner = null;
    if (input.ownerUserId !== undefined) {
      const owner = input.ownerUserId ? await resolveOwner(db, user, input.ownerUserId) : null;
      sets.push('owner_user_id = ?', 'sales_person_name = ?');
      args.push(owner?.id || null, owner?.name || null);
      if (owner && Number(owner.id) !== Number(current.owner_user_id)) newOwner = owner;
    }
    if (!sets.length) throw httpError(400, 'VALIDATION_ERROR', 'Tidak ada perubahan');
    await db.query(`UPDATE sales_customers SET ${sets.join(', ')} WHERE id = ? AND entity_id = ?`, [...args, id, user.entityId]);
    await notifyAssigned(user, newOwner, { type: 'customer', id, name: input.name || current.name });
    if (input.name && input.name !== current.name) {
      await db.query('UPDATE sales_orders SET customer_name = ? WHERE customer_id = ? AND entity_id = ?', [input.name, id, user.entityId]);
    }
    await salesOwners.refreshRecords(db, user.entityId, { customers: [id] });
    await log({ entityId: user.entityId, userId: user.sub, action: 'sales_customer.update', subjectType: 'sales_customer', subjectId: id, metadata: { fields: Object.keys(input) } });
    return { id };
  });
}

async function deleteCustomer(user, id) {
  return inTx(async (db) => {
    await ownRecord(db, user, 'sales_customers', 'customer', id, 'x.id');
    const [[orders]] = await db.query('SELECT COUNT(*) AS n FROM sales_orders WHERE customer_id = ? AND deleted_at IS NULL', [id]);
    if (Number(orders.n) > 0) throw httpError(409, 'HAS_ORDERS', `Customer ini punya ${orders.n} sales order, jadi tidak bisa dihapus.`);
    await db.query('UPDATE sales_customers SET deleted_at = NOW() WHERE id = ? AND entity_id = ?', [id, user.entityId]);
    await db.query("DELETE FROM sales_owner_links WHERE record_type = 'customer' AND record_id = ?", [id]);
    await log({ entityId: user.entityId, userId: user.sub, action: 'sales_customer.delete', subjectType: 'sales_customer', subjectId: id });
    return { id };
  });
}

async function nextCustomerCode(user, input) {
  const [codes] = await pool.query('SELECT customer_code AS code FROM sales_customers WHERE entity_id = ? AND customer_code IS NOT NULL', [user.entityId]);
  return numbers.customerCode(input, codes.map((c) => c.code));
}

// ------------------------------------------------------------------ orders

// Totals the way the Sales Data Tracker settles an order: goods plus delivery;
// PPN 11% on taxable lines is recorded alongside, as the sheet did.
function computeOrder(lines, deliveryFee = 0) {
  const fee = round2(deliveryFee);
  const out = lines.map((l, i) => {
    const qty = Number(l.qty);
    const lineTotal = round2(qty * Number(l.unitPrice));
    const lineFee = i === 0 ? fee : 0;
    return {
      lineNo: i + 1,
      skuCode: l.skuCode || null,
      productName: l.productName,
      qty,
      unitPrice: round2(l.unitPrice),
      lineTotal,
      taxable: Boolean(l.taxable),
      taxAmount: l.taxable ? round2(lineTotal * PPN_RATE) : 0,
      deliveryFee: lineFee,
      outstanding: round2(lineTotal + lineFee),
    };
  });
  const sum = (k) => round2(out.reduce((s, l) => s + l[k], 0));
  const subtotal = sum('lineTotal');
  // DPP (revenue before PPN): prices include PPN, so a taxable line is / 1.11.
  const dppAmount = round2(out.reduce((s, l) => s + (l.taxable ? l.lineTotal / (1 + PPN_RATE) : l.lineTotal), 0));
  return { lines: out, subtotal, dppAmount, taxAmount: sum('taxAmount'), deliveryFee: fee, totalAmount: round2(subtotal + fee) };
}

async function existingOrderNumbers(db, entityId, date) {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  const suffix = `/${numbers.ROMAN[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
  const [rows] = await db.query(
    'SELECT order_number AS n FROM sales_orders WHERE entity_id = ? AND order_number LIKE ?',
    [entityId, `SO%${suffix}`],
  );
  return rows.map((r) => r.n);
}

async function nextOrderNumber(user, { date, channel }) {
  return numbers.orderNumber({ date, channel }, await existingOrderNumbers(pool, user.entityId, date));
}

async function insertLines(db, orderId, lines) {
  await db.query(
    `INSERT INTO sales_order_lines
       (order_id, line_no, sku_code, product_name, qty, unit_price, line_total, taxable, tax_amount,
        delivery_fee, outstanding_amount, settled_amount, do_number, invoice_number)
     VALUES ?`,
    [lines.map((l) => [orderId, l.lineNo, l.skuCode, l.productName, l.qty, l.unitPrice, l.lineTotal, l.taxable ? 1 : 0,
      l.taxAmount, l.deliveryFee, l.outstanding, 0, null, null])],
  );
}

async function createOrder(user, input) {
  return inTx(async (db) => {
    const entityId = user.entityId;
    const customer = await ownRecord(db, user, 'sales_customers', 'customer', input.customerId,
      'x.id, x.name, x.customer_code, x.channel, x.owner_user_id');
    const channel = input.channel || numbers.orderChannelFor(customer.channel);
    const transactionDate = input.deliveryDate || input.orderDate;
    const orderNo = input.orderNumber
      || numbers.orderNumber({ date: transactionDate, channel }, await existingOrderNumbers(db, entityId, transactionDate));
    const [[dup]] = await db.query('SELECT id FROM sales_orders WHERE entity_id = ? AND order_number = ? AND deleted_at IS NULL LIMIT 1', [entityId, orderNo]);
    if (dup) throw httpError(409, 'DUPLICATE', `Nomor SO ${orderNo} sudah dipakai.`);
    const owner = await resolveOwner(db, user, input.ownerUserId || customer.owner_user_id);
    const totals = computeOrder(input.lines, input.deliveryFee);
    const division = await divisionIds(db, entityId);
    const [r] = await db.query(
      `INSERT INTO sales_orders
         (entity_id, department_id, order_number, customer_code, customer_id, customer_name, channel, sales_person_name,
          owner_user_id, order_date, delivery_date, transaction_date, line_count, subtotal, dpp_amount, tax_amount, delivery_fee,
          total_amount, outstanding_amount, settled_amount, source, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'app', ?, ?)`,
      [entityId, division(divisionForOrderChannel(channel)), orderNo, customer.customer_code || '', customer.id, customer.name,
        channel, owner?.name || null, owner?.id || null, input.orderDate, input.deliveryDate || null, transactionDate,
        totals.lines.length, totals.subtotal, totals.dppAmount, totals.taxAmount, totals.deliveryFee, totals.totalAmount, totals.totalAmount,
        input.notes || null, user.sub],
    );
    await insertLines(db, r.insertId, totals.lines);
    await refreshCustomerDates(db, [customer.id]);
    await salesOwners.refreshRecords(db, entityId, { customers: [customer.id], orders: [r.insertId] });
    await log({ entityId, userId: user.sub, action: 'sales_order.create', subjectType: 'sales_order', subjectId: r.insertId, metadata: { orderNumber: orderNo, total: totals.totalAmount } });
    return { id: r.insertId, orderNumber: orderNo };
  });
}

// Editable until it is invoiced or paid; after that the paperwork stands.
async function updateOrder(user, id, input) {
  return inTx(async (db) => {
    const order = await ownRecord(db, user, 'sales_orders', 'order', id,
      'x.id, x.customer_id, x.invoice_numbers, x.settled_amount, x.channel, x.order_date, x.delivery_date');
    if (order.invoice_numbers || Number(order.settled_amount) > 0) {
      throw httpError(409, 'LOCKED', 'Sales order yang sudah ditagih atau dibayar tidak bisa diubah.');
    }
    const channel = input.channel || order.channel;
    const orderDate = input.orderDate || order.order_date;
    const deliveryDate = input.deliveryDate !== undefined ? input.deliveryDate : order.delivery_date;
    const totals = input.lines ? computeOrder(input.lines, input.deliveryFee) : null;
    const owner = input.ownerUserId ? await resolveOwner(db, user, input.ownerUserId) : null;
    const division = await divisionIds(db, user.entityId);
    await db.query(
      `UPDATE sales_orders SET channel = ?, department_id = ?, order_date = ?, delivery_date = ?, transaction_date = ?,
              notes = COALESCE(?, notes)
              ${owner ? ', owner_user_id = ?, sales_person_name = ?' : ''}
              ${totals ? ', line_count = ?, subtotal = ?, dpp_amount = ?, tax_amount = ?, delivery_fee = ?, total_amount = ?, outstanding_amount = ?' : ''}
        WHERE id = ? AND entity_id = ?`,
      [channel, division(divisionForOrderChannel(channel)), orderDate, deliveryDate || null, deliveryDate || orderDate,
        input.notes ?? null,
        ...(owner ? [owner.id, owner.name] : []),
        ...(totals ? [totals.lines.length, totals.subtotal, totals.dppAmount, totals.taxAmount, totals.deliveryFee, totals.totalAmount, totals.totalAmount] : []),
        id, user.entityId],
    );
    if (totals) {
      const [[doRow]] = await db.query('SELECT do_numbers FROM sales_orders WHERE id = ?', [id]);
      await db.query('DELETE FROM sales_order_lines WHERE order_id = ?', [id]);
      await insertLines(db, id, totals.lines);
      if (doRow?.do_numbers) await db.query('UPDATE sales_order_lines SET do_number = ? WHERE order_id = ?', [doRow.do_numbers, id]);
    }
    await refreshCustomerDates(db, [order.customer_id]);
    await salesOwners.refreshRecords(db, user.entityId, { orders: [id] });
    await log({ entityId: user.entityId, userId: user.sub, action: 'sales_order.update', subjectType: 'sales_order', subjectId: id });
    return { id };
  });
}

async function cancelOrder(user, id) {
  return inTx(async (db) => {
    const order = await ownRecord(db, user, 'sales_orders', 'order', id, 'x.id, x.customer_id, x.order_number, x.settled_amount');
    if (Number(order.settled_amount) > 0) throw httpError(409, 'LOCKED', 'Sales order yang sudah ada pembayarannya tidak bisa dibatalkan.');
    await db.query('UPDATE sales_orders SET deleted_at = NOW() WHERE id = ? AND entity_id = ?', [id, user.entityId]);
    await db.query("DELETE FROM sales_owner_links WHERE record_type = 'order' AND record_id = ?", [id]);
    await refreshCustomerDates(db, [order.customer_id]);
    await log({ entityId: user.entityId, userId: user.sub, action: 'sales_order.cancel', subjectType: 'sales_order', subjectId: id, metadata: { orderNumber: order.order_number } });
    return { id };
  });
}

// Surat jalan (kind DO) or invoice (kind SI): one number for the whole order.
async function setDocument(user, id, kind, { number, date, dueDate }) {
  return inTx(async (db) => {
    const order = await ownRecord(db, user, 'sales_orders', 'order', id, 'x.id, x.order_number, x.do_numbers, x.invoice_numbers');
    const docNo = (number || numbers.documentNumber(order.order_number, kind)).trim().slice(0, 80);
    const lineCol = kind === 'DO' ? 'do_number' : 'invoice_number';
    const headCol = kind === 'DO' ? 'do_numbers' : 'invoice_numbers';
    const dateCol = kind === 'DO' ? 'do_date' : 'invoice_date';
    const [[dup]] = await db.query(
      `SELECT o.id FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
        WHERE o.entity_id = ? AND o.deleted_at IS NULL AND l.${lineCol} = ? AND o.id <> ? LIMIT 1`,
      [user.entityId, docNo, id],
    );
    if (dup) throw httpError(409, 'DUPLICATE', `Nomor ${docNo} sudah dipakai sales order lain.`);
    await db.query(`UPDATE sales_order_lines SET ${lineCol} = ? WHERE order_id = ?`, [docNo, id]);
    await db.query(`UPDATE sales_orders SET ${headCol} = ?, ${dateCol} = ? WHERE id = ? AND entity_id = ?`, [docNo, date, id, user.entityId]);
    if (kind === 'SI') {
      // Due date is fixed when invoicing: the date chosen, else invoice date +
      // the payment terms in Pengaturan dokumen; none when no terms are set.
      let due = dueDate || null;
      if (!due) {
        const [[settings]] = await db.query('SELECT payment_terms_days AS days FROM sales_document_settings WHERE entity_id = ?', [user.entityId]);
        if (settings?.days !== null && settings?.days !== undefined) {
          const d = new Date(`${date}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + Number(settings.days));
          due = d.toISOString().slice(0, 10);
        }
      }
      if (due && due < date) throw httpError(400, 'VALIDATION_ERROR', 'Jatuh tempo tidak boleh sebelum tanggal invoice.');
      await db.query('UPDATE sales_orders SET due_date = ? WHERE id = ? AND entity_id = ?', [due, id, user.entityId]);
    }
    await log({ entityId: user.entityId, userId: user.sub, action: kind === 'DO' ? 'sales_order.delivery' : 'sales_order.invoice', subjectType: 'sales_order', subjectId: id, metadata: { number: docNo, date } });
    return { id, number: docNo };
  });
}

// A payment pays the lines down in order; the order's totals follow its lines.
async function addPayment(user, id, { amount, paidAt, method, note }) {
  return inTx(async (db) => {
    const order = await ownRecord(db, user, 'sales_orders', 'order', id, 'x.id, x.outstanding_amount');
    const pay = round2(amount);
    if (!(pay > 0)) throw httpError(400, 'VALIDATION_ERROR', 'Jumlah pembayaran harus lebih dari 0.');
    if (pay > round2(order.outstanding_amount)) {
      throw httpError(400, 'VALIDATION_ERROR', `Pembayaran melebihi sisa piutang (${round2(order.outstanding_amount)}).`);
    }
    const [lines] = await db.query('SELECT id, outstanding_amount AS due FROM sales_order_lines WHERE order_id = ? ORDER BY line_no FOR UPDATE', [id]);
    let left = pay;
    for (const l of lines) {
      if (left <= 0) break;
      const part = Math.min(left, round2(l.due));
      if (part <= 0) continue;
      await db.query('UPDATE sales_order_lines SET outstanding_amount = outstanding_amount - ?, settled_amount = settled_amount + ? WHERE id = ?', [part, part, l.id]);
      left = round2(left - part);
    }
    await db.query(
      `UPDATE sales_orders o
         JOIN (SELECT order_id, SUM(outstanding_amount) AS due, SUM(settled_amount) AS paid FROM sales_order_lines WHERE order_id = ? GROUP BY order_id) l
           ON l.order_id = o.id
          SET o.outstanding_amount = l.due, o.settled_amount = l.paid
        WHERE o.id = ?`,
      [id, id],
    );
    const [r] = await db.query(
      'INSERT INTO sales_order_payments (order_id, paid_at, amount, method, note, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [id, paidAt, pay, method || null, note || null, user.sub],
    );
    await log({ entityId: user.entityId, userId: user.sub, action: 'sales_order.payment', subjectType: 'sales_order', subjectId: id, metadata: { amount: pay, paidAt } });
    return { id, paymentId: r.insertId };
  });
}

// ------------------------------------------------------------------ leads

async function refreshLeadVisits(db, leadId) {
  await db.query(
    `UPDATE sales_leads l
       LEFT JOIN (SELECT lead_id, MIN(visit_date) AS first_at, MAX(visit_date) AS last_at, COUNT(*) AS n
                    FROM sales_visit_reports WHERE lead_id = ? GROUP BY lead_id) v ON v.lead_id = l.id
        SET l.first_visit_date = v.first_at, l.last_visit_date = v.last_at, l.visit_count = COALESCE(v.n, 0),
            l.last_note = (SELECT LEFT(x.summary, 500) FROM sales_visit_reports x
                            WHERE x.lead_id = l.id AND x.summary IS NOT NULL
                            ORDER BY x.visit_date DESC, x.id DESC LIMIT 1)
      WHERE l.id = ?`,
    [leadId, leadId],
  );
}

async function createLead(user, input) {
  return inTx(async (db) => {
    const entityId = user.entityId;
    const owner = await resolveOwner(db, user, input.ownerUserId);
    const [codes] = await db.query('SELECT outlet_code AS code FROM sales_leads WHERE entity_id = ? FOR UPDATE', [entityId]);
    const today = todayWib();
    const code = numbers.leadCode(today, codes.map((c) => c.code));
    const division = await divisionIds(db, entityId);
    const [r] = await db.query(
      `INSERT INTO sales_leads
         (entity_id, department_id, outlet_code, name, address, area, latitude, longitude, sales_person_name,
          owner_user_id, last_note, source, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'app', ?)`,
      [entityId, division(DEFAULT_DIVISION), code, input.name, input.address || null, input.area || null,
        input.latitude ?? null, input.longitude ?? null, owner?.name || null, owner?.id || null, input.notes || null, user.sub],
    );
    await salesOwners.refreshRecords(db, entityId, { leads: [r.insertId] });
    await notifyAssigned(user, owner, { type: 'lead', id: r.insertId, name: input.name });
    await log({ entityId, userId: user.sub, action: 'sales_lead.create', subjectType: 'sales_lead', subjectId: r.insertId, metadata: { code, name: input.name } });
    return { id: r.insertId, code };
  });
}

const LEAD_FIELDS = { name: 'name', address: 'address', area: 'area', latitude: 'latitude', longitude: 'longitude', status: 'status' };

async function updateLead(user, id, input) {
  return inTx(async (db) => {
    const lead = await ownRecord(db, user, 'sales_leads', 'lead', id, 'x.id, x.customer_id, x.status, x.name, x.owner_user_id');
    const sets = [];
    const args = [];
    for (const [field, column] of Object.entries(LEAD_FIELDS)) {
      if (input[field] !== undefined) { sets.push(`${column} = ?`); args.push(input[field] === '' ? null : input[field]); }
    }
    if (input.customerId !== undefined) {
      if (input.customerId !== null) await ownRecord(db, user, 'sales_customers', 'customer', input.customerId, 'x.id');
      sets.push('customer_id = ?'); args.push(input.customerId);
    }
    if (input.ownerUserId !== undefined) {
      const owner = input.ownerUserId ? await resolveOwner(db, user, input.ownerUserId) : null;
      sets.push('owner_user_id = ?', 'sales_person_name = ?'); args.push(owner?.id || null, owner?.name || null);
      if (owner && Number(owner.id) !== Number(lead.owner_user_id)) {
        await notifyAssigned(user, owner, { type: 'lead', id, name: input.name || lead.name });
      }
    }
    if (!sets.length) throw httpError(400, 'VALIDATION_ERROR', 'Tidak ada perubahan');
    await db.query(`UPDATE sales_leads SET ${sets.join(', ')} WHERE id = ? AND entity_id = ?`, [...args, id, user.entityId]);
    if (input.customerId !== undefined) {
      await db.query('UPDATE sales_visit_reports SET customer_id = ? WHERE lead_id = ? AND entity_id = ?', [input.customerId, id, user.entityId]);
    }
    await salesOwners.refreshRecords(db, user.entityId, { leads: [id] });
    await log({ entityId: user.entityId, userId: user.sub, action: 'sales_lead.update', subjectType: 'sales_lead', subjectId: id, metadata: { from: { customerId: lead.customer_id, status: lead.status }, fields: Object.keys(input) } });
    return { id };
  });
}

const minutesBetween = (a, b) => {
  if (!a || !b) return null;
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  const diff = (bh * 60 + bm) - (ah * 60 + am);
  return diff >= 0 ? diff : null;
};

async function addVisit(user, leadId, input) {
  return inTx(async (db) => {
    const lead = await ownRecord(db, user, 'sales_leads', 'lead', leadId, 'x.id, x.customer_id, x.name, x.address, x.area, x.outlet_code, x.department_id');
    const [[me]] = await db.query('SELECT name FROM users WHERE id = ?', [user.sub]);
    const [r] = await db.query(
      `INSERT INTO sales_visit_reports
         (entity_id, department_id, customer_id, lead_id, visit_date, location, summary, outlet_code, outlet_name, area,
          sales_person_name, check_in_at, check_out_at, duration_minutes, is_planned, is_visited, total_sales, source, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'app', ?)`,
      [user.entityId, lead.department_id, lead.customer_id, leadId, input.visitDate, lead.address, input.summary || null,
        lead.outlet_code, lead.name, lead.area, me?.name || null,
        input.checkIn ? `${input.visitDate} ${input.checkIn}:00` : null,
        input.checkOut ? `${input.visitDate} ${input.checkOut}:00` : null,
        minutesBetween(input.checkIn, input.checkOut), input.isPlanned ? 1 : 0, input.totalSales ?? 0, user.sub],
    );
    await refreshLeadVisits(db, leadId);
    await log({ entityId: user.entityId, userId: user.sub, action: 'sales_lead.visit', subjectType: 'sales_lead', subjectId: leadId, metadata: { visitId: r.insertId, visitDate: input.visitDate } });
    return { id: r.insertId };
  });
}

// A prospect that becomes a customer: the customer is created from the lead,
// and the lead and its visits point to it.
async function convertLead(user, leadId, input) {
  return inTx(async (db) => {
    const lead = await ownRecord(db, user, 'sales_leads', 'lead', leadId, 'x.id, x.name, x.address, x.customer_id, x.owner_user_id');
    if (lead.customer_id) throw httpError(409, 'ALREADY_CONVERTED', 'Lead ini sudah menjadi customer.');
    const created = await createCustomer(user, {
      ...input,
      name: input.name || lead.name,
      address: input.address ?? lead.address,
      ownerUserId: input.ownerUserId || lead.owner_user_id,
    }, db);
    await db.query('UPDATE sales_leads SET customer_id = ? WHERE id = ?', [created.id, leadId]);
    await db.query('UPDATE sales_visit_reports SET customer_id = ? WHERE lead_id = ?', [created.id, leadId]);
    await log({ entityId: user.entityId, userId: user.sub, action: 'sales_lead.convert', subjectType: 'sales_lead', subjectId: leadId, metadata: { customerId: created.id, code: created.code } });
    return created;
  });
}

// ------------------------------------------------------------------ products

async function createProduct(user, input) {
  const [[dup]] = await pool.query('SELECT id FROM sales_products WHERE entity_id = ? AND sku_code = ?', [user.entityId, input.skuCode]);
  if (dup) throw httpError(409, 'DUPLICATE', `SKU ${input.skuCode} sudah ada.`);
  const [r] = await pool.query(
    `INSERT INTO sales_products (entity_id, sku_code, name, category, unit, price, cost_price, is_active, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'app')`,
    [user.entityId, input.skuCode, input.name, input.category || input.skuCode.split('-')[0] || null,
      input.unit || null, input.price ?? null, input.costPrice ?? null],
  );
  await log({ entityId: user.entityId, userId: user.sub, action: 'sales_product.create', subjectType: 'sales_product', subjectId: r.insertId, metadata: { sku: input.skuCode } });
  return { id: r.insertId };
}

const PRODUCT_FIELDS = { name: 'name', category: 'category', unit: 'unit', price: 'price', costPrice: 'cost_price', isActive: 'is_active' };

async function updateProduct(user, id, input) {
  const sets = [];
  const args = [];
  for (const [field, column] of Object.entries(PRODUCT_FIELDS)) {
    if (input[field] !== undefined) { sets.push(`${column} = ?`); args.push(field === 'isActive' ? (input[field] ? 1 : 0) : input[field]); }
  }
  if (!sets.length) throw httpError(400, 'VALIDATION_ERROR', 'Tidak ada perubahan');
  const [r] = await pool.query(`UPDATE sales_products SET ${sets.join(', ')} WHERE id = ? AND entity_id = ?`, [...args, id, user.entityId]);
  if (!r.affectedRows) throw httpError(404, 'NOT_FOUND', 'Produk tidak ditemukan');
  await log({ entityId: user.entityId, userId: user.sub, action: 'sales_product.update', subjectType: 'sales_product', subjectId: id, metadata: { fields: Object.keys(input) } });
  return { id };
}

module.exports = {
  PPN_RATE, computeOrder, refreshCustomerDates,
  createCustomer, updateCustomer, deleteCustomer, nextCustomerCode,
  nextOrderNumber, createOrder, updateOrder, cancelOrder, setDocument, addPayment,
  createLead, updateLead, addVisit, convertLead,
  createProduct, updateProduct,
};
