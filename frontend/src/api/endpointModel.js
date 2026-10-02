// Pure endpoint resolution (no import.meta) so node --test can cover it.
//
// Production (cPanel): the SPA is served from https://<domain> and the API from
// https://api.<domain>. VITE_API_URL is baked in at build time, e.g.
// https://api.<domain>/api/v1. The backend serves public document
// verification at <api origin>/verify/:code (backend/src/app.js), outside
// /api/v1, so the verification base is the API origin.
//
// Without VITE_API_URL a production build falls back to the same-origin
// '/api/v1' and '/api/public' paths of the legacy Vercel rewrites
// (frontend/vercel.json).
const DEFAULT_API = '/api/v1';
const DEV_FALLBACK_API = 'http://localhost:3000/api/v1';
const LEGACY_PUBLIC_BASE = '/api/public';

const trimSlash = (value) => value.replace(/\/+$/, '');
const isAbsolute = (value) => /^https?:\/\//i.test(value);

export function resolveApiBaseUrl({ apiUrl = '' } = {}) {
  const configured = String(apiUrl || '').trim();
  if (!configured) return DEFAULT_API;
  return trimSlash(configured) || DEFAULT_API;
}

export function resolvePublicVerificationBaseUrl({ dev = false, apiUrl = '' } = {}) {
  const configured = String(apiUrl || '').trim();
  if (dev) {
    // Dev keeps its old behaviour: the API host with /api/v1 stripped.
    return trimSlash((configured || DEV_FALLBACK_API).replace(/\/api\/v1\/?$/, ''));
  }
  if (isAbsolute(configured)) return new URL(configured).origin;
  return LEGACY_PUBLIC_BASE;
}
