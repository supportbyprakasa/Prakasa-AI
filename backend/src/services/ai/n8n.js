function getConfig() {
  const url = process.env.N8N_AI_GATEWAY_URL;
  if (!url || !/^https?:\/\//i.test(url)) {
    const error = new Error('N8N_AI_GATEWAY_URL tidak dikonfigurasi dengan benar');
    error.code = 'N8N_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }

  const rawTimeout = Number(process.env.N8N_AI_GATEWAY_TIMEOUT_MS || 120000);
  const timeoutMs = Number.isFinite(rawTimeout)
    ? Math.min(Math.max(rawTimeout, 1000), 300000)
    : 120000;

  return {
    url,
    secret: process.env.N8N_AI_GATEWAY_SECRET || null,
    timeoutMs,
  };
}

function safeContext(context) {
  if (!context || typeof context !== 'object') return undefined;
  return {
    entityId: context.entityId ?? null,
    userId: context.userId ?? null,
    subjectType: context.subjectType ?? null,
    subjectId: context.subjectId ?? null,
  };
}

async function generate({ system, prompt, model, params, context }) {
  const config = getConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (config.secret) {
      headers.Authorization = `Bearer ${config.secret}`;
    }

    const response = await fetch(config.url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: model || 'default',
        system: system || '',
        prompt: prompt || '',
        params: params || {},
        context: safeContext(context),
      }),
    });

    const responseText = await response.text();
    if (responseText.length > 2_000_000) {
      const error = new Error('n8n gateway response terlalu besar');
      error.code = 'N8N_BAD_RESPONSE';
      error.status = 502;
      throw error;
    }

    if (!response.ok) {
      const error = new Error(`n8n gateway error: HTTP ${response.status}`);
      error.code = 'N8N_HTTP_ERROR';
      error.status = 502;
      throw error;
    }

    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch {
      const error = new Error('n8n gateway response bukan JSON');
      error.code = 'N8N_BAD_RESPONSE';
      error.status = 502;
      throw error;
    }

    const content =
      payload.content ??
      payload.output ??
      payload.text ??
      (typeof payload.message === 'string'
        ? payload.message
        : payload.message?.content);

    if (typeof content !== 'string' || !content.trim()) {
      const error = new Error('n8n gateway response tidak berisi content');
      error.code = 'N8N_EMPTY_CONTENT';
      error.status = 502;
      throw error;
    }

    const tokensIn = Number.isFinite(Number(payload.tokensIn))
      ? Number(payload.tokensIn)
      : Number.isFinite(Number(payload.tokens_in))
        ? Number(payload.tokens_in)
        : null;

    const tokensOut = Number.isFinite(Number(payload.tokensOut))
      ? Number(payload.tokensOut)
      : Number.isFinite(Number(payload.tokens_out))
        ? Number(payload.tokens_out)
        : null;

    return {
      content,
      tokensIn,
      tokensOut,
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('n8n gateway timeout');
      timeoutError.code = 'N8N_TIMEOUT';
      timeoutError.status = 504;
      throw timeoutError;
    }

    if (error.code?.startsWith('N8N_')) {
      throw error;
    }

    const safeError = new Error('n8n gateway gagal');
    safeError.code = 'N8N_FAILED';
    safeError.status = 502;
    throw safeError;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generate };
