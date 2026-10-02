const pool = require('../db/pool');
const intLog = require('./integrationLog.service');
const { ownScope } = require('./salesOwners.service');
const { documentVisibilitySql, signatureVisibilitySql } = require('./divisionAccess');
const { taskDivisionSql } = require('./taskAccess.service');
const { approvalVisibilitySql } = require('./approvalEngine.service');

/* ============================================================
   Constants
   ============================================================ */

// Batch 6.3: stable per-provider fetch cap. Independent of page size.
const MAX_PER_PROVIDER_FETCH = 200;

const SUPPORTED_TYPES = [
  'document',
  'task',
  'customer',
  'sales_order',
  'device',
  'subscription',
  'finance_workflow',
  'hrga_workflow',
  'approval_request',
  'signature_request',
];

/**
 * type -> required module permission code.
 * If user lacks the permission, the provider is NOT executed.
 */
const TYPE_PERMISSION = {
  document: 'document.view',
  task: 'task.view',
  customer: 'sales.customer.view',
  sales_order: 'sales.order.view',
  device: 'device.view',
  subscription: 'subscription.view',
  finance_workflow: 'finance.view',
  hrga_workflow: 'hrga.view',
  approval_request: 'approval.view',
  signature_request: 'signature.view',
};

/**
 * Server-side action URL map. Never trust DB/user URL fields.
 */
const ACTION_URL_BUILDERS = {
  document: (r) => `/documents?highlight=${r.id}`,
  task: (r) => `/tasks/${r.id}`,
  customer: (r) => `/sales/customers/${r.id}`,
  sales_order: (r) => `/sales/orders/${r.id}`,
  device: (r) => `/it/devices/${r.id}`,
  subscription: (r) => `/it/subscriptions/${r.id}`,
  finance_workflow: (r) => `/finance/payment-requests/${r.id}`,
  hrga_workflow: (r) => `/hrga/workflows/${r.id}`,
  approval_request: () => `/approvals`,
  signature_request: (r) => `/signatures/${r.id}`,
};

/* ============================================================
   Helpers
   ============================================================ */

function hasPerm(user, code) {
  if (!user) return false;
  return (user.permissions || []).includes(code);
}

function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (c) => '\\' + c);
}

/**
 * Resolve the entity to search.
 * Default = user's own entity. Cross-entity requires entity.cross_access.
 */
function resolveSearchEntity({ user, requestedEntityId }) {
  const userEntityId = Number(user?.entityId) || null;
  const cross = hasPerm(user, 'entity.cross_access');

  if (requestedEntityId != null && requestedEntityId !== '') {
    const num = Number(requestedEntityId);
    if (!Number.isInteger(num) || num <= 0) {
      const e = new Error('entityId tidak valid');
      e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
    }
    if (num === userEntityId) return num;
    if (!cross) {
      const e = new Error('Tidak punya akses ke entity ini');
      e.status = 403; e.code = 'FORBIDDEN'; throw e;
    }
    return num;
  }

  if (!userEntityId) {
    const e = new Error('entityId wajib');
    e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
  }
  return userEntityId;
}

/**
 * Compute a deterministic relevance score from a title match.
 */
function scoreMatch(title, q) {
  if (!title) return 0;
  const t = String(title).toLowerCase();
  const query = q.toLowerCase();
  if (t === query) return 100;
  if (t.startsWith(query)) return 80;
  if (t.includes(query)) return 60;
  return 0;
}

/**
 * Compute secondary field match score.
 */
function scoreSecondary(text, q) {
  if (!text) return 0;
  return String(text).toLowerCase().includes(q.toLowerCase()) ? 40 : 0;
}

/**
 * Normalize a raw provider row into the shared contract.
 */
