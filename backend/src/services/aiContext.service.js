const pool = require('../db/pool');
const { getDocPlainText } = require('./googleDocs.service');
const { STANDARD_BUDGET } = require('./ai/contextBudget');

const MAX_CONTEXT_CHARS = STANDARD_BUDGET.itemChars;
// Below this many characters a partially fitting block is dropped rather than cut.
const MIN_PARTIAL_BLOCK_CHARS = 1000;
const DOCUMENT_HEADER_ALLOWANCE = 500;

function truncate(value, max = MAX_CONTEXT_CHARS) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function hasPerm(user, code) {
  return Boolean(user && (user.permissions || []).includes(code));
}

function hasAnyPerm(user, codes) {
  return codes.some((code) => hasPerm(user, code));
}

function assertUnderlyingPermission(user, codes) {
  if (!hasAnyPerm(user, codes)) return false;
  return true;
}

function canAccessScopedRow(user, row) {
  const rowEntityId = Number(row.entity_id ?? row.entityId);
  const rowDepartmentId = row.department_id ?? row.departmentId ?? null;
  const userEntityId = user?.entityId != null ? Number(user.entityId) : null;
  const userDepartmentId =
    user?.departmentId != null ? Number(user.departmentId) : null;

  if (!userEntityId || !rowEntityId) return false;

  if (rowEntityId !== userEntityId) {
    return (
      hasPerm(user, 'entity.cross_access') &&
      hasPerm(user, 'ai_command.admin.view')
    );
  }

  if (rowDepartmentId == null) return true;
  if (userDepartmentId != null && Number(rowDepartmentId) === userDepartmentId) {
    return true;
  }

  return hasPerm(user, 'ai_command.admin.view');
}

function formatBlock(type, id, title, body, maxChars = MAX_CONTEXT_CHARS) {
  return truncate(
    `[UNTRUSTED_INTERNAL_DATA type=${type} id=${id}]\n` +
    `Title: ${title || '-'}\n${body || ''}`,
    maxChars
  );
}

const RESOLVERS = {
  async document({ entityId, contextId, user, includeContent = true, budget = STANDARD_BUDGET }) {
    if (!assertUnderlyingPermission(user, ['document.view'])) return null;

    const [rows] = await pool.query(
      `SELECT d.id, d.entity_id, d.department_id, d.title,
              d.document_type, d.status, d.drive_file_id,
              f.mime_type AS mimeType,
              c.extraction_status AS extractionStatus,
              c.extracted_text AS extractedText
         FROM documents d
         LEFT JOIN drive_files_metadata f
           ON f.drive_file_id=d.drive_file_id
         LEFT JOIN document_ai_content c
           ON c.document_id=d.id
        WHERE d.id=? AND d.deleted_at IS NULL
        LIMIT 1`,
      [contextId]
    );
    const row = rows[0];
    if (!row || Number(row.entity_id) !== Number(entityId)) return null;
    if (!canAccessScopedRow(user, row)) return null;

    let extracted = '';
    if (includeContent && row.extractionStatus === 'ready' && row.extractedText) {
      extracted = String(row.extractedText);
    }
    if (
      includeContent &&
      !extracted &&
      row.drive_file_id &&
      row.mimeType === 'application/vnd.google-apps.document'
    ) {
      try {
        extracted = await getDocPlainText(row.drive_file_id, {
          entityId: row.entity_id,
          userId: user.sub,
          subjectType: 'ai_context_document',
          subjectId: row.id,
        });
      } catch {
        extracted = '';
      }
    }

    return {
      type: 'document',
      id: row.id,
      title: row.title,
      text: formatBlock(
        'document',
        row.id,
        row.title,
        [
          `Document type: ${row.document_type}`,
          `Status: ${row.status}`,
          row.extractionStatus && row.extractionStatus !== 'ready'
            ? `AI extraction status: ${row.extractionStatus}`
            : '',
          extracted ? `Content:\n${truncate(extracted, budget.documentChars)}` : '',
        ].filter(Boolean).join('\n'),
        budget.documentChars + DOCUMENT_HEADER_ALLOWANCE
      ),
    };
  },

  async task({ entityId, contextId, user }) {
    if (!assertUnderlyingPermission(user, ['task.view'])) return null;

    const [rows] = await pool.query(
      `SELECT id, entity_id, department_id, title, description,
              status, priority, due_date
         FROM tasks
        WHERE id=? AND deleted_at IS NULL
        LIMIT 1`,
      [contextId]
    );
    const row = rows[0];
    if (!row || Number(row.entity_id) !== Number(entityId)) return null;
    if (!canAccessScopedRow(user, row)) return null;

    return {
      type: 'task',
      id: row.id,
      title: row.title,
      text: formatBlock(
        'task',
        row.id,
        row.title,
        `Status: ${row.status}\nPriority: ${row.priority}\nDue: ${row.due_date || '-'}\nDescription: ${row.description || '-'}`
      ),
    };
  },

  async approval_request({ entityId, contextId, user }) {
    if (!assertUnderlyingPermission(user, ['approval.view'])) return null;

    const [rows] = await pool.query(
      `SELECT id, entity_id, department_id, title, description, status,
              current_level, flow_type, amount, currency, request_type
         FROM approval_requests
        WHERE id=?
        LIMIT 1`,
      [contextId]
    );
    const row = rows[0];
    if (!row || Number(row.entity_id) !== Number(entityId)) return null;
    if (!canAccessScopedRow(user, row)) return null;

    return {
      type: 'approval_request',
      id: row.id,
      title: row.title,
      text: formatBlock(
        'approval_request',
        row.id,
        row.title,
        [
          `Status: ${row.status}`,
          `Current level: ${row.current_level}`,
          `Flow: ${row.flow_type || 'legacy'}`,
          `Request type: ${row.request_type || '-'}`,
          `Amount: ${row.amount ?? '-'} ${row.currency || ''}`,
          row.description ? `Description: ${row.description}` : '',
        ].filter(Boolean).join('\n')
      ),
    };
  },

};

