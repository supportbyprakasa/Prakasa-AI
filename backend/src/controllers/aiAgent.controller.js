const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { loadUser } = require('../middleware/requireAuth');
const { verifyAgentToken } = require('../services/ai/agent/agentToken');
const agentTools = require('../services/ai/agent/agentTools');
const clientTools = require('../services/ai/agent/clientTools');
const aiAccess = require('../services/aiSessionAccess.service');
const agentRun = require('../services/ai/agent/agentRun');
const { log } = require('../services/activityLog.service');

// The Prakasa AI agent's tool server (a subprocess of the Claude CLI) calls
// back here for every tool. Authentication is the short-lived agent token only;
// the user behind it is re-loaded on every call, so a permission revoked
// mid-answer takes effect at once, and a tool is refused unless it was granted
// to this answer AND the user may still use it.

const MAX_CALLS_PER_TOKEN = 30;
// What a scoped token's tool is asked, and what its audit row is about.
const SCOPED_INPUT = Object.freeze({ accurate_batch_review: (claims) => ({ id_batch: Number(claims.rid) }) });
const auditSubject = (claims) => (claims.pur
  ? { subjectType: agentRun.SCOPED_PURPOSES[claims.pur], subjectId: Number(claims.rid) }
  : { subjectType: 'ai_session', subjectId: claims.sid });
const callsByToken = new Map();

function countCall(jti, exp) {
  const now = Date.now();
  for (const [key, entry] of callsByToken) if (entry.exp < now) callsByToken.delete(key);
  const entry = callsByToken.get(jti) || { n: 0, exp: exp * 1000 };
  entry.n += 1;
  callsByToken.set(jti, entry);
  return entry.n;
}

async function requireAgent(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, 'UNAUTHORIZED', 'Token agen tidak ada', 401);
  let claims;
  try {
    claims = verifyAgentToken(token);
  } catch {
    return fail(res, 'UNAUTHORIZED', 'Token agen tidak valid', 401);
  }
  try {
    const user = await loadUser(claims.sub);
    if (!user || user.status !== 'active' || Number(user.entity_id) !== Number(claims.eid)) {
      return fail(res, 'UNAUTHORIZED', 'Pengguna tidak aktif', 401);
    }
    req.agentUser = {
      sub: user.id, email: user.email, entityId: user.entity_id, departmentId: user.department_id, permissions: user.permissions,
    };
    // A one-off run outside any conversation (agentRun.prepareScoped — the
    // Accurate batch review): no session row; always private, no web research,
    // and every call is bound to the one record the token names.
    if (claims.pur) {
      if (!agentRun.SCOPED_PURPOSES[claims.pur] || claims.sid != null || !Number.isInteger(Number(claims.rid))) {
        return fail(res, 'UNAUTHORIZED', 'Token agen tidak valid', 401);
      }
      req.agentSession = agentRun.SCOPED_SESSION;
      req.agent = claims;
      return next();
    }
    const [[session]] = await pool.query('SELECT * FROM ai_sessions WHERE id = ? AND deleted_at IS NULL LIMIT 1', [claims.sid]);
    if (!session) return fail(res, 'NOT_FOUND', 'Sesi AI tidak ditemukan', 404);
    req.agentSession = session;
    aiAccess.assertSessionAccess({ user: req.agentUser, session, action: 'send_message' });
    req.agent = claims;
    return next();
  } catch (e) {
    if (e.status) return fail(res, e.code || 'FORBIDDEN', e.message, e.status);
    return next(e);
  }
}

function granted(req) {
  const allowed = new Set(req.agent.tools || []);
  return agentTools.toolsFor(req.agentUser, req.agentSession, { surface: req.agent.srf || null }).filter((t) => allowed.has(t.name));
}

async function listTools(req, res) {
  return ok(res, granted(req).map(agentTools.schemaOf));
}

