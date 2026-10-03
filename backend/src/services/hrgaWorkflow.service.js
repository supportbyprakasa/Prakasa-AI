const pool = require('../db/pool');
const { log, logWith } = require('./activityLog.service');
const notif = require('./notification.service');
const engine = require('./approvalEngine.service');
const { notifySteps } = require('./approvalNotify.service');
const resolver = require('./approverResolver.service');
const { insertWithNumber } = require('./nextNumber');
const directory = require('./peopleDirectory.service');
const deviceLifecycle = require('./deviceLifecycle.service');
const licenses = require('./licenseAssignment.service');
const { checkWorkEmail } = require('./workEmail');
const { looksSecret, SECRET_TEXT_MESSAGE } = require('./secretText');
const { todayWib } = require('../utils/wibTime');
const rules = require('./hrgaChecklist');

// People & Culture wave 2, row 2.1 — onboarding & offboarding ready for use
// (docs/rancangan-people-culture-g2.md, Bagian 2 and Bagian 5).
//
// Every function takes a transaction context `tx` = { conn, effects, cleanups }
// (see `transact`): writes and their activity logs run on tx.conn, inside one
// transaction; notifications run after the commit (tx.effects); named locks are
// released after commit/rollback (tx.cleanups). The real-data gate and the
// tests run the same functions inside one transaction that is rolled back.
// The entity is always the signed-in user's (user.entityId), never the request's.

class HrgaError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

const RUNNING = Object.freeze(['approved', 'in_progress']);
const EDITABLE = Object.freeze(['draft', 'revision_requested']);
const OPEN_TASK = Object.freeze(['pending', 'in_progress', 'blocked']);
const SUBJECT_TYPE = 'hrga_workflow';
const REQUEST_TYPES = Object.freeze(['hrga_onboarding', 'hrga_offboarding']);
const TYPE_LABEL = Object.freeze({ onboarding: 'Onboarding', offboarding: 'Offboarding' });
const PREFIX = Object.freeze({ onboarding: 'ONB', offboarding: 'OFF' });
const PIC_SETTING_KEY = 'people_culture.pic';

const int = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const has = (user, code) => (user?.permissions || []).includes(code);
const trim = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || null;
};
const parseJson = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};
const notFound = () => new HrgaError('NOT_FOUND', 'Onboarding/offboarding tidak ditemukan', 404);

function guardText(value, field) {
  if (looksSecret(value)) throw new HrgaError('SECRET_TEXT', SECRET_TEXT_MESSAGE, 400, { field });
}

// ------------------------------------------------------------------ transactions

/** One transaction on its own connection; effects run after commit, cleanups always. */
async function transact(fn) {
  const conn = await pool.getConnection();
  const tx = { conn, effects: [], cleanups: [] };
  try {
    await conn.beginTransaction();
    const out = await fn(tx);
    await conn.commit();
    for (const effect of tx.effects) {
      try { await effect(); } catch { /* a notification never undoes a committed change */ }
    }
    return out;
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw e;
  } finally {
    for (const cleanup of tx.cleanups) {
      try { await cleanup(); } catch { /* noop */ }
    }
    conn.release();
  }
}

// ------------------------------------------------------------------ small lookups

const WF_SELECT = `SELECT h.*,
    DATE_FORMAT(h.join_date, '%Y-%m-%d') AS join_day,
    DATE_FORMAT(h.last_working_date, '%Y-%m-%d') AS last_day,
    DATE_FORMAT(h.effective_date, '%Y-%m-%d') AS effective_day
  FROM hrga_workflows h`;

async function lockWorkflow(conn, entityId, id) {
  const [[wf]] = await conn.query(
    `${WF_SELECT} WHERE h.id = ? AND h.entity_id = ? AND h.deleted_at IS NULL LIMIT 1 FOR UPDATE`,
    [id, entityId],
  );
  return wf || null;
}

async function readWorkflow(db, entityId, id) {
  const [[wf]] = await db.query(
    `${WF_SELECT} WHERE h.id = ? AND h.entity_id = ? AND h.deleted_at IS NULL LIMIT 1`,
    [id, entityId],
  );
  return wf || null;
}

async function activeUser(conn, entityId, userId) {
  if (!userId) return null;
  const [[u]] = await conn.query(
    "SELECT id, name, department_id FROM users WHERE id = ? AND entity_id = ? AND status = 'active' AND deleted_at IS NULL LIMIT 1",
    [userId, entityId],
  );
  return u || null;
}

async function userHolds(conn, entityId, userId, code) {
  if (!userId) return false;
  const [[row]] = await conn.query(
    `SELECT 1 AS ok FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.entity_id = ? AND r.deleted_at IS NULL
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id AND p.code = ?
      WHERE u.id = ? AND u.entity_id = ? AND u.status = 'active' AND u.deleted_at IS NULL LIMIT 1`,
    [entityId, code, userId, entityId],
  );
  return Boolean(row);
}

async function checkDepartment(conn, entityId, departmentId) {
  if (departmentId == null) return null;
  const [[d]] = await conn.query(
    'SELECT id FROM departments WHERE id = ? AND entity_id = ? AND deleted_at IS NULL LIMIT 1',
    [departmentId, entityId],
  );
  if (!d) throw new HrgaError('DEPARTMENT_INVALID', 'Divisi tidak ditemukan di perusahaan ini', 400);
  return Number(departmentId);
}

async function checkLocation(conn, entityId, locationId) {
  if (locationId == null) return null;
  const [[l]] = await conn.query(
    'SELECT id FROM org_locations WHERE id = ? AND entity_id = ? AND is_active = 1 LIMIT 1',
    [locationId, entityId],
  );
  if (!l) throw new HrgaError('LOCATION_INVALID', 'Lokasi tidak ditemukan di perusahaan ini', 400);
  return Number(locationId);
}

async function checkPic(conn, entityId, userId) {
  if (userId == null) return null;
  if (!(await activeUser(conn, entityId, userId))) throw new HrgaError('PIC_INVALID', 'PIC People & Culture harus akun aktif di perusahaan ini', 400);
  return Number(userId);
}

async function checkSubscriptions(conn, entityId, ids) {
  const list = [...new Set((ids || []).map(Number))];
  if (!list.length) return [];
  const [rows] = await conn.query(
    `SELECT id FROM software_subscriptions
      WHERE entity_id = ? AND deleted_at IS NULL AND status IN ('active', 'expiring') AND id IN (?)`,
    [entityId, list],
  );
  if (rows.length !== list.length) throw new HrgaError('LICENSE_INVALID', 'Ada langganan software yang tidak ditemukan atau tidak aktif', 400);
  return list;
}

/** A directory person of the entity from a key ('p12' or 'u5'); 'u' gets its row (wave-1 matching). */
async function personFromKey(conn, entityId, key, actorId, { allowResigned = false } = {}) {
  const parsed = directory.parseKey(key);
  if (!parsed) throw new HrgaError('PERSON_INVALID', 'Orang tidak ditemukan di direktori', 400);
  let personId = parsed.personId;
  if (personId == null) {
    if (!(await activeUser(conn, entityId, parsed.userId))) throw new HrgaError('PERSON_INVALID', 'Orang tidak ditemukan di direktori', 400);
    personId = (await directory.ensurePersonForUser(conn, entityId, parsed.userId, actorId, { create: true })).id;
  }
  const [[p]] = await conn.query(
    `SELECT p.id, p.user_id, p.kind, p.status, p.manager_id, p.position,
            COALESCE(u.name, p.full_name) AS name, COALESCE(u.email, p.work_email) AS email,
            COALESCE(u.department_id, p.department_id) AS department_id,
            u.status AS account_status, u.deleted_at AS account_deleted
       FROM people_directory p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ? AND p.entity_id = ? LIMIT 1`,
    [personId, entityId],
  );
  if (!p || p.kind === 'excluded') throw new HrgaError('PERSON_INVALID', 'Orang tidak ditemukan di direktori', 400);
  if (!allowResigned && p.status !== 'active') throw new HrgaError('PERSON_RESIGNED', 'Orang ini sudah resign di direktori', 409);
  return p;
}

async function managerFromKey(conn, entityId, key, actorId) {
  if (key === null || key === undefined || key === '') return null;
  const p = await personFromKey(conn, entityId, key, actorId);
  return { personId: Number(p.id), userId: int(p.user_id) };
}

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

// ------------------------------------------------------------------ PIC setting

async function readPic(db, entityId) {
  const [[row]] = await db.query('SELECT value FROM settings WHERE entity_id = ? AND `key` = ? LIMIT 1', [entityId, PIC_SETTING_KEY]);
  const value = parseJson(row?.value) || {};
  return { itUserId: int(value.itUserId), gaUserId: int(value.gaUserId) };
}

// ------------------------------------------------------------------ read access

/** 'full' (hrga.view), 'limited' (manager, responsible, requester, management) or null. */
async function accessOf(db, user, wf) {
  if (!wf) return null;
  if (has(user, 'hrga.view')) return 'full';
  const me = Number(user.sub);
  if (Number(wf.requested_by) === me) return 'limited';
  if (has(user, 'management_dashboard.view')) return 'limited';
  if (has(user, 'management_dashboard.division') && wf.department_id != null && Number(wf.department_id) === Number(user.departmentId)) return 'limited';
  const [[task]] = await db.query(
    'SELECT id FROM hrga_workflow_tasks WHERE hrga_workflow_id = ? AND responsible_user_id = ? LIMIT 1',
    [wf.id, me],
  );
  if (task) return 'limited';
  if (wf.manager_person_id) {
    const [[m]] = await db.query('SELECT user_id FROM people_directory WHERE id = ? AND entity_id = ? LIMIT 1', [wf.manager_person_id, wf.entity_id]);
    if (m && Number(m.user_id) === me) return 'limited';
  }
  return null;
}

// ------------------------------------------------------------------ holdings

let phoneRegister = null;
/** Whether row 2.3's phone register exists yet (cached once found). */
async function phoneRegisterReady(db) {
  if (phoneRegister) return true;
  const [[row]] = await db.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'it_phone_lines'",
  );
  phoneRegister = Number(row?.n || 0) > 0;
  return phoneRegister;
}

const DEVICE_NAME = `TRIM(CONCAT_WS(' ', NULLIF(CONCAT_WS(' ', d.brand, d.model), ''), IF(d.asset_code IS NULL OR d.asset_code = '', NULL, CONCAT('(', d.asset_code, ')'))))`;
const PHONE_LABEL = "COALESCE(pl.number, CONCAT('ext. ', pl.extension))";

/** What the person still holds: active device assignments, assigned licences, active company numbers. */
async function holdingsOf(db, entityId, personId, { accountId = null } = {}) {
  let userId = null;
  if (personId) {
    const [[p]] = await db.query('SELECT id, user_id FROM people_directory WHERE id = ? AND entity_id = ? LIMIT 1', [personId, entityId]);
    if (!p) return { devices: [], licenses: [], phoneLines: [] };
    userId = int(p.user_id);
  } else if (accountId) {
    // An app account People & Culture has not given a directory row yet:
    // only what is assigned to the account itself (no phone line can be).
    const [[u]] = await db.query('SELECT id FROM users WHERE id = ? AND entity_id = ? AND deleted_at IS NULL LIMIT 1', [accountId, entityId]);
    if (!u) return { devices: [], licenses: [], phoneLines: [] };
    userId = Number(u.id);
  } else {
    return { devices: [], licenses: [], phoneLines: [] };
  }
  const [devices] = await db.query(
    `SELECT a.id AS assignmentId, a.device_id AS deviceId,
            COALESCE(NULLIF(${DEVICE_NAME}, ''), d.device_type) AS name
       FROM device_assignments a JOIN devices d ON d.id = a.device_id AND d.entity_id = a.entity_id
      WHERE a.entity_id = ? AND a.status = 'active' AND (a.person_id = ?${userId ? ' OR a.assigned_to = ?' : ''})
      ORDER BY a.id`,
    userId ? [entityId, personId || 0, userId] : [entityId, personId],
  );
  let licenseRows = [];
  if (userId) {
    [licenseRows] = await db.query(
      `SELECT l.id AS licenseId, l.subscription_id AS subscriptionId, s.product_name AS productName
         FROM subscription_licenses l JOIN software_subscriptions s ON s.id = l.subscription_id AND s.deleted_at IS NULL
        WHERE s.entity_id = ? AND l.assigned_to = ? AND l.status IN ('assigned', 'idle')
        ORDER BY l.id`,
      [entityId, userId],
    );
  }
  let phoneLines = [];
  if (personId && await phoneRegisterReady(db)) {
    [phoneLines] = await db.query(
      `SELECT pl.id, ${PHONE_LABEL} AS label FROM it_phone_lines pl
        WHERE pl.entity_id = ? AND pl.person_id = ? AND pl.status = 'active' ORDER BY pl.id`,
      [entityId, personId],
    );
  }
  return {
    devices: devices.map((d) => ({ assignmentId: Number(d.assignmentId), deviceId: Number(d.deviceId), name: d.name })),
    licenses: licenseRows.map((l) => ({ licenseId: Number(l.licenseId), subscriptionId: Number(l.subscriptionId), productName: l.productName })),
    phoneLines: phoneLines.map((l) => ({ id: Number(l.id), label: l.label })),
  };
}

