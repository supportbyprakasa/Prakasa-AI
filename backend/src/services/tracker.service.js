const pool = require('../db/pool');
const logger = require('../utils/logger');
const { log: activityLog } = require('./activityLog.service');
const taskActivity = require('./taskActivity.service');
const watcherSvc = require('./taskWatcher.service');
const notifSvc = require('./taskNotification.service');
const taskService = require('./task.service');
const realtime = require('./realtime.service');
const trackerChat = require('./trackerChat.service');
const M = require('./trackerModel');

// Project Tracker per Google Chat space (Jira-like). Reuses the task board
// tables: project = boards row with project_key + google_chat_space_name,
// issue = tasks row, status = board_columns row (with a category).
// Access = membership of the Chat space, verified with Chat AS the user.

const DEFAULT_COLUMNS = [
  { name: 'To Do', category: 'todo' },
  { name: 'In Progress', category: 'in_progress' },
  { name: 'In Review', category: 'in_progress' },
  { name: 'Done', category: 'done' },
];
const MAX_ISSUES = 1000;
const ACTIVITY_LIMIT = 100;

const ISSUE_SELECT = `
  SELECT t.id, t.board_id, t.entity_id, t.issue_number, t.title, t.description, t.issue_type, t.priority,
         t.column_id, c.category, c.name AS column_name,
         t.assignee_id, t.assignee_email, ua.name AS assignee_name, ua.email AS assignee_user_email,
         t.reporter_id, ur.name AS reporter_name,
         t.start_date, t.due_date, t.story_points, t.labels, t.sprint_id, t.parent_id, p.issue_number AS parent_number,
         t.position,
         UNIX_TIMESTAMP(t.created_at) AS created_ts, UNIX_TIMESTAMP(t.updated_at) AS updated_ts,
         UNIX_TIMESTAMP(t.completed_at) AS completed_ts,
         b.project_key,
         (SELECT COUNT(*) FROM tasks ch WHERE ch.parent_id = t.id AND ch.deleted_at IS NULL) AS child_count,
         (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count
    FROM tasks t
    JOIN boards b ON b.id = t.board_id
    LEFT JOIN board_columns c ON c.id = t.column_id
    LEFT JOIN users ua ON ua.id = t.assignee_id
    LEFT JOIN users ur ON ur.id = t.reporter_id
    LEFT JOIN tasks p ON p.id = t.parent_id AND p.deleted_at IS NULL`;

