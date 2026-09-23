function providerError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function generate({ system, prompt, model, params }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw providerError(
      'Gemini belum dikonfigurasi oleh administrator',
      'AI_PROVIDER_NOT_CONFIGURED',
      503
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    ...(system
      ? {
          system_instruction: {
            parts: [{ text: system }],
          },
        }
      : {}),
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: params?.temperature ?? 0.2,
      maxOutputTokens: params?.max_tokens ?? 800,
    },
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS || 120000)),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw providerError('Gemini timeout', 'AI_PROVIDER_TIMEOUT', 504);
    }
    throw providerError('Gemini tidak dapat dijangkau', 'AI_PROVIDER_UNAVAILABLE', 503);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const payload = await res.json();
      detail = payload?.error?.message ? `: ${payload.error.message}` : '';
    } catch {
      // Response body is intentionally not exposed to clients.
    }

    const status =
      res.status === 429 ? 503 :
      res.status >= 500 ? 503 :
      502;
    const code =
      res.status === 429 ? 'AI_PROVIDER_RATE_LIMIT' :
      res.status === 401 || res.status === 403 ? 'AI_PROVIDER_AUTH_ERROR' :
      'AI_PROVIDER_ERROR';

    const error = providerError(
      `Gemini error ${res.status}${detail}`,
      code,
      status
    );
    throw error;
  }

  const json = await res.json();
  const content = json.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter(Boolean)
    .join('') || '';

  return {
    content,
    tokensIn: json.usageMetadata?.promptTokenCount,
    tokensOut: json.usageMetadata?.candidatesTokenCount,
  };
}

module.exports = { generate };