function normalize({ type, row, title, subtitle, status, entityId, departmentId,
                   createdAt, meta = {}, score = 0 }) {
  const builder = ACTION_URL_BUILDERS[type];
  const actionUrl = builder ? builder(row) : null;
  return {
    type,
    id: row.id,
    title: String(title || '').slice(0, 500),
    subtitle: subtitle ? String(subtitle).slice(0, 500) : null,
    status: status || null,
    entityId: entityId ?? row.entity_id ?? null,
    departmentId: departmentId ?? row.department_id ?? null,
    createdAt: createdAt || row.created_at || null,
    actionUrl,
    score,
    meta,
  };
}

function getAllowedSearchTypes(user) {
  if (!hasPerm(user, 'search.global')) return [];
  const out = [];
  for (const t of SUPPORTED_TYPES) {
    if (hasPerm(user, TYPE_PERMISSION[t])) out.push(t);
  }
  return out;
}

/* ============================================================
   PROVIDERS
   Each provider executes only when:
     1) caller asks for the type (or no type filter)
     2) caller has the module permission
     3) entity scope is set
   Each provider returns normalized safe rows.
   ============================================================ */

async function searchDocuments({ entityId, q, cap, user }) {
  const like = `%${escapeLike(q)}%`;
  const visible = documentVisibilitySql(user, 'd');
  const [rows] = await pool.query(
    `SELECT d.id, d.entity_id, d.department_id, d.title, d.document_type, d.status, d.created_at
       FROM documents d
      WHERE d.entity_id = ? AND d.deleted_at IS NULL AND ${visible.sql}
        AND (d.title LIKE ? OR d.document_type LIKE ?)
      ORDER BY d.id DESC
      LIMIT ?`,
    [entityId, ...visible.args, like, like, cap]
  );
  return rows.map((r) =>
    normalize({
      type: 'document',
      row: r,
      title: r.title,
      subtitle: r.document_type,
      status: r.status,
      createdAt: r.created_at,
      score: Math.max(
        scoreMatch(r.title, q),
        scoreSecondary(r.document_type, q)
      ),
      meta: { category: r.document_type },
    })
  );
}

async function searchTasks({ entityId, q, cap, user }) {
  const like = `%${escapeLike(q)}%`;
  const visible = taskDivisionSql(user, 't');
  const [rows] = await pool.query(
    `SELECT t.id, t.entity_id, t.department_id, t.title, t.description, t.status, t.priority, t.due_date, t.created_at
       FROM tasks t
      WHERE t.entity_id = ? AND t.deleted_at IS NULL AND ${visible.sql}
        AND (t.title LIKE ? OR t.description LIKE ?)
      ORDER BY t.id DESC
      LIMIT ?`,
    [entityId, ...visible.args, like, like, cap]
  );
  return rows.map((r) =>
    normalize({
      type: 'task',
      row: r,
      title: r.title,
      subtitle: null,
      status: r.status,
      createdAt: r.created_at,
      score: Math.max(scoreMatch(r.title, q), scoreSecondary(r.description, q)),
      meta: { priority: r.priority, dueDate: r.due_date },
    })
  );
}

// Sales members only find the customers and orders they own (sales.data.view_all sees all).
async function searchCustomers({ entityId, q, cap, user }) {
  const like = `%${escapeLike(q)}%`;
  const cs = ownScope(user, 'customer', 'c.id');
  const [rows] = await pool.query(
    `SELECT c.id, c.entity_id, c.department_id, c.name, c.contact_person, c.phone, c.city, c.customer_code, c.created_at
       FROM sales_customers c
      WHERE c.entity_id = ?${cs.sql} AND c.deleted_at IS NULL
        AND (c.name LIKE ? OR c.contact_person LIKE ? OR c.phone LIKE ? OR c.city LIKE ? OR c.customer_code LIKE ?)
      ORDER BY c.id DESC
      LIMIT ?`,
    [entityId, ...cs.args, like, like, like, like, like, cap]
  );
  return rows.map((r) =>
    normalize({
      type: 'customer',
      row: r,
      title: r.name,
      subtitle: r.customer_code || r.city || r.contact_person || null,
      createdAt: r.created_at,
      score: Math.max(
        scoreMatch(r.name, q),
        scoreSecondary(r.contact_person, q),
        scoreSecondary(r.phone, q),
        scoreSecondary(r.city, q)
      ),
      meta: { city: r.city || null },
    })
  );
}

