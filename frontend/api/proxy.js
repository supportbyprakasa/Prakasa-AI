const UPSTREAM_ORIGIN =
  process.env.API_UPSTREAM_ORIGIN || 'https://prakasa-ai-api.vercel.app';

const HOP_BY_HOP = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

module.exports = async function handler(req, res) {
  try {
    const rawPath = String(req.query?.path || '').replace(/^\/+/, '');
    const incomingUrl = new URL(req.url || '/', 'https://proxy.local');
    const target = new URL('/api/' + rawPath, UPSTREAM_ORIGIN);
    target.search = incomingUrl.search;

    const headers = {};
    for (const [key, value] of Object.entries(req.headers || {})) {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower) || value == null) continue;
      headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
    }

    const method = String(req.method || 'GET').toUpperCase();
    const init = {
      method,
      headers,
      redirect: 'manual',
    };

    if (method !== 'GET' && method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      init.body = Buffer.concat(chunks);
    }

    const upstream = await fetch(target, init);
    res.statusCode = upstream.status;

    for (const [key, value] of upstream.headers.entries()) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      res.setHeader(key, value);
    }

    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error('[api-proxy] upstream request failed', {
      name: error?.name,
      message: error?.message,
    });

    res.statusCode = 502;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      success: false,
      error: {
        code: 'API_PROXY_UNAVAILABLE',
        message: 'Backend temporarily unavailable.',
      },
    }));
  }
};
