const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const aiAccess = require('../services/aiSessionAccess.service');
const aiContext = require('../services/aiContext.service');
const aiCommand = require('../services/aiCommand.service');
const aiAction = require('../services/aiActionProposal.service');
const { listProviders } = require('../services/ai/provider');

function handleServiceError(error, res, next) {
  if ([400, 403, 404, 409, 502, 503, 504].includes(error.status)) {
    return fail(
      res,
      error.code || (error.status === 403 ? 'FORBIDDEN' : 'VALIDATION_ERROR'),
      error.message,
      error.status
    );
  }
  return next(error);
}

async function providers(req, res, next) {
  try {
    const rows = await listProviders('ai_command_center', {
      userEmail: req.user.email,
      userId: req.user.sub,
    });
    return ok(res, rows);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function listSessions(req, res, next) {
  try {
    const result = await aiCommand.listSessions({
      user: req.user,
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      visibility: req.query.visibility,
    });

    return ok(res, result.rows, {
      page: result.page,
      limit: result.limit,
      total: result.total,
    });
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function createSession(req, res, next) {
  try {
    const result = await aiCommand.createSession({
      departmentId: req.body.departmentId || null,
      title: req.body.title,
      sessionType: req.body.sessionType,
      visibility: req.body.visibility,
      systemContext: req.body.systemContext,
      provider: req.body.provider,
      user: req.user,
    });

    return ok(res, result, undefined, 201);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function getSession(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) {
      return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    }

    aiAccess.assertSessionAccess({
      user: req.user,
      session,
      action: 'view',
    });

    return ok(res, aiCommand.sessionDto(session));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function updateSession(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) {
      return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    }

    const result = await aiCommand.updateSession({
      session,
      user: req.user,
      patch: req.body,
    });

    return ok(res, result);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function archiveSession(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) {
      return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    }

    const result = await aiCommand.archiveSession({
      session,
      user: req.user,
    });

    return ok(res, result);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function deleteSession(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) {
      return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    }

    const result = await aiCommand.deleteSession({
      session,
      user: req.user,
    });

    return ok(res, result);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function listMessages(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) {
      return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    }

    aiAccess.assertSessionAccess({
      user: req.user,
      session,
      action: 'view',
    });

    const result = await aiCommand.listMessages({
      session,
      page: req.query.page,
      limit: req.query.limit,
    });

    return ok(res, result.rows, {
      page: result.page,
      limit: result.limit,
      total: result.total,
    });
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function sendMessage(req, res, next) {
  try {
    const result = await aiCommand.sendMessage({
      sessionId: Number(req.params.id),
      userMessage: req.body.message,
      user: req.user,
    });

    return ok(res, result, undefined, 201);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function listContexts(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) {
      return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    }

    aiAccess.assertSessionAccess({
      user: req.user,
      session,
      action: 'view',
    });

    const rows = await aiContext.listContexts({
      session,
      user: req.user,
    });

    return ok(res, rows);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function attachContext(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) {
      return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    }

    aiAccess.assertSessionAccess({
      user: req.user,
      session,
      action: 'attach_context',
    });

    const result = await aiContext.attachContext({
      session,
      contextType: req.body.contextType,
      contextId: req.body.contextId,
      relation: req.body.relation || 'reference',
      user: req.user,
    });

    return ok(res, result, undefined, 201);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function removeContext(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) {
      return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    }

    aiAccess.assertSessionAccess({
      user: req.user,
      session,
      action: 'attach_context',
    });

    const result = await aiContext.removeContext({
      session,
      linkId: Number(req.params.contextId),
    });

    return ok(res, result);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function listActions(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) {
      return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    }

    aiAccess.assertSessionAccess({
      user: req.user,
      session,
      action: 'view',
    });

    const rows = await aiAction.listProposals({
      session,
      status: req.query.status,
    });

    return ok(res, rows);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function createAction(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) {
      return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    }

    aiAccess.assertSessionAccess({
      user: req.user,
      session,
      action: 'propose_action',
    });

    const result = await aiAction.createProposal({
      session,
      messageId: req.body.messageId || null,
      actionType: req.body.actionType,
      payload: req.body.payload,
      user: req.user,
    });

    return ok(res, result, undefined, 201);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function confirmAction(req, res, next) {
  try {
    const proposal = await aiAction.getProposalById(req.params.id);
    if (!proposal) {
      return fail(res, 'NOT_FOUND', 'Proposal tidak ditemukan', 404);
    }

    const session = await aiCommand.getSessionById(proposal.session_id);
    if (!session) {
      return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    }

    aiAccess.assertSessionAccess({
      user: req.user,
      session,
      action: 'confirm_action',
    });

    const result = await aiAction.confirmProposal({
      proposalId: Number(req.params.id),
      user: req.user,
    });

    return ok(res, result);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function rejectAction(req, res, next) {
  try {
    const proposal = await aiAction.getProposalById(req.params.id);
    if (!proposal) {
      return fail(res, 'NOT_FOUND', 'Proposal tidak ditemukan', 404);
    }

    const session = await aiCommand.getSessionById(proposal.session_id);
    if (!session) {
      return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    }

    aiAccess.assertSessionAccess({
      user: req.user,
      session,
      action: 'confirm_action',
    });

    const result = await aiAction.rejectProposal({
      proposalId: Number(req.params.id),
      user: req.user,
      reason: req.body.reason,
    });

    return ok(res, result);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function usage(req, res, next) {
  try {
    const where = [];
    const args = [];
    const requestedEntityId = req.query.entityId
      ? Number(req.query.entityId)
      : null;

    if (!requestedEntityId) {
      where.push('user_id=?');
      args.push(req.user.sub);
    } else if (requestedEntityId === Number(req.user.entityId)) {
      if (!aiAccess.hasPerm(req.user, 'ai_command.admin.view')) {
        where.push('entity_id=? AND user_id=?');
        args.push(requestedEntityId, req.user.sub);
      } else {
        where.push('entity_id=?');
        args.push(requestedEntityId);
      }
    } else {
      if (
        !aiAccess.hasPerm(req.user, 'entity.cross_access') ||
        !aiAccess.hasPerm(req.user, 'ai_command.admin.view')
      ) {
        return fail(res, 'FORBIDDEN', 'Tidak punya akses usage lintas entity', 403);
      }
      where.push('entity_id=?');
      args.push(requestedEntityId);
    }

    if (req.query.departmentId) {
      if (
        !aiAccess.hasPerm(req.user, 'ai_command.admin.view') &&
        Number(req.query.departmentId) !== Number(req.user.departmentId)
      ) {
        return fail(res, 'FORBIDDEN', 'Tidak punya akses usage department lain', 403);
      }
      where.push('department_id=?');
      args.push(Number(req.query.departmentId));
    }

    if (req.query.module) {
      where.push('module=?');
      args.push(req.query.module);
    }
    if (req.query.provider) {
      where.push('provider=?');
      args.push(req.query.provider);
    }
    if (req.query.from) {
      where.push('created_at>=?');
      args.push(req.query.from);
    }
    if (req.query.to) {
      where.push('created_at<=?');
      args.push(req.query.to);
    }

    const offset = (req.query.page - 1) * req.query.limit;
    const [rows] = await pool.query(
      `SELECT id, session_id AS sessionId,
              message_id AS messageId,
              entity_id AS entityId,
              department_id AS departmentId,
              user_id AS userId,
              module, provider, model,
              event_type AS eventType,
              tokens_in AS tokensIn,
              tokens_out AS tokensOut,
              duration_ms AS durationMs,
              metadata_json AS metadataJson,
              created_at AS createdAt
         FROM ai_usage_events
        WHERE ${where.join(' AND ')}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
      [...args, req.query.limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM ai_usage_events
        WHERE ${where.join(' AND ')}`,
      args
    );

    return ok(
      res,
      rows.map((row) => ({
        ...row,
        metadata:
          typeof row.metadataJson === 'string'
            ? (() => {
                try { return JSON.parse(row.metadataJson); }
                catch { return null; }
              })()
            : row.metadataJson,
        metadataJson: undefined,
      })),
      {
        page: req.query.page,
        limit: req.query.limit,
        total: Number(total),
      }
    );
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

module.exports = {
  providers,
  listSessions,
  createSession,
  getSession,
  updateSession,
  archiveSession,
  deleteSession,
  listMessages,
  sendMessage,
  listContexts,
  attachContext,
  removeContext,
  listActions,
  createAction,
  confirmAction,
  rejectAction,
  usage,
};