// Sales orders by SO, surat jalan (DO) or invoice number, or customer name.
async function searchSalesOrders({ entityId, q, cap, user }) {
  const like = `%${escapeLike(q)}%`;
  const os = ownScope(user, 'order', 'o.id');
  const [rows] = await pool.query(
    `SELECT o.id, o.entity_id, o.department_id, o.order_number AS orderNumber, o.customer_name AS customerName,
            o.do_numbers AS doNumbers, o.invoice_numbers AS invoiceNumbers, o.transaction_date, o.created_at
       FROM sales_orders o
      WHERE o.entity_id = ?${os.sql} AND o.deleted_at IS NULL
        AND (o.order_number LIKE ? OR o.do_numbers LIKE ? OR o.invoice_numbers LIKE ? OR o.customer_name LIKE ?)
      ORDER BY o.transaction_date DESC, o.id DESC
      LIMIT ?`,
    [entityId, ...os.args, like, like, like, like, cap]
  );
  return rows.map((r) =>
    normalize({
      type: 'sales_order',
      row: r,
      title: r.orderNumber,
      subtitle: [r.customerName, r.doNumbers, r.invoiceNumbers].filter(Boolean).join(' · ') || null,
      createdAt: r.transaction_date || r.created_at,
      score: Math.max(
        scoreMatch(r.orderNumber, q),
        scoreSecondary(r.doNumbers, q),
        scoreSecondary(r.invoiceNumbers, q),
        scoreSecondary(r.customerName, q)
      ),
      meta: {},
    })
  );
}

async function searchDevices({ entityId, q, cap }) {
  const like = `%${escapeLike(q)}%`;
  const [rows] = await pool.query(
    `SELECT id, entity_id, department_id, asset_code, device_type, brand, model,
            serial_number, status, created_at
       FROM devices
      WHERE entity_id = ? AND deleted_at IS NULL
        AND (asset_code LIKE ? OR brand LIKE ? OR model LIKE ? OR serial_number LIKE ?)
      ORDER BY id DESC
      LIMIT ?`,
    [entityId, like, like, like, like, cap]
  );
  return rows.map((r) =>
    normalize({
      type: 'device',
      row: r,
      title: [r.brand, r.model].filter(Boolean).join(' ') || r.asset_code,
      subtitle: r.asset_code,
      status: r.status,
      createdAt: r.created_at,
      score: Math.max(
        scoreMatch(r.asset_code, q),
        scoreSecondary(r.brand, q),
        scoreSecondary(r.model, q),
        scoreSecondary(r.serial_number, q)
      ),
      meta: { deviceType: r.device_type },
    })
  );
}

async function searchSubscriptions({ entityId, q, cap }) {
  const like = `%${escapeLike(q)}%`;
  const [rows] = await pool.query(
    `SELECT id, entity_id, department_id, product_name, plan_name, status,
            renewal_date, created_at
       FROM software_subscriptions
      WHERE entity_id = ? AND deleted_at IS NULL
        AND (product_name LIKE ? OR plan_name LIKE ?)
      ORDER BY id DESC
      LIMIT ?`,
    [entityId, like, like, cap]
  );
  return rows.map((r) =>
    normalize({
      type: 'subscription',
      row: r,
      title: r.product_name,
      subtitle: r.plan_name,
      status: r.status,
      createdAt: r.created_at,
      score: Math.max(
        scoreMatch(r.product_name, q),
        scoreSecondary(r.plan_name, q)
      ),
      meta: { renewalDate: r.renewal_date },
    })
  );
}