/** Holdings of the person picked in the offboarding form (directory key p<id> / u<id>). */
async function holdingsForKey(user, key) {
  const parsed = directory.parseKey(key);
  if (!parsed) throw new HrgaError('VALIDATION_ERROR', 'Pilih karyawan dari direktori', 400, { field: 'personKey' });
  if (parsed.personId) return holdingsOf(pool, user.entityId, parsed.personId);
  const [[row]] = await pool.query('SELECT id FROM people_directory WHERE entity_id = ? AND user_id = ? LIMIT 1', [user.entityId, parsed.userId]);
  return row ? holdingsOf(pool, user.entityId, Number(row.id)) : holdingsOf(pool, user.entityId, null, { accountId: parsed.userId });
}

// ------------------------------------------------------------------ checklist

async function templateFor(db, entityId, workflowType, departmentId) {
  const [rows] = await db.query(
    `SELECT id, department_id, items FROM hrga_checklist_templates
      WHERE entity_id = ? AND workflow_type = ? AND is_active = 1 AND (department_id = ? OR department_id IS NULL)
      ORDER BY department_id IS NULL, id DESC LIMIT 1`,
    [entityId, workflowType, departmentId ?? 0],
  );
  if (rows[0]) return { id: Number(rows[0].id), items: parseJson(rows[0].items) || [] };
  return { id: null, items: rules.BUILT_IN[workflowType] };
}

/** Responsible user per team (decision 12); null when unset or lacking the permission. */
async function responsibles(db, wf) {
  const entityId = wf.entity_id;
  const pic = await readPic(db, entityId);
  const out = { it: null, ga: null, manager: null, pc: int(wf.hrga_pic_user_id) || int(wf.requested_by) };
  if (pic.itUserId && await userHolds(db, entityId, pic.itUserId, rules.PIC_PERMISSION.it)) out.it = pic.itUserId;
  if (pic.gaUserId && await userHolds(db, entityId, pic.gaUserId, rules.PIC_PERMISSION.ga)) out.ga = pic.gaUserId;
  if (wf.manager_person_id) {
    const [[m]] = await db.query(
      `SELECT u.id FROM people_directory p JOIN users u ON u.id = p.user_id
        WHERE p.id = ? AND p.entity_id = ? AND u.status = 'active' AND u.deleted_at IS NULL LIMIT 1`,
      [wf.manager_person_id, entityId],
    );
    out.manager = m ? Number(m.id) : null;
  }
  return out;
}

async function personHasAccount(db, wf) {
  if (!wf.person_id) return Boolean(wf.employee_user_id);
  const [[p]] = await db.query(
    `SELECT u.id FROM people_directory p JOIN users u ON u.id = p.user_id
      WHERE p.id = ? AND p.entity_id = ? AND u.deleted_at IS NULL AND u.status = 'active' LIMIT 1`,
    [wf.person_id, wf.entity_id],
  );
  return Boolean(p);
}

/** The checklist that approval would create today (draft preview) or creates now. */
async function planChecklist(db, wf, approvalDay) {
  const needs = parseJson(wf.needs) || {};
  const template = await templateFor(db, wf.entity_id, wf.workflow_type, wf.department_id);
  let subscriptions = [];
  if (wf.workflow_type === 'onboarding' && Array.isArray(needs.licenses) && needs.licenses.length) {
    const [rows] = await db.query(
      'SELECT id, product_name AS productName FROM software_subscriptions WHERE entity_id = ? AND id IN (?)',
      [wf.entity_id, needs.licenses.map(Number)],
    );
    subscriptions = rows;
  }
  const holdings = wf.workflow_type === 'offboarding' ? await holdingsOf(db, wf.entity_id, wf.person_id) : null;
  const items = rules.planItems({
    workflowType: wf.workflow_type,
    templateItems: template.items,
    needs,
    hasAccount: wf.workflow_type === 'offboarding' ? await personHasAccount(db, wf) : false,
    subscriptions,
    holdings,
    baseDay: (wf.workflow_type === 'onboarding' ? wf.join_day : wf.last_day) || wf.effective_day,
    approvalDay,
  });
  const who = await responsibles(db, wf);
  return { items: items.map((i) => ({ ...i, responsibleUserId: who[i.ownerGroup] || null })), templateId: template.id, responsible: who };
}

async function insertTasks(conn, workflowId, items) {
  for (const i of items) {
    await conn.query(
      `INSERT INTO hrga_workflow_tasks
         (hrga_workflow_id, category, owner_group, sort_order, title, description, responsible_user_id,
          linked_device_assignment_id, linked_subscription_license_id, linked_subscription_id, linked_phone_line_id,
          status, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [workflowId, i.category, i.ownerGroup, i.sortOrder || 0, String(i.title).slice(0, 255), i.description || null,
        i.responsibleUserId || null, i.linkedDeviceAssignmentId || null, i.linkedSubscriptionLicenseId || null,
        i.linkedSubscriptionId || null, i.linkedPhoneLineId || null, i.dueDate || null],
    );
  }
}

/** Creates the checklist at approval, in the decision's transaction (decision 10, D5). */
async function generateChecklist(conn, wf, approvalDay = todayWib()) {
  const [[existing]] = await conn.query('SELECT COUNT(*) AS n FROM hrga_workflow_tasks WHERE hrga_workflow_id = ?', [wf.id]);
  if (Number(existing?.n || 0) > 0) return { items: [], unassigned: [] };
  const plan = await planChecklist(conn, wf, approvalDay);
  await insertTasks(conn, wf.id, plan.items);
  const unassigned = [...new Set(plan.items.filter((i) => !i.responsibleUserId).map((i) => i.ownerGroup))];
  return { items: plan.items, unassigned };
}

// ------------------------------------------------------------------ directory link

/**
 * Approval links the workflow to the directory (decision 13): an onboarding
 * creates or reuses the person with the join date; an offboarding marks the
 * resign with the last day. Runs inside the decision's transaction.
 */
async function ensureDirectoryPerson(conn, wf, actorId) {
  const entityId = Number(wf.entity_id);
  await directory.lockDirectory(conn, entityId);
  if (wf.workflow_type === 'offboarding') {
    if (!wf.person_id) throw new HrgaError('PERSON_REQUIRED', 'Orang yang keluar belum dipilih', 409);
    const [r] = await conn.query(
      `UPDATE people_directory SET status = 'resigned', resigned_on = ?, resigned_on_source = 'offboarding', updated_by = ?
        WHERE id = ? AND entity_id = ? AND status = 'active'`,
      [wf.last_day, actorId || null, wf.person_id, entityId],
    );
    if (r.affectedRows) {
      await logWith(conn, {
        entityId, userId: actorId || null, action: 'people_directory.resign', subjectType: 'people_directory',
        subjectId: Number(wf.person_id), metadata: { source: 'offboarding', workflowId: Number(wf.id), resignedOn: wf.last_day },
      });
    }
    return { personId: Number(wf.person_id), created: false, resigned: Boolean(r.affectedRows) };
  }

  let personId = int(wf.person_id);
  if (!personId && wf.planned_work_email) {
    const [[account]] = await conn.query(
      'SELECT id FROM users WHERE entity_id = ? AND email = ? AND deleted_at IS NULL LIMIT 1',
      [entityId, wf.planned_work_email],
    );
    if (account) personId = (await directory.ensurePersonForUser(conn, entityId, account.id, actorId, { create: true })).id;
    else {
      const [[row]] = await conn.query(
        'SELECT id FROM people_directory WHERE entity_id = ? AND work_email = ? LIMIT 1',
        [entityId, wf.planned_work_email],
      );
      if (row) personId = Number(row.id);
    }
  }

  if (personId) {
    const [[row]] = await conn.query('SELECT * FROM people_directory WHERE id = ? AND entity_id = ? FOR UPDATE', [personId, entityId]);
    if (!row) throw new HrgaError('PERSON_INVALID', 'Orang tidak ditemukan di direktori', 409);
    const sets = ['starts_on = ?', 'updated_by = ?'];
    const args = [wf.join_day, actorId || null];
    if (row.status === 'resigned') sets.push("status = 'active'", 'resigned_on = NULL', 'resigned_on_source = NULL');
    if (row.kind === 'excluded') sets.push("kind = 'employee'", 'excluded_reason = NULL');
    if (wf.employee_position) { sets.push('position = ?'); args.push(wf.employee_position); }
    if (wf.manager_person_id && Number(wf.manager_person_id) !== personId) { sets.push('manager_id = ?'); args.push(wf.manager_person_id); }
    if (wf.location_id) { sets.push('location_id = ?'); args.push(wf.location_id); }
    if (row.user_id == null && wf.department_id) { sets.push('department_id = ?'); args.push(wf.department_id); }
    await conn.query(`UPDATE people_directory SET ${sets.join(', ')} WHERE id = ? AND entity_id = ?`, [...args, personId, entityId]);
    await logWith(conn, {
      entityId, userId: actorId || null, action: 'people_directory.update', subjectType: 'people_directory', subjectId: personId,
      metadata: { source: 'onboarding', workflowId: Number(wf.id), startsOn: wf.join_day, rehire: row.status === 'resigned' },
    });
    await conn.query('UPDATE hrga_workflows SET person_id = ?, person_created = 0 WHERE id = ?', [personId, wf.id]);
    return { personId, created: false };
  }

  const [ins] = await conn.query(
    `INSERT INTO people_directory
       (entity_id, kind, full_name, position, department_id, manager_id, location_id, work_email, starts_on, created_by, updated_by)
     VALUES (?, 'employee', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [entityId, trim(wf.employee_full_name), wf.employee_position || null, wf.department_id || null, wf.manager_person_id || null,
      wf.location_id || null, wf.planned_work_email || null, wf.join_day, actorId || null, actorId || null],
  );
  const newId = Number(ins.insertId);
  await logWith(conn, {
    entityId, userId: actorId || null, action: 'people_directory.create', subjectType: 'people_directory', subjectId: newId,
    metadata: { source: 'onboarding', workflowId: Number(wf.id), startsOn: wf.join_day },
  });
  await conn.query('UPDATE hrga_workflows SET person_id = ?, person_created = 1 WHERE id = ?', [newId, wf.id]);
  return { personId: newId, created: true };
}

// ------------------------------------------------------------------ create / edit

function onboardingValues(body) {
  return {
    employee_full_name: trim(body.employeeFullName),
    employee_position: trim(body.employeePosition),
    join_date: body.joinDate || null,
    needs: body.needs ? {
      google: Boolean(body.needs.google), app: Boolean(body.needs.app),
      device: body.needs.device || 'none', licenses: (body.needs.licenses || []).map(Number),
      phone: body.needs.phone || 'none', desk: Boolean(body.needs.desk), idCard: Boolean(body.needs.idCard),
    } : undefined,
  };
}

async function create(tx, user, body) {
  const { conn } = tx;
  const entityId = user.entityId;
  const type = body.workflowType;
  if (!PREFIX[type]) throw new HrgaError('VALIDATION_ERROR', 'Jenis workflow tidak dikenal', 400);
  guardText(body.notes, 'notes');
  const pic = await checkPic(conn, entityId, body.hrgaPicUserId ?? user.sub);
  const row = {
    entity_id: entityId, workflow_type: type, status: 'draft', requested_by: user.sub,
    hrga_pic_user_id: pic, notes: trim(body.notes),
  };

  if (type === 'onboarding') {
    const v = onboardingValues(body);
    if (!v.employee_full_name) throw new HrgaError('VALIDATION_ERROR', 'Nama karyawan wajib diisi', 400);
    if (!isDate(body.joinDate)) throw new HrgaError('VALIDATION_ERROR', 'Tanggal mulai wajib diisi (YYYY-MM-DD)', 400);
    const manager = await managerFromKey(conn, entityId, body.managerKey, user.sub);
    let email = null;
    if (body.plannedWorkEmail) {
      const checked = checkWorkEmail(body.plannedWorkEmail);
      if (!checked.ok) throw new HrgaError(checked.code, checked.message, checked.code === 'WORK_EMAIL_DOMAINS_UNSET' ? 503 : 400);
      email = checked.email;
    }
    let personId = null;
    if (body.personKey) personId = Number((await personFromKey(conn, entityId, body.personKey, user.sub, { allowResigned: true })).id);
    Object.assign(row, {
      department_id: await checkDepartment(conn, entityId, body.departmentId),
      employee_full_name: v.employee_full_name,
      employee_position: v.employee_position,
      manager_person_id: manager?.personId || null,
      employee_manager_user_id: manager?.userId || null,
      location_id: await checkLocation(conn, entityId, body.locationId ?? null),
      planned_work_email: email,
      person_id: personId,
      join_date: body.joinDate,
      effective_date: body.joinDate,
      needs: JSON.stringify({ ...(v.needs || {}), licenses: await checkSubscriptions(conn, entityId, v.needs?.licenses) }),
    });
    if (!row.department_id) throw new HrgaError('VALIDATION_ERROR', 'Divisi wajib dipilih', 400);
  } else {
    if (!body.personKey) throw new HrgaError('VALIDATION_ERROR', 'Pilih karyawan yang keluar', 400);
    if (!isDate(body.lastWorkingDate)) throw new HrgaError('VALIDATION_ERROR', 'Hari terakhir wajib diisi (YYYY-MM-DD)', 400);
    if (!['resign', 'contract_end', 'other'].includes(body.reasonCode)) throw new HrgaError('VALIDATION_ERROR', 'Pilih alasan keluar', 400);
    const p = await personFromKey(conn, entityId, body.personKey, user.sub);
    Object.assign(row, {
      person_id: Number(p.id),
      employee_user_id: int(p.user_id),
      employee_full_name: p.name,
      employee_email: p.email || null,
      employee_position: p.position || null,
      department_id: int(p.department_id),
      manager_person_id: int(p.manager_id),
      last_working_date: body.lastWorkingDate,
      effective_date: body.lastWorkingDate,
      reason_code: body.reasonCode,
    });
  }

  const columns = Object.keys(row);
  let out;
  try {
    out = await insertWithNumber(conn, {
      table: 'hrga_workflows', column: 'workflow_number', prefix: PREFIX[type], entityId,
    }, async (number) => {
      const [ins] = await conn.query(
        `INSERT INTO hrga_workflows (${columns.join(', ')}, workflow_number) VALUES (${columns.map(() => '?').join(', ')}, ?)`,
        [...Object.values(row), number],
      );
      return Number(ins.insertId);
    });
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY' && /uq_hrga_open_person/.test(e.message)) {
      throw new HrgaError('OPEN_WORKFLOW_EXISTS', `Orang ini sudah punya ${TYPE_LABEL[type].toLowerCase()} yang sedang berjalan`, 409);
    }
    throw e;
  }
  tx.cleanups.push(out.release);
  await logWith(conn, {
    entityId, userId: user.sub, action: 'hrga.create', subjectType: SUBJECT_TYPE, subjectId: out.result,
    metadata: { workflowType: type, workflowNumber: out.number },
  });
  return { id: out.result, workflowNumber: out.number, version: 1 };
}

async function loadEditable(tx, user, id) {
  const wf = await lockWorkflow(tx.conn, user.entityId, id);
  if (!wf) throw notFound();
  const own = Number(wf.requested_by) === Number(user.sub);
  if (!own && !has(user, 'hrga.manage')) {
    throw (await accessOf(tx.conn, user, wf)) ? new HrgaError('FORBIDDEN', 'Hanya pengaju atau Supervisor/Head People & Culture yang bisa mengubah ini', 403) : notFound();
  }
  return wf;
}

function checkVersion(wf, version) {
  if (version === undefined || version === null) throw new HrgaError('VALIDATION_ERROR', 'Versi data wajib dikirim', 400);
  if (Number(version) !== Number(wf.version)) {
    throw new HrgaError('VERSION_CONFLICT', 'Data ini sudah diubah orang lain. Muat ulang lalu coba lagi.', 409, { version: Number(wf.version) });
  }
}

async function updateDraft(tx, user, id, body) {
  const { conn } = tx;
  const entityId = user.entityId;
  const wf = await loadEditable(tx, user, id);
  if (!EDITABLE.includes(wf.status)) throw new HrgaError('CONFLICT', 'Hanya draft atau yang diminta revisi yang bisa diubah', 409);
  checkVersion(wf, body.version);
  guardText(body.notes, 'notes');
  const sets = {};
  if (body.hrgaPicUserId !== undefined) sets.hrga_pic_user_id = await checkPic(conn, entityId, body.hrgaPicUserId);
  if (body.notes !== undefined) sets.notes = trim(body.notes);
  if (wf.workflow_type === 'onboarding') {
    if (body.employeeFullName !== undefined) {
      sets.employee_full_name = trim(body.employeeFullName);
      if (!sets.employee_full_name) throw new HrgaError('VALIDATION_ERROR', 'Nama karyawan wajib diisi', 400);
    }
    if (body.employeePosition !== undefined) sets.employee_position = trim(body.employeePosition);
    if (body.departmentId !== undefined) {
      sets.department_id = await checkDepartment(conn, entityId, body.departmentId);
      if (!sets.department_id) throw new HrgaError('VALIDATION_ERROR', 'Divisi wajib dipilih', 400);
    }
    if (body.managerKey !== undefined) {
      const m = await managerFromKey(conn, entityId, body.managerKey, user.sub);
      sets.manager_person_id = m?.personId || null;
      sets.employee_manager_user_id = m?.userId || null;
    }
    if (body.locationId !== undefined) sets.location_id = await checkLocation(conn, entityId, body.locationId);
    if (body.plannedWorkEmail !== undefined) {
      if (!body.plannedWorkEmail) sets.planned_work_email = null;
      else {
        const checked = checkWorkEmail(body.plannedWorkEmail);
        if (!checked.ok) throw new HrgaError(checked.code, checked.message, 400);
        sets.planned_work_email = checked.email;
      }
    }
    if (body.personKey !== undefined) {
      sets.person_id = body.personKey ? Number((await personFromKey(conn, entityId, body.personKey, user.sub, { allowResigned: true })).id) : null;
    }
    if (body.joinDate !== undefined) {
      if (!isDate(body.joinDate)) throw new HrgaError('VALIDATION_ERROR', 'Tanggal mulai tidak valid', 400);
      sets.join_date = body.joinDate;
      sets.effective_date = body.joinDate;
    }
    if (body.needs !== undefined) {
      const v = onboardingValues(body).needs;
      sets.needs = JSON.stringify({ ...v, licenses: await checkSubscriptions(conn, entityId, v.licenses) });
    }
  } else {
    if (body.personKey !== undefined) {
      const p = await personFromKey(conn, entityId, body.personKey, user.sub);
      Object.assign(sets, {
        person_id: Number(p.id), employee_user_id: int(p.user_id), employee_full_name: p.name,
        employee_email: p.email || null, employee_position: p.position || null,
        department_id: int(p.department_id), manager_person_id: int(p.manager_id),
      });
    }
    if (body.lastWorkingDate !== undefined) {
      if (!isDate(body.lastWorkingDate)) throw new HrgaError('VALIDATION_ERROR', 'Hari terakhir tidak valid', 400);
      sets.last_working_date = body.lastWorkingDate;
      sets.effective_date = body.lastWorkingDate;
    }
    if (body.reasonCode !== undefined) sets.reason_code = body.reasonCode;
  }
  const columns = Object.keys(sets);
  try {
    await conn.query(
      `UPDATE hrga_workflows SET ${[...columns.map((c) => `${c} = ?`), 'version = version + 1'].join(', ')} WHERE id = ? AND entity_id = ?`,
      [...Object.values(sets), wf.id, entityId],
    );
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY' && /uq_hrga_open_person/.test(e.message)) {
      throw new HrgaError('OPEN_WORKFLOW_EXISTS', `Orang ini sudah punya ${TYPE_LABEL[wf.workflow_type].toLowerCase()} yang sedang berjalan`, 409);
    }
    throw e;
  }
  await logWith(conn, {
    entityId, userId: user.sub, action: 'hrga.update', subjectType: SUBJECT_TYPE, subjectId: Number(wf.id),
    metadata: { fields: columns },
  });
  return { id: Number(wf.id), version: Number(wf.version) + 1 };
}