const PROJECT_COLUMNS = `id, entity_id, department_id, name, project_key, post_updates_to_space,
  google_chat_space_name, is_archived, UNIX_TIMESTAMP(updated_at) AS updated_ts`;

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
async function loadProject(projectId, db = pool, { lock = false } = {}) {
  const [rows] = await db.query(
    `SELECT ${PROJECT_COLUMNS}
       FROM boards
      WHERE id = ? AND deleted_at IS NULL
        AND project_key IS NOT NULL AND google_chat_space_name IS NOT NULL
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [projectId]
  );
  return rows[0] || null;
}

// Entity first (no Google call for foreign ids), then Chat membership.
async function accessProject(user, projectId) {
  const id = M.positiveInt(projectId, 'projectId');
  const board = await loadProject(id);
  if (!board || Number(board.entity_id) !== Number(user.entityId)) throw M.notFound('Project tidak ditemukan');
  await trackerChat.assertMember(user, board.google_chat_space_name);
  return board;
}

async function accessIssue(user, issueId) {
  const id = M.positiveInt(issueId, 'issueId');
  const [rows] = await pool.query(
    `SELECT id, board_id, entity_id, title, issue_number, assignee_id, assignee_email
       FROM tasks WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  const issue = rows[0];
  if (!issue || !issue.board_id) throw M.notFound('Issue tidak ditemukan');
  const board = await loadProject(issue.board_id);
  if (!board || Number(board.entity_id) !== Number(user.entityId)) throw M.notFound('Issue tidak ditemukan');
  await trackerChat.assertMember(user, board.google_chat_space_name);
  return { board, issue };
}

// ---------------------------------------------------------------------------
// Side effects after commit (never fail the request)
// ---------------------------------------------------------------------------
// Audience of a project event: the space's members when a local list exists
// (plus the actor, the project's division and the cross-division roles, whose
// dashboards refresh on tracker events); without one the event stays
// entity-wide. Ids only either way — every refetch passes the access checks.
function audienceFor(board, user) {
  const known = trackerChat.knownAudience(board.google_chat_space_name);
  if (!known) return null;
  return {
    emails: known.emails,
    userIds: [...known.userIds, Number(user?.sub) || 0],
    departmentId: board.department_id != null ? Number(board.department_id) : null,
    crossDivision: true,
  };
}

function emit(type, board, user, issueId = null) {
  realtime.publish('tracker', {
    type,
    entityId: Number(board.entity_id),
    projectId: Number(board.id),
    spaceName: board.google_chat_space_name,
    issueId: issueId ? Number(issueId) : null,
    actorUserId: Number(user.sub),
  }, audienceFor(board, user));
}

// Short message to the space AS the acting user when the project wants it.
// Fire-and-forget; returns the promise so tests can await it.
function announce(user, board, issue, changes) {
  if (!board?.post_updates_to_space || !changes?.length || !issue?.key) return Promise.resolve(false);
  const text = M.spaceUpdateText({ key: issue.key, title: issue.title, changes });
  if (!text) return Promise.resolve(false);
  return trackerChat.postUpdate(user, board.google_chat_space_name, text).catch(() => false);
}

async function notifyAssignee(user, board, issue) {
  const userId = issue?.assignee?.userId;
  if (!userId || Number(userId) === Number(user.sub)) return;
  try {
    await notifSvc.notifyTaskUsers({
      task: { id: issue.id, entity_id: board.entity_id, reporter_id: null, assignee_id: userId },
      actorUserId: user.sub,
      event: 'task.assigned',
      title: 'Anda ditugaskan ke issue',
      body: `${issue.key} ${issue.title}`.slice(0, 200),
      actionUrl: `/projects/${M.spaceIdOf(board.google_chat_space_name)}?issue=${issue.id}`,
      includeReporter: false,
      includeWatchers: false,
    });
  } catch (error) {
    logger.debug({ err: error.message }, '[tracker] assignee notification failed');
  }
}

async function logProjectActivity(user, board, action, metadata) {
  try {
    await activityLog({
      entityId: board.entity_id, userId: user.sub, action,
      subjectType: 'board', subjectId: board.id, metadata,
    });
  } catch { /* committed work stays valid */ }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
function memberNameMap(spaceName) {
  const members = trackerChat.cachedMembers(spaceName) || [];
  return new Map(members.map((m) => [m.email, m.name]));
}

async function fetchIssues(where, args, board, { limit = MAX_ISSUES, db = pool } = {}) {
  const [rows] = await db.query(
    `${ISSUE_SELECT}
      WHERE ${where}
      ORDER BY c.position ASC, c.id ASC, t.position ASC, t.id ASC
      LIMIT ${Number(limit)}`,
    args
  );
  const names = memberNameMap(board.google_chat_space_name);
  return rows.map((row) => M.mapIssue(row, names));
}

async function fetchIssue(issueId, board, db = pool) {
  const [issue] = await fetchIssues('t.id = ? AND t.deleted_at IS NULL', [issueId], board, { limit: 1, db });
  return issue || null;
}

async function columnsOf(boardIds, db = pool) {
  if (!boardIds.length) return new Map();
  const [rows] = await db.query(
    `SELECT id, board_id, name, category, position, wip_limit
       FROM board_columns WHERE board_id IN (?)
      ORDER BY position ASC, id ASC`,
    [boardIds]
  );
  const out = new Map(boardIds.map((id) => [Number(id), []]));
  for (const row of rows) out.get(Number(row.board_id))?.push(M.mapColumn(row));
  return out;
}

async function countsOf(boardIds, db = pool) {
  if (!boardIds.length) return new Map();
  const [rows] = await db.query(
    `SELECT t.board_id,
            SUM(COALESCE(c.category, 'todo') <> 'done') AS open_count,
            SUM(c.category = 'in_progress') AS in_progress_count,
            SUM(c.category = 'done') AS done_count,
            SUM(t.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) AND COALESCE(c.category, 'todo') <> 'done') AS overdue_count
       FROM tasks t
       LEFT JOIN board_columns c ON c.id = t.column_id
      WHERE t.board_id IN (?) AND t.deleted_at IS NULL
      GROUP BY t.board_id`,
    [boardIds]
  );
  return new Map(rows.map((row) => [Number(row.board_id), M.mapCounts(row)]));
}

const SPRINT_ORDER = { active: 0, planned: 1, completed: 2 };

async function sprintsOf(boardIds, db = pool, { sprintId = null } = {}) {
  if (!boardIds.length) return new Map();
  const [rows] = await db.query(
    `SELECT s.id, s.board_id, s.name, s.goal, s.start_date, s.end_date, s.status,
            COUNT(t.id) AS issue_count,
            COALESCE(SUM(t.story_points), 0) AS points,
            COALESCE(SUM(CASE WHEN c.category = 'done' THEN t.story_points END), 0) AS done_points
       FROM tracker_sprints s
       LEFT JOIN tasks t ON t.sprint_id = s.id AND t.deleted_at IS NULL
       LEFT JOIN board_columns c ON c.id = t.column_id
      WHERE s.board_id IN (?)${sprintId ? ' AND s.id = ?' : ''}
      GROUP BY s.id`,
    sprintId ? [boardIds, sprintId] : [boardIds]
  );
  rows.sort((a, b) => (SPRINT_ORDER[a.status] - SPRINT_ORDER[b.status])
    || (a.status === 'completed' ? Number(b.id) - Number(a.id) : Number(a.id) - Number(b.id)));
  const out = new Map(boardIds.map((id) => [Number(id), []]));
  for (const row of rows) out.get(Number(row.board_id))?.push(M.mapSprint(row));
  return out;
}

async function membersOf(user, board) {
  let members;
  try {
    members = await trackerChat.listMembers(user, board.google_chat_space_name);
  } catch (error) {
    logger.warn({ err: error.message }, '[tracker] space members unavailable');
    return { members: [], available: false };
  }
  const emails = members.map((m) => m.email);
  const accounts = new Map();
  if (emails.length) {
    const [rows] = await pool.query(
      `SELECT id, name, LOWER(email) AS email FROM users
        WHERE LOWER(email) IN (?) AND entity_id = ? AND status = 'active' AND deleted_at IS NULL`,
      [emails, board.entity_id]
    );
    for (const row of rows) accounts.set(row.email, row);
  }
  return {
    available: true,
    members: members
      .map((m) => ({
        email: m.email,
        name: accounts.get(m.email)?.name || m.name || m.email,
        userId: accounts.get(m.email) ? Number(accounts.get(m.email).id) : null,
        role: m.role,
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  };
}

function projectBase(board, columns, counts) {
  return {
    id: Number(board.id),
    spaceName: board.google_chat_space_name,
    spaceId: M.spaceIdOf(board.google_chat_space_name),
    name: board.name,
    key: board.project_key,
    departmentId: board.department_id != null ? Number(board.department_id) : null,
    postUpdatesToSpace: Boolean(board.post_updates_to_space),
    columns: columns || [],
    counts: counts || M.mapCounts(),
  };
}

async function buildProject(user, board) {
  const ids = [Number(board.id)];
  const [columns, counts, sprints, members] = await Promise.all([
    columnsOf(ids), countsOf(ids), sprintsOf(ids), membersOf(user, board),
  ]);
  return {
    ...projectBase(board, columns.get(ids[0]), counts.get(ids[0])),
    sprints: sprints.get(ids[0]) || [],
    members: members.members,
    membersAvailable: members.available,
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function listProjects(user) {
  const [boards] = await pool.query(
    `SELECT ${PROJECT_COLUMNS}
       FROM boards
      WHERE entity_id = ? AND deleted_at IS NULL
        AND project_key IS NOT NULL AND google_chat_space_name IS NOT NULL
      ORDER BY name ASC, id ASC
      LIMIT 200`,
    [user.entityId]
  );
  const visible = (await mapLimit(boards, 4, async (board) => {
    try {
      await trackerChat.assertMember(user, board.google_chat_space_name);
      return board;
    } catch (error) {
      if (error?.status === 403 && error?.code === 'FORBIDDEN') return null;
      throw error;
    }
  })).filter(Boolean);

  const ids = visible.map((b) => Number(b.id));
  const [columns, counts, sprints] = await Promise.all([columnsOf(ids), countsOf(ids), sprintsOf(ids)]);
  return {
    projects: visible.map((board) => {
      const own = sprints.get(Number(board.id)) || [];
      const active = own.find((s) => s.status === 'active') || null;
      return {
        ...projectBase(board, columns.get(Number(board.id)), counts.get(Number(board.id))),
        activeSprint: active,
        // Sprints that can still be edited (active and planned), for whoever needs their ids.
        openSprints: own.filter((s) => s.status !== 'completed'),
        updatedAt: M.iso(board.updated_ts),
      };
    }),
  };
}

async function findSpaceProject(entityId, spaceName, db = pool, { lock = false } = {}) {
  const [rows] = await db.query(
    `SELECT ${PROJECT_COLUMNS}
       FROM boards
      WHERE entity_id = ? AND google_chat_space_name = ? AND deleted_at IS NULL
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [entityId, spaceName]
  );
  return rows[0] || null;
}

async function getSpaceProject(user, spaceId) {
  const spaceName = M.spaceNameFromId(spaceId);
  const space = await trackerChat.assertMember(user, spaceName);
  const board = await findSpaceProject(user.entityId, spaceName);
  if (!board || !board.project_key) {
    return {
      enabled: false,
      space: { name: spaceName, displayName: space.displayName, spaceType: space.spaceType },
    };
  }
  return { enabled: true, project: await buildProject(user, board) };
}

// ---------------------------------------------------------------------------
// Project mutations
// ---------------------------------------------------------------------------
async function keyTaken(db, entityId, key, exceptBoardId = null) {
  const [rows] = await db.query(
    `SELECT id FROM boards
      WHERE entity_id = ? AND project_key = ? AND deleted_at IS NULL
        AND (? IS NULL OR id <> ?)
      LIMIT 1`,
    [entityId, key, exceptBoardId, exceptBoardId]
  );
  return Boolean(rows[0]);
}

async function uniqueAutoKey(db, entityId, base) {
  if (!(await keyTaken(db, entityId, base))) return base;
  for (let n = 2; n < 100; n += 1) {
    const suffix = String(n);
    const candidate = `${base.slice(0, 10 - suffix.length)}${suffix}`;
    if (!(await keyTaken(db, entityId, candidate))) return candidate;
  }
  throw M.conflict('KEY_TAKEN', 'Tidak dapat membuat key project unik. Isi key secara manual.');
}

async function enableProject(user, spaceId, body = {}) {
  const spaceName = M.spaceNameFromId(spaceId);
  const requestedKey = M.has(body, 'key') && body.key !== null && body.key !== '' ? M.keyValue(body.key) : null;
  const postUpdates = M.has(body, 'postUpdatesToSpace') ? M.booleanValue(body.postUpdatesToSpace, 'postUpdatesToSpace') : true;

  const space = await trackerChat.assertMember(user, spaceName);
  if (space.spaceType !== 'SPACE') {
    throw M.invalid('Project tracker hanya tersedia untuk space (bukan pesan langsung atau grup).');
  }

  const conn = await pool.getConnection();
  let boardId;
  try {
    await conn.beginTransaction();
    const existing = await findSpaceProject(user.entityId, spaceName, conn, { lock: true });
    if (existing?.project_key) throw M.conflict('PROJECT_EXISTS', 'Project tracker sudah aktif untuk space ini');

    let key;
    if (requestedKey) {
      if (await keyTaken(conn, user.entityId, requestedKey)) throw M.conflict('KEY_TAKEN', `Key ${requestedKey} sudah dipakai project lain`);
      key = requestedKey;
    } else {
      key = await uniqueAutoKey(conn, user.entityId, M.autoKey(space.displayName));
    }

    if (existing) {
      // A task board already linked to this space becomes its project.
      boardId = Number(existing.id);
      const [tasks] = await conn.query(
        `SELECT id FROM tasks WHERE board_id = ? AND deleted_at IS NULL AND issue_number IS NULL ORDER BY id ASC`,
        [boardId]
      );
      const [[{ maxNumber }]] = await conn.query(
        'SELECT COALESCE(MAX(issue_number), 0) AS maxNumber FROM tasks WHERE board_id = ?', [boardId]
      );
      let seq = Number(maxNumber);
      for (const task of tasks) {
        seq += 1;
        await conn.query('UPDATE tasks SET issue_number = ?, updated_at = updated_at WHERE id = ?', [seq, task.id]);
      }
      await conn.query(
        `UPDATE boards SET project_key = ?, post_updates_to_space = ?, issue_seq = GREATEST(issue_seq, ?),
                department_id = COALESCE(department_id, ?) WHERE id = ?`,
        [key, postUpdates ? 1 : 0, seq, user.departmentId || null, boardId]
      );
    } else {
      const name = String(space.displayName || key).trim().slice(0, M.LIMITS.projectName) || key;
      const [result] = await conn.query(
        `INSERT INTO boards
           (entity_id, department_id, name, description, created_by,
            google_chat_space_name, google_chat_space_url, project_key, post_updates_to_space)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        [user.entityId, user.departmentId || null, name, user.sub, spaceName, `https://chat.google.com/room/${M.spaceIdOf(spaceName)}`, key, postUpdates ? 1 : 0]
      );
      boardId = Number(result.insertId);
      for (const [index, column] of DEFAULT_COLUMNS.entries()) {
        await conn.query(
          'INSERT INTO board_columns (board_id, name, position, category) VALUES (?, ?, ?, ?)',
          [boardId, column.name, index, column.category]
        );
      }
    }
    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (error?.code === 'ER_DUP_ENTRY') throw M.conflict('PROJECT_EXISTS', 'Project tracker sudah aktif untuk space ini');
    throw error;
  } finally {
    conn.release();
  }

  const board = await loadProject(boardId);
  await logProjectActivity(user, board, 'tracker.project_enabled', { key: board.project_key, spaceName });
  emit('project.updated', board, user);
  return { project: await buildProject(user, board) };
}

function normalizeColumns(value) {
  if (!Array.isArray(value)) throw M.invalid('columns harus berupa daftar');
  if (!value.length) throw M.invalid('Minimal 1 kolom');
  if (value.length > M.LIMITS.maxColumns) throw M.invalid(`Maksimal ${M.LIMITS.maxColumns} kolom`);
  const seenIds = new Set();
  return value.map((col) => {
    if (!col || typeof col !== 'object') throw M.invalid('Kolom tidak valid');
    const id = M.optionalPositiveInt(col.id, 'columns.id');
    if (id && seenIds.has(id)) throw M.invalid('columns.id duplikat');
    if (id) seenIds.add(id);
    let wipLimit = null;
    if (col.wipLimit !== undefined && col.wipLimit !== null && col.wipLimit !== '') {
      const n = Number(col.wipLimit);
      if (!Number.isInteger(n) || n < 1 || n > M.LIMITS.wipMax) throw M.invalid(`wipLimit harus 1–${M.LIMITS.wipMax}`);
      wipLimit = n;
    }
    return {
      id,
      name: M.text(col.name, 'Nama kolom', { max: M.LIMITS.columnName }),
      category: M.enumValue(col.category, M.CATEGORIES, 'category'),
      wipLimit,
    };
  });
}

async function applyColumns(conn, user, board, columns) {
  const [existingRows] = await conn.query(
    'SELECT id, name, category FROM board_columns WHERE board_id = ? FOR UPDATE', [board.id]
  );
  const existing = new Map(existingRows.map((row) => [Number(row.id), row]));
  for (const col of columns) {
    if (col.id && !existing.has(col.id)) throw M.invalid('Kolom tidak ditemukan di project ini');
  }
  const keep = new Set(columns.filter((c) => c.id).map((c) => c.id));
  const removed = [...existing.keys()].filter((id) => !keep.has(id));
  if (removed.length) {
    const [[{ busy }]] = await conn.query(
      'SELECT COUNT(*) AS busy FROM tasks WHERE column_id IN (?) AND deleted_at IS NULL', [removed]
    );
    if (Number(busy) > 0) throw M.conflict('COLUMN_NOT_EMPTY', 'Pindahkan semua issue dari kolom yang dihapus terlebih dahulu');
    await conn.query('UPDATE tasks SET column_id = NULL, updated_at = updated_at WHERE column_id IN (?)', [removed]);
    await conn.query('DELETE FROM board_columns WHERE id IN (?) AND board_id = ?', [removed, board.id]);
  }

  for (const [position, col] of columns.entries()) {
    if (!col.id) {
      await conn.query(
        'INSERT INTO board_columns (board_id, name, position, wip_limit, category) VALUES (?, ?, ?, ?, ?)',
        [board.id, col.name, position, col.wipLimit, col.category]
      );
      continue;
    }
    const before = existing.get(col.id);
    await conn.query(
      'UPDATE board_columns SET name = ?, position = ?, wip_limit = ?, category = ? WHERE id = ? AND board_id = ?',
      [col.name, position, col.wipLimit, col.category, col.id, board.id]
    );
    if (before.category === col.category) continue;

    // Issues follow their column's new category (status, completion).
    await conn.query(
      `INSERT INTO task_activity (task_id, entity_id, actor_user_id, event, metadata_json)
       SELECT id, entity_id, ?, 'tracker.status_changed', ?
         FROM tasks WHERE column_id = ? AND deleted_at IS NULL`,
      [user.sub, JSON.stringify({ from: before.category, to: col.category, reason: 'column_category' }), col.id]
    );
    if (col.category === 'done') {
      await conn.query(
        `UPDATE tasks SET status = 'done', progress_percent = 100,
                completed_at = COALESCE(completed_at, NOW()), completed_by = COALESCE(completed_by, ?)
          WHERE column_id = ? AND deleted_at IS NULL`,
        [user.sub, col.id]
      );
    } else {
      await conn.query(
        `UPDATE tasks SET status = ?,
                progress_percent = IF(completed_at IS NULL, progress_percent, 0),
                completed_at = NULL, completed_by = NULL
          WHERE column_id = ? AND deleted_at IS NULL`,
        [M.STATUS_FOR_CATEGORY[col.category], col.id]
      );
    }
  }
}

async function updateProject(user, projectId, body = {}) {
  const board = await accessProject(user, projectId);
  const sets = [];
  const args = [];
  const fields = [];
  if (M.has(body, 'name')) {
    sets.push('name = ?'); args.push(M.text(body.name, 'name', { max: M.LIMITS.projectName })); fields.push('name');
  }
  let key = null;
  if (M.has(body, 'key')) {
    key = M.keyValue(body.key);
    if (key !== board.project_key) { sets.push('project_key = ?'); args.push(key); fields.push('key'); }
  }
  if (M.has(body, 'departmentId')) {
    const departmentId = body.departmentId === null || body.departmentId === '' ? null : M.positiveInt(body.departmentId, 'departmentId');
    sets.push('department_id = ?'); args.push(departmentId); fields.push('departmentId');
  }
  if (M.has(body, 'postUpdatesToSpace')) {
    sets.push('post_updates_to_space = ?');
    args.push(M.booleanValue(body.postUpdatesToSpace, 'postUpdatesToSpace') ? 1 : 0);
    fields.push('postUpdatesToSpace');
  }
  const columns = M.has(body, 'columns') ? normalizeColumns(body.columns) : null;
  if (columns) fields.push('columns');
  if (!fields.length) throw M.invalid('Tidak ada perubahan');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await loadProject(board.id, conn, { lock: true });
    if (fields.includes('key') && await keyTaken(conn, board.entity_id, key, board.id)) {
      throw M.conflict('KEY_TAKEN', `Key ${key} sudah dipakai project lain`);
    }
    if (sets.length) {
      await conn.query(`UPDATE boards SET ${sets.join(', ')} WHERE id = ?`, [...args, board.id]);
    }
    if (columns) await applyColumns(conn, user, board, columns);
    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }

  const fresh = await loadProject(board.id);
  await logProjectActivity(user, fresh, 'tracker.project_updated', { fields });
  emit('project.updated', fresh, user);
  return { project: await buildProject(user, fresh) };
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------
function escapeLike(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

async function listIssues(user, projectId, query = {}) {
  const board = await accessProject(user, projectId);
  const where = ['t.board_id = ?', 't.deleted_at IS NULL'];
  const args = [board.id];
  const one = (value) => (Array.isArray(value) ? value[0] : value);

  const sprint = one(query.sprint);
  if (sprint !== undefined && sprint !== '' && sprint !== 'all') {
    if (sprint === 'active') {
      where.push(`t.sprint_id = (SELECT s.id FROM tracker_sprints s WHERE s.board_id = ? AND s.status = 'active' ORDER BY s.id DESC LIMIT 1)`);
      args.push(board.id);
    } else if (sprint === 'backlog') {
      where.push('t.sprint_id IS NULL');
    } else {
      where.push('t.sprint_id = ?'); args.push(M.positiveInt(sprint, 'sprint'));
    }
  }

  const q = one(query.q);
  if (q !== undefined && q !== '') {
    if (typeof q !== 'string' || q.length > M.LIMITS.query) throw M.invalid('q tidak valid');
    const term = q.trim();
    if (term) {
      const numberMatch = /^(?:([A-Za-z0-9]{2,10})-)?(\d{1,9})$/.exec(term);
      if (numberMatch && (!numberMatch[1] || numberMatch[1].toUpperCase() === board.project_key)) {
        where.push('(t.issue_number = ? OR t.title LIKE ?)');
        args.push(Number(numberMatch[2]), `%${escapeLike(term)}%`);
      } else {
        where.push('t.title LIKE ?'); args.push(`%${escapeLike(term)}%`);
      }
    }
  }

  const assignee = one(query.assignee);
  if (assignee !== undefined && assignee !== '') {
    if (assignee === 'me') {
      where.push('(t.assignee_id = ? OR LOWER(t.assignee_email) = ?)'); args.push(user.sub, M.lower(user.email));
    } else if (assignee === 'none') {
      where.push('t.assignee_id IS NULL AND t.assignee_email IS NULL');
    } else {
      const email = M.emailValue(assignee, 'assignee');
      where.push('(LOWER(t.assignee_email) = ? OR ua.email = ?)'); args.push(email, email);
    }
  }

  const type = one(query.type);
  if (type !== undefined && type !== '') { where.push('t.issue_type = ?'); args.push(M.enumValue(type, M.ISSUE_TYPES, 'type')); }
  const priority = one(query.priority);
  if (priority !== undefined && priority !== '') { where.push('t.priority = ?'); args.push(M.enumValue(priority, M.PRIORITIES, 'priority')); }
  const label = one(query.label);
  if (label !== undefined && label !== '') {
    const [clean] = M.labelsValue([label]);
    if (!clean) throw M.invalid('label tidak valid');
    where.push('JSON_CONTAINS(t.labels, JSON_QUOTE(?))'); args.push(clean);
  }

  return { issues: await fetchIssues(where.join(' AND '), args, board) };
}

async function resolveAssignee(user, board, email) {
  if (email === null) return { email: null, userId: null, name: null };
  const members = await trackerChat.listMembers(user, board.google_chat_space_name);
  const member = members.find((m) => m.email === email);
  if (!member) throw M.invalid('assigneeEmail bukan anggota space ini');
  const [rows] = await pool.query(
    `SELECT id, name FROM users
      WHERE LOWER(email) = ? AND entity_id = ? AND status = 'active' AND deleted_at IS NULL
      LIMIT 1`,
    [email, board.entity_id]
  );
  return { email, userId: rows[0] ? Number(rows[0].id) : null, name: rows[0]?.name || member.name };
}

async function columnOf(db, board, columnId) {
  const [rows] = await db.query(
    'SELECT id, name, category FROM board_columns WHERE id = ? AND board_id = ? LIMIT 1', [columnId, board.id]
  );
  if (!rows[0]) throw M.invalid('columnId tidak valid untuk project ini');
  return rows[0];
}

async function firstColumn(db, board, category) {
  const [rows] = await db.query(
    `SELECT id, name, category FROM board_columns
      WHERE board_id = ? ${category ? 'AND category = ?' : ''}
      ORDER BY position ASC, id ASC LIMIT 1`,
    category ? [board.id, category] : [board.id]
  );
  return rows[0] || null;
}

async function validateSprint(db, board, sprintId) {
  if (sprintId === null) return null;
  const [rows] = await db.query(
    'SELECT id, status FROM tracker_sprints WHERE id = ? AND board_id = ? LIMIT 1', [sprintId, board.id]
  );
  if (!rows[0]) throw M.invalid('sprintId tidak valid untuk project ini');
  if (rows[0].status === 'completed') throw M.invalid('Sprint sudah selesai');
  return sprintId;
}

async function validateParent(db, board, parentId, selfId = null) {
  if (parentId === null) return null;
  if (selfId && parentId === selfId) throw M.invalid('Issue tidak bisa menjadi induk dirinya sendiri');
  const [rows] = await db.query(
    'SELECT id, board_id, parent_id FROM tasks WHERE id = ? AND deleted_at IS NULL LIMIT 1', [parentId]
  );
  if (!rows[0] || Number(rows[0].board_id) !== Number(board.id)) throw M.invalid('parentId tidak valid untuk project ini');
  if (selfId) {
    let cursor = rows[0].parent_id;
    for (let depth = 0; cursor && depth < 20; depth += 1) {
      if (Number(cursor) === Number(selfId)) throw M.invalid('parentId membuat relasi melingkar');
      const [up] = await db.query('SELECT parent_id FROM tasks WHERE id = ? LIMIT 1', [cursor]);
      cursor = up[0]?.parent_id || null;
    }
  }
  return parentId;
}

async function lockColumns(db, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(Number))].sort((a, b) => a - b);
  if (unique.length) await db.query('SELECT id FROM board_columns WHERE id IN (?) ORDER BY id FOR UPDATE', [unique]);
}

async function writePositions(db, order, current) {
  const changes = order.map((id, index) => [Number(id), index]).filter(([id, index]) => current.get(id) !== index);
  if (!changes.length) return;
  const cases = changes.map(() => 'WHEN ? THEN ?').join(' ');
  await db.query(
    `UPDATE tasks SET position = CASE id ${cases} END, updated_at = updated_at WHERE id IN (?)`,
    [...changes.flat(), changes.map(([id]) => id)]
  );
}

// Deterministic drag & drop: the column is renumbered 0..n-1 with the moved
// issue at `index` (append when null); ties are broken by id.
async function placeInColumn(db, columnId, issueId, index) {
  const [rows] = await db.query(
    `SELECT id, position FROM tasks
      WHERE column_id = ? AND deleted_at IS NULL AND id <> ?
      ORDER BY position ASC, id ASC`,
    [columnId, issueId]
  );
  const current = new Map(rows.map((r) => [Number(r.id), Number(r.position)]));
  await writePositions(db, M.placeAt(rows.map((r) => r.id), issueId, index), current);
}

async function compactColumn(db, columnId) {
  const [rows] = await db.query(
    'SELECT id, position FROM tasks WHERE column_id = ? AND deleted_at IS NULL ORDER BY position ASC, id ASC',
    [columnId]
  );
  const current = new Map(rows.map((r) => [Number(r.id), Number(r.position)]));
  await writePositions(db, rows.map((r) => Number(r.id)), current);
}

function normalizeIssueInput(body, { create = false } = {}) {
  const out = {};
  if (create || M.has(body, 'title')) out.title = M.text(body.title, 'title', { max: M.LIMITS.title });
  if (M.has(body, 'description')) {
    out.description = body.description === null ? null
      : M.text(body.description, 'description', { min: 0, max: M.LIMITS.description, trim: false });
  }
  if (M.has(body, 'type')) out.type = M.enumValue(body.type, M.ISSUE_TYPES, 'type');
  if (M.has(body, 'priority')) out.priority = M.enumValue(body.priority, M.PRIORITIES, 'priority');
  if (M.has(body, 'assigneeEmail')) out.assigneeEmail = M.emailValue(body.assigneeEmail);
  if (M.has(body, 'startDate')) out.startDate = M.dateValue(body.startDate, 'startDate');
  if (M.has(body, 'dueDate')) out.dueDate = M.dateValue(body.dueDate, 'dueDate');
  if (M.has(body, 'storyPoints')) out.storyPoints = M.storyPointsValue(body.storyPoints);
  if (M.has(body, 'labels')) out.labels = M.labelsValue(body.labels);
  if (M.has(body, 'sprintId')) out.sprintId = M.optionalPositiveInt(body.sprintId, 'sprintId');
  if (M.has(body, 'parentId')) out.parentId = M.optionalPositiveInt(body.parentId, 'parentId');
  if (M.has(body, 'columnId')) {
    if (!create && (body.columnId === null || body.columnId === undefined)) throw M.invalid('columnId tidak valid');
    out.columnId = M.optionalPositiveInt(body.columnId, 'columnId');
  }
  if (!create && M.has(body, 'status')) out.status = M.enumValue(body.status, M.CATEGORIES, 'status');
  if (!create && M.has(body, 'position')) {
    const n = Number(body.position);
    if (!Number.isInteger(n) || n < 0 || n > 100000 || typeof body.position === 'boolean') throw M.invalid('position tidak valid');
    out.position = n;
  }
  // Only checkable when both arrive together; a partial patch is validated
  // against the stored row in updateIssue instead.
  if (out.startDate && out.dueDate && out.startDate > out.dueDate) {
    throw M.invalid('startDate harus sebelum atau sama dengan dueDate');
  }
  return out;
}

async function createIssue(user, projectId, body = {}) {
  const board = await accessProject(user, projectId);
  const input = normalizeIssueInput(body, { create: true });
  const assignee = input.assigneeEmail ? await resolveAssignee(user, board, input.assigneeEmail) : null;

  const conn = await pool.getConnection();
  let issueId;
  let number;
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE boards SET issue_seq = LAST_INSERT_ID(issue_seq + 1) WHERE id = ?', [board.id]);
    const [[seqRow]] = await conn.query('SELECT LAST_INSERT_ID() AS n');
    number = Number(seqRow.n);

    const column = input.columnId
      ? await columnOf(conn, board, input.columnId)
      : (await firstColumn(conn, board, 'todo')) || (await firstColumn(conn, board, null));
    if (!column) throw M.invalid('Project belum punya kolom status');
    await lockColumns(conn, [column.id]);
    if (column.category !== 'done') {
      await taskService.enforceWipLimit({ columnId: column.id, entityId: board.entity_id }, conn);
    }
    const sprintId = await validateSprint(conn, board, input.sprintId ?? null);
    const parentId = await validateParent(conn, board, input.parentId ?? null);
    const [[{ nextPosition }]] = await conn.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS nextPosition FROM tasks WHERE column_id = ? AND deleted_at IS NULL',
      [column.id]
    );
    const done = column.category === 'done';

    const [result] = await conn.query(
      `INSERT INTO tasks
         (entity_id, department_id, board_id, column_id, title, description, status, priority,
          assignee_id, assignee_email, reporter_id, start_date, due_date, progress_percent,
          completed_at, completed_by, source_type, position,
          issue_number, issue_type, story_points, labels, sprint_id, parent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${done ? 'NOW()' : 'NULL'}, ?, 'tracker', ?, ?, ?, ?, ?, ?, ?)`,
      [
        board.entity_id, board.department_id || null, board.id, column.id,
        input.title, input.description ?? null, M.STATUS_FOR_CATEGORY[column.category], input.priority || 'normal',
        assignee?.userId || null, assignee?.email || null, user.sub, input.startDate ?? null, input.dueDate ?? null, done ? 100 : 0,
        done ? user.sub : null, Number(nextPosition),
        number, input.type || 'task', input.storyPoints ?? null,
        input.labels?.length ? JSON.stringify(input.labels) : null, sprintId, parentId,
      ]
    );
    issueId = Number(result.insertId);

    await watcherSvc.autoAdd({ taskId: issueId, entityId: board.entity_id, userId: user.sub, createdBy: user.sub }, conn);
    if (assignee?.userId && assignee.userId !== Number(user.sub)) {
      await watcherSvc.autoAdd({ taskId: issueId, entityId: board.entity_id, userId: assignee.userId, createdBy: user.sub }, conn);
    }
    await taskActivity.record({
      taskId: issueId, entityId: board.entity_id, actorUserId: user.sub, event: 'tracker.issue_created',
      metadata: {
        key: M.issueKey(board.project_key, number), type: input.type || 'task',
        columnId: Number(column.id), assigneeEmail: assignee?.email || null, sprintId,
      },
    }, conn);
    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }

  const issue = await fetchIssue(issueId, board);
  emit('issue.created', board, user, issueId);
  announce(user, board, issue, [{ kind: 'created', assigneeName: assignee?.name || null }]);
  if (assignee?.userId) notifyAssignee(user, board, issue);
  return { issue };
}

// ---------------------------------------------------------------------------
// System issues: IT tickets (itTracker.service). The requester is usually not
// a member of the IT Space, so these skip the Chat membership check; the board
// is still bound to the ticket's company. No WIP limit: a ticket never fails
// because a column is full.
// ---------------------------------------------------------------------------
async function createSystemIssue(board, { title, description = null, priority = 'normal', reporterId = null, labels = [] }, db = null) {
  const conn = db || await pool.getConnection();
  const own = !db;
  try {
    if (own) await conn.beginTransaction();
    await conn.query('UPDATE boards SET issue_seq = LAST_INSERT_ID(issue_seq + 1) WHERE id = ?', [board.id]);
    const [[seqRow]] = await conn.query('SELECT LAST_INSERT_ID() AS n');
    const number = Number(seqRow.n);
    const column = (await firstColumn(conn, board, 'todo')) || (await firstColumn(conn, board, null));
    if (!column) throw M.invalid('Project belum punya kolom status');
    await lockColumns(conn, [column.id]);
    const [[{ nextPosition }]] = await conn.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS nextPosition FROM tasks WHERE column_id = ? AND deleted_at IS NULL',
      [column.id]
    );
    const [result] = await conn.query(
      `INSERT INTO tasks
         (entity_id, department_id, board_id, column_id, title, description, status, priority,
          reporter_id, progress_percent, source_type, position, issue_number, issue_type, labels)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'tracker', ?, ?, 'task', ?)`,
      [
        board.entity_id, board.department_id || null, board.id, column.id,
        String(title).slice(0, 255), description, M.STATUS_FOR_CATEGORY[column.category], priority,
        reporterId, Number(nextPosition), number, labels.length ? JSON.stringify(labels) : null,
      ]
    );
    const issueId = Number(result.insertId);
    await taskActivity.record({
      taskId: issueId, entityId: board.entity_id, actorUserId: reporterId, event: 'tracker.issue_created',
      metadata: { key: M.issueKey(board.project_key, number), type: 'task', columnId: Number(column.id), source: 'it_ticket' },
    }, conn);
    if (own) await conn.commit();
    return { id: issueId, number, key: M.issueKey(board.project_key, number) };
  } catch (error) {
    if (own) { try { await conn.rollback(); } catch { /* noop */ } }
    throw error;
  } finally {
    if (own) conn.release();
  }
}

// Moves a system-linked issue to the first column of a category (todo,
// in_progress, done). No-op when it already sits in that category.
async function moveSystemIssue(issueId, category, actorUserId = null) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[task]] = await conn.query('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [issueId]);
    if (!task?.board_id) { await conn.rollback(); return false; }
    const board = await loadProject(task.board_id, conn);
    if (!board) { await conn.rollback(); return false; }
    const from = task.column_id ? await columnOf(conn, board, task.column_id).catch(() => null) : null;
    if (from?.category === category) { await conn.rollback(); return false; }
    const to = await firstColumn(conn, board, category);
    if (!to) { await conn.rollback(); return false; }
    await lockColumns(conn, [task.column_id, to.id]);
    const [[{ nextPosition }]] = await conn.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS nextPosition FROM tasks WHERE column_id = ? AND deleted_at IS NULL',
      [to.id]
    );
    const done = category === 'done';
    await conn.query(
      `UPDATE tasks SET column_id = ?, status = ?, position = ?, progress_percent = ?,
              completed_at = ${done ? 'COALESCE(completed_at, NOW())' : 'NULL'}, completed_by = ?
        WHERE id = ?`,
      [to.id, M.STATUS_FOR_CATEGORY[category], Number(nextPosition), done ? 100 : 0, done ? actorUserId : null, issueId]
    );
    if (task.column_id) await compactColumn(conn, task.column_id);
    await taskActivity.record({
      taskId: issueId, entityId: board.entity_id, actorUserId, event: 'tracker.issue_moved',
      metadata: { fromColumnId: task.column_id || null, toColumnId: Number(to.id), from: from?.name || null, to: to.name, source: 'it_ticket' },
    }, conn);
    await conn.commit();
    emit('issue.updated', board, { sub: actorUserId || 0 }, issueId);
    return true;
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }
}

