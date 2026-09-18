const OpenAI = require('openai');

async function generate({ system, prompt, model, params }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const r = await client.chat.completions.create({
    model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt },
    ],
    temperature: params?.temperature ?? 0.2,
    max_tokens: params?.max_tokens ?? 800,
  });
  return {
    content: r.choices[0].message.content,
    tokensIn: r.usage?.prompt_tokens,
    tokensOut: r.usage?.completion_tokens,
  };
}

module.exports = { generate };