async function removeDraft(tx, user, id) {
  const wf = await loadEditable(tx, user, id);
  if (wf.status !== 'draft') throw new HrgaError('CONFLICT', 'Hanya draft yang bisa dihapus', 409);
  await tx.conn.query('UPDATE hrga_workflows SET deleted_at = NOW(), version = version + 1 WHERE id = ? AND entity_id = ?', [wf.id, user.entityId]);
  await logWith(tx.conn, { entityId: user.entityId, userId: user.sub, action: 'hrga.delete', subjectType: SUBJECT_TYPE, subjectId: Number(wf.id) });
  return { id: Number(wf.id) };
}

// ------------------------------------------------------------------ submit / withdraw / cancel

async function submit(tx, user, id) {
  const { conn } = tx;
  const entityId = user.entityId;
  const wf = await loadEditable(tx, user, id);
  if (!EDITABLE.includes(wf.status)) throw new HrgaError('CONFLICT', 'Workflow ini sudah diajukan', 409);
  const today = todayWib();
  let managerPersonId = int(wf.manager_person_id);
  let subjectUserId = int(wf.employee_user_id);
  if (wf.workflow_type === 'onboarding') {
    if (!trim(wf.employee_full_name)) throw new HrgaError('VALIDATION_ERROR', 'Nama karyawan wajib diisi', 400);
    if (!wf.department_id) throw new HrgaError('VALIDATION_ERROR', 'Divisi wajib dipilih', 400);
    if (!wf.join_day || wf.join_day < rules.addDays(today, -7)) throw new HrgaError('VALIDATION_ERROR', 'Tanggal mulai paling awal 7 hari yang lalu', 400);
    if (!managerPersonId) throw new HrgaError('VALIDATION_ERROR', 'Pilih atasan langsung dari direktori', 400);
    const [[m]] = await conn.query("SELECT id FROM people_directory WHERE id = ? AND entity_id = ? AND kind <> 'excluded' AND status = 'active' LIMIT 1", [managerPersonId, entityId]);
    if (!m) throw new HrgaError('VALIDATION_ERROR', 'Atasan langsung tidak aktif di direktori', 400);
    if (wf.person_id) {
      const [[p]] = await conn.query('SELECT user_id FROM people_directory WHERE id = ? AND entity_id = ? LIMIT 1', [wf.person_id, entityId]);
      subjectUserId = int(p?.user_id) || subjectUserId;
    }
  } else {
    if (!wf.person_id) throw new HrgaError('VALIDATION_ERROR', 'Pilih karyawan yang keluar', 400);
    const [[p]] = await conn.query(
      "SELECT id, user_id, manager_id, status, kind FROM people_directory WHERE id = ? AND entity_id = ? LIMIT 1",
      [wf.person_id, entityId],
    );
    if (!p || p.kind === 'excluded' || p.status !== 'active') throw new HrgaError('PERSON_RESIGNED', 'Orang ini tidak aktif di direktori', 409);
    if (!wf.last_day || wf.last_day < rules.addDays(today, -30)) throw new HrgaError('VALIDATION_ERROR', 'Hari terakhir paling awal 30 hari yang lalu', 400);
    managerPersonId = int(p.manager_id);
    subjectUserId = int(p.user_id);
  }
  const exclude = [wf.requested_by, user.sub, subjectUserId].filter(Boolean);
  const approver = await resolver.resolveApprover(conn, {
    entityId, managerPersonId, departmentId: int(wf.department_id), excludeUserIds: exclude,
  });
  const requestType = `hrga_${wf.workflow_type}`;
  const title = `${TYPE_LABEL[wf.workflow_type]} ${wf.workflow_number} — ${wf.employee_full_name}`;
  const approval = await engine.createApprovalRequest({
    entityId,
    departmentId: int(wf.department_id),
    subjectType: SUBJECT_TYPE,
    subjectId: Number(wf.id),
    requestType,
    title,
    description: `${TYPE_LABEL[wf.workflow_type]} ${wf.workflow_type === 'onboarding' ? 'mulai' : 'hari terakhir'} ${wf.workflow_type === 'onboarding' ? wf.join_day : wf.last_day}`,
    requestedBy: user.sub,
  }, conn);
  if (approval.flowType === 'legacy') {
    throw new HrgaError('APPROVAL_MATRIX_MISSING', 'Aturan approval onboarding/offboarding belum ada. Hubungi admin sistem.', 409);
  }
  await resolver.assignFirstStep(conn, approval.id, approver);
  await conn.query(
    `UPDATE hrga_workflows
        SET status = 'pending_approval', approval_request_id = ?, submitted_at = NOW(), approver_basis = ?,
            manager_person_id = ?, employee_user_id = COALESCE(?, employee_user_id), version = version + 1
      WHERE id = ? AND entity_id = ?`,
    [approval.id, approver.basis, managerPersonId, subjectUserId, wf.id, entityId],
  );
  await logWith(conn, {
    entityId, userId: user.sub, action: 'hrga.submit', subjectType: SUBJECT_TYPE, subjectId: Number(wf.id),
    metadata: { approvalRequestId: approval.id, approverBasis: approver.basis },
  });
  const [steps] = await conn.query(
    "SELECT id FROM approval_steps WHERE approval_request_id = ? AND status = 'pending' AND activated_at IS NOT NULL",
    [approval.id],
  );
  const request = { id: approval.id, entity_id: entityId, title };
  tx.effects.push(() => notifySteps(steps.map((s) => s.id), request, { excludeUserIds: exclude }));
  return {
    id: Number(wf.id), status: 'pending_approval', approvalRequestId: approval.id,
    approverBasis: approver.basis, approverName: approver.name,
  };
}

