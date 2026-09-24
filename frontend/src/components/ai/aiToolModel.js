// Pure helpers for the contextual Prakasa AI panel. The server re-resolves the route and
// re-checks permissions; these only decide what the browser shows.

const MAX_STATE_KEYS = 12;
const MAX_STATE_VALUE = 120;
const SECRET_KEY = /pass(word)?|token|secret|api[-_]?key|credential|auth|cookie|session/i;

const split = (path) => String(path || '').split('?')[0].split('#')[0].split('/').filter(Boolean);

function matchPattern(pattern, segments) {
  const parts = split(pattern);
  if (parts.length !== segments.length) return null;
  const params = {};
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index].startsWith(':')) params[parts[index].slice(1)] = decodeURIComponent(segments[index]);
    else if (parts[index] !== segments[index]) return null;
  }
  return params;
}

export function resolveToolForPath(tools, pathname) {
  const segments = split(pathname);
  let best = null;
  for (const tool of tools || []) {
    for (const pattern of tool.patterns || []) {
      const params = matchPattern(pattern, segments);
      if (!params) continue;
      const literals = split(pattern).filter((part) => !part.startsWith(':')).length;
      if (!best || literals > best.literals) best = { tool, pattern, params, literals };
    }
  }
  if (!best) return null;
  return { tool: best.tool, pattern: best.pattern, params: best.params };
}

export function filterStarters(tool) {
  const seen = new Set();
  const starters = [];
  for (const raw of tool?.starters || []) {
    const text = String(raw || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    starters.push(text);
    if (starters.length >= 6) break;
  }
  return starters;
}

export function sanitizeVisibleState(state, allowedKeys = []) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return {};
  const allowed = new Set(allowedKeys);
  const clean = {};
  for (const [key, value] of Object.entries(state)) {
    if (Object.keys(clean).length >= MAX_STATE_KEYS) break;
    if (!allowed.has(key) || SECRET_KEY.test(key)) continue;
    if (typeof value === 'string') {
      const text = value.trim();
      if (text) clean[key] = text.slice(0, MAX_STATE_VALUE);
    } else if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') {
      clean[key] = value;
    }
  }
  return clean;
}

const TIER_LABELS = {
  read: 'Baca',
  draft: 'Draft',
  confirmed_write: 'Perlu konfirmasi',
  controlled_decision: 'Keputusan manusia',
  system_administration: 'Super Admin',
};

export const riskTierLabel = (tier) => TIER_LABELS[tier] || tier;

export function actionAvailabilityText(action) {
  if (action.riskTier === 'controlled_decision') return 'AI hanya merekomendasikan; keputusan tetap di tangan Anda.';
  if (action.riskTier === 'system_administration') return 'AI menyiapkan pratinjau; Super Admin yang mengonfirmasi perubahan.';
  if (action.riskTier === 'read') return 'Dibaca dalam batas izin Anda.';
  if (action.executorAvailable) return 'Dijalankan hanya setelah Anda meninjau dan konfirmasi.';
  return 'Disiapkan sebagai draft atau rekomendasi; tidak dijalankan otomatis.';
}

export function panelModeForWidth(width) {
  if (width >= 1200) return 'desktop';
  if (width >= 760) return 'tablet';
  return 'mobile';
}

export function contextKeyFor(resolved) {
  if (!resolved) return null;
  const params = Object.values(resolved.params || {}).join(':');
  return `${resolved.tool.key}:${resolved.pattern}:${params}`;
}

export const PANEL_MIN_WIDTH = 320;
export const PANEL_MAX_WIDTH = 576;
export const PANEL_DEFAULT_WIDTH = 400;

export function clampPanelWidth(width) {
  const number = Number(width);
  if (!Number.isFinite(number)) return PANEL_DEFAULT_WIDTH;
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(number)));
}
