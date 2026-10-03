const pool = require('../db/pool');

// Who owns which Sales record.
//
// The Sales Data Tracker and the visit export name salespeople as text, one or
// several per record ("Fajar", "Liani / Windy", "Muhammad Aris"). Each single
// name is mapped once to an app account (sales_person_accounts); every
// customer, order and lead then belongs to the accounts its names map to
// (sales_owner_links). An order without a salesperson — all e-Commerce orders —
// belongs to its customer's owners.
//
// Mapping is a person's decision: suggestions are only offered, never saved on
// their own.

const RECORD_TYPES = ['customer', 'order', 'lead'];

// "Liani / Windy" → ['Liani', 'Windy']
function splitNames(value) {
  if (!value) return [];
  return [...new Set(String(value)
    .split(/\s*(?:\/|,|&|\+|\bdan\b)\s*/i)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean))];
}

const key = (name) => String(name || '').trim().toLowerCase();

// A suggestion only when exactly one account fits: the same full name, else
// the only account with that word in its name ("Aris" → "Muhammad Aris").
function suggestUser(name, users) {
  const k = key(name);
  if (!k) return null;
  const exact = users.filter((u) => key(u.name) === k);
  if (exact.length === 1) return exact[0].id;
  const words = k.split(' ');
  const partial = users.filter((u) => {
    const own = key(u.name).split(' ');
    return words.every((w) => own.includes(w));
  });
  return partial.length === 1 ? partial[0].id : null;
}

async function mappingOf(db, entityId) {
  const [rows] = await db.query(
    'SELECT sales_person_name AS name, user_id AS userId FROM sales_person_accounts WHERE entity_id = ?',
    [entityId],
  );
  return new Map(rows.map((r) => [key(r.name), Number(r.userId)]));
}

const ownersOf = (mapping, value, ownerUserId = null) => [...new Set([
  ...splitNames(value).map((n) => mapping.get(key(n))),
  ownerUserId ? Number(ownerUserId) : null,
].filter(Boolean))];

// Owners of the given records: the mapped names plus the account set as PIC.
// An order also belongs to its customer's owners (e-Commerce orders carry no
// salesperson of their own).
async function computeLinks(db, entityId, mapping, where) {
  const clause = (ids, col) => (ids === null ? '' : ` AND ${col} IN (?)`);
  const args = (ids) => (ids === null ? [entityId] : [entityId, ids]);
  const links = [];
  const customerOwners = new Map();
  if (where.customers === null || where.customers.length) {
    const [customers] = await db.query(
      `SELECT id, sales_person_name AS name, owner_user_id AS ownerUserId FROM sales_customers
        WHERE entity_id = ? AND deleted_at IS NULL${clause(where.customers, 'id')}`,
      args(where.customers),
    );
    for (const c of customers) {
      const owners = ownersOf(mapping, c.name, c.ownerUserId);
      customerOwners.set(c.id, owners);
      for (const u of owners) links.push([entityId, 'customer', c.id, u]);
    }
  }
  if (where.orders === null || where.orders.length) {
    const [orders] = await db.query(
      `SELECT o.id, o.sales_person_name AS name, o.owner_user_id AS ownerUserId,
              c.sales_person_name AS customerName, c.owner_user_id AS customerOwner
         FROM sales_orders o LEFT JOIN sales_customers c ON c.id = o.customer_id
        WHERE o.entity_id = ? AND o.deleted_at IS NULL${clause(where.orders, 'o.id')}`,
      args(where.orders),
    );
    for (const o of orders) {
      const owners = new Set([...ownersOf(mapping, o.name, o.ownerUserId), ...ownersOf(mapping, o.customerName, o.customerOwner)]);
      for (const u of owners) links.push([entityId, 'order', o.id, u]);
    }
  }
  if (where.leads === null || where.leads.length) {
    const [leads] = await db.query(
      `SELECT id, sales_person_name AS name, owner_user_id AS ownerUserId FROM sales_leads
        WHERE entity_id = ? AND deleted_at IS NULL${clause(where.leads, 'id')}`,
      args(where.leads),
    );
    for (const l of leads) {
      for (const u of ownersOf(mapping, l.name, l.ownerUserId)) links.push([entityId, 'lead', l.id, u]);
    }
  }
  return links;
}

async function insertLinks(db, links) {
  for (let i = 0; i < links.length; i += 1000) {
    await db.query(
      'INSERT IGNORE INTO sales_owner_links (entity_id, record_type, record_id, user_id) VALUES ?',
      [links.slice(i, i + 1000)],
    );
  }
}

// Recomputes sales_owner_links for the whole entity (after a mapping change).
async function refreshLinks(db, entityId) {
  const mapping = await mappingOf(db, entityId);
  const links = await computeLinks(db, entityId, mapping, { customers: null, orders: null, leads: null });
  await db.query('DELETE FROM sales_owner_links WHERE entity_id = ?', [entityId]);
  await insertLinks(db, links);
  return links.length;
}