async function searchFinance({ entityId, q, cap, user }) {
  const like = `%${escapeLike(q)}%`;
  // Same read rule as the Finance module's own list.
  const scope = require('./financeRequests.service').readScope(user);
  const [rows] = await pool.query(
    `SELECT f.id, f.entity_id, f.department_id, f.request_number, f.title, f.status,
            f.total_amount, f.currency, f.created_at
       FROM finance_workflows f
      WHERE f.entity_id = ? AND f.deleted_at IS NULL${scope.sql}
        AND (f.title LIKE ? OR f.request_number LIKE ?)
      ORDER BY f.id DESC
      LIMIT ?`,
    [entityId, ...scope.args, like, like, cap]
  );
  return rows.map((r) =>
    normalize({
      type: 'finance_workflow',
      row: r,
      title: r.title,
      subtitle: r.request_number,
      status: r.status,
      createdAt: r.created_at,
      score: Math.max(
        scoreMatch(r.title, q),
        scoreSecondary(r.request_number, q)
      ),
      // NOTE: we intentionally do not include bank details or full amounts
      meta: { currency: r.currency },
    })
  );
}

async function searchHrga({ entityId, q, cap }) {
  const like = `%${escapeLike(q)}%`;
  const [rows] = await pool.query(
    `SELECT id, entity_id, department_id, workflow_number, employee_full_name,
            workflow_type, status, created_at
       FROM hrga_workflows
      WHERE entity_id = ? AND deleted_at IS NULL
        AND (employee_full_name LIKE ? OR workflow_number LIKE ?)
      ORDER BY id DESC
      LIMIT ?`,
    [entityId, like, like, cap]
  );
  return rows.map((r) =>
    normalize({
      type: 'hrga_workflow',
      row: r,
      title: r.employee_full_name,
      subtitle: `${r.workflow_type} · ${r.workflow_number}`,
      status: r.status,
      createdAt: r.created_at,
      score: Math.max(
        scoreMatch(r.employee_full_name, q),
        scoreSecondary(r.workflow_number, q)
      ),
      meta: { workflowType: r.workflow_type },
    })
  );
}

async function searchApprovals({ entityId, q, cap, user }) {
  const like = `%${escapeLike(q)}%`;
  const visible = approvalVisibilitySql(user, 'a');
  const [rows] = await pool.query(
    `SELECT a.id, a.entity_id, a.department_id, a.title, a.status, a.subject_type,
            a.current_level, a.created_at
       FROM approval_requests a
      WHERE a.entity_id = ? AND ${visible.sql}
        AND a.title LIKE ?
      ORDER BY a.id DESC
      LIMIT ?`,
    [entityId, ...visible.args, like, cap]
  );
  return rows.map((r) =>
    normalize({
      type: 'approval_request',
      row: r,
      title: r.title,
      subtitle: r.subject_type,
      status: r.status,
      createdAt: r.created_at,
      score: scoreMatch(r.title, q),
    })
  );
}

async function searchSignatures({ entityId, q, cap, user }) {
  const like = `%${escapeLike(q)}%`;
  const visible = signatureVisibilitySql(user, 's');
  const [rows] = await pool.query(
    `SELECT s.id, s.entity_id, s.department_id, s.status, s.created_at,
            d.title AS docTitle
       FROM signature_requests s
       JOIN documents d ON d.id = s.document_id
      WHERE s.entity_id = ? AND ${visible.sql}
        AND d.deleted_at IS NULL
        AND d.title LIKE ?
      ORDER BY s.id DESC
      LIMIT ?`,
    [entityId, ...visible.args, like, cap]
  );
  return rows.map((r) =>
    normalize({
      type: 'signature_request',
      row: r,
      title: r.docTitle,
      subtitle: `Signature #${r.id}`,
      status: r.status,
      createdAt: r.created_at,
      score: scoreMatch(r.docTitle, q),
    })
  );
}

/* ============================================================
   PROVIDER REGISTRY
   ============================================================ */

const PROVIDERS = {
  document: searchDocuments,
  task: searchTasks,
  customer: searchCustomers,
  sales_order: searchSalesOrders,
  device: searchDevices,
  subscription: searchSubscriptions,
  finance_workflow: searchFinance,
  hrga_workflow: searchHrga,
  approval_request: searchApprovals,
  signature_request: searchSignatures,
};