async function getIssue(user, issueId) {
  const { board, issue: basic } = await accessIssue(user, issueId);
  const issue = await fetchIssue(basic.id, board);
  const [[comments], [activity], children] = await Promise.all([
    pool.query(
      `SELECT c.id, c.user_id, u.name AS user_name, c.body, UNIX_TIMESTAMP(c.created_at) AS created_ts
         FROM task_comments c LEFT JOIN users u ON u.id = c.user_id
        WHERE c.task_id = ? ORDER BY c.id ASC LIMIT 500`,
      [basic.id]
    ),
    pool.query(
      `SELECT a.id, a.actor_user_id, u.name AS actor_name, a.event, a.metadata_json,
              UNIX_TIMESTAMP(a.created_at) AS created_ts
         FROM task_activity a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.task_id = ? ORDER BY a.id DESC LIMIT ${ACTIVITY_LIMIT}`,
      [basic.id]
    ),
    fetchIssues('t.parent_id = ? AND t.deleted_at IS NULL', [basic.id], board, { limit: 200 }),
  ]);
  return {
    issue: {
      ...issue,
      comments: comments.map(mapComment),
      activity: activity.map((row) => ({
        id: Number(row.id),
        actor: row.actor_user_id ? { userId: Number(row.actor_user_id), name: row.actor_name || 'Pengguna' } : null,
        event: row.event,
        metadata: parseJson(row.metadata_json),
        createdAt: M.iso(row.created_ts),
      })),
      children,
    },
  };
}

function parseJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function mapComment(row) {
  return {
    id: Number(row.id),
    author: { userId: Number(row.user_id), name: row.user_name || 'Pengguna' },
    body: row.body,
    createdAt: M.iso(row.created_ts),
  };
}

const sameLabels = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

async function updateIssue(user, issueId, body = {}) {
  const { board, issue: basic } = await accessIssue(user, issueId);
  const input = normalizeIssueInput(body);
  if (!Object.keys(input).length) throw M.invalid('Tidak ada perubahan');

  const currentEmail = M.lower(basic.assignee_email) || null;
  let assignee = null;
  if (M.has(input, 'assigneeEmail') && input.assigneeEmail !== currentEmail) {
    assignee = await resolveAssignee(user, board, input.assigneeEmail);
  }

  const id = Number(basic.id);
  const conn = await pool.getConnection();
  const activity = [];
  const announcements = [];
  let changed = false;
  let movedToCategory = null;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [id]);
    const task = rows[0];
    if (!task || Number(task.board_id) !== Number(board.id)) throw M.notFound('Issue tidak ditemukan');

    const fromColumn = task.column_id ? await columnOf(conn, board, task.column_id).catch(() => null) : null;
    let toColumn = fromColumn;
    if (M.has(input, 'columnId')) {
      toColumn = await columnOf(conn, board, input.columnId);
    } else if (M.has(input, 'status') && fromColumn?.category !== input.status) {
      toColumn = await firstColumn(conn, board, input.status);
      if (!toColumn) throw M.invalid('Tidak ada kolom dengan status tersebut');
    }
    if (!toColumn) toColumn = (await firstColumn(conn, board, 'todo')) || (await firstColumn(conn, board, null));
    const columnChanged = Number(toColumn?.id || 0) !== Number(task.column_id || 0);

    await lockColumns(conn, [task.column_id, toColumn?.id]);
    if (columnChanged && toColumn && toColumn.category !== 'done') {
      await taskService.enforceWipLimit({ columnId: toColumn.id, entityId: board.entity_id, ignoreTaskId: id }, conn);
    }

    const sets = [];
    const args = [];
    const fields = [];
    const set = (column, value, field) => { sets.push(`${column} = ?`); args.push(value); if (field) fields.push(field); };

    if (M.has(input, 'title') && input.title !== task.title) set('title', input.title, 'title');
    if (M.has(input, 'description') && (input.description || null) !== (task.description || null)) set('description', input.description, 'description');
    if (M.has(input, 'type') && input.type !== task.issue_type) set('issue_type', input.type, 'type');
    if (M.has(input, 'priority') && input.priority !== task.priority) set('priority', input.priority, 'priority');
    const nextStart = M.has(input, 'startDate') ? input.startDate : M.dateString(task.start_date);
    const nextDue = M.has(input, 'dueDate') ? input.dueDate : M.dateString(task.due_date);
    if (nextStart && nextDue && nextStart > nextDue) {
      throw M.invalid('startDate harus sebelum atau sama dengan dueDate');
    }
    if (M.has(input, 'startDate') && input.startDate !== M.dateString(task.start_date)) set('start_date', input.startDate, 'startDate');
    if (M.has(input, 'dueDate') && input.dueDate !== M.dateString(task.due_date)) set('due_date', input.dueDate, 'dueDate');
    if (M.has(input, 'storyPoints') && input.storyPoints !== (task.story_points === null ? null : Number(task.story_points))) {
      set('story_points', input.storyPoints, 'storyPoints');
    }
    if (M.has(input, 'labels') && !sameLabels(input.labels, M.parseLabels(task.labels))) {
      set('labels', input.labels.length ? JSON.stringify(input.labels) : null, 'labels');
    }
    if (M.has(input, 'parentId') && input.parentId !== (task.parent_id ? Number(task.parent_id) : null)) {
      set('parent_id', await validateParent(conn, board, input.parentId, id), 'parentId');
    }

    if (M.has(input, 'sprintId') && input.sprintId !== (task.sprint_id ? Number(task.sprint_id) : null)) {
      set('sprint_id', await validateSprint(conn, board, input.sprintId));
      activity.push({ event: 'tracker.sprint_changed', metadata: { from: task.sprint_id || null, to: input.sprintId } });
    }

    if (assignee) {
      set('assignee_id', assignee.userId);
      set('assignee_email', assignee.email);
      const previous = currentEmail || task.assignee_id || null;
      const event = assignee.email === null ? 'tracker.unassigned' : previous ? 'tracker.reassigned' : 'tracker.assigned';
      activity.push({ event, metadata: { from: currentEmail, to: assignee.email } });
      if (assignee.email) announcements.push({ kind: 'assigned', assigneeName: assignee.name });
    }

    if (columnChanged && toColumn) {
      if (fromColumn?.category !== toColumn.category) movedToCategory = toColumn.category;
      set('column_id', toColumn.id);
      set('status', M.STATUS_FOR_CATEGORY[toColumn.category]);
      const wasDone = fromColumn?.category === 'done';
      const willBeDone = toColumn.category === 'done';
      if (!wasDone && willBeDone) {
        sets.push('completed_at = NOW()');
        set('completed_by', user.sub);
        set('progress_percent', 100);
      } else if (wasDone && !willBeDone) {
        sets.push('completed_at = NULL', 'completed_by = NULL');
        set('progress_percent', 0);
      }
      activity.push({
        event: 'tracker.issue_moved',
        metadata: { fromColumnId: task.column_id || null, toColumnId: Number(toColumn.id), from: fromColumn?.name || null, to: toColumn.name },
      });
      if ((fromColumn?.category || 'todo') !== toColumn.category) {
        activity.push({ event: 'tracker.status_changed', metadata: { from: fromColumn?.category || null, to: toColumn.category } });
      }
      if (!wasDone && willBeDone) {
        activity.push({ event: 'tracker.completed', metadata: null });
        announcements.push({ kind: 'completed' });
      } else {
        if (wasDone && !willBeDone) activity.push({ event: 'tracker.reopened', metadata: null });
        announcements.push({ kind: 'status', from: fromColumn?.name || null, to: toColumn.name });
      }
    }

    if (fields.length) activity.push({ event: 'tracker.issue_updated', metadata: { fields } });

    if (sets.length) {
      await conn.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, [...args, id]);
      changed = true;
    }

    if (toColumn && (columnChanged || M.has(input, 'position'))) {
      const before = Number(task.position || 0);
      await placeInColumn(conn, toColumn.id, id, M.has(input, 'position') ? input.position : null);
      if (columnChanged && task.column_id) await compactColumn(conn, task.column_id);
      if (!columnChanged && M.has(input, 'position') && input.position !== before) {
        activity.push({ event: 'tracker.issue_reordered', metadata: { from: before, to: input.position } });
      }
      changed = true;
    }

    for (const entry of activity) {
      await taskActivity.record({ taskId: id, entityId: board.entity_id, actorUserId: user.sub, event: entry.event, metadata: entry.metadata }, conn);
    }
    if (assignee?.userId && assignee.userId !== Number(user.sub)) {
      await watcherSvc.autoAdd({ taskId: id, entityId: board.entity_id, userId: assignee.userId, createdBy: user.sub }, conn);
    }
    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }

  const issue = await fetchIssue(id, board);
  if (changed) {
    emit('issue.updated', board, user, id);
    announce(user, board, issue, announcements);
    if (assignee?.userId) notifyAssignee(user, board, issue);
    // An issue linked to an IT ticket carries its move back to the ticket.
    if (movedToCategory) {
      require('./itTracker.service').onIssueMoved(id, movedToCategory, user).catch((error) => {
        logger.warn({ err: error.message, issueId: id }, '[tracker] IT ticket not updated from issue');
      });
    }
  }
  return { issue };
}