async function callTool(req, res, next) {
  const tool = granted(req).find((t) => t.name === req.params.name);
  if (!tool) return fail(res, 'FORBIDDEN', 'Alat ini tidak tersedia untuk Anda', 403);
  if (countCall(req.agent.jti, req.agent.exp) > MAX_CALLS_PER_TOKEN) {
    return fail(res, 'TOO_MANY_CALLS', 'Batas pemanggilan alat untuk satu jawaban tercapai', 429);
  }
  // A scoped run reads its own record only, whatever the model asks for.
  const input = req.agent.pur
    ? SCOPED_INPUT[req.agent.pur](req.agent)
    : (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body.input || {}) : {});
  const startedAt = Date.now();
  if (tool.client) return callClientTool(req, res, next, { tool, input, startedAt });
  try {
    const result = await tool.run(req.agentUser, input);
    const audit = log({
      entityId: req.agentUser.entityId, userId: req.agentUser.sub, action: 'ai_tool.call', ...auditSubject(req.agent), metadata: { tool: tool.name, ok: true, durationMs: Date.now() - startedAt },
    });
    // The audit row is what keeps a chat with stock, PO or notification data
    // private: no record, no data (program 4.1). Other tools stay best-effort.
    if (tool.privateOnly) {
      try { await audit; } catch { return fail(res, 'AUDIT_FAILED', 'Data tidak dikirim karena pencatatan akses gagal. Coba lagi.', 500); }
    } else {
      await audit.catch(() => {});
    }
    return ok(res, result);
  } catch (e) {
    await log({
      entityId: req.agentUser.entityId, userId: req.agentUser.sub, action: 'ai_tool.call', ...auditSubject(req.agent), metadata: { tool: tool.name, ok: false, error: String(e.code || e.message).slice(0, 120) },
    }).catch(() => {});
    if (e.status && e.code) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
}

// A page tool: the user's browser carries it out on the answer's own stream
// (services/ai/agent/clientTools.js). The audit row names the tool, the route,
// the form and the field NAMES — never a value — and, as for every private
// tool, nothing is sent to the browser's page or back to the model without it.
async function callClientTool(req, res, next, { tool, input, startedAt }) {
  const base = {
    entityId: req.agentUser.entityId, userId: req.agentUser.sub, action: 'ai_tool.call', subjectType: 'ai_session', subjectId: req.agent.sid,
  };
  const auditOf = (outcome) => ({
    tool: tool.name,
    client: true,
    ok: outcome.ok,
    ...(outcome.denied ? { error: 'FORBIDDEN' } : {}),
    route: outcome.audit.route || null,
    ...(outcome.audit.formId ? { formId: outcome.audit.formId } : {}),
    ...(outcome.audit.forms ? { forms: outcome.audit.forms } : {}),
    ...(outcome.audit.fields ? { fields: outcome.audit.fields } : {}),
    ...(outcome.audit.filled ? { filled: outcome.audit.filled } : {}),
    // Rows added per rows field (a count), and for an edit form the record it changes.
    ...(outcome.audit.rows ? { rows: outcome.audit.rows } : {}),
    ...(outcome.audit.mode ? { mode: outcome.audit.mode, recordType: outcome.audit.recordType, recordId: outcome.audit.recordId } : {}),
    durationMs: Date.now() - startedAt,
  });
  try {
    const outcome = await clientTools.run({
      tool,
      user: req.agentUser,
      input,
      ctx: { answerId: req.agent.jti, sessionId: req.agent.sid, surface: req.agent.srf || null },
    });
    try {
      await log({ ...base, metadata: auditOf(outcome) });
    } catch {
      return fail(res, 'AUDIT_FAILED', 'Hasil tidak dikirim karena pencatatan akses gagal. Coba lagi.', 500);
    }
    return ok(res, outcome.result);
  } catch (e) {
    await log({ ...base, metadata: { tool: tool.name, client: true, ok: false, error: String(e.code || e.message).slice(0, 120) } }).catch(() => {});
    if (e.status && e.code) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
}

module.exports = { requireAgent, listTools, callTool, MAX_CALLS_PER_TOKEN };
