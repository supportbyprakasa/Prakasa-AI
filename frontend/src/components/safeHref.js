// Link guards for data that came from the server or another user (security
// review, Oct 2026). Pure, so they can be unit tested.

const EXTERNAL_SCHEMES = new Set(['https:', 'http:', 'mailto:']);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// A stored URL (KantorKu reference, portal, Chat space…) as an href: only
// https:, http: and mailto: — never javascript:, data: or vbscript:, whatever
// the casing or whitespace. Anything else returns null (render plain text).
export function safeExternalHref(url) {
  if (typeof url !== 'string') return null;
  const value = url.trim();
  if (!value || CONTROL_CHARS.test(value)) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  return EXTERNAL_SCHEMES.has(parsed.protocol) ? parsed.href : null;
}

// An in-app path from data (notification action, AI inbox, escalation link):
// must start with a single "/", and contain no backslash (browsers read
// "/\host" as "//host") or control character. Returns the trimmed path or null.
export function safeInAppPath(path) {
  if (typeof path !== 'string') return null;
  const value = path.trim();
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\') || CONTROL_CHARS.test(value)) return null;
  return value;
}