const SUPPORTED_CONTEXT_TYPES = Object.freeze(Object.keys(RESOLVERS));

async function resolveOne({
  session,
  contextType,
  contextId,
  user,
  includeContent = true,
  budget = STANDARD_BUDGET,
}) {
  const resolver = RESOLVERS[contextType];
  if (!resolver) return null;
  return resolver({
    entityId: session.entity_id,
    contextId,
    user,
    includeContent,
    budget,
  });
}

async function attachContext({
  session,
  contextType,
  contextId,
  relation = 'reference',
  user,
}) {
  if (!SUPPORTED_CONTEXT_TYPES.includes(contextType)) {
    const error = new Error(`context_type tidak didukung: ${contextType}`);
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const resolved = await resolveOne({
    session,
    contextType,
    contextId,
    user,
    includeContent: false,
  });

  if (!resolved) {
    const error = new Error('Konteks tidak ditemukan atau tidak dapat diakses');
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  const [result] = await pool.query(
    `INSERT INTO ai_context_links
     (session_id, entity_id, context_type, context_id, relation, added_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
    [
      session.id,
      session.entity_id,
      contextType,
      contextId,
      relation,
      user.sub,
    ]
  );

  return {
    id: result.insertId,
    contextType,
    contextId: Number(contextId),
    relation,
    title: resolved.title,
  };
}

// `excludeDocumentIds`: documents the caller puts into the prompt itself (the
// attachments of the message being answered), so they are not sent twice.
async function resolveContext({ session, user, budget = STANDARD_BUDGET, excludeDocumentIds = [] }) {
  const excluded = new Set(excludeDocumentIds.map(Number));
  const [links] = await pool.query(
    `SELECT id, context_type AS contextType,
            context_id AS contextId, relation
       FROM ai_context_links
      WHERE session_id=? AND entity_id=?
      ORDER BY id ASC`,
    [session.id, session.entity_id]
  );

  const parts = [];
  let totalChars = 0;
  let resolvedCount = 0;
  let skippedCount = 0;
  let truncatedCount = 0;

  for (const link of links) {
    if (link.contextType === 'document' && excluded.has(Number(link.contextId))) continue;
    let resolved = null;
    try {
      resolved = await resolveOne({
        session,
        contextType: link.contextType,
        contextId: link.contextId,
        user,
        budget,
      });
    } catch {
      resolved = null;
    }

    if (!resolved) {
      skippedCount += 1;
      continue;
    }

    const blockLimit = resolved.type === 'document'
      ? budget.documentChars + DOCUMENT_HEADER_ALLOWANCE
      : budget.itemChars;
    let block = truncate(resolved.text, blockLimit);
    const remaining = budget.totalContextChars - totalChars;
    if (block.length > remaining) {
      // Include what fits instead of dropping a large document entirely.
      if (remaining < MIN_PARTIAL_BLOCK_CHARS) {
        skippedCount += 1;
        continue;
      }
      block = `${block.slice(0, remaining - 1)}…`;
      truncatedCount += 1;
    }

    parts.push(block);
    totalChars += block.length;
    resolvedCount += 1;
  }

  return {
    text: parts.join('\n\n---\n\n'),
    linkCount: links.length,
    resolvedCount,
    skippedCount,
    truncatedCount,
    totalChars,
  };
}

async function listContexts({ session, user }) {
  const [links] = await pool.query(
    `SELECT id, context_type AS contextType,
            context_id AS contextId, relation,
            added_by AS addedBy, created_at AS createdAt
       FROM ai_context_links
      WHERE session_id=? AND entity_id=?
      ORDER BY id ASC`,
    [session.id, session.entity_id]
  );

  const visible = [];
  for (const link of links) {
    const resolved = await resolveOne({
      session,
      contextType: link.contextType,
      contextId: link.contextId,
      user,
      includeContent: false,
    }).catch(() => null);

    if (!resolved) continue;
    visible.push({
      ...link,
      title: resolved.title,
    });
  }

  return visible;
}

async function removeContext({ session, linkId }) {
  const [result] = await pool.query(
    `DELETE FROM ai_context_links
      WHERE id=? AND session_id=? AND entity_id=?`,
    [linkId, session.id, session.entity_id]
  );

  if (!result.affectedRows) {
    const error = new Error('Konteks tidak ditemukan');
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  return { id: Number(linkId) };
}

module.exports = {
  attachContext,
  resolveContext,
  listContexts,
  removeContext,
  SUPPORTED_CONTEXT_TYPES,
};
