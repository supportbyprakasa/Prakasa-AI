async function generate({ system, prompt, model, params }) {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    contents: [
      ...(system ? [{ role: 'user', parts: [{ text: system }] }] : []),
      { role: 'user', parts: [{ text: prompt }] },
    ],
    generationConfig: {
      temperature: params?.temperature ?? 0.2,
      maxOutputTokens: params?.max_tokens ?? 800,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
  const json = await res.json();
  return {
    content: json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '',
    tokensIn: json.usageMetadata?.promptTokenCount,
    tokensOut: json.usageMetadata?.candidatesTokenCount,
  };
}

module.exports = { generate };
