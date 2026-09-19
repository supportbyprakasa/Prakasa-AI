const pool = require('../db/pool');
const logger = require('../utils/logger');

/* ============================================================
   Constants
   ============================================================ */

const SUPPORTED_TYPES = [
  'document',
  'task',
  'customer',
  'sales_pipeline',
  'meeting',
  'device',
  'subscription',
  'finance_workflow',
  'hrga_workflow',
  'kb_document',
  'decision_log',
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
  sales_pipeline: 'sales.pipeline.view',
  meeting: 'meeting.view',
  device: 'device.view',
  subscription: 'subscription.view',
  finance_workflow: 'finance.view',
  hrga_workflow: 'hrga.view',
  kb_document: 'kb.view',
  decision_log: 'decision_log.view',
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
  sales_pipeline: () => `/sales/pipeline`,
  meeting: (r) => `/meetings/${r.id}`,
  device: (r) => `/it/devices/${r.id}`,
  subscription: (r) => `/it/subscriptions/${r.id}`,
  finance_workflow: (r) => `/finance/payment-requests/${r.id}`,
  hrga_workflow: (r) => `/hrga/workflows/${r.id}`,
  kb_document: () => `/kb`,
  decision_log: () => `/decision-log`,
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
  const userEntityId = user?.entityId != null ? Number(user.entityId) : null;
  const canSearch = hasPerm(user, 'search.global');
  const canCrossEntity = hasPerm(user, 'entity.cross_access');

  if (!canSearch) {
    const e = new Error('Butuh permission search.global');
    e.status = 403; e.code = 'FORBIDDEN'; throw e;
  }

  if (requestedEntityId != null && requestedEntityId !== '') {
    const num = Number(requestedEntityId);
    if (!Number.isInteger(num) || num <= 0) {
      const e = new Error('entityId tidak valid');
      e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
    }
    if (userEntityId != null && num === userEntityId) return num;
    if (!canCrossEntity) {
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

async function searchDocuments({ entityId, q, cap }) {
  const like = `%${escapeLike(q)}%`;
  const [rows] = await pool.query(
    `SELECT id, entity_id, department_id, title, document_type, status, created_at
       FROM documents
      WHERE entity_id = ? AND deleted_at IS NULL
        AND (title LIKE ? OR document_type LIKE ?)
      ORDER BY id DESC
      LIMIT ?`,
    [entityId, like, like, cap]
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

async function searchTasks({ entityId, q, cap }) {
  const like = `%${escapeLike(q)}%`;
  const [rows] = await pool.query(
    `SELECT id, entity_id, department_id, title, status, priority, due_date, created_at
       FROM tasks
      WHERE entity_id = ? AND deleted_at IS NULL
        AND (title LIKE ? OR description LIKE ?)
      ORDER BY id DESC
      LIMIT ?`,
    [entityId, like, like, cap]
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

async function searchCustomers({ entityId, q, cap }) {
  const like = `%${escapeLike(q)}%`;
  const [rows] = await pool.query(
    `SELECT id, entity_id, department_id, name, contact_person, phone, city, created_at
       FROM sales_customers
      WHERE entity_id = ? AND deleted_at IS NULL
        AND (name LIKE ? OR contact_person LIKE ? OR phone LIKE ? OR city LIKE ?)
      ORDER BY id DESC
      LIMIT ?`,
    [entityId, like, like, like, like, cap]
  );
  return rows.map((r) =>
    normalize({
      type: 'customer',
      row: r,
      title: r.name,
      subtitle: r.city || r.contact_person || null,
      createdAt: r.created_at,
      score: Math.max(
        scoreMatch(r.name, q),
        scoreSecondary(r.contact_person, q),
        scoreSecondary(r.city, q)
      ),
      meta: { city: r.city || null },
    })
  );
}

async function searchPipeline({ entityId, q, cap }) {
  const like = `%${escapeLike(q)}%`;
  const [rows] = await pool.query(
    `SELECT p.id, p.entity_id, p.department_id, p.deal_title AS dealTitle,
            p.stage, p.created_at
       FROM sales_pipeline p
      WHERE p.entity_id = ? AND p.deleted_at IS NULL
        AND p.deal_title LIKE ?
      ORDER BY p.id DESC
      LIMIT ?`,
    [entityId, like, cap]
  );
  return rows.map((r) =>
    normalize({
      type: 'sales_pipeline',
      row: r,
      title: r.dealTitle,
      subtitle: r.stage,
      status: r.stage,
      createdAt: r.created_at,
      score: scoreMatch(r.dealTitle, q),
      meta: { stage: r.stage },
    })
  );
}

async function searchMeetings({ entityId, q, cap }) {
  const like = `%${escapeLike(q)}%`;
  const [rows] = await pool.query(
    `SELECT id, entity_id, department_id, title, status, start_time, created_at
       FROM meetings
      WHERE entity_id = ? AND deleted_at IS NULL
        AND title LIKE ?
      ORDER BY start_time DESC, id DESC
      LIMIT ?`,
    [entityId, like, cap]
  );
  return rows.map((r) =>
    normalize({
      type: 'meeting',
      row: r,
      title: r.title,
      subtitle: r.start_time ? new Date(r.start_time).toISOString().slice(0, 16) : null,
      status: r.status,
      createdAt: r.created_at,
      score: scoreMatch(r.title, q),
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

async function searchFinance({ entityId, q, cap }) {
  const like = `%${escapeLike(q)}%`;
  const [rows] = await pool.query(
    `SELECT id, entity_id, department_id, request_number, title, status,
            total_amount, currency, created_at
       FROM finance_workflows
      WHERE entity_id = ? AND deleted_at IS NULL
        AND (title LIKE ? OR request_number LIKE ?)
      ORDER BY id DESC
      LIMIT ?`,
    [entityId, like, like, cap]
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

async function searchDecisionLogs({ entityId, q, cap }) {
  const like = `%${escapeLike(q)}%`;
  const [rows] = await pool.query(
    `SELECT id, entity_id, department_id, title, category, status, created_at
       FROM decision_logs
      WHERE entity_id = ? AND deleted_at IS NULL
        AND title LIKE ?
      ORDER BY id DESC
      LIMIT ?`,
    [entityId, like, cap]
  );
  return rows.map((r) =>
    normalize({
      type: 'decision_log',
      row: r,
      title: r.title,
      subtitle: r.category,
      status: r.status,
      createdAt: r.created_at,
      score: scoreMatch(r.title, q),
      meta: { category: r.category },
    })
  );
}

async function searchApprovals({ entityId, q, cap }) {
  const like = `%${escapeLike(q)}%`;
  const [rows] = await pool.query(
    `SELECT id, entity_id, department_id, title, status, subject_type,
            current_level, created_at
       FROM approval_requests
      WHERE entity_id = ?
        AND title LIKE ?
      ORDER BY id DESC
      LIMIT ?`,
    [entityId, like, cap]
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

async function searchSignatures({ entityId, q, cap }) {
  const like = `%${escapeLike(q)}%`;
  const [rows] = await pool.query(
    `SELECT s.id, s.entity_id, s.department_id, s.status, s.created_at,
            d.title AS docTitle
       FROM signature_requests s
       JOIN documents d ON d.id = s.document_id
      WHERE s.entity_id = ?
        AND d.deleted_at IS NULL
        AND d.title LIKE ?
      ORDER BY s.id DESC
      LIMIT ?`,
    [entityId, like, cap]
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

/**
 * KB provider with strict visibility enforcement. * Cross-entity + private / role visibility returns nothing if it cannot be
 * safely satisfied — never weaken privacy to make results appear.
 */
async function searchKnowledgeBase({ entityId, q, cap, user }) {
  const like = `%${escapeLike(q)}%`;

  // Load user's role IDs once.
  const [roleRows] = await pool.query(
    `SELECT role_id AS roleId FROM user_roles WHERE user_id = ?`,
    [user.sub]
  );
  const userRoleIds = new Set(roleRows.map((r) => Number(r.roleId)));
  const userDeptId = user.departmentId || null;
  const sameEntity = Number(entityId) === Number(user.entityId);

  const fetchCap = Math.min(1000, Math.max(cap, cap * 5));
  const [rows] = await pool.query(
    `SELECT id, entity_id, department_id, title, category, visibility,
            allowed_role_ids, uploaded_by, created_at
       FROM kb_documents
      WHERE entity_id = ? AND deleted_at IS NULL AND is_active = 1
        AND title LIKE ?
      ORDER BY id DESC
      LIMIT ?`,
    [entityId, like, fetchCap]
  );

  const visible = rows.filter((r) => {
    const vis = r.visibility;
    if (vis === 'entity') return true;
    if (!sameEntity) {
      // Cross-entity KB is only allowed for 'entity' visibility.
      return false;
    }
    if (vis === 'department') {
      return userDeptId != null &&
        Number(r.department_id) === Number(userDeptId);
    }
    if (vis === 'role') {
      const allowed = r.allowed_role_ids
        ? (typeof r.allowed_role_ids === 'string'
            ? safeParseJson(r.allowed_role_ids, [])
            : r.allowed_role_ids)
        : [];
      if (!Array.isArray(allowed) || !allowed.length) return false;
      return allowed.some((rid) => userRoleIds.has(Number(rid)));
    }
    if (vis === 'private') {
      return Number(r.uploaded_by) === Number(user.sub);
    }
    return false;
  });

  return visible.slice(0, cap).map((r) =>
    normalize({
      type: 'kb_document',
      row: r,
      title: r.title,
      subtitle: r.category,
      createdAt: r.created_at,
      score: scoreMatch(r.title, q),
      meta: { category: r.category, visibility: r.visibility },
    })
  );
}

function safeParseJson(v, fallback) {
  try { return JSON.parse(v); } catch { return fallback; }
}

/* ============================================================
   PROVIDER REGISTRY
   ============================================================ */

const PROVIDERS = {
  document: searchDocuments,
  task: searchTasks,
  customer: searchCustomers,
  sales_pipeline: searchPipeline,
  meeting: searchMeetings,
  device: searchDevices,
  subscription: searchSubscriptions,
  finance_workflow: searchFinance,
  hrga_workflow: searchHrga,
  kb_document: searchKnowledgeBase,
  decision_log: searchDecisionLogs,
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

  // Bounded fetch per provider. Page 1: fetch `limit`. Deeper pages: fetch `page*limit` capped.
  const perProviderCap = Math.min(200, page * limit);

  const tasks = requestedTypes.map(async (type) => {
    const fn = PROVIDERS[type];
    if (!fn) return [];
    try {
      // KB needs the user for visibility resolution.
      const args = type === 'kb_document'
        ? { entityId: resolvedEntityId, q: query, cap: perProviderCap, user }
        : { entityId: resolvedEntityId, q: query, cap: perProviderCap };
      const rows = await fn(args);
      return rows;
    } catch (error) {
      // One provider must not break the whole search. Log only provider/type
      // and error code/message; never log the user's search text.
      logger.warn({
        type,
        code: error?.code || null,
        message: String(error?.message || 'provider failed').slice(0, 300),
      }, '[globalSearch] provider failed');
      return [];
    }
  });

  const nested = await Promise.all(tasks);
  const merged = nested.flat();

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

  return {
    rows: pageRows,
    meta: {
      page,
      limit,
      total,
      allowedTypes,
      requestedTypes,
    },
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