async function withdraw(tx, user, id, note) {
  const { conn } = tx;
  const wf = await lockWorkflow(conn, user.entityId, id);
  if (!wf) throw notFound();
  if (Number(wf.requested_by) !== Number(user.sub)) {
    throw (await accessOf(conn, user, wf)) ? new HrgaError('FORBIDDEN', 'Hanya pengaju yang bisa menarik pengajuan', 403) : notFound();
  }
  if (wf.status !== 'pending_approval' || !wf.approval_request_id) throw new HrgaError('CONFLICT', 'Hanya pengajuan yang menunggu approval yang bisa ditarik', 409);
  guardText(note, 'note');
  await engine.withdrawRequest({ approvalRequestId: wf.approval_request_id, actorUserId: user.sub, note, conn });
  await conn.query("UPDATE hrga_workflows SET status = 'draft', version = version + 1 WHERE id = ? AND entity_id = ?", [wf.id, user.entityId]);
  await logWith(conn, {
    entityId: user.entityId, userId: user.sub, action: 'hrga.withdraw', subjectType: SUBJECT_TYPE, subjectId: Number(wf.id),
    metadata: { approvalRequestId: Number(wf.approval_request_id), note: String(note).slice(0, 255) },
  });
  return { id: Number(wf.id), status: 'draft' };
}

async function cancel(tx, user, id, reason) {
  const { conn } = tx;
  const entityId = user.entityId;
  const wf = await lockWorkflow(conn, entityId, id);
  if (!wf) throw notFound();
  if (!has(user, 'hrga.manage')) throw new HrgaError('FORBIDDEN', 'Hanya Supervisor/Head People & Culture yang bisa membatalkan', 403);
  if (!RUNNING.includes(wf.status)) throw new HrgaError('CONFLICT', 'Hanya workflow yang sedang berjalan yang bisa dibatalkan', 409);
  const why = trim(reason);
  if (!why) throw new HrgaError('VALIDATION_ERROR', 'Tulis alasan pembatalan', 400);
  guardText(why, 'reason');
  await conn.query(
    `UPDATE hrga_workflow_tasks SET status = 'skipped', skipped_reason = 'Workflow dibatalkan'
      WHERE hrga_workflow_id = ? AND status IN ('pending', 'in_progress', 'blocked')`,
    [wf.id],
  );
  let directoryOutcome = null;
  if (wf.person_id) {
    if (wf.workflow_type === 'onboarding') {
      if (Number(wf.person_created) === 1) {
        await conn.query(
          "UPDATE people_directory SET kind = 'excluded', excluded_reason = ?, updated_by = ? WHERE id = ? AND entity_id = ?",
          [`Onboarding dibatalkan ${wf.workflow_number}`.slice(0, 160), user.sub, wf.person_id, entityId],
        );
        directoryOutcome = 'excluded';
      } else directoryOutcome = 'untouched';
    } else {
      const [r] = await conn.query(
        `UPDATE people_directory SET status = 'active', resigned_on = NULL, resigned_on_source = NULL, updated_by = ?
          WHERE id = ? AND entity_id = ? AND status = 'resigned' AND resigned_on_source = 'offboarding' AND resigned_on = ?`,
        [user.sub, wf.person_id, entityId, wf.last_day],
      );
      directoryOutcome = r.affectedRows ? 'reverted' : 'untouched';
    }
    if (directoryOutcome !== 'untouched') {
      await logWith(conn, {
        entityId, userId: user.sub, action: 'people_directory.update', subjectType: 'people_directory', subjectId: Number(wf.person_id),
        metadata: { source: 'hrga_cancel', workflowId: Number(wf.id), outcome: directoryOutcome },
      });
    }
  }
  const [open] = await conn.query(
    `SELECT a.id AS assignmentId, COALESCE(NULLIF(${DEVICE_NAME}, ''), d.device_type) AS deviceName
       FROM hrga_workflow_tasks t
       JOIN device_assignments a ON a.id = t.linked_device_assignment_id AND a.entity_id = ? AND a.status = 'active'
       JOIN devices d ON d.id = a.device_id
      WHERE t.hrga_workflow_id = ? AND t.category = 'device_handover'`,
    [entityId, wf.id],
  );
  await conn.query(
    `UPDATE hrga_workflows SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = ?, cancel_reason = ?, version = version + 1
      WHERE id = ? AND entity_id = ?`,
    [user.sub, why.slice(0, 255), wf.id, entityId],
  );
  await logWith(conn, {
    entityId, userId: user.sub, action: 'hrga.cancel', subjectType: SUBJECT_TYPE, subjectId: Number(wf.id),
    metadata: { reason: why.slice(0, 255), directory: directoryOutcome, openAssignments: open.length },
  });
  return {
    id: Number(wf.id), status: 'cancelled', directory: directoryOutcome,
    openAssignments: open.map((o) => ({ assignmentId: Number(o.assignmentId), deviceName: o.deviceName })),
  };
}

// ------------------------------------------------------------------ approval lifecycle hooks

async function lockForApproval(approval, conn) {
  const wf = await lockWorkflow(conn, approval.entity_id, approval.subject_id);
  if (!wf) throw notFound();
  if (wf.status !== 'pending_approval' || Number(wf.approval_request_id) !== Number(approval.id)) {
    throw new HrgaError('STALE_APPROVAL', 'Approval ini bukan pengajuan aktif onboarding/offboarding tersebut', 409);
  }
  return wf;
}

/** Separation of duties (S3, S4): requester, creator, subject and excluded accounts never decide. */
async function decisionDenial(conn, approval, user, wf) {
  const me = Number(user.sub);
  const subject = new Set([wf.employee_user_id, wf.requested_by, approval.requested_by].filter(Boolean).map(Number));
  if (wf.person_id) {
    const [[p]] = await conn.query('SELECT user_id FROM people_directory WHERE id = ? AND entity_id = ? LIMIT 1', [wf.person_id, wf.entity_id]);
    if (p?.user_id) subject.add(Number(p.user_id));
  }
  if (subject.has(me)) return new HrgaError('SELF_APPROVAL_FORBIDDEN', 'Pengaju dan karyawan yang bersangkutan tidak boleh menyetujui pengajuan ini', 403);
  if (await resolver.isExcludedAccount(conn, wf.entity_id, me)) {
    return new HrgaError('APPROVER_EXCLUDED', 'Akun ini dikecualikan di direktori, jadi tidak bisa memutuskan approval', 403);
  }
  return null;
}

async function assertCanDecide({ approval, user, action, conn }) {
  const wf = await lockForApproval(approval, conn);
  const denial = await decisionDenial(conn, approval, user, wf);
  if (denial) {
    try {
      await log({
        entityId: approval.entity_id, userId: user.sub, action: 'hrga.decision_denied', subjectType: SUBJECT_TYPE,
        subjectId: Number(wf.id), metadata: { approvalRequestId: Number(approval.id), action, code: denial.code },
      });
    } catch { /* the denial stands even when its log fails */ }
    throw denial;
  }
}

async function canUserDecide({ approval, user, conn }) {
  const db = conn || pool;
  const wf = await readWorkflow(db, approval.entity_id, approval.subject_id);
  if (!wf || wf.status !== 'pending_approval' || Number(wf.approval_request_id) !== Number(approval.id)) return false;
  return !(await decisionDenial(db, approval, user, wf));
}

const DECISION = { approved: 'approved', rejected: 'rejected', revision_requested: 'revision_requested' };

async function applyApprovalDecision({ approval, result, actorUserId, note = null, conn }) {
  const target = DECISION[result?.status];
  if (!target) return { changed: false };
  const wf = await lockForApproval(approval, conn);
  const entityId = Number(wf.entity_id);
  let checklist = null;
  let person = null;
  if (target === 'approved') {
    await conn.query(
      "UPDATE hrga_workflows SET status = 'approved', approved_at = NOW(), version = version + 1 WHERE id = ? AND entity_id = ?",
      [wf.id, entityId],
    );
    person = await ensureDirectoryPerson(conn, wf, actorUserId);
    const fresh = await readWorkflow(conn, entityId, wf.id);
    checklist = await generateChecklist(conn, fresh, todayWib());
  } else {
    await conn.query(
      'UPDATE hrga_workflows SET status = ?, version = version + 1 WHERE id = ? AND entity_id = ?',
      [target, wf.id, entityId],
    );
  }
  await logWith(conn, {
    entityId, userId: actorUserId, action: `hrga.${target}`, subjectType: SUBJECT_TYPE, subjectId: Number(wf.id),
    metadata: {
      approvalRequestId: Number(approval.id), note: note ? String(note).slice(0, 255) : null,
      ...(person ? { personId: person.personId, personCreated: Boolean(person.created) } : {}),
      ...(checklist ? { tasks: checklist.items.length, unassigned: checklist.unassigned } : {}),
    },
  });
  return {
    changed: true, status: target, workflowId: Number(wf.id), entityId, workflowType: wf.workflow_type,
    workflowNumber: wf.workflow_number, employeeName: wf.employee_full_name, requestedBy: Number(wf.requested_by),
    picUserId: int(wf.hrga_pic_user_id) || Number(wf.requested_by),
    responsibleUserIds: checklist ? [...new Set(checklist.items.map((i) => i.responsibleUserId).filter(Boolean))] : [],
    unassigned: checklist ? checklist.unassigned : [],
  };
}

const GROUP_LABEL = { it: 'IT', ga: 'GA', manager: 'Atasan', pc: 'People & Culture' };

async function afterDecision(outcome) {
  if (!outcome?.changed) return;
  const url = `/hrga/workflows/${outcome.workflowId}`;
  const label = TYPE_LABEL[outcome.workflowType];
  const titles = {
    approved: `${label} disetujui`, rejected: `${label} ditolak`, revision_requested: `${label} perlu revisi`,
  };
  await notif.create({
    userId: outcome.requestedBy, entityId: outcome.entityId, title: titles[outcome.status],
    body: `${outcome.workflowNumber} — ${outcome.employeeName}`, event: `hrga.${outcome.status}`,
    subjectType: SUBJECT_TYPE, subjectId: outcome.workflowId, actionUrl: url,
  });
  if (outcome.status !== 'approved') return;
  for (const userId of outcome.responsibleUserIds) {
    await notif.create({
      userId, entityId: outcome.entityId, title: `Tugas ${label.toLowerCase()} untuk Anda`,
      body: `${outcome.employeeName} (${outcome.workflowNumber})`, event: 'hrga.task_assigned',
      subjectType: SUBJECT_TYPE, subjectId: outcome.workflowId, actionUrl: url,
      dedupeKey: `hrga_assigned:${outcome.workflowId}:${userId}`,
    });
  }
  for (const group of outcome.unassigned) {
    await notif.create({
      userId: outcome.picUserId, entityId: outcome.entityId, title: `Tugas ${GROUP_LABEL[group]} belum punya penanggung jawab`,
      body: `${outcome.workflowNumber} — tetapkan PIC di Template checklist → Penanggung jawab, atau tugaskan manual.`,
      event: 'hrga.task_unassigned', subjectType: SUBJECT_TYPE, subjectId: outcome.workflowId, actionUrl: url,
      dedupeKey: `hrga_unassigned:${outcome.workflowId}:${group}`,
    });
  }
}

// ------------------------------------------------------------------ tasks

async function lockTask(conn, workflowId, taskId) {
  const [[task]] = await conn.query(
    `SELECT t.*, DATE_FORMAT(t.due_date, '%Y-%m-%d') AS due_day FROM hrga_workflow_tasks t
      WHERE t.id = ? AND t.hrga_workflow_id = ? LIMIT 1 FOR UPDATE`,
    [taskId, workflowId],
  );
  return task || null;
}

/** Lock workflow then task (D3); who and when rules (§2.1.3 Task rules). */
async function loadTask(tx, user, workflowId, taskId, { categories = null } = {}) {
  const { conn } = tx;
  const wf = await lockWorkflow(conn, user.entityId, workflowId);
  if (!wf) throw notFound();
  const task = await lockTask(conn, wf.id, taskId);
  const mine = task && Number(task.responsible_user_id) === Number(user.sub);
  if (!task || (!mine && !has(user, 'hrga.manage'))) {
    if (task && await accessOf(conn, user, wf)) throw new HrgaError('FORBIDDEN', 'Tugas ini bukan untuk Anda', 403);
    throw new HrgaError('NOT_FOUND', 'Tugas tidak ditemukan', 404);
  }
  if (!RUNNING.includes(wf.status)) throw new HrgaError('WORKFLOW_NOT_RUNNING', 'Tugas checklist hanya bisa diubah saat workflow sudah disetujui dan berjalan', 409);
  if (categories && !categories.includes(task.category)) throw new HrgaError('WRONG_TASK', 'Aksi ini bukan untuk tugas tersebut', 409);
  return { wf, task };
}

/** Recount under the workflow lock: all completed/skipped → workflow completed (once). */
async function recount(conn, wf, actorId) {
  if (wf.status === 'approved') {
    await conn.query("UPDATE hrga_workflows SET status = 'in_progress', version = version + 1 WHERE id = ? AND status = 'approved'", [wf.id]);
  }
  const [[c]] = await conn.query(
    "SELECT COUNT(*) AS total, SUM(status IN ('completed', 'skipped')) AS done FROM hrga_workflow_tasks WHERE hrga_workflow_id = ?",
    [wf.id],
  );
  if (Number(c.total) > 0 && Number(c.total) === Number(c.done)) {
    const [r] = await conn.query(
      `UPDATE hrga_workflows SET status = 'completed', completed_at = NOW(), completed_by = ?, version = version + 1
        WHERE id = ? AND status IN ('approved', 'in_progress')`,
      [actorId, wf.id],
    );
    if (r.affectedRows) {
      await logWith(conn, { entityId: wf.entity_id, userId: actorId, action: 'hrga.completed', subjectType: SUBJECT_TYPE, subjectId: Number(wf.id) });
    }
    return 'completed';
  }
  return 'in_progress';
}

