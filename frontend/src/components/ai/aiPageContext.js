// The standard page context every page hands to Prakasa AI (pure functions;
// the server sanitises again — backend/src/services/aiToolContext.service.js
// sanitizePageContext — so this only decides what leaves the browser).
//
//   { route, title, filters, selection, counts, formState? }
//     route      pathname of the page
//     title      the page heading (the registry title until a PageHeader renders)
//     filters    allow-listed URL parameters + search/sort of the list on screen
//     selection  the open record: { type, id, name? } — ids from the route,
//                a display name only when the page gives one
//     counts     rows on screen / matching (integers only)
//     formState  { id, dirty } of an open form (Wave C: isi_form)
//
// Where it comes from, so a page needs no code of its own:
//   • the provider (context/PrakasaAIToolContext.jsx): route, registry title,
//     URL filters, the record id from the route — EVERY route under Layout;
//   • <PageHeader>: the heading as title (not when it is a record's own name);
//   • <DataGrid>: search text, sort and row counts;
//   • usePublishPrakasaAIPage({ … }): one line for anything more specific.
// A page whose registry entry says publishesState: false publishes nothing.
// Never money and never personal fields: keys that look like either are
// dropped, counts are whole numbers, and no row content is ever sent.

const MAX_KEYS = 12;
const MAX_TEXT = 120;
const SECRET_KEY = /pass(word)?|token|secret|api[-_]?key|credential|auth|cookie|session/i;
// Rupiah-shaped and personal-data-shaped keys (same families as the server's output guard).
const SENSITIVE_KEY = /harga|price|nilai|amount|nominal|dpp|ppn|pajak|tax|diskon|spend|belanja|biaya|cost|margin|rupiah|omzet|revenue|piutang|utang|saldo|gaji|salary|rekening|bank|npwp|nik|ktp|bpjs|phone|telepon|alamat|address|email/i;

export const isSensitiveKey = (key) => SECRET_KEY.test(key) || SENSITIVE_KEY.test(key);

const cleanText = (value, max = MAX_TEXT) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
};

export function cleanFilters(filters) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(filters)) {
    if (Object.keys(clean).length >= MAX_KEYS) break;
    if (isSensitiveKey(key)) continue;
    if (typeof value === 'string') {
      const text = cleanText(value);
      if (text) clean[key] = text;
    } else if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') {
      clean[key] = value;
    }
  }
  return clean;
}

export function cleanCounts(counts) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(counts)) {
    if (Object.keys(clean).length >= MAX_KEYS) break;
    if (isSensitiveKey(key) || !Number.isInteger(value) || value < 0) continue;
    clean[key] = value;
  }
  return clean;
}

export function cleanSelection(selection) {
  if (!selection || typeof selection !== 'object') return null;
  const type = cleanText(String(selection.type || ''), 40);
  const id = cleanText(String(selection.id ?? ''), 64);
  if (!type || !id) return null;
  const name = cleanText(selection.name);
  return { type, id, ...(name ? { name } : {}) };
}

export function cleanFormState(formState) {
  if (!formState || typeof formState !== 'object') return null;
  const id = cleanText(String(formState.id || ''), 60);
  if (!id) return null;
  return { id, dirty: Boolean(formState.dirty) };
}

// URL parameters the registry allows for this page (the same list the server uses).
export function queryFilters(tool, search) {
  const allowed = new Set(tool?.queryKeys || []);
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const out = {};
  for (const [key, value] of params.entries()) if (allowed.has(key)) out[key] = value;
  return cleanFilters(out);
}

// The open record named by the route itself: /tasks/12 → { type: 'task', id: '12' }.
export function routeSelection(resolved) {
  const id = resolved?.params?.id;
  if (!id || !/^[1-9]\d{0,9}$/.test(String(id))) return null;
  const type = resolved.tool.subjectTypes?.[0] || resolved.tool.key;
  return { type, id: String(id) };
}

// What one <DataGrid> says about itself.
export function gridPart({ title, search, sort, shown, total }) {
  const filters = {};
  const text = cleanText(search || '');
  if (text) filters.cari = text;
  if (sort?.id) filters.urut = `${cleanText(String(sort.id), 60)} ${sort.desc ? 'turun' : 'naik'}`;
  const counts = {};
  if (Number.isInteger(shown)) counts.baris_tampil = shown;
  if (Number.isInteger(total)) counts.baris_cocok = total;
  const name = typeof title === 'string' ? cleanText(title, 80) : '';
  return { ...(name ? { daftar: name } : {}), filters, counts };
}

// Merges the provider's own knowledge with what the page's parts published.
//   parts: { header?: { title }, grids?: [gridPart…], page?: { title, filters, selection, counts, formState } }
// Returns null when the page publishes nothing.
export function buildPageContext({ resolved, pathname, search = '', parts = {} }) {
  const tool = resolved?.tool;
  if (!tool || tool.publishesState === false) return null;
  const page = parts.page || {};
  const grid = (parts.grids || [])[0] || null;
  const title = cleanText(page.title || parts.header?.title || '') || tool.title;
  const filters = cleanFilters({
    ...queryFilters(tool, search),
    ...(grid?.filters || {}),
    ...(grid?.daftar ? { daftar: grid.daftar } : {}),
    ...cleanFilters(page.filters),
  });
  const explicit = cleanSelection(page.selection);
  const fromRoute = routeSelection(resolved);
  const selection = explicit || fromRoute;
  const counts = cleanCounts({ ...(grid?.counts || {}), ...cleanCounts(page.counts) });
  const formState = cleanFormState(page.formState);
  return {
    route: String(pathname || '').split('?')[0].split('#')[0],
    title,
    filters,
    selection,
    counts,
    ...(formState ? { formState } : {}),
  };
}
