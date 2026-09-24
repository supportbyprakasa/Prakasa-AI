const http = require('node:http');
const { runCli } = require('../services/ai/claudeTeamPersonal');

const host = process.env.CLAUDE_TEAM_GATEWAY_HOST || '127.0.0.1';
const port = Number(process.env.CLAUDE_TEAM_GATEWAY_PORT || 3199);
const secret = process.env.CLAUDE_TEAM_GATEWAY_SECRET;

if (!secret || secret.length < 24) {
  throw new Error('CLAUDE_TEAM_GATEWAY_SECRET wajib diisi minimal 24 karakter.');
}

function send(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { status: 'ok' });
  }

  if (req.method !== 'POST' || req.url !== '/generate') {
    return send(res, 404, {
      error: { code: 'NOT_FOUND', message: 'Not found' },
    });
  }

  if (req.headers['x-prakasa-ai-gateway-secret'] !== secret) {
    return send(res, 401, {
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
    });
  }

  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 256 * 1024) {
        return send(res, 413, {
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload terlalu besar' },
        });
      }
      chunks.push(chunk);
    }

    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');

    // The shared secret is the trust boundary: the calling Prakasa backend has already
    // authorized the user against the Super Admin settings before forwarding here.
    const result = await runCli({
      system: body.system || '',
      prompt: String(body.prompt || ''),
      model: body.model || process.env.CLAUDE_TEAM_MODEL || 'sonnet',
    });

    return send(res, 200, result);
  } catch (error) {
    const status = [400, 401, 403, 413, 502, 503, 504].includes(error.status)
      ? error.status
      : 500;

    return send(res, status, {
      error: {
        code: error.code || 'GATEWAY_ERROR',
        message: status >= 500 ? 'Claude Team gateway error' : error.message,
      },
    });
  }
});

server.listen(port, host, () => {
  console.log(`Claude Team personal gateway listening on http://${host}:${port}`);
});