async function completeTask(conn, wf, task, actorId, extra = {}) {
  const sets = ["status = 'completed'", 'completed_at = NOW()', 'completed_by = ?'];
  const args = [actorId];
  for (const [column, value] of Object.entries(extra)) { sets.push(`${column} = ?`); args.push(value); }
  await conn.query(`UPDATE hrga_workflow_tasks SET ${sets.join(', ')} WHERE id = ?`, [...args, task.id]);
  return recount(conn, wf, actorId);
}

/** Whether an action-only task's linked record already is in its target state. */
async function linkedDone(conn, wf, task) {
  const entityId = wf.entity_id;
  switch (task.category) {
    case 'device_handover': {
      if (!task.linked_device_assignment_id) return false;
      const [[a]] = await conn.query('SELECT status FROM device_assignments WHERE id = ? AND entity_id = ?', [task.linked_device_assignment_id, entityId]);
      return Boolean(a);
    }
    case 'device_return': {
      if (!task.linked_device_assignment_id) return true;
      const [[a]] = await conn.query('SELECT status FROM device_assignments WHERE id = ? AND entity_id = ?', [task.linked_device_assignment_id, entityId]);
      return !a || a.status !== 'active';
    }
    case 'software_license': {
      if (!task.linked_subscription_license_id) return false;
      const [[l]] = await conn.query(
        `SELECT l.status, l.assigned_to FROM subscription_licenses l JOIN software_subscriptions s ON s.id = l.subscription_id
          WHERE l.id = ? AND s.entity_id = ?`,
        [task.linked_subscription_license_id, entityId],
      );
      if (wf.workflow_type === 'onboarding') return Boolean(l && ['assigned', 'idle'].includes(l.status));
      const [[p]] = await conn.query('SELECT user_id FROM people_directory WHERE id = ? AND entity_id = ?', [wf.person_id, entityId]);
      return !l || !['assigned', 'idle'].includes(l.status) || Number(l.assigned_to) !== Number(p?.user_id);
    }
    case 'phone_line':
    case 'phone_line_return': {
      if (!task.linked_phone_line_id) return task.category === 'phone_line_return';
      if (!(await phoneRegisterReady(conn))) return false;
      const [[line]] = await conn.query('SELECT person_id, status FROM it_phone_lines WHERE id = ? AND entity_id = ?', [task.linked_phone_line_id, entityId]);
      const held = Boolean(line && line.status === 'active' && Number(line.person_id) === Number(wf.person_id));
      return task.category === 'phone_line' ? held : !held;
    }
    default: return true;
  }
}

async function updateTask(tx, user, workflowId, taskId, body) {
  const { conn } = tx;
  const { wf, task } = await loadTask(tx, user, workflowId, taskId);
  guardText(body.notes, 'notes');
  guardText(body.skippedReason, 'skippedReason');
  const sets = [];
  const args = [];
  let status = task.status;
  if (body.status && body.status !== task.status) {
    status = body.status;
    if (status === 'completed') {
      if (rules.ACTION_ONLY.includes(task.category) && !(await linkedDone(conn, wf, task))) {
        throw new HrgaError('USE_TASK_ACTION', 'Selesaikan tugas ini lewat tombol aksinya (serah terima, pengembalian, atau lisensi), bukan dicentang', 409);
      }
      if (rules.GOOGLE_CONFIRM.includes(task.category) && body.confirmedInAdminConsole !== true) {
        throw new HrgaError('CONFIRM_REQUIRED', 'Centang "Sudah dilakukan di konsol admin Google" dulu', 400);
      }
      sets.push('completed_at = NOW()', 'completed_by = ?', 'skipped_reason = NULL');
      args.push(user.sub);
    } else if (status === 'skipped') {
      const reason = trim(body.skippedReason);
      if (!reason) throw new HrgaError('SKIP_REASON_REQUIRED', 'Tulis alasan melewati tugas ini', 400);
      sets.push('skipped_reason = ?', 'completed_at = NULL', 'completed_by = NULL');
      args.push(reason.slice(0, 255));
    } else {
      sets.push('completed_at = NULL', 'completed_by = NULL', 'skipped_reason = NULL');
    }
    sets.unshift('status = ?');
    args.unshift(status);
  }
  if (body.notes !== undefined) { sets.push('notes = ?'); args.push(trim(body.notes)); }
  if (!sets.length) throw new HrgaError('VALIDATION_ERROR', 'Tidak ada perubahan', 400);
  await conn.query(`UPDATE hrga_workflow_tasks SET ${sets.join(', ')} WHERE id = ?`, [...args, task.id]);
  const workflowStatus = await recount(conn, wf, user.sub);
  await logWith(conn, {
    entityId: user.entityId, userId: user.sub, action: 'hrga.task.update', subjectType: 'hrga_workflow_task', subjectId: Number(task.id),
    metadata: { workflowId: Number(wf.id), from: task.status, to: status, confirmedInAdminConsole: body.confirmedInAdminConsole === true || undefined },
  });
  return { id: Number(task.id), status, workflowStatus };
}

async function assignTask(tx, user, workflowId, taskId, responsibleUserId) {
  const { conn } = tx;
  if (!has(user, 'hrga.manage')) throw new HrgaError('FORBIDDEN', 'Hanya Supervisor/Head People & Culture yang bisa menugaskan ulang', 403);
  const { wf, task } = await loadTask(tx, user, workflowId, taskId);
  let target = null;
  if (responsibleUserId != null) {
    target = await activeUser(conn, user.entityId, responsibleUserId);
    if (!target) throw new HrgaError('USER_INVALID', 'Penanggung jawab harus akun aktif di perusahaan ini', 400);
  }
  await conn.query('UPDATE hrga_workflow_tasks SET responsible_user_id = ? WHERE id = ?', [target ? target.id : null, task.id]);
  await logWith(conn, {
    entityId: user.entityId, userId: user.sub, action: 'hrga.task.assign', subjectType: 'hrga_workflow_task', subjectId: Number(task.id),
    metadata: { workflowId: Number(wf.id), from: int(task.responsible_user_id), to: target ? Number(target.id) : null },
  });
  if (target && Number(target.id) !== Number(user.sub)) {
    tx.effects.push(() => notif.create({
      userId: target.id, entityId: user.entityId, title: `Tugas ${TYPE_LABEL[wf.workflow_type].toLowerCase()} untuk Anda`,
      body: `${task.title} — ${wf.employee_full_name}`, event: 'hrga.task_assigned', subjectType: SUBJECT_TYPE,
      subjectId: Number(wf.id), actionUrl: `/hrga/workflows/${wf.id}`,
    }));
  }
  return { id: Number(task.id), responsibleUserId: target ? Number(target.id) : null };
}

const PERSON_REQUIRED = () => new HrgaError('PERSON_REQUIRED', 'Karyawan ini belum ada di direktori', 409);

async function deviceHandover(tx, user, workflowId, taskId, { deviceId, expectedReturnDate = null }) {
  const { conn } = tx;
  const { wf, task } = await loadTask(tx, user, workflowId, taskId, { categories: ['device_handover'] });
  if (task.status === 'completed') throw new HrgaError('CONFLICT', 'Perangkat sudah diserahkan', 409);
  if (!wf.person_id) throw PERSON_REQUIRED();
  const [[device]] = await conn.query(
    'SELECT * FROM devices WHERE id = ? AND entity_id = ? AND deleted_at IS NULL FOR UPDATE',
    [deviceId, user.entityId],
  );
  if (!device) throw new HrgaError('NOT_FOUND', 'Perangkat tidak ditemukan', 404);
  if (device.status !== 'available') throw new HrgaError('DEVICE_NOT_AVAILABLE', 'Hanya perangkat berstatus Cadangan yang bisa diserahkan', 409);
  const out = await deviceLifecycle.openAssignment(conn, {
    entityId: user.entityId, device, holder: { personId: Number(wf.person_id) }, actorId: user.sub,
    departmentId: int(wf.department_id), expectedReturnDate, purpose: `Onboarding ${wf.workflow_number}`,
  });
  await logWith(conn, {
    entityId: user.entityId, userId: user.sub, action: 'device.assign', subjectType: 'device_assignment', subjectId: out.assignmentId,
    metadata: { deviceId: Number(device.id), personId: out.holder.personId || null, assignedTo: out.holder.userId || null, workflowId: Number(wf.id) },
  });
  const workflowStatus = await completeTask(conn, wf, task, user.sub, { linked_device_assignment_id: out.assignmentId });
  return { id: Number(task.id), assignmentId: out.assignmentId, workflowStatus };
}

async function deviceReturn(tx, user, workflowId, taskId, { conditionOnReturn = null, notes = null }) {
  const { conn } = tx;
  const { wf, task } = await loadTask(tx, user, workflowId, taskId, { categories: ['device_return'] });
  guardText(notes, 'notes');
  if (task.status === 'completed') throw new HrgaError('CONFLICT', 'Perangkat sudah diterima kembali', 409);
  let returned = null;
  if (task.linked_device_assignment_id) {
    returned = await deviceLifecycle.returnAssignment(conn, {
      entityId: user.entityId, assignmentId: task.linked_device_assignment_id, conditionOnReturn, notes: trim(notes), actorId: user.sub,
    });
  }
  const workflowStatus = await completeTask(conn, wf, task, user.sub);
  return { id: Number(task.id), newStatus: returned?.newStatus || null, workflowStatus };
}

async function subjectAccount(conn, wf) {
  if (wf.person_id) {
    const [[p]] = await conn.query(
      `SELECT u.id FROM people_directory p JOIN users u ON u.id = p.user_id
        WHERE p.id = ? AND p.entity_id = ? AND u.status = 'active' AND u.deleted_at IS NULL LIMIT 1`,
      [wf.person_id, wf.entity_id],
    );
    if (p) return Number(p.id);
  }
  return null;
}

async function licenseAssign(tx, user, workflowId, taskId, { licenseId }) {
  const { conn } = tx;
  const { wf, task } = await loadTask(tx, user, workflowId, taskId, { categories: ['software_license'] });
  if (wf.workflow_type !== 'onboarding') throw new HrgaError('WRONG_TASK', 'Aksi ini bukan untuk tugas tersebut', 409);
  if (task.status === 'completed') throw new HrgaError('CONFLICT', 'Lisensi sudah diberikan', 409);
  const userId = await subjectAccount(conn, wf);
  if (!userId) throw new HrgaError('ACCOUNT_REQUIRED', 'Buat akun Prakasa Workspace dulu', 409);
  const out = await licenses.assignLicense(conn, {
    entityId: user.entityId, licenseId, userId, actorId: user.sub, subscriptionId: int(task.linked_subscription_id),
  });
  const workflowStatus = await completeTask(conn, wf, task, user.sub, { linked_subscription_license_id: out.licenseId });
  return { id: Number(task.id), licenseId: out.licenseId, workflowStatus };
}

async function licenseRevoke(tx, user, workflowId, taskId) {
  const { conn } = tx;
  const { wf, task } = await loadTask(tx, user, workflowId, taskId, { categories: ['software_license'] });
  if (wf.workflow_type !== 'offboarding' || !task.linked_subscription_license_id) throw new HrgaError('WRONG_TASK', 'Aksi ini bukan untuk tugas tersebut', 409);
  if (task.status === 'completed') throw new HrgaError('CONFLICT', 'Lisensi sudah dicabut', 409);
  await licenses.revokeLicense(conn, {
    entityId: user.entityId, licenseId: task.linked_subscription_license_id, actorId: user.sub, reason: `Offboarding ${wf.workflow_number}`,
  });
  const workflowStatus = await completeTask(conn, wf, task, user.sub);
  return { id: Number(task.id), workflowStatus };
}

async function requirePhoneRegister(conn) {
  if (!(await phoneRegisterReady(conn))) {
    throw new HrgaError('PHONE_REGISTER_UNAVAILABLE', 'Register nomor perusahaan belum tersedia. Catat di Infrastruktur IT setelah tersedia.', 409);
  }
}

