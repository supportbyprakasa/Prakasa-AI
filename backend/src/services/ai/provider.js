const pool = require('../../db/pool');
const providers = {
  openai: require('./openai'),
  gemini: require('./gemini'),
  claude: require('./claude'),
};

async function getModuleContext(module) {
  const [rows] = await pool.query(
    `SELECT module, provider, model, system_prompt AS systemPrompt, params
       FROM ai_module_contexts WHERE module=? AND is_active=1 LIMIT 1`,
    [module]
  );
  if (!rows[0]) throw new Error(`AI module context '${module}' tidak ditemukan`);
  return rows[0];
}

async function runModule(module, prompt) {
  const ctx = await getModuleContext(module);
  const impl = providers[ctx.provider];
  if (!impl) throw new Error(`Provider ${ctx.provider} tidak dikenal`);
  const result = await impl.generate({
    system: ctx.systemPrompt,
    prompt,
    model: ctx.model,
    params: typeof ctx.params === 'string' ? JSON.parse(ctx.params) : ctx.params,
  });
  return { ...result, provider: ctx.provider, model: ctx.model };
}

module.exports = { runModule, getModuleContext };
