const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const aiAccess = require('../services/aiSessionAccess.service');
const aiContext = require('../services/aiContext.service');
const aiCommand = require('../services/aiCommand.service');
const aiAction = require('../services/aiActionProposal.service');
const aiDocumentStorage = require('../services/aiDocumentStorage.service');
const aiInbox = require('../services/aiInbox.service');
const aiToolRegistry = require('../services/aiToolRegistry.service');
const aiToolContext = require('../services/aiToolContext.service');
const { log: activityLog } = require('../services/activityLog.service');
const { listProviders } = require('../services/ai/provider');
const logger = require('../utils/logger');

const KNOWN_ERROR_STATUSES = [400, 403, 404, 409, 502, 503, 504];
const SSE_HEARTBEAT_MS = 15000;

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
      webResearch: req.body.webResearch === true,
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

    return ok(res, {
      ...aiCommand.sessionDto(session),
      access: aiAccess.sessionAccessFlags(req.user, session),
      pinned: await aiCommand.isPinned(session.id, req.user.sub),
    });
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function pinSession(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    return ok(res, await aiCommand.setPinned({ session, user: req.user, pinned: req.method === 'PUT' }));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function divisions(req, res, next) {
  try {
    return ok(res, await aiCommand.listTargetDivisions(req.user));
  } catch (error) {
    return next(error);
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
      editMessageId: req.body.editMessageId || null,
    });

    return ok(res, result, undefined, 201);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function inbox(req, res, next) {
  try {
    return ok(res, await aiInbox.getInbox({ user: req.user }));
  } catch (error) {
    return next(error);
  }
}

async function tools(req, res, next) {
  try {
    const level = await aiToolContext.roleLevelFromDb(req.user);
    return ok(res, { roleLevel: level, tools: aiToolRegistry.listToolsForUser(req.user, level) });
  } catch (error) {
    return next(error);
  }
}

// Builds the context for the page the user has open and, when a session is given, stores
// it as that session's notes through the normal owner-checked session update.
async function toolContext(req, res, next) {
  try {
    const context = await aiToolContext.buildToolContext({
      user: req.user,
      pathname: req.body.pathname,
      search: req.body.search || '',
      visibleState: req.body.visibleState || null,
    });

    let attachedSessionId = null;
    if (req.body.sessionId) {
      const session = await aiCommand.getSessionById(req.body.sessionId);
      if (!session) return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
      await aiCommand.updateSession({ session, user: req.user, patch: { systemContext: context.text } });
      attachedSessionId = session.id;
    }

    activityLog({
      entityId: req.user.entityId,
      userId: req.user.sub,
      action: 'ai_tool.context_built',
      subjectType: 'ai_tool',
      subjectId: attachedSessionId,
      metadata: { tool: context.tool.key, sourceRef: context.subject?.sourceRef || null, attached: Boolean(attachedSessionId) },
    }).catch(() => {});

    return ok(res, { ...context, attachedSessionId });
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function stopGeneration(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    const result = await aiCommand.stopGeneration({ session, user: req.user });
    return ok(res, result);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

// Server-Sent Events over POST: `delta` events carry answer text, then exactly one
// `done` (same payload as sendMessage) or `error`. Generation is not cancelled when
// the client disconnects, so the answer is still saved to the history.
async function streamMessage(req, res) {
  let clientGone = false;
  res.on('close', () => { clientGone = true; });

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const send = (event, data) => {
    if (clientGone || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => {
    if (!clientGone && !res.writableEnded) res.write(': keep-alive\n\n');
  }, SSE_HEARTBEAT_MS);

  try {
    const result = await aiCommand.sendMessage({
      sessionId: Number(req.params.id),
      userMessage: req.body.message,
      user: req.user,
      editMessageId: req.body.editMessageId || null,
      onDelta: (text) => send('delta', { text }),
      onStatus: (status) => send('status', status),
    });
    send('done', result);
  } catch (error) {
    const known = KNOWN_ERROR_STATUSES.includes(error.status);
    if (!known) logger.error({ err: error.message, stack: error.stack }, 'AI stream failed');
    send('error', {
      status: known ? error.status : 500,
      code: error.code || 'INTERNAL_ERROR',
      message: known ? error.message : 'Terjadi kesalahan server',
    });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
}

async function uploadSessionFile(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);

    aiAccess.assertSessionAccess({ user: req.user, session, action: 'send_message' });
    const result = await aiDocumentStorage.uploadSessionFile({
      session,
      user: req.user,
      file: req.file,
      title: req.body?.title,
      documentType: req.body?.documentType,
    });
    return ok(res, result, undefined, 201);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function generateArtifact(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);

    aiAccess.assertSessionAccess({ user: req.user, session, action: 'send_message' });
    const result = await aiDocumentStorage.generateFromMessage({
      session,
      user: req.user,
      messageId: req.body.messageId,
      format: req.body.format,
      title: req.body.title,
      documentType: req.body.documentType,
    });
    return ok(res, result, undefined, 201);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function downloadArtifact(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);

    aiAccess.assertSessionAccess({ user: req.user, session, action: 'view' });
    const file = await aiDocumentStorage.downloadSessionDocument({
      session,
      user: req.user,
      documentId: Number(req.params.documentId),
    });
    const fallback = String(file.fileName || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', file.buffer.length);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`
    );
    return res.status(200).send(file.buffer);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function getArtifact(req, res, next) {
  try {
    const session = await aiCommand.getSessionById(req.params.id);
    if (!session) return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);

    aiAccess.assertSessionAccess({ user: req.user, session, action: 'view' });
    const artifact = await aiDocumentStorage.getSessionDocumentMetadata({
      session,
      documentId: Number(req.params.documentId),
    });
    return ok(res, artifact);
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
  pinSession,
  divisions,
  tools,
  toolContext,
  providers,
  listSessions,
  createSession,
  getSession,
  updateSession,
  archiveSession,
  deleteSession,
  listMessages,
  sendMessage,
  streamMessage,
  stopGeneration,
  inbox,
  uploadSessionFile,
  generateArtifact,
  getArtifact,
  downloadArtifact,
  listContexts,
  attachContext,
  removeContext,
  listActions,
  createAction,
  confirmAction,
  rejectAction,
  usage,
};
