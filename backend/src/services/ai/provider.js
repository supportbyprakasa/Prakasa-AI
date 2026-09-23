const pool = require('../../db/pool');
const integrationLog = require('../integrationLog.service');

const providers = {
  openai: require('./openai'),
  gemini: require('./gemini'),
  claude: require('./claude'),
  n8n: require('./n8n'),
};

const providerDefinitions = {
  claude: {
    label: 'Claude',
    configured: () => Boolean(process.env.ANTHROPIC_API_KEY),
    model: (moduleContext) =>
      process.env.CLAUDE_MODEL ||
      (moduleContext.provider === 'claude' ? moduleContext.model : null) ||
      'claude-sonnet-5',
    authMode: 'api_key',
    billingMode: 'separate_api',
  },
  gemini: {
    label: 'Gemini',
    configured: () => Boolean(process.env.GEMINI_API_KEY),
    model: (moduleContext) =>
      process.env.GEMINI_MODEL ||
      (moduleContext.provider === 'gemini' ? moduleContext.model : null) ||
      'gemini-3.8-flash',
    authMode: 'api_key',
    billingMode: 'provider_tier',
  },
  openai: {
    label: 'OpenAI',
    configured: () => Boolean(process.env.OPENAI_API_KEY),
    model: (moduleContext) =>
      process.env.OPENAI_MODEL ||
      (moduleContext.provider === 'openai' ? moduleContext.model : null),
    authMode: 'api_key',
    billingMode: 'separate_api',
  },
  n8n: {
    label: 'n8n AI Gateway',
    configured: () => Boolean(process.env.N8N_AI_GATEWAY_URL),
    model: (moduleContext) =>
      process.env.N8N_AI_MODEL ||
      (moduleContext.provider === 'n8n' ? moduleContext.model : null) ||
      'n8n-gateway',
    authMode: 'server_gateway',
    billingMode: 'gateway_managed',
  },
};

function providerError(message, code = 'AI_PROVIDER_NOT_CONFIGURED', status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

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

function resolveProvider(moduleContext, requestedProvider) {
  const providerName = requestedProvider || moduleContext.provider;
  const definition = providerDefinitions[providerName];
  const implementation = providers[providerName];

  if (!definition || !implementation) {
    throw providerError(
      `Provider ${providerName} tidak dikenal`,
      'AI_PROVIDER_UNSUPPORTED',
      400
    );
  }

  if (!definition.configured()) {
    throw providerError(
      `Provider ${definition.label} belum dikonfigurasi oleh administrator`
    );
  }

  const model = definition.model(moduleContext);
  if (!model) {
    throw providerError(
      `Model untuk provider ${definition.label} belum dikonfigurasi`
    );
  }

  return {
    name: providerName,
    model,
    definition,
    implementation,
  };
}

async function listProviders(module) {
  const moduleContext = await getModuleContext(module);

  return Object.entries(providerDefinitions).map(([name, definition]) => {
    const available = definition.configured();
    const model = available ? definition.model(moduleContext) : null;

    return {
      id: name,
      label: definition.label,
      available: Boolean(available && model),
      model: available ? model : null,
      isDefault: name === moduleContext.provider,
      authMode: definition.authMode,
      billingMode: definition.billingMode,
    };
  });
}

async function runModule(module, prompt, ctx = {}) {
  const startedAt = Date.now();
  let providerName = 'ai';

  try {
    const moduleContext = await getModuleContext(module);
    const selected = resolveProvider(moduleContext, ctx.provider || null);
    providerName = selected.name;

    const result = await selected.implementation.generate({
      system: moduleContext.systemPrompt,
      prompt,
      model: selected.model,
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
        model: selected.model,
        tokensIn: result?.tokensIn ?? result?.usage?.input_tokens ?? null,
        tokensOut: result?.tokensOut ?? result?.usage?.output_tokens ?? null,
      },
    });

    return {
      ...result,
      provider: providerName,
      model: selected.model,
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

module.exports = {
  runModule,
  getModuleContext,
  listProviders,
  resolveProvider,
};