// Recomputes ownership of just these records (after a create or an edit). A
// customer's orders are included, since they inherit its owners.
async function refreshRecords(db, entityId, { customers = [], orders = [], leads = [] }) {
  const ids = (list) => [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const customerIds = ids(customers);
  let orderIds = ids(orders);
  if (customerIds.length) {
    const [rows] = await db.query('SELECT id FROM sales_orders WHERE entity_id = ? AND customer_id IN (?)', [entityId, customerIds]);
    orderIds = ids([...orderIds, ...rows.map((r) => r.id)]);
  }
  const leadIds = ids(leads);
  const mapping = await mappingOf(db, entityId);
  const links = await computeLinks(db, entityId, mapping, { customers: customerIds, orders: orderIds, leads: leadIds });
  for (const [type, list] of [['customer', customerIds], ['order', orderIds], ['lead', leadIds]]) {
    if (list.length) {
      await db.query('DELETE FROM sales_owner_links WHERE entity_id = ? AND record_type = ? AND record_id IN (?)', [entityId, type, list]);
    }
  }
  await insertLinks(db, links);
  return links.length;
}

// Every single salesperson name in the entity's data, how much data carries it,
// its current account and a suggestion.
async function listPeople(entityId) {
  const counts = new Map();
  const add = (value, field) => {
    for (const name of splitNames(value)) {
      const k = key(name);
      const entry = counts.get(k) || { name, customers: 0, orders: 0, leads: 0 };
      entry[field] += 1;
      counts.set(k, entry);
    }
  };
  const [customers] = await pool.query('SELECT sales_person_name AS n FROM sales_customers WHERE entity_id = ? AND deleted_at IS NULL AND sales_person_name IS NOT NULL', [entityId]);
  const [orders] = await pool.query('SELECT sales_person_name AS n FROM sales_orders WHERE entity_id = ? AND deleted_at IS NULL AND sales_person_name IS NOT NULL', [entityId]);
  const [leads] = await pool.query('SELECT sales_person_name AS n FROM sales_leads WHERE entity_id = ? AND deleted_at IS NULL AND sales_person_name IS NOT NULL', [entityId]);
  customers.forEach((r) => add(r.n, 'customers'));
  orders.forEach((r) => add(r.n, 'orders'));
  leads.forEach((r) => add(r.n, 'leads'));

  // Accounts that can own Sales records: active people of Sales and Retail Commerce.
  const [users] = await pool.query(
    `SELECT u.id, u.name, d.name AS departmentName
       FROM users u JOIN departments d ON d.id = u.department_id
      WHERE u.entity_id = ? AND u.deleted_at IS NULL AND u.status = 'active'
        AND d.code IN ('sales', 'retail_commerce')
      ORDER BY u.name`,
    [entityId],
  );
  const mapping = await mappingOf(pool, entityId);
  const people = [...counts.values()]
    .map((p) => ({
      ...p,
      userId: mapping.get(key(p.name)) || null,
      suggestedUserId: suggestUser(p.name, users),
    }))
    .sort((a, b) => (b.customers + b.orders + b.leads) - (a.customers + a.orders + a.leads) || a.name.localeCompare(b.name));
  return { people, users: users.map((u) => ({ id: u.id, name: u.name, departmentName: u.departmentName })) };
}

// entries: [{ name, userId | null }]. null removes the mapping.
async function saveMapping(entityId, entries, actorId) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const ids = [...new Set(entries.map((e) => e.userId).filter(Boolean))];
    if (ids.length) {
      const [valid] = await db.query(
        `SELECT u.id FROM users u JOIN departments d ON d.id = u.department_id
          WHERE u.entity_id = ? AND u.deleted_at IS NULL AND d.code IN ('sales', 'retail_commerce') AND u.id IN (?)`,
        [entityId, ids],
      );
      const ok = new Set(valid.map((v) => v.id));
      const bad = ids.filter((id) => !ok.has(id));
      if (bad.length) {
        const e = new Error('Akun tidak ditemukan atau bukan anggota Sales / Retail Commerce.');
        e.status = 400;
        e.code = 'VALIDATION_ERROR';
        throw e;
      }
    }
    for (const { name, userId } of entries) {
      const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!clean) continue;
      if (userId) {
        await db.query(
          `INSERT INTO sales_person_accounts (entity_id, sales_person_name, user_id, updated_by) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), updated_by = VALUES(updated_by)`,
          [entityId, clean, userId, actorId],
        );
      } else {
        await db.query('DELETE FROM sales_person_accounts WHERE entity_id = ? AND sales_person_name = ?', [entityId, clean]);
      }
    }
    const links = await refreshLinks(db, entityId);
    await db.commit();
    return { links };
  } catch (e) {
    await db.rollback().catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}

// Record filter for one query. Users with sales.data.view_all see everything;
// everyone else only the records linked to them. `idColumn` is the record id
// column of the query (e.g. 'c.id'). Returns a fragment starting with AND.
function ownScope(user, type, idColumn) {
  if (!RECORD_TYPES.includes(type)) throw new Error(`unknown sales record type ${type}`);
  if ((user?.permissions || []).includes('sales.data.view_all')) return { sql: '', args: [] };
  return {
    sql: ` AND EXISTS (SELECT 1 FROM sales_owner_links k WHERE k.record_type = '${type}' AND k.record_id = ${idColumn} AND k.user_id = ?)`,
    args: [Number(user?.sub) || 0],
  };
}

async function scopeInfo(user) {
  const viewAll = (user?.permissions || []).includes('sales.data.view_all');
  const [rows] = await pool.query(
    'SELECT sales_person_name AS name FROM sales_person_accounts WHERE entity_id = ? AND user_id = ? ORDER BY sales_person_name',
    [user.entityId, user.sub],
  );
  return { viewAll, names: rows.map((r) => r.name) };
}

module.exports = {
  splitNames, suggestUser, refreshLinks, refreshRecords, listPeople, saveMapping, ownScope, scopeInfo, RECORD_TYPES,
};