/* ============================================================
   MAIN SEARCH
   ============================================================ */

/**
 * @param {object} params
 * @param {object} params.user         authenticated user
 * @param {string} params.q            query string (2..200 chars)
 * @param {number|null} params.entityId
 * @param {string[]|null} params.types requested types (whitelisted downstream)
 * @param {number} params.page
 * @param {number} params.limit
 */
async function search({ user, q, entityId, types, page = 1, limit = 20 }) {
  const query = String(q || '').trim();
  if (query.length < 2) {
    const e = new Error('Kata kunci minimal 2 karakter');
    e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
  }
  if (query.length > 200) {
    const e = new Error('Kata kunci maksimal 200 karakter');
    e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
  }

  page = Math.max(1, Number(page) || 1);
  limit = Math.min(50, Math.max(1, Number(limit) || 20));

  const resolvedEntityId = resolveSearchEntity({ user, requestedEntityId: entityId });

  const allowedTypes = getAllowedSearchTypes(user);
  if (!allowedTypes.length) {
    const e = new Error('Tidak ada modul yang dapat dicari');
    e.status = 403; e.code = 'FORBIDDEN'; throw e;
  }

  // Determine requested types (intersect with allowed).
  let requestedTypes = allowedTypes;
  if (Array.isArray(types) && types.length) {
    const wanted = types.filter((t) => SUPPORTED_TYPES.includes(t));
    requestedTypes = wanted.filter((t) => allowedTypes.includes(t));
    if (!requestedTypes.length) {
      const e = new Error('Tidak ada tipe yang diizinkan untuk dicari');
      e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
    }
  }

  // Stable per-provider cap — never page-dependent.
  // Fetch one extra row to detect overflow without COUNT(*) per provider.
  const providerErrors = [];
  const fetchCap = MAX_PER_PROVIDER_FETCH + 1;

  const tasks = requestedTypes.map(async (type) => {
    const fn = PROVIDERS[type];
    if (!fn) return [];
    try {
      const rows = await fn({ entityId: resolvedEntityId, q: query, cap: fetchCap, user });
      return rows;
    } catch (e) {
      // Keep public metadata sanitized; raw error stays internal only.
      providerErrors.push({ type });
      try {
        await intLog.log({
          entityId: resolvedEntityId,
          userId: user?.sub || null,
          provider: 'internal',
          operation: `search.provider.${type}`,
          status: 'failed',
          errorMessage: e.message,
          requestMeta: { qLength: query.length },
        });
      } catch {
        // Observability must never break the search response.
      }
      return [];
    }
  });

  const nested = await Promise.all(tasks);

  let totalCapped = false;
  const cappedModules = [];
  const trimmed = nested.map((rows, idx) => {
    if (rows.length > MAX_PER_PROVIDER_FETCH) {
      totalCapped = true;
      cappedModules.push(requestedTypes[idx]);
      return rows.slice(0, MAX_PER_PROVIDER_FETCH);
    }
    return rows;
  });

  const merged = trimmed.flat();

  // Filter out zero-score (defensive — providers should already do this).
  const scored = merged.filter((r) => (r.score || 0) > 0);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (bt !== at) return bt - at;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return Number(a.id) - Number(b.id);
  });

  const total = scored.length;
  const offset = (page - 1) * limit;
  const pageRows = scored.slice(offset, offset + limit);

  const meta = {
    page,
    limit,
    total,
    allowedTypes,
    requestedTypes,
  };

  if (providerErrors.length) {
    meta.providerErrors = providerErrors;
    meta.partial = true;
  }

  if (totalCapped) {
    meta.totalCapped = true;
    meta.cappedModules = cappedModules;
    meta.perProviderCap = MAX_PER_PROVIDER_FETCH;
  }

  return {
    rows: pageRows,
    meta,
    resolvedEntityId,
  };
}

module.exports = {
  search,
  getAllowedSearchTypes,
  resolveSearchEntity,
  escapeLike,
  SUPPORTED_TYPES,
  TYPE_PERMISSION,
};