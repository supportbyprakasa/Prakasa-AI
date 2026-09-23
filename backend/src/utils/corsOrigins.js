const VERCEL_WEB_ORIGINS = [
  'https://prakasa-ai-web.vercel.app',
  'https://prakasa-ai-web-git-feat-full-design-revamp-support-prakasa.vercel.app',
  'https://prakasa-ai-git-feat-full-design-revamp-support-prakasa.vercel.app',
];

function allowedOrigins(configuredOrigins = '') {
  return new Set([
    ...VERCEL_WEB_ORIGINS,
    ...configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean),
  ]);
}

module.exports = { allowedOrigins };