async function deleteIssue(user, issueId) {
  const { board, issue } = await accessIssue(user, issueId);
  const id = Number(issue.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [id]);
    if (!rows[0]) throw M.notFound('Issue tidak ditemukan');
    await taskActivity.record({
      taskId: id, entityId: board.entity_id, actorUserId: user.sub, event: 'tracker.issue_deleted',
      metadata: { key: M.issueKey(board.project_key, issue.issue_number) },
    }, conn);
    await conn.query('UPDATE tasks SET deleted_at = NOW() WHERE id = ?', [id]);
    await conn.query('UPDATE tasks SET parent_id = NULL WHERE parent_id = ?', [id]);
    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }
  emit('issue.deleted', board, user, id);
  return { id, deleted: true };
}

async function addComment(user, issueId, body = {}) {
  const { board, issue } = await accessIssue(user, issueId);
  const text = M.text(body.body, 'body', { max: M.LIMITS.comment });
  const id = Number(issue.id);
  const conn = await pool.getConnection();
  let commentId;
  try {
    await conn.beginTransaction();
    const [result] = await conn.query('INSERT INTO task_comments (task_id, user_id, body) VALUES (?, ?, ?)', [id, user.sub, text]);
    commentId = Number(result.insertId);
    await taskActivity.record({
      taskId: id, entityId: board.entity_id, actorUserId: user.sub, event: 'tracker.comment_added',
      metadata: { commentId, length: text.length },
    }, conn);
    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }

  const [rows] = await pool.query(
    `SELECT c.id, c.user_id, u.name AS user_name, c.body, UNIX_TIMESTAMP(c.created_at) AS created_ts
       FROM task_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
    [commentId]
  );
  emit('comment.created', board, user, id);
  try {
    await notifSvc.notifyTaskUsers({
      task: { id, entity_id: board.entity_id, reporter_id: null, assignee_id: issue.assignee_id },
      actorUserId: user.sub,
      event: 'task.comment',
      title: 'Komentar baru pada issue',
      body: `${M.issueKey(board.project_key, issue.issue_number)}: ${text}`.slice(0, 200),
      actionUrl: `/projects/${M.spaceIdOf(board.google_chat_space_name)}?issue=${id}`,
      includeReporter: false,
    });
  } catch { /* notification is best effort */ }
  return { comment: mapComment(rows[0]) };
}

// ---------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------
async function fetchSprint(board, sprintId) {
  const sprints = await sprintsOf([Number(board.id)], pool, { sprintId });
  return (sprints.get(Number(board.id)) || [])[0] || null;
}

function sprintDates(input, current = {}) {
  const start = M.has(input, 'startDate') ? M.dateValue(input.startDate, 'startDate') : M.dateString(current.start_date);
  const end = M.has(input, 'endDate') ? M.dateValue(input.endDate, 'endDate') : M.dateString(current.end_date);
  if (start && end && start > end) throw M.invalid('startDate harus <= endDate');
  return { start, end };
}

async function createSprint(user, projectId, body = {}) {
  const board = await accessProject(user, projectId);
  const name = M.text(body.name, 'name', { max: M.LIMITS.sprintName });
  const goal = M.has(body, 'goal') ? M.text(body.goal, 'goal', { min: 0, max: M.LIMITS.sprintGoal, allowNull: true }) : null;
  const { start, end } = sprintDates(body);
  const [result] = await pool.query(
    `INSERT INTO tracker_sprints (board_id, name, goal, start_date, end_date, status, created_by)
     VALUES (?, ?, ?, ?, ?, 'planned', ?)`,
    [board.id, name, goal || null, start, end, user.sub]
  );
  const sprintId = Number(result.insertId);
  await logProjectActivity(user, board, 'tracker.sprint_created', { sprintId, name });
  emit('sprint.updated', board, user);
  return { sprint: await fetchSprint(board, sprintId) };
}

async function updateSprint(user, sprintIdParam, body = {}) {
  const sprintId = M.positiveInt(sprintIdParam, 'sprintId');
  const [found] = await pool.query('SELECT id, board_id FROM tracker_sprints WHERE id = ? LIMIT 1', [sprintId]);
  if (!found[0]) throw M.notFound('Sprint tidak ditemukan');
  const board = await accessProject(user, found[0].board_id).catch((error) => {
    if (error?.status === 404) throw M.notFound('Sprint tidak ditemukan');
    throw error;
  });

  const status = M.has(body, 'status') ? M.enumValue(body.status, ['active', 'completed'], 'status') : null;
  let moveTo = 'backlog';
  if (M.has(body, 'moveOpenIssuesTo') && body.moveOpenIssuesTo !== null && body.moveOpenIssuesTo !== 'backlog') {
    moveTo = M.positiveInt(body.moveOpenIssuesTo, 'moveOpenIssuesTo');
    if (moveTo === sprintId) throw M.invalid('moveOpenIssuesTo tidak boleh sprint yang sama');
  }

  const conn = await pool.getConnection();
  const fields = [];
  let movedCount = 0;
  try {
    await conn.beginTransaction();
    await loadProject(board.id, conn, { lock: true });
    const [rows] = await conn.query('SELECT * FROM tracker_sprints WHERE id = ? FOR UPDATE', [sprintId]);
    const sprint = rows[0];
    if (sprint.status === 'completed' && (status || M.has(body, 'startDate') || M.has(body, 'endDate'))) {
      throw M.conflict('SPRINT_COMPLETED', 'Sprint sudah selesai');
    }

    const sets = [];
    const args = [];
    if (M.has(body, 'name')) { sets.push('name = ?'); args.push(M.text(body.name, 'name', { max: M.LIMITS.sprintName })); fields.push('name'); }
    if (M.has(body, 'goal')) {
      sets.push('goal = ?'); args.push(M.text(body.goal, 'goal', { min: 0, max: M.LIMITS.sprintGoal, allowNull: true }) || null); fields.push('goal');
    }
    let { start, end } = sprintDates(body, sprint);
    if (M.has(body, 'startDate')) fields.push('startDate');
    if (M.has(body, 'endDate')) fields.push('endDate');

    if (status === 'active' && sprint.status !== 'active') {
      if (sprint.status !== 'planned') throw M.conflict('INVALID_SPRINT_STATE', 'Sprint tidak bisa dimulai');
      const [active] = await conn.query(
        `SELECT id FROM tracker_sprints WHERE board_id = ? AND status = 'active' AND id <> ? LIMIT 1`, [board.id, sprintId]
      );
      if (active[0]) throw M.conflict('SPRINT_ALREADY_ACTIVE', 'Sudah ada sprint aktif di project ini');
      if (!start) {
        const [[today]] = await conn.query("SELECT DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-%m-%d') AS d");
        start = today.d;
      }
      if (!end) {
        const [[later]] = await conn.query("SELECT DATE_FORMAT(DATE_ADD(?, INTERVAL 14 DAY), '%Y-%m-%d') AS d", [start]);
        end = later.d;
      }
      if (start > end) throw M.invalid('startDate harus <= endDate');
      sets.push("status = 'active'");
      fields.push('status');
    } else if (status === 'completed') {
      if (sprint.status !== 'active') throw M.conflict('INVALID_SPRINT_STATE', 'Hanya sprint aktif yang bisa diselesaikan');
      let target = null;
      if (moveTo !== 'backlog') {
        const [targets] = await conn.query(
          `SELECT id FROM tracker_sprints WHERE id = ? AND board_id = ? AND status = 'planned' LIMIT 1`, [moveTo, board.id]
        );
        if (!targets[0]) throw M.invalid('moveOpenIssuesTo harus sprint yang direncanakan di project ini');
        target = moveTo;
      }
      const openWhere = `sprint_id = ? AND deleted_at IS NULL
        AND (column_id IS NULL OR column_id NOT IN (SELECT id FROM board_columns WHERE board_id = ? AND category = 'done'))`;
      const [open] = await conn.query(`SELECT id FROM tasks WHERE ${openWhere}`, [sprintId, board.id]);
      movedCount = open.length;
      if (movedCount) {
        await conn.query(
          `INSERT INTO task_activity (task_id, entity_id, actor_user_id, event, metadata_json)
           SELECT id, entity_id, ?, 'tracker.sprint_changed', ? FROM tasks WHERE ${openWhere}`,
          [user.sub, JSON.stringify({ from: sprintId, to: target, reason: 'sprint_completed' }), sprintId, board.id]
        );
        await conn.query('UPDATE tasks SET sprint_id = ? WHERE id IN (?)', [target, open.map((r) => r.id)]);
      }
      sets.push("status = 'completed'", 'completed_at = NOW()');
      fields.push('status');
    }

    if (M.has(body, 'startDate') || M.has(body, 'endDate') || status === 'active') {
      sets.push('start_date = ?', 'end_date = ?'); args.push(start, end);
    }
    if (!fields.length) throw M.invalid('Tidak ada perubahan');
    await conn.query(`UPDATE tracker_sprints SET ${sets.join(', ')} WHERE id = ?`, [...args, sprintId]);
    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }

  await logProjectActivity(user, board, 'tracker.sprint_updated', { sprintId, fields, status, movedCount });
  emit('sprint.updated', board, user);
  return { sprint: await fetchSprint(board, sprintId) };
}

module.exports = {
  DEFAULT_COLUMNS,
  loadProject,
  accessProject,
  accessIssue,
  emit,
  _audienceFor: audienceFor,
  announce,
  listProjects,
  getSpaceProject,
  enableProject,
  updateProject,
  listIssues,
  createIssue,
  createSystemIssue,
  moveSystemIssue,
  getIssue,
  updateIssue,
  deleteIssue,
  addComment,
  createSprint,
  updateSprint,
  normalizeIssueInput,
  normalizeColumns,
};
