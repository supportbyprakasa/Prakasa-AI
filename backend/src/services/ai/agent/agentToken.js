const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

// A short-lived credential handed to the agent's tool server for ONE answer.
// It is signed with its own key (derived from JWT_SECRET), so it can never pass
// as a normal login token anywhere else in the API — and requireAuth refuses
// its type as a second line of defence. It names the user, the session and the
// tools that answer may call; nothing more.

const TYPE = 'ai_agent';
const TTL_SECONDS = 15 * 60;

function agentSecret() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET wajib diisi');
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update('prakasa-ai-agent-token').digest('hex');
}

// `surface` ('panel' | 'full' | null) is where the conversation runs: page
// tools are offered by surface (agentTools.toolsFor). `answerId` (jti) names
// this one answer: its page-tool requests reach only that answer's stream.
// `purpose` + `subjectId` (pur, rid): a one-off run outside any conversation
// (the Accurate batch review). Such a token names no session; the API gives it
// a private one with no web research and binds the tool call to that record.
function signAgentToken({ userId, entityId, sessionId, tools, surface = null, answerId = null, purpose = null, subjectId = null }) {
  return jwt.sign(
    {
      typ: TYPE, sub: userId, eid: entityId, sid: sessionId, tools: [...tools], jti: answerId || crypto.randomUUID(),
      ...(surface ? { srf: surface } : {}),
      ...(purpose ? { pur: purpose, rid: subjectId } : {}),
    },
    agentSecret(),
    { expiresIn: TTL_SECONDS },
  );
}

function verifyAgentToken(token) {
  const decoded = jwt.verify(token, agentSecret());
  if (decoded.typ !== TYPE) throw new Error('Bukan token agen');
  return decoded;
}

module.exports = { TYPE, TTL_SECONDS, signAgentToken, verifyAgentToken };
