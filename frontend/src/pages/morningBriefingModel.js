// Pure helpers for the home page's "Ringkasan pagi" card (GET /work-summary/briefing).

// How many rows the card shows before "Tampilkan lainnya".
export const BRIEFING_VISIBLE_ROWS = 6;

// The hour on Prakasa's clock (WIB, UTC+7), wherever the browser is.
export const wibHour = (now = new Date()) => (now.getUTCHours() + 7) % 24;

// The severities a row can carry; its tone and label come from the one status
// map (components/statusTone.js `briefing_<severity>`).
const SEVERITIES = ['danger', 'warning', 'info'];
export const briefingStatus = (severity) => `briefing_${SEVERITIES.includes(severity) ? severity : 'info'}`;

const safeRoute = (value) => (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null);

// The answer in one known shape: an unexpected answer shows an empty card
// instead of breaking the home page.
export function normalizeBriefing(data) {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const headline = source.headline && typeof source.headline === 'object' ? source.headline : {};
  const items = (Array.isArray(source.items) ? source.items : [])
    .filter((item) => item && typeof item === 'object' && item.key && Number(item.count) > 0)
    .map((item) => ({
      key: String(item.key),
      label: String(item.label || ''),
      count: Number(item.count),
      severity: SEVERITIES.includes(item.severity) ? item.severity : 'info',
      group: item.group || 'attention',
      route: safeRoute(item.route),
      ageHours: Number.isFinite(Number(item.ageHours)) && item.ageHours != null ? Number(item.ageHours) : null,
      examples: (Array.isArray(item.examples) ? item.examples : []).slice(0, 3)
        .filter((example) => example && example.title)
        .map((example) => ({ title: String(example.title), route: safeRoute(example.route), translate: example.translate === true })),
    }));
  const pending = (Array.isArray(source.tertunda) ? source.tertunda : []).map(String);
  const failed = (Array.isArray(source.gagal) ? source.gagal : []).map(String);
  return {
    headline: {
      total: Number(headline.total) || 0,
      lead: String(headline.lead || ''),
      parts: (Array.isArray(headline.parts) ? headline.parts : []).filter((part) => part && part.text).map((part) => ({ key: String(part.key), text: String(part.text) })),
    },
    items,
    pending,
    failed,
    allClear: items.length === 0 && pending.length === 0 && failed.length === 0,
  };
}

// "menunggu 3 hari" / "menunggu 5 jam" — how long the oldest one has waited.
export function waitingText(hours) {
  if (hours == null || !Number.isFinite(hours) || hours < 1) return '';
  if (hours < 24) return `menunggu ${Math.floor(hours)} jam`;
  return `menunggu ${Math.floor(hours / 24)} hari`;
}

// The question put into Prakasa AI's message box for one row (the user reads
// it, may change it, and sends it themselves).
export function briefingQuestion(item) {
  return `Tentang ${item.label} (${item.count}) di ringkasan pagi saya: apa yang perlu saya tindak lebih dulu, dan mengapa?`;
}

// Collapsed or open, remembered per user in this browser.
const collapseKey = (userId) => `pw.briefing.collapsed.${userId || 'me'}`;
export function readCollapsed(userId, storage = globalThis.localStorage) {
  try { return storage?.getItem(collapseKey(userId)) === '1'; } catch { return false; }
}
export function writeCollapsed(userId, collapsed, storage = globalThis.localStorage) {
  try { storage?.setItem(collapseKey(userId), collapsed ? '1' : '0'); } catch { /* storage disabled */ }
}
