// The contract every division module signs to report into management.
//
// A module does not wire itself into Pusat Eskalasi, Target & realisasi and the
// Management Dashboard one by one. It exports ONE provider (a file in
// ./providers/) describing what management should see of it; the registry
// discovers the file and every management view picks it up — including the
// division scoping, since each capability receives the caller's departmentId.
//
// See docs/management-integration.md for how to write one.

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
const KEY_MAX = 40;
// A key that is stored must fit its column, or the write fails (or, without
// strict mode, is cut short and never matches again). KPI and provider keys are
// never stored, so KEY_RE's 40 characters is their only limit.
const STORED_KEYS = Object.freeze({
  escalations: Object.freeze({ max: 32, column: 'escalation_followups.source' }), // VARCHAR(32), migration 049
  metrics: Object.freeze({ max: 40, column: 'division_targets.metric_key' }), // VARCHAR(40), migration 050
});
const UNITS = Object.freeze(['issue', 'poin', '%', 'hari', 'item', 'rupiah']);
const BETTER = Object.freeze(['higher', 'lower']);
// A permission code as stored in permissions.code, e.g. 'procurement.price.view'.
const PERMISSION_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
// What a caller without a KPI's or metric's permission reads instead of the figure.
const RESTRICTED_TEXT = 'Hanya untuk yang berwenang melihat angka ini';

function fail(provider, message) {
  const name = provider && typeof provider.key === 'string' ? provider.key : '(tanpa key)';
  return new Error(`Provider manajemen "${name}": ${message}`);
}

function checkList(provider, list, field, checkItem) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw fail(provider, `${field} harus berupa array`);
  list.forEach((item, index) => checkItem(item, `${field}[${index}]`));
  return list;
}

function requireKey(provider, item, where, stored = null) {
  if (!item || typeof item !== 'object') throw fail(provider, `${where} harus berupa objek`);
  const key = String(item.key || '');
  const max = stored ? stored.max : KEY_MAX;
  if (!KEY_RE.test(key)) throw fail(provider, `${where}.key harus snake_case (a-z, 0-9, _), maks ${max} karakter`);
  if (stored && key.length > stored.max) throw fail(provider, `${where}.key maks ${stored.max} karakter (kolom ${stored.column})`);
  if (!String(item.label || '').trim()) throw fail(provider, `${where}.label wajib diisi (bahasa Indonesia)`);
}

function requireFn(provider, item, name, where) {
  if (typeof item[name] !== 'function') throw fail(provider, `${where}.${name} harus berupa fungsi async`);
}

// Optional on a KPI or metric: a figure only part of management may see (purchase
// prices, P1). One code or a list; holding any one of them is enough — the same
// "any of" rule as requirePermission. Without it the figure is never computed.
function checkPermission(provider, item, where) {
  if (item.permission === undefined) {
    if (item.restrictedText !== undefined) throw fail(provider, `${where}.restrictedText hanya dipakai bersama permission`);
    return;
  }
  const codes = Array.isArray(item.permission) ? item.permission : [item.permission];
  if (!codes.length || !codes.every((code) => typeof code === 'string' && PERMISSION_RE.test(code))) {
    throw fail(provider, `${where}.permission harus kode izin (mis. "procurement.price.view") atau daftar kode izin`);
  }
  if (item.restrictedText !== undefined && !(typeof item.restrictedText === 'string' && item.restrictedText.trim())) {
    throw fail(provider, `${where}.restrictedText harus berupa teks bahasa Indonesia`);
  }
}

/** Whether a caller holding `permissions` may see this KPI or metric. */
function permitted(item, permissions) {
  if (item?.permission == null) return true;
  const held = Array.isArray(permissions) ? permissions : [];
  const codes = Array.isArray(item.permission) ? item.permission : [item.permission];
  return codes.some((code) => held.includes(code));
}

/** The line shown instead of a figure the caller may not see. */
function restrictedText(item) {
  return (typeof item?.restrictedText === 'string' && item.restrictedText.trim()) || RESTRICTED_TEXT;
}

/**
 * Validates a provider and returns it frozen. Throws with an Indonesian message
 * naming the provider and the exact field, so a broken module fails loudly at
 * startup and in the guard test — never silently vanishes from management.
 */
function validateProvider(provider) {
  if (!provider || typeof provider !== 'object') throw fail(provider, 'modul harus mengekspor objek');
  if (!KEY_RE.test(String(provider.key || ''))) throw fail(provider, `key harus snake_case (a-z, 0-9, _), maks ${KEY_MAX} karakter`);
  if (!String(provider.label || '').trim()) throw fail(provider, 'label wajib diisi');
  if (!Array.isArray(provider.navPaths) || !provider.navPaths.every((p) => typeof p === 'string' && p.startsWith('/'))) {
    throw fail(provider, 'navPaths harus berupa daftar rute menu yang diwakili provider ini, mis. ["/warehouse"]');
  }

  const escalations = checkList(provider, provider.escalations, 'escalations', (item, where) => {
    requireKey(provider, item, where, STORED_KEYS.escalations);
    requireFn(provider, item, 'list', where);
    // locate() is what lets a follow-up write be scoped exactly like the read.
    requireFn(provider, item, 'locate', where);
    // Escalation texts never carry a restricted figure, so there is nothing to gate:
    // refuse the field rather than let it look enforced when it is not.
    if (item.permission !== undefined) {
      throw fail(provider, `${where}.permission tidak berlaku untuk eskalasi — teks eskalasi tidak boleh memuat angka yang dibatasi izin`);
    }
  });
  const metrics = checkList(provider, provider.metrics, 'metrics', (item, where) => {
    requireKey(provider, item, where, STORED_KEYS.metrics);
    requireFn(provider, item, 'actuals', where);
    if (!UNITS.includes(item.unit)) throw fail(provider, `${where}.unit harus salah satu dari ${UNITS.join(', ')}`);
    if (!BETTER.includes(item.better)) throw fail(provider, `${where}.better harus "higher" atau "lower"`);
    if (typeof item.cumulative !== 'boolean') throw fail(provider, `${where}.cumulative harus true atau false`);
    // Optional: the exact company-wide value of a rate/average (not a mean of divisions).
    if (item.entityActuals !== undefined && typeof item.entityActuals !== 'function') {
      throw fail(provider, `${where}.entityActuals harus berupa fungsi async (entityId, period) → angka atau null`);
    }
    // Optional: billed once a month (true, or the division codes it applies to).
    if (item.billedMonthly !== undefined && item.billedMonthly !== true
      && !(Array.isArray(item.billedMonthly) && item.billedMonthly.every((c) => typeof c === 'string' && KEY_RE.test(c)))) {
      throw fail(provider, `${where}.billedMonthly harus true atau daftar kode divisi`);
    }
    checkPermission(provider, item, where);
  });
  const kpis = checkList(provider, provider.kpis, 'kpis', (item, where) => {
    requireKey(provider, item, where);
    requireFn(provider, item, 'value', where);
    checkPermission(provider, item, where);
  });

  const reportsSomething = escalations.length || metrics.length || kpis.length;
  if (!reportsSomething && !String(provider.optOut || '').trim()) {
    throw fail(provider, 'belum melaporkan apa pun ke manajemen. Isi escalations, metrics atau kpis — '
      + 'atau tulis optOut berisi alasan kenapa modul ini memang tidak perlu dilaporkan.');
  }
  return Object.freeze({ ...provider, escalations, metrics, kpis });
}

module.exports = {
  validateProvider, permitted, restrictedText, UNITS, BETTER, KEY_RE, KEY_MAX, STORED_KEYS, RESTRICTED_TEXT,
};
