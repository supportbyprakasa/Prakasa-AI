const fs = require('fs');
const path = require('path');
const { validateProvider } = require('./contract');

// Discovers every provider in ./providers/ — adding a module to management is
// adding one file there, with no list to edit (so parallel work never collides
// on a shared registration file, and nothing can be "registered but forgotten").

const PROVIDER_DIR = path.join(__dirname, 'providers');
let cache = null;

function load() {
  const files = fs.readdirSync(PROVIDER_DIR)
    .filter((file) => file.endsWith('.js') && !file.startsWith('_'))
    .sort();
  const providers = files.map((file) => validateProvider(require(path.join(PROVIDER_DIR, file))));

  // Keys are how the frontend, the follow-up table and targets refer to things:
  // a clash would silently merge two modules' data, so refuse it outright.
  const seen = new Map();
  const claim = (kind, key, owner) => {
    const id = `${kind}:${key}`;
    if (seen.has(id)) throw new Error(`Key ${kind} "${key}" dipakai dua provider: ${seen.get(id)} dan ${owner}`);
    seen.set(id, owner);
  };
  for (const provider of providers) {
    claim('provider', provider.key, provider.key);
    provider.escalations.forEach((s) => claim('eskalasi', s.key, provider.key));
    provider.metrics.forEach((m) => claim('metrik', m.key, provider.key));
    provider.kpis.forEach((k) => claim('kpi', `${provider.key}.${k.key}`, provider.key));
  }
  return providers;
}

function providers() {
  if (!cache) cache = load();
  return cache;
}

const withProvider = (provider, item) => ({ ...item, provider: provider.key, providerLabel: provider.label });

function escalationSources() {
  return providers().flatMap((p) => p.escalations.map((s) => withProvider(p, s)));
}

function metrics() {
  return providers().flatMap((p) => p.metrics.map((m) => withProvider(p, m)));
}

function kpis() {
  return providers().flatMap((p) => p.kpis.map((k) => withProvider(p, k)));
}

function escalationSource(key) {
  return escalationSources().find((s) => s.key === key) || null;
}

function metric(key) {
  return metrics().find((m) => m.key === key) || null;
}

// Tests swap providers in and out; production loads once.
function reset() { cache = null; }

module.exports = { providers, escalationSources, metrics, kpis, escalationSource, metric, reset, PROVIDER_DIR };
