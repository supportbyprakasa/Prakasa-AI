const pool = require('../../db/pool');
const integrationLog = require('../integrationLog.service');

const providers = {
  openai: require('./openai'),
  gemini: require('./gemini'),
  claude: require('./claude'),
  n8n: require('./n8n'),
};

async function getModuleContext(module) {
  const [rows] = await pool.query(
    `SELECT module, provider, model, system_prompt AS systemPrompt, params
       FROM ai_module_contexts
      WHERE module=? AND is_active=1
      LIMIT 1`,
    [module]
  );
  if (!rows[0]) throw new Error(`AI module context '${module}' tidak ditemukan`);
  return rows[0];
}

async function runModule(module, prompt, ctx = {}) {
  const startedAt = Date.now();
  let providerName = 'ai';

  try {
    const moduleContext = await getModuleContext(module);
    providerName = moduleContext.provider;

    const implementation = providers[moduleContext.provider];
    if (!implementation) {
      throw new Error(`Provider ${moduleContext.provider} tidak dikenal`);
    }

    const result = await implementation.generate({
      system: moduleContext.systemPrompt,
      prompt,
      model: moduleContext.model,
      params: typeof moduleContext.params === 'string'
        ? JSON.parse(moduleContext.params)
        : moduleContext.params,
      context: {
        entityId: ctx.entityId || null,
        userId: ctx.userId || null,
        subjectType: ctx.subjectType || null,
        subjectId: ctx.subjectId || null,
      },
    });

    await integrationLog.log({
      entityId: ctx.entityId || null,
      userId: ctx.userId || null,
      provider: providerName,
      operation: `runModule:${module}`,
      subjectType: ctx.subjectType || null,
      subjectId: ctx.subjectId || null,
      status: 'success',
      durationMs: Date.now() - startedAt,
      requestMeta: {
        module,
        promptLength: typeof prompt === 'string' ? prompt.length : 0,
      },
      responseMeta: {
        model: moduleContext.model,
        tokensIn: result?.tokensIn ?? result?.usage?.input_tokens ?? null,
        tokensOut: result?.tokensOut ?? result?.usage?.output_tokens ?? null,
      },
    });

    return {
      ...result,
      provider: moduleContext.provider,
      model: moduleContext.model,
    };
  } catch (error) {
    await integrationLog.log({
      entityId: ctx.entityId || null,
      userId: ctx.userId || null,
      provider: providerName,
      operation: `runModule:${module}`,
      subjectType: ctx.subjectType || null,
      subjectId: ctx.subjectId || null,
      status: 'failed',
      errorMessage: error.message,
      durationMs: Date.now() - startedAt,
      requestMeta: {
        module,
        promptLength: typeof prompt === 'string' ? prompt.length : 0,
      },
    });
    throw error;
  }
}

module.exports = { runModule, getModuleContext };