async function phoneLine(tx, user, workflowId, taskId, { phoneLineId }) {
  const { conn } = tx;
  const { wf, task } = await loadTask(tx, user, workflowId, taskId, { categories: ['phone_line'] });
  await requirePhoneRegister(conn);
  if (task.status === 'completed') throw new HrgaError('CONFLICT', 'Nomor sudah diserahkan', 409);
  if (!wf.person_id) throw PERSON_REQUIRED();
  const [[line]] = await conn.query('SELECT * FROM it_phone_lines WHERE id = ? AND entity_id = ? FOR UPDATE', [phoneLineId, user.entityId]);
  if (!line) throw new HrgaError('NOT_FOUND', 'Nomor tidak ditemukan', 404);
  if (line.status !== 'spare') throw new HrgaError('PHONE_NOT_SPARE', 'Hanya nomor berstatus Cadangan yang bisa diserahkan', 409);
  await conn.query(
    `UPDATE it_phone_lines SET person_id = ?, holder_label = NULL, status = 'active', status_changed_at = CURRENT_TIMESTAMP,
            version = version + 1, updated_by = ? WHERE id = ? AND entity_id = ?`,
    [wf.person_id, user.sub, line.id, user.entityId],
  );
  await logWith(conn, {
    entityId: user.entityId, userId: user.sub, action: 'it_phone_line.holder', subjectType: 'it_phone_line', subjectId: Number(line.id),
    metadata: { personId: Number(wf.person_id), workflowId: Number(wf.id) },
  });
  const workflowStatus = await completeTask(conn, wf, task, user.sub, { linked_phone_line_id: Number(line.id) });
  return { id: Number(task.id), phoneLineId: Number(line.id), workflowStatus };
}

async function phoneLineReturn(tx, user, workflowId, taskId) {
  const { conn } = tx;
  const { wf, task } = await loadTask(tx, user, workflowId, taskId, { categories: ['phone_line_return'] });
  await requirePhoneRegister(conn);
  if (task.status === 'completed') throw new HrgaError('CONFLICT', 'Nomor sudah diterima kembali', 409);
  if (task.linked_phone_line_id) {
    const [[line]] = await conn.query('SELECT * FROM it_phone_lines WHERE id = ? AND entity_id = ? FOR UPDATE', [task.linked_phone_line_id, user.entityId]);
    if (line && Number(line.person_id) === Number(wf.person_id)) {
      await conn.query(
        `UPDATE it_phone_lines SET person_id = NULL, holder_label = NULL, status = 'spare', status_changed_at = CURRENT_TIMESTAMP,
                version = version + 1, updated_by = ? WHERE id = ? AND entity_id = ?`,
        [user.sub, line.id, user.entityId],
      );
      await logWith(conn, {
        entityId: user.entityId, userId: user.sub, action: 'it_phone_line.holder', subjectType: 'it_phone_line', subjectId: Number(line.id),
        metadata: { personId: null, returnedFrom: Number(wf.person_id), workflowId: Number(wf.id) },
      });
    }
  }
  const workflowStatus = await completeTask(conn, wf, task, user.sub);
  return { id: Number(task.id), workflowStatus };
}

async function itTicket(tx, user, workflowId, taskId, { category, title, description }) {
  const { conn } = tx;
  const { wf, task } = await loadTask(tx, user, workflowId, taskId);
  if (!['new_device_request', 'access_software'].includes(category)) throw new HrgaError('VALIDATION_ERROR', 'Kategori tiket tidak valid', 400);
  const safeTitle = trim(title);
  const safeDescription = String(description || '').trim();
  if (!safeTitle || !safeDescription) throw new HrgaError('VALIDATION_ERROR', 'Judul dan deskripsi tiket wajib diisi', 400);
  guardText(safeTitle, 'title');
  guardText(safeDescription, 'description');
  const [ins] = await conn.query(
    `INSERT INTO it_tickets (entity_id, department_id, category, title, description, priority, device_id, requester_id)
     VALUES (?, ?, ?, ?, ?, 'normal', NULL, ?)`,
    [user.entityId, int(wf.department_id), category, safeTitle.slice(0, 255), safeDescription, user.sub],
  );
  const ticketId = Number(ins.insertId);
  await conn.query('UPDATE hrga_workflow_tasks SET linked_it_ticket_id = ? WHERE id = ?', [ticketId, task.id]);
  await logWith(conn, {
    entityId: user.entityId, userId: user.sub, action: 'it_ticket.create', subjectType: 'it_ticket', subjectId: ticketId,
    metadata: { category, priority: 'normal', workflowId: Number(wf.id), taskId: Number(task.id) },
  });
  tx.effects.push(async () => {
    const itTickets = require('./itTicket.service');
    const ids = await itTickets.itAdminUserIds(user.entityId);
    for (const id of ids) {
      if (Number(id) === Number(user.sub)) continue;
      await notif.create({
        userId: id, entityId: user.entityId, title: 'Tiket IT baru', body: safeTitle, event: 'it_ticket.created',
        subjectType: 'it_ticket', subjectId: ticketId, actionUrl: `/it/tickets/${ticketId}`,
      });
    }
  });
  return { id: Number(task.id), ticketId };
}

async function holdingsSync(tx, user, workflowId) {
  const { conn } = tx;
  if (!has(user, 'hrga.manage')) throw new HrgaError('FORBIDDEN', 'Hanya Supervisor/Head People & Culture', 403);
  const wf = await lockWorkflow(conn, user.entityId, workflowId);
  if (!wf) throw notFound();
  if (wf.workflow_type !== 'offboarding') throw new HrgaError('CONFLICT', 'Hanya untuk offboarding', 409);
  if (!RUNNING.includes(wf.status)) throw new HrgaError('WORKFLOW_NOT_RUNNING', 'Workflow belum berjalan', 409);
  const holdings = await holdingsOf(conn, user.entityId, wf.person_id);
  const planned = rules.planItems({
    workflowType: 'offboarding', templateItems: [], holdings, baseDay: wf.last_day, approvalDay: todayWib(),
  });
  const [tasks] = await conn.query(
    'SELECT linked_device_assignment_id, linked_subscription_license_id, linked_phone_line_id FROM hrga_workflow_tasks WHERE hrga_workflow_id = ?',
    [wf.id],
  );
  const who = await responsibles(conn, wf);
  const missing = rules.missingHoldingItems(planned, tasks).map((i) => ({ ...i, responsibleUserId: who.it, sortOrder: 190 }));
  await insertTasks(conn, wf.id, missing);
  await logWith(conn, {
    entityId: user.entityId, userId: user.sub, action: 'hrga.holdings_sync', subjectType: SUBJECT_TYPE, subjectId: Number(wf.id),
    metadata: { added: missing.length },
  });
  return { added: missing.length };
}

// ------------------------------------------------------------------ reading

const STATUS_GROUPS = {
  running: ['approved', 'in_progress'],
  closed: ['rejected', 'cancelled'],
};

