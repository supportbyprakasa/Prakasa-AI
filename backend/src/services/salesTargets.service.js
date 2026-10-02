const pool = require('../db/pool');
const { log } = require('./activityLog.service');
const { int, money } = require('./salesQuery');
const { factsForEntity } = require('./salesFacts');
const { wibClock } = require('../utils/wibTime');

// Monthly targets per salesperson account — revenue (DPP, before PPN) and new
// customers (NOO) —
// against what their own records actually did that month. "Their own" is the
// same ownership that decides what a member sees (sales_owner_links), so a
// salesperson's progress always matches their lists.

function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  const now = wibClock();
  const y = m ? Number(m[1]) : now.getUTCFullYear();
  const mm = m ? Number(m[2]) : now.getUTCMonth() + 1;
  if (mm < 1 || mm > 12) return null;
  const start = `${y}-${String(mm).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10);
  return { month: start.slice(0, 7), start, end };
}

const pct = (actual, target) => (target > 0 ? Math.round((actual / target) * 1000) / 10 : null);

async function listTargets(user, month) {
  const range = monthRange(month);
  if (!range) {
    const e = new Error('Bulan harus YYYY-MM'); e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
  }
  const viewAll = (user.permissions || []).includes('sales.data.view_all');
  const [accounts] = await pool.query(
    `SELECT u.id, u.name, d.name AS departmentName
       FROM users u JOIN departments d ON d.id = u.department_id
      WHERE u.entity_id = ? AND u.deleted_at IS NULL AND u.status = 'active'
        AND d.code IN ('sales', 'retail_commerce')${viewAll ? '' : ' AND u.id = ?'}
      ORDER BY u.name`,
    viewAll ? [user.entityId] : [user.entityId, user.sub],
  );
  if (!accounts.length) return { month: range.month, rows: [], totals: null };
  const ids = accounts.map((a) => a.id);
  const [targets] = await pool.query(
    'SELECT user_id, revenue_target, noo_target FROM sales_person_targets WHERE entity_id = ? AND month = ? AND user_id IN (?)',
    [user.entityId, range.start, ids],
  );
  const src = await factsForEntity(user.entityId);
  // Tahap B: approved Accurate invoices (DPP) whose salesperson is mapped to the
  // account, or whose customer the account owns — the same rule as what they see.
  const [revenue] = src.accurate
    ? await pool.query(
      `SELECT u.id AS user_id, COALESCE(SUM(i.kind = 'invoice'), 0) AS orders, SUM(i.amount) AS revenue
         FROM users u JOIN sales_revenue_accurate i ON i.entity_id = ?
          AND (EXISTS (SELECT 1 FROM sales_person_accounts pa
                        WHERE pa.entity_id = i.entity_id AND pa.user_id = u.id
                          AND LOWER(TRIM(pa.sales_person_name)) COLLATE utf8mb4_unicode_ci = LOWER(TRIM(i.sales_person_name)))
               OR EXISTS (SELECT 1 FROM sales_owner_links k
                           WHERE k.record_type = 'customer' AND k.record_id = i.customer_id AND k.user_id = u.id))
        WHERE u.id IN (?) AND i.trans_date BETWEEN ? AND ?
        GROUP BY u.id`,
      [user.entityId, ids, range.start, range.end],
    )
    : await pool.query(
      `SELECT k.user_id, COUNT(*) AS orders, SUM(o.dpp_amount) AS revenue
         FROM sales_owner_links k JOIN sales_orders o ON o.id = k.record_id
        WHERE k.record_type = 'order' AND k.user_id IN (?) AND o.entity_id = ? AND o.deleted_at IS NULL
          AND o.transaction_date BETWEEN ? AND ?
        GROUP BY k.user_id`,
      [ids, user.entityId, range.start, range.end],
    );
  const [noo] = await pool.query(
    `SELECT k.user_id, COUNT(*) AS n
       FROM sales_owner_links k JOIN ${src.customers} c ON c.id = k.record_id
      WHERE k.record_type = 'customer' AND k.user_id IN (?) AND c.entity_id = ? AND c.deleted_at IS NULL
        AND c.noo_date BETWEEN ? AND ?
      GROUP BY k.user_id`,
    [ids, user.entityId, range.start, range.end],
  );
  // With Accurate: which accounts are linked to anything they can be credited
  // with — an Accurate salesperson name (Customers → Pemetaan sales) or an
  // owned customer. An unlinked account has no actual, not a real 0. (In app
  // mode the account owns its orders directly, so it is always linked.)
  const [links] = !src.accurate ? [ids.map((id) => ({ user_id: id, by_name: 1, by_customer: 0 }))] : await pool.query(
    `SELECT u.id AS user_id,
            EXISTS (SELECT 1 FROM sales_person_accounts pa WHERE pa.entity_id = ? AND pa.user_id = u.id) AS by_name,
            EXISTS (SELECT 1 FROM sales_owner_links k WHERE k.record_type = 'customer' AND k.user_id = u.id) AS by_customer
       FROM users u WHERE u.id IN (?)`,
    [user.entityId, ids],
  );
  const linked = new Set(links.filter((l) => Number(l.by_name) || Number(l.by_customer)).map((l) => l.user_id));
  const byUser = (rows) => new Map(rows.map((r) => [r.user_id, r]));
  const t = byUser(targets);
  const r = byUser(revenue);
  const n = byUser(noo);
  const rows = accounts.map((a) => {
    const revenueTarget = t.get(a.id)?.revenue_target === null || t.get(a.id)?.revenue_target === undefined ? null : money(t.get(a.id).revenue_target);
    const nooTarget = t.get(a.id)?.noo_target ?? null;
    const revenueActual = money(r.get(a.id)?.revenue);
    const nooActual = int(n.get(a.id)?.n);
    return {
      userId: a.id, name: a.name, departmentName: a.departmentName, linked: linked.has(a.id),
      orders: int(r.get(a.id)?.orders), revenueActual, revenueTarget, revenuePct: pct(revenueActual, revenueTarget),
      nooActual, nooTarget: nooTarget === null ? null : int(nooTarget), nooPct: pct(nooActual, nooTarget),
    };
  }).sort((a, b) => b.revenueActual - a.revenueActual || a.name.localeCompare(b.name));
  return { month: range.month, rows, mapping: { linkedAccounts: rows.filter((x) => x.linked).length, accounts: rows.length } };
}

async function saveTargets(user, month, entries) {
  const range = monthRange(month);
  if (!range) {
    const e = new Error('Bulan harus YYYY-MM'); e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
  }
  const ids = [...new Set(entries.map((x) => x.userId))];
  const [valid] = await pool.query(
    `SELECT u.id FROM users u JOIN departments d ON d.id = u.department_id
      WHERE u.entity_id = ? AND u.deleted_at IS NULL AND d.code IN ('sales', 'retail_commerce') AND u.id IN (?)`,
    [user.entityId, ids],
  );
  const ok = new Set(valid.map((v) => v.id));
  if (ids.some((id) => !ok.has(id))) {
    const e = new Error('Target hanya untuk akun divisi Sales atau Retail Commerce.'); e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
  }
  for (const x of entries) {
    if (x.revenueTarget === null && x.nooTarget === null) {
      await pool.query('DELETE FROM sales_person_targets WHERE entity_id = ? AND user_id = ? AND month = ?', [user.entityId, x.userId, range.start]);
    } else {
      await pool.query(
        `INSERT INTO sales_person_targets (entity_id, user_id, month, revenue_target, noo_target, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE revenue_target = VALUES(revenue_target), noo_target = VALUES(noo_target), updated_by = VALUES(updated_by)`,
        [user.entityId, x.userId, range.start, x.revenueTarget, x.nooTarget, user.sub],
      );
    }
  }
  await log({
    entityId: user.entityId, userId: user.sub, action: 'sales_targets.update', subjectType: 'sales_person_targets',
    subjectId: null, metadata: { month: range.month, count: entries.length },
  });
  return listTargets(user, range.month);
}

module.exports = { monthRange, listTargets, saveTargets };