async function list(user, query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  const type = query.type || query.workflowType;
  const base = ['h.entity_id = ?', 'h.deleted_at IS NULL'];
  const args = [user.entityId];
  if (type === 'onboarding' || type === 'offboarding') { base.push('h.workflow_type = ?'); args.push(type); }
  if (query.departmentId) { base.push('h.department_id = ?'); args.push(Number(query.departmentId)); }
  const q = trim(query.q);
  if (q) { base.push('(h.employee_full_name LIKE ? OR h.workflow_number LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const where = [...base];
  const whereArgs = [...args];
  if (query.status) {
    const statuses = STATUS_GROUPS[query.status] || [String(query.status)];
    where.push('h.status IN (?)');
    whereArgs.push(statuses);
  }
  const today = todayWib();
  const [rows] = await pool.query(
    `SELECT h.id, h.workflow_type, h.workflow_number, h.status, h.employee_full_name, h.employee_position,
            h.department_id, d.name AS department_name,
            DATE_FORMAT(COALESCE(IF(h.workflow_type = 'onboarding', h.join_date, h.last_working_date), h.effective_date), '%Y-%m-%d') AS base_day,
            rq.name AS requester_name, pic.name AS pic_name, h.created_at,
            (SELECT COUNT(*) FROM hrga_workflow_tasks t WHERE t.hrga_workflow_id = h.id) AS total_tasks,
            (SELECT COUNT(*) FROM hrga_workflow_tasks t WHERE t.hrga_workflow_id = h.id AND t.status IN ('completed', 'skipped')) AS done_tasks,
            (SELECT COUNT(*) FROM hrga_workflow_tasks t WHERE t.hrga_workflow_id = h.id AND t.status IN ('pending', 'in_progress', 'blocked')
                AND t.due_date < ? AND h.status IN ('approved', 'in_progress')) AS late_tasks
       FROM hrga_workflows h
       LEFT JOIN departments d ON d.id = h.department_id
       LEFT JOIN users rq ON rq.id = h.requested_by
       LEFT JOIN users pic ON pic.id = h.hrga_pic_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY h.id DESC LIMIT ? OFFSET ?`,
    [today, ...whereArgs, limit, (page - 1) * limit],
  );
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM hrga_workflows h WHERE ${where.join(' AND ')}`, whereArgs);
  const [countRows] = await pool.query(`SELECT h.status, COUNT(*) AS n FROM hrga_workflows h WHERE ${base.join(' AND ')} GROUP BY h.status`, args);
  const by = Object.fromEntries(countRows.map((r) => [r.status, Number(r.n)]));
  const counts = {
    all: countRows.reduce((s, r) => s + Number(r.n), 0),
    draft: by.draft || 0,
    pending_approval: by.pending_approval || 0,
    revision_requested: by.revision_requested || 0,
    running: (by.approved || 0) + (by.in_progress || 0),
    completed: by.completed || 0,
    closed: (by.rejected || 0) + (by.cancelled || 0),
  };
  return {
    rows: rows.map((r) => ({
      id: Number(r.id), workflowType: r.workflow_type, workflowNumber: r.workflow_number, status: r.status,
      employeeName: r.employee_full_name, position: r.employee_position || null,
      departmentId: int(r.department_id), departmentName: r.department_name || null, baseDate: r.base_day || null,
      totalTasks: Number(r.total_tasks), doneTasks: Number(r.done_tasks), lateTasks: Number(r.late_tasks),
      requesterName: r.requester_name || null, picName: r.pic_name || null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    })),
    meta: { page, limit, total: Number(total), counts },
  };
}

/**
 * The open checklist tasks the caller is responsible for, in running workflows
 * of the caller's entity — the rows behind the home card "Tugas
 * onboarding/offboarding untuk Anda" (a manager in another division has them
 * without hrga.view). Soonest due first. Read only; always bound to user.sub.
 */
async function myTasks(user, { limit = 25, type = null } = {}) {
  const cap = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const where = ['t.responsible_user_id = ?', 't.status IN (?)', 'h.entity_id = ?', 'h.deleted_at IS NULL', 'h.status IN (?)'];
  const args = [Number(user.sub), [...OPEN_TASK], user.entityId, [...RUNNING]];
  if (type === 'onboarding' || type === 'offboarding') { where.push('h.workflow_type = ?'); args.push(type); }
  const from = `FROM hrga_workflow_tasks t
       JOIN hrga_workflows h ON h.id = t.hrga_workflow_id
       LEFT JOIN departments d ON d.id = h.department_id
      WHERE ${where.join(' AND ')}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}`, args);
  const [rows] = await pool.query(
    `SELECT t.id, t.title, t.category, t.owner_group, t.status, DATE_FORMAT(t.due_date, '%Y-%m-%d') AS due_day,
            h.id AS workflow_id, h.workflow_number, h.workflow_type, h.employee_full_name, h.employee_position,
            d.name AS department_name,
            DATE_FORMAT(COALESCE(IF(h.workflow_type = 'onboarding', h.join_date, h.last_working_date), h.effective_date), '%Y-%m-%d') AS base_day
       ${from}
      ORDER BY t.due_date IS NULL, t.due_date ASC, t.id ASC LIMIT ?`,
    [...args, cap],
  );
  const today = todayWib();
  return {
    total: Number(total),
    rows: rows.map((r) => ({
      id: Number(r.id), title: r.title, category: r.category, ownerGroup: r.owner_group, status: r.status,
      dueDate: r.due_day || null, late: Boolean(r.due_day && r.due_day < today),
      workflowId: Number(r.workflow_id), workflowNumber: r.workflow_number, workflowType: r.workflow_type,
      employeeName: r.employee_full_name, position: r.employee_position || null,
      departmentName: r.department_name || null, baseDate: r.base_day || null,
    })),
  };
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

async function userRoleIds(db, userId, entityId) {
  const [rows] = await db.query(
    'SELECT ur.role_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.entity_id = ? AND r.deleted_at IS NULL',
    [userId, entityId],
  );
  return rows.map((r) => Number(r.role_id));
}

async function viewerCanDecide(db, user, wf) {
  if (wf.status !== 'pending_approval' || !wf.approval_request_id || !has(user, 'approval.decide')) return false;
  const [[approval]] = await db.query('SELECT * FROM approval_requests WHERE id = ? AND entity_id = ? LIMIT 1', [wf.approval_request_id, wf.entity_id]);
  if (!approval || approval.status !== 'pending') return false;
  if (!(await canUserDecide({ approval, user, conn: db }))) return false;
  const roles = await userRoleIds(db, user.sub, wf.entity_id);
  const steps = await engine.getActiveSteps(approval.id, db);
  for (const step of steps) {
    if (await engine.canDecide({
      step, userId: user.sub, userRoleIds: roles, userPermissions: user.permissions || [], entityId: wf.entity_id,
      requestType: approval.request_type, documentTypeId: approval.document_type_id, conn: db,
    })) return true;
  }
  return false;
}

async function detail(user, id) {
  const wf = await readWorkflow(pool, user.entityId, id);
  const access = await accessOf(pool, user, wf);
  if (!access) throw notFound();
  const full = access === 'full';
  const entityId = user.entityId;
  const [[names]] = await pool.query(
    `SELECT d.name AS department_name, rq.name AS requester_name, pic.name AS pic_name, loc.name AS location_name,
            COALESCE(mu.name, mp.full_name) AS manager_name, mp.user_id AS manager_user_id,
            COALESCE(su.name, sp.full_name) AS person_name, sp.user_id AS person_user_id
       FROM hrga_workflows h
       LEFT JOIN departments d ON d.id = h.department_id
       LEFT JOIN users rq ON rq.id = h.requested_by
       LEFT JOIN users pic ON pic.id = h.hrga_pic_user_id
       LEFT JOIN org_locations loc ON loc.id = h.location_id AND loc.entity_id = h.entity_id
       LEFT JOIN people_directory mp ON mp.id = h.manager_person_id AND mp.entity_id = h.entity_id
       LEFT JOIN users mu ON mu.id = mp.user_id
       LEFT JOIN people_directory sp ON sp.id = h.person_id AND sp.entity_id = h.entity_id
       LEFT JOIN users su ON su.id = sp.user_id
      WHERE h.id = ? AND h.entity_id = ?`,
    [wf.id, entityId],
  );
  const needs = parseJson(wf.needs);
  let needLicenses = [];
  if (needs?.licenses?.length) {
    const [rows] = await pool.query('SELECT id, product_name FROM software_subscriptions WHERE entity_id = ? AND id IN (?)', [entityId, needs.licenses.map(Number)]);
    needLicenses = rows.map((r) => ({ id: Number(r.id), productName: r.product_name }));
  }
  const today = todayWib();
  const phoneReady = await phoneRegisterReady(pool);
  const [tasks] = await pool.query(
    `SELECT t.*, DATE_FORMAT(t.due_date, '%Y-%m-%d') AS due_day, ru.name AS responsible_name, cu.name AS completed_by_name,
            a.status AS assignment_status, COALESCE(NULLIF(${DEVICE_NAME}, ''), d.device_type) AS device_name,
            s.product_name AS subscription_name, l.status AS license_status, l.assigned_to AS license_holder
            ${phoneReady ? `, ${PHONE_LABEL} AS phone_label` : ', NULL AS phone_label'}
       FROM hrga_workflow_tasks t
       LEFT JOIN users ru ON ru.id = t.responsible_user_id
       LEFT JOIN users cu ON cu.id = t.completed_by
       LEFT JOIN device_assignments a ON a.id = t.linked_device_assignment_id AND a.entity_id = ?
       LEFT JOIN devices d ON d.id = a.device_id
       LEFT JOIN software_subscriptions s ON s.id = t.linked_subscription_id AND s.entity_id = ?
       LEFT JOIN subscription_licenses l ON l.id = t.linked_subscription_license_id
       ${phoneReady ? 'LEFT JOIN it_phone_lines pl ON pl.id = t.linked_phone_line_id AND pl.entity_id = ?' : ''}
      WHERE t.hrga_workflow_id = ?
      ORDER BY t.sort_order, t.id`,
    phoneReady ? [entityId, entityId, entityId, wf.id] : [entityId, entityId, wf.id],
  );
  const running = RUNNING.includes(wf.status);
  const canManage = has(user, 'hrga.manage');
  const shapedTasks = tasks.map((t) => ({
    id: Number(t.id), category: t.category, ownerGroup: t.owner_group, sortOrder: Number(t.sort_order), title: t.title,
    description: t.description || null, responsibleUserId: int(t.responsible_user_id), responsibleName: t.responsible_name || null,
    status: t.status, dueDate: t.due_day || null,
    late: Boolean(t.due_day && t.due_day < today && OPEN_TASK.includes(t.status) && running),
    completedAt: iso(t.completed_at), completedByName: t.completed_by_name || null,
    notes: full || Number(t.responsible_user_id) === Number(user.sub) ? (t.notes || null) : null,
    skippedReason: t.skipped_reason || null,
    linkedDeviceAssignmentId: int(t.linked_device_assignment_id), linkedDeviceName: t.linked_device_assignment_id ? t.device_name : null,
    linkedAssignmentActive: t.assignment_status === 'active',
    linkedSubscriptionId: int(t.linked_subscription_id), linkedSubscriptionName: t.subscription_name || null,
    linkedSubscriptionLicenseId: int(t.linked_subscription_license_id),
    linkedLicenseActive: ['assigned', 'idle'].includes(t.license_status),
    linkedItTicketId: int(t.linked_it_ticket_id), linkedPhoneLineId: int(t.linked_phone_line_id), linkedPhoneLineLabel: t.phone_label || null,
    canAct: running && (Number(t.responsible_user_id) === Number(user.sub) || canManage),
  }));

  let approval = null;
  if (wf.approval_request_id) {
    const [[a]] = await pool.query('SELECT id, status FROM approval_requests WHERE id = ? AND entity_id = ?', [wf.approval_request_id, entityId]);
    if (a) {
      const [steps] = await pool.query(
        `SELECT s.id, s.order_index, s.status, au.name AS approver_name, ar.name AS approver_role_name, er.name AS escalated_role_name,
                du.name AS decided_by_name, s.decided_at, s.note, s.activated_at, s.deadline_at
           FROM approval_steps s
           LEFT JOIN users au ON au.id = s.approver_user_id
           LEFT JOIN roles ar ON ar.id = s.approver_role_id
           LEFT JOIN roles er ON er.id = s.escalated_to_role_id
           LEFT JOIN users du ON du.id = s.decided_by
          WHERE s.approval_request_id = ? ORDER BY s.order_index, s.id`,
        [a.id],
      );
      approval = {
        id: Number(a.id), status: a.status,
        steps: steps.map((s) => ({
          id: Number(s.id), orderIndex: Number(s.order_index), status: s.status, approverName: s.approver_name || null,
          approverRoleName: s.approver_role_name || null, escalatedToRoleName: s.escalated_role_name || null,
          decidedByName: s.decided_by_name || null, decidedAt: iso(s.decided_at), note: s.note || null,
          activatedAt: iso(s.activated_at), deadlineAt: iso(s.deadline_at),
        })),
      };
    }
  }

  let possibleMatches = [];
  if (full && wf.workflow_type === 'onboarding' && !wf.person_id && EDITABLE.includes(wf.status)) {
    const key = directory.nameKey(wf.employee_full_name);
    const [rows] = await pool.query(
      `SELECT dir.person_id, dir.user_id, dir.full_name, dir.status, dep.name AS department_name
         FROM (${directory.DIRECTORY_SQL}) dir LEFT JOIN departments dep ON dep.id = dir.department_id
        WHERE LOWER(TRIM(dir.full_name)) = ? AND dir.kind <> 'excluded' LIMIT 5`,
      [entityId, entityId, key],
    );
    possibleMatches = rows.map((r) => ({
      key: directory.keyOf(r), name: r.full_name, departmentName: r.department_name || null, status: r.status,
    }));
  }

  const isRequester = Number(wf.requested_by) === Number(user.sub);
  const editable = EDITABLE.includes(wf.status) && (isRequester || canManage) && has(user, 'hrga.request');
  const out = {
    id: Number(wf.id), workflowType: wf.workflow_type, workflowNumber: wf.workflow_number, status: wf.status,
    version: Number(wf.version), limited: !full,
    employeeName: wf.employee_full_name, position: wf.employee_position || null,
    departmentId: int(wf.department_id), departmentName: names?.department_name || null,
    personId: int(wf.person_id), personKey: wf.person_id ? `p${wf.person_id}` : null, personCreated: Number(wf.person_created) === 1,
    managerPersonId: int(wf.manager_person_id), managerKey: wf.manager_person_id ? `p${wf.manager_person_id}` : null,
    managerName: names?.manager_name || null,
    locationId: int(wf.location_id), locationName: names?.location_name || null,
    plannedWorkEmail: wf.planned_work_email || null,
    joinDate: wf.join_day || null, lastWorkingDate: wf.last_day || null,
    baseDate: (wf.workflow_type === 'onboarding' ? wf.join_day : wf.last_day) || wf.effective_day || null,
    needs: needs || null, needLicenses,
    reasonCode: full ? (wf.reason_code || null) : null,
    requesterId: Number(wf.requested_by), requesterName: names?.requester_name || null,
    picUserId: int(wf.hrga_pic_user_id), picName: names?.pic_name || null,
    approvalRequestId: int(wf.approval_request_id), approverBasis: wf.approver_basis || null,
    submittedAt: iso(wf.submitted_at), approvedAt: iso(wf.approved_at), completedAt: iso(wf.completed_at),
    cancelledAt: iso(wf.cancelled_at), cancelReason: full ? (wf.cancel_reason || null) : null,
    possibleMatches,
    tasks: shapedTasks,
    holdings: full && wf.workflow_type === 'offboarding' ? await holdingsOf(pool, entityId, wf.person_id) : null,
    approval,
    viewer: {
      fullAccess: full, canManage, isRequester,
      canEdit: editable, canDelete: editable && wf.status === 'draft', canSubmit: editable,
      canWithdraw: wf.status === 'pending_approval' && isRequester,
      canCancel: canManage && running,
      canDecide: await viewerCanDecide(pool, user, wf),
      canAttach: canManage && full, canHoldingsSync: canManage && running && wf.workflow_type === 'offboarding',
      canEditKantorku: canManage && full,
    },
  };
  if (full) {
    const [attachments] = await pool.query(
      `SELECT id, name, attachment_type, web_view_link, created_at FROM hrga_workflow_attachments
        WHERE hrga_workflow_id = ? ORDER BY id`,
      [wf.id],
    );
    Object.assign(out, {
      kantorkuEmployeeId: wf.kantorku_employee_id || null,
      kantorkuReferenceUrl: wf.kantorku_reference_url || null,
      notes: wf.notes || null,
      attachments: attachments.map((a) => ({
        id: Number(a.id), name: a.name, attachmentType: a.attachment_type, webViewLink: a.web_view_link || null, createdAt: iso(a.created_at),
      })),
    });
  }
  return out;
}

async function checklistPreview(user, id) {
  const wf = await readWorkflow(pool, user.entityId, id);
  if (!(await accessOf(pool, user, wf))) throw notFound();
  if (!['draft', 'revision_requested', 'pending_approval'].includes(wf.status)) {
    throw new HrgaError('CONFLICT', 'Pratinjau hanya untuk draft; checklist sudah dibuat', 409);
  }
  const plan = await planChecklist(pool, wf, todayWib());
  const ids = [...new Set(plan.items.map((i) => i.responsibleUserId).filter(Boolean))];
  let names = new Map();
  if (ids.length) {
    const [rows] = await pool.query('SELECT id, name FROM users WHERE id IN (?)', [ids]);
    names = new Map(rows.map((r) => [Number(r.id), r.name]));
  }
  return {
    items: plan.items.map((i) => ({
      category: i.category, ownerGroup: i.ownerGroup, title: i.title, dueDate: i.dueDate,
      responsibleName: i.responsibleUserId ? names.get(Number(i.responsibleUserId)) || null : null,
    })),
  };
}

async function taskOptions(user, workflowId, taskId) {
  const wf = await readWorkflow(pool, user.entityId, workflowId);
  if (!wf) throw notFound();
  const [[task]] = await pool.query('SELECT * FROM hrga_workflow_tasks WHERE id = ? AND hrga_workflow_id = ?', [taskId, wf.id]);
  if (!task || (Number(task.responsible_user_id) !== Number(user.sub) && !has(user, 'hrga.manage'))) {
    throw new HrgaError('NOT_FOUND', 'Tugas tidak ditemukan', 404);
  }
  const entityId = user.entityId;
  const [devices] = await pool.query(
    `SELECT d.id, d.device_type, d.serial_number, COALESCE(NULLIF(${DEVICE_NAME}, ''), d.device_type) AS name, loc.name AS location_name
       FROM devices d LEFT JOIN org_locations loc ON loc.id = d.location_id AND loc.entity_id = d.entity_id
      WHERE d.entity_id = ? AND d.deleted_at IS NULL AND d.status = 'available'
      ORDER BY d.device_type, d.brand, d.model, d.id LIMIT 300`,
    [entityId],
  );
  const licenseArgs = [entityId];
  let licenseFilter = '';
  if (task.linked_subscription_id) { licenseFilter = ' AND l.subscription_id = ?'; licenseArgs.push(task.linked_subscription_id); }
  const [licenseRows] = await pool.query(
    `SELECT l.id, l.seat_label, l.subscription_id, s.product_name
       FROM subscription_licenses l JOIN software_subscriptions s ON s.id = l.subscription_id AND s.deleted_at IS NULL
      WHERE s.entity_id = ? AND l.status = 'available'${licenseFilter}
      ORDER BY s.product_name, l.id LIMIT 300`,
    licenseArgs,
  );
  let phoneLines = null;
  if (await phoneRegisterReady(pool)) {
    const [rows] = await pool.query(
      `SELECT pl.id, ${PHONE_LABEL} AS label FROM it_phone_lines pl
        WHERE pl.entity_id = ? AND pl.status = 'spare' ORDER BY pl.kind, pl.number, pl.extension LIMIT 300`,
      [entityId],
    );
    phoneLines = rows.map((r) => ({ id: Number(r.id), label: r.label }));
  }
  // Each list only for whoever may act on it (the action routes check the same permission).
  return {
    devices: has(user, 'device.assign')
      ? devices.map((d) => ({ id: Number(d.id), name: d.name, deviceType: d.device_type, serialNumber: d.serial_number || null, locationName: d.location_name || null }))
      : [],
    licenses: has(user, 'subscription.license.manage')
      ? licenseRows.map((l) => ({ id: Number(l.id), seatLabel: l.seat_label || null, subscriptionId: Number(l.subscription_id), productName: l.product_name }))
      : [],
    phoneLines: phoneLines && !has(user, 'it.infra.manage') ? [] : phoneLines,
  };
}

async function lookups(user) {
  const entityId = user.entityId;
  const [departments] = await pool.query('SELECT id, name, code FROM departments WHERE entity_id = ? AND deleted_at IS NULL ORDER BY name', [entityId]);
  const today = todayWib();
  const [people] = await pool.query(
    `SELECT dir.person_id, dir.user_id, dir.full_name, dir.position, dir.department_id, dep.name AS department_name, dir.status,
            DATE_FORMAT(dir.starts_on, '%Y-%m-%d') AS starts_day, DATE_FORMAT(dir.resigned_on, '%Y-%m-%d') AS resigned_day
       FROM (${directory.DIRECTORY_SQL}) dir LEFT JOIN departments dep ON dep.id = dir.department_id
      WHERE dir.kind <> 'excluded'
      ORDER BY dir.full_name LIMIT 2000`,
    [entityId, entityId],
  );
  const [locations] = await pool.query('SELECT id, name FROM org_locations WHERE entity_id = ? AND is_active = 1 ORDER BY name', [entityId]);
  const [subscriptions] = await pool.query(
    `SELECT s.id, s.product_name, s.plan_name,
            (SELECT COUNT(*) FROM subscription_licenses l WHERE l.subscription_id = s.id AND l.status = 'available') AS available
       FROM software_subscriptions s
      WHERE s.entity_id = ? AND s.deleted_at IS NULL AND s.status IN ('active', 'expiring')
      ORDER BY s.product_name`,
    [entityId],
  );
  const [users] = await pool.query(
    `SELECT u.id, u.name, d.name AS department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.entity_id = ? AND u.status = 'active' AND u.deleted_at IS NULL ORDER BY u.name`,
    [entityId],
  );
  return {
    departments: departments.map((d) => ({ id: Number(d.id), name: d.name, code: d.code })),
    people: people.map((p) => ({
      key: directory.keyOf(p), personId: int(p.person_id), userId: int(p.user_id), name: p.full_name, position: p.position || null,
      departmentId: int(p.department_id), departmentName: p.department_name || null, hasAccount: p.user_id != null,
      status: p.status, startsOn: p.starts_day && p.starts_day > today ? p.starts_day : null,
      lastDay: p.resigned_day && p.resigned_day >= today && p.status === 'resigned' ? p.resigned_day : null,
    })),
    locations: locations.map((l) => ({ id: Number(l.id), name: l.name })),
    subscriptions: subscriptions.map((s) => ({ id: Number(s.id), productName: s.product_name, planName: s.plan_name || null, availableLicenses: Number(s.available) })),
    users: users.map((u) => ({ id: Number(u.id), name: u.name, departmentName: u.department_name || null })),
    pic: await readPic(pool, entityId),
  };
}

/** The running onboarding/offboarding of a directory person (directory profile, P&C only). */
async function runningWorkflowForPerson(entityId, personId) {
  if (!personId) return null;
  const [[row]] = await pool.query(
    `SELECT id, workflow_type, workflow_number, status FROM hrga_workflows
      WHERE entity_id = ? AND person_id = ? AND deleted_at IS NULL
        AND status IN ('draft', 'pending_approval', 'revision_requested', 'approved', 'in_progress')
      ORDER BY id DESC LIMIT 1`,
    [entityId, personId],
  );
  return row ? { id: Number(row.id), workflowType: row.workflow_type, workflowNumber: row.workflow_number, status: row.status } : null;
}

// ------------------------------------------------------------------ attachments / KantorKu

async function addAttachment(tx, user, id, { attachmentType, driveFileId, webViewLink, name, mimeType, size, documentId }) {
  const wf = await lockWorkflow(tx.conn, user.entityId, id);
  if (!wf) throw notFound();
  const [ins] = await tx.conn.query(
    `INSERT INTO hrga_workflow_attachments
       (hrga_workflow_id, document_id, drive_file_id, web_view_link, attachment_type, name, mime_type, size, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [wf.id, documentId || null, driveFileId, webViewLink, attachmentType, name, mimeType, size, user.sub],
  );
  await logWith(tx.conn, {
    entityId: user.entityId, userId: user.sub, action: 'hrga.attachment.upload', subjectType: SUBJECT_TYPE,
    subjectId: Number(wf.id), metadata: { attachmentType, driveFileId },
  });
  return { id: Number(ins.insertId), webViewLink };
}

async function setKantorku(tx, user, id, { kantorkuEmployeeId, kantorkuReferenceUrl }) {
  const wf = await lockWorkflow(tx.conn, user.entityId, id);
  if (!wf) throw notFound();
  guardText(kantorkuEmployeeId, 'kantorkuEmployeeId');
  await tx.conn.query(
    `UPDATE hrga_workflows SET kantorku_employee_id = ?, kantorku_reference_url = ?, kantorku_synced_at = NOW()
      WHERE id = ? AND entity_id = ?`,
    [trim(kantorkuEmployeeId), trim(kantorkuReferenceUrl), wf.id, user.entityId],
  );
  await logWith(tx.conn, {
    entityId: user.entityId, userId: user.sub, action: 'hrga.link_kantorku', subjectType: SUBJECT_TYPE, subjectId: Number(wf.id),
    metadata: { kantorkuEmployeeId: trim(kantorkuEmployeeId) },
  });
  return { id: Number(wf.id) };
}

// ------------------------------------------------------------------ templates and PIC

function shapeTemplate(r) {
  return {
    id: Number(r.id), workflowType: r.workflow_type, departmentId: int(r.department_id), departmentName: r.department_name || null,
    name: r.name, items: parseJson(r.items) || [], isActive: Number(r.is_active) === 1,
    updatedAt: iso(r.updated_at), updatedByName: r.updated_by_name || null,
  };
}

async function listTemplates(user, query = {}) {
  const where = ['t.entity_id = ?'];
  const args = [user.entityId];
  if (query.workflowType === 'onboarding' || query.workflowType === 'offboarding') { where.push('t.workflow_type = ?'); args.push(query.workflowType); }
  const [rows] = await pool.query(
    `SELECT t.*, d.name AS department_name, u.name AS updated_by_name
       FROM hrga_checklist_templates t
       LEFT JOIN departments d ON d.id = t.department_id
       LEFT JOIN users u ON u.id = t.updated_by
      WHERE ${where.join(' AND ')}
      ORDER BY t.workflow_type, t.is_active DESC, t.department_id IS NOT NULL, d.name, t.id DESC`,
    args,
  );
  return { rows: rows.map(shapeTemplate), builtIn: rules.BUILT_IN };
}

function checkItems(workflowType, items) {
  for (const entry of items || []) {
    const problem = rules.templateItemProblem(workflowType, entry);
    if (problem) throw new HrgaError('TEMPLATE_ITEM_INVALID', `${entry.title || entry.category}: ${problem}`, 400);
    guardText(entry.title, 'title');
    guardText(entry.description, 'description');
  }
}

function duplicateTemplate(e) {
  if (e?.code === 'ER_DUP_ENTRY' && /uq_hrga_tpl_active/.test(e.message)) {
    return new HrgaError('TEMPLATE_ACTIVE_EXISTS', 'Sudah ada template aktif untuk jenis dan divisi ini. Nonaktifkan dulu yang lama.', 409);
  }
  return e;
}

async function createTemplate(tx, user, body) {
  const { conn } = tx;
  checkItems(body.workflowType, body.items);
  const departmentId = await checkDepartment(conn, user.entityId, body.departmentId ?? null);
  let id;
  try {
    const [ins] = await conn.query(
      `INSERT INTO hrga_checklist_templates (entity_id, workflow_type, department_id, name, items, is_active, updated_by)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [user.entityId, body.workflowType, departmentId, trim(body.name), JSON.stringify(body.items || []), user.sub],
    );
    id = Number(ins.insertId);
  } catch (e) { throw duplicateTemplate(e); }
  await logWith(conn, {
    entityId: user.entityId, userId: user.sub, action: 'hrga_checklist_template.create', subjectType: 'hrga_checklist_template', subjectId: id,
    metadata: { workflowType: body.workflowType, departmentId, items: (body.items || []).length },
  });
  return { id };
}

async function updateTemplate(tx, user, id, body) {
  const { conn } = tx;
  const [[row]] = await conn.query('SELECT * FROM hrga_checklist_templates WHERE id = ? AND entity_id = ? FOR UPDATE', [id, user.entityId]);
  if (!row) throw new HrgaError('NOT_FOUND', 'Template tidak ditemukan', 404);
  const sets = {};
  if (body.name !== undefined) sets.name = trim(body.name);
  if (body.items !== undefined) { checkItems(row.workflow_type, body.items); sets.items = JSON.stringify(body.items); }
  if (body.isActive !== undefined) sets.is_active = body.isActive ? 1 : 0;
  sets.updated_by = user.sub;
  try {
    await conn.query(
      `UPDATE hrga_checklist_templates SET ${Object.keys(sets).map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND entity_id = ?`,
      [...Object.values(sets), row.id, user.entityId],
    );
  } catch (e) { throw duplicateTemplate(e); }
  await logWith(conn, {
    entityId: user.entityId, userId: user.sub, action: 'hrga_checklist_template.update', subjectType: 'hrga_checklist_template', subjectId: Number(row.id),
    metadata: { fields: Object.keys(sets).filter((k) => k !== 'updated_by') },
  });
  return { id: Number(row.id) };
}

async function picCandidates(db, entityId, code) {
  const [rows] = await db.query(
    `SELECT DISTINCT u.id, u.name FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.entity_id = ? AND r.deleted_at IS NULL
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id AND p.code = ?
      WHERE u.entity_id = ? AND u.status = 'active' AND u.deleted_at IS NULL
      ORDER BY u.name`,
    [entityId, code, entityId],
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}

async function getPicSettings(user, db = pool) {
  const pic = await readPic(db, user.entityId);
  const it = await picCandidates(db, user.entityId, rules.PIC_PERMISSION.it);
  const ga = await picCandidates(db, user.entityId, rules.PIC_PERMISSION.ga);
  const nameOf = async (id) => {
    if (!id) return null;
    const [[u]] = await db.query('SELECT name FROM users WHERE id = ? AND entity_id = ?', [id, user.entityId]);
    return u?.name || null;
  };
  return {
    itUserId: pic.itUserId, itUserName: await nameOf(pic.itUserId),
    gaUserId: pic.gaUserId, gaUserName: await nameOf(pic.gaUserId),
    candidates: { it, ga },
  };
}

async function putPicSettings(tx, user, { itUserId = null, gaUserId = null }) {
  const { conn } = tx;
  for (const [group, userId] of [['it', itUserId], ['ga', gaUserId]]) {
    if (userId == null) continue;
    if (!(await userHolds(conn, user.entityId, userId, rules.PIC_PERMISSION[group]))) {
      throw new HrgaError('PIC_PERMISSION', group === 'it'
        ? 'PIC IT harus akun aktif yang memegang izin serah terima perangkat (device.assign)'
        : 'PIC GA harus akun aktif yang memegang izin memproses permintaan GA (ga.request.process)', 400);
    }
  }
  const before = await readPic(conn, user.entityId);
  const value = JSON.stringify({ itUserId: itUserId ?? null, gaUserId: gaUserId ?? null });
  await conn.query(
    'INSERT INTO settings (entity_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [user.entityId, PIC_SETTING_KEY, value],
  );
  await logWith(conn, {
    entityId: user.entityId, userId: user.sub, action: 'people_culture.pic.update', subjectType: 'settings', subjectId: null,
    metadata: { before, after: { itUserId: itUserId ?? null, gaUserId: gaUserId ?? null } },
  });
  return getPicSettings(user, conn);
}

module.exports = {
  HrgaError, RUNNING, EDITABLE, SUBJECT_TYPE, REQUEST_TYPES, PIC_SETTING_KEY,
  transact, accessOf, holdingsOf, holdingsForKey, phoneRegisterReady, planChecklist, generateChecklist, ensureDirectoryPerson,
  create, updateDraft, removeDraft, submit, withdraw, cancel,
  assertCanDecide, canUserDecide, applyApprovalDecision, afterDecision,
  updateTask, assignTask, deviceHandover, deviceReturn, licenseAssign, licenseRevoke, phoneLine, phoneLineReturn, itTicket, holdingsSync,
  list, myTasks, detail, checklistPreview, taskOptions, lookups, runningWorkflowForPerson,
  addAttachment, setKantorku, listTemplates, createTemplate, updateTemplate, getPicSettings, putPicSettings, readPic,
};
