// What the browser does for Prakasa AI on the page (Wave C,
// docs/prakasa-ai-rencana.md §9.8). The server sends a `client_tool` request on
// the answer's stream; this module carries it out and the result goes back
// (POST /ai-command/sessions/:id/tool-results).
//
// It knows three operations and nothing else:
//   buka_halaman   → navigate: an in-app route the user may open (the router)
//   baca_formulir  → readForms: the forms the page registered
//   isi_form       → fillForm: values into ONE registered form, through the
//                    form's own state setter (aiFormModel.js fillForm). A lookup
//                    or person field is resolved with the search the page gave
//                    for it — the same call the user's typing makes
// There is no operation that saves, sends, approves or deletes, and nothing
// here touches the DOM: no button is ever pressed, no event is ever fired.
// test/aiClientTools.test.js reads this file to keep it that way.
import { describeForm, fillFormAsync, isDirty, permissionList, recordOf } from './aiFormModel.js';

const ROUTE = /^\/[A-Za-z0-9\-._~/%]*(\?[A-Za-z0-9\-._~%=&+]*)?$/;
const MAX_ROUTE = 300;
export const CLIENT_OPERATIONS = Object.freeze(['buka_halaman', 'baca_formulir', 'isi_form']);

// "/it/tickets/new", "/finance/payment-requests?baru=1": a path inside this
// app. Never a URL, another origin, a protocol or a path that climbs.
export function parseInAppRoute(value) {
  const route = typeof value === 'string' ? value.trim() : '';
  if (!route || route.length > MAX_ROUTE || !ROUTE.test(route)) return null;
  if (route.startsWith('//') || route.includes('..') || route.includes('//')) return null;
  const [pathname, search = ''] = route.split('?');
  return { route, pathname: pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname, search: search ? `?${search}` : '' };
}

// Query parameters that open a form (useOpenFromUrl.js): ?baru=1 a create
// form, ?ubah=<id> an edit form, ?form=<name> a named dialog, ?buat=<id> a
// form made from a record, ?aksi=<name> an action dialog; `bantuan`,
// `kunjungan` are the pilots' own. `open`, `lead`, `langganan`, `issue` and
// `tab` only say which record or tab a form belongs to: they come WITH one of
// these (or the server says the route opens a form: harap_formulir), and on
// their own they are not waited on. None of them leaves the page: see openRoute.
export const OPEN_PARAMS = Object.freeze(['baru', 'ubah', 'form', 'buat', 'aksi', 'bantuan', 'kunjungan']);
const OPEN_PARAM = new RegExp(`(^|&)(${OPEN_PARAMS.join('|')})=`);

const holds = (permissions, code) => (permissions || []).includes(code);
// The form's permission: one code, or a list that means "any of".
const holdsAny = (permissions, permission) => permissionList(permission).some((code) => holds(permissions, code));
const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * registry        createFormRegistry() — the forms on the page
 * navigate(to)    the router's navigate
 * getLocation()   { pathname, search }
 * getPermissions() the signed-in user's permission codes
 * canOpen(pathname, permissions) hasRouteAccess (components/navigation.js)
 * confirmLeave(titles) → Promise<boolean>: asked in the app when a registered
 *                 form has unsaved changes; anything but `true` stays
 * beforeNavigate(route) optional hook (the panel keeps its conversation)
 * onOpened(forms) optional hook: a route was opened and a form is on the page
 * onFilled(id, result) optional hook after a fill that set something (the
 *                 panel steps aside on a small screen so the form is seen)
 */
export function createClientToolExecutor({
  registry, navigate, getLocation, getPermissions, canOpen, confirmLeave, beforeNavigate = null,
  sleep = delay, now = () => Date.now(), formWaitMs = 5000, settleMs = 250, onOpened = null, onFilled = null, lookupOptions = {},
}) {
  const formsNow = () => registry.list().map((entry) => ({ id: entry.id, judul: String(entry.getConfig()?.title || entry.id) }));

  // The page a route opens may load lazily and open its form a moment later.
  async function waitForForms(expectForm) {
    const started = now();
    await sleep(settleMs);
    while (expectForm && !registry.list().length && now() - started < formWaitMs) await sleep(150);
    return formsNow();
  }

  async function openRoute(input) {
    const parsed = parseInAppRoute(input?.rute);
    if (!parsed) return { dibuka: false, alasan: 'Rute tidak valid: hanya halaman di dalam aplikasi.' };
    if (!canOpen(parsed.pathname, getPermissions())) return { dibuka: false, alasan: 'Pengguna tidak punya akses ke halaman itu.' };
    const here = getLocation();
    const samePlace = here.pathname === parsed.pathname && (here.search || '') === parsed.search;
    // Only LEAVING the page asks: opening a form, a tab or a record on the same
    // pathname (?form=…, ?baru=…, ?ubah=…, ?open=…, ?aksi=…, ?tab=…) keeps the
    // page and whatever is on it.
    const leaving = here.pathname !== parsed.pathname;
    const unsaved = leaving ? registry.list().filter((entry) => isDirty(entry)) : [];
    if (unsaved.length) {
      const leave = await confirmLeave(unsaved.map((entry) => String(entry.getConfig()?.title || entry.id)));
      if (leave !== true) return { dibuka: false, alasan: 'Ada formulir yang belum disimpan dan pengguna memilih tetap di halaman ini.' };
    }
    if (!samePlace) {
      if (beforeNavigate) beforeNavigate(parsed);
      navigate(parsed.route);
    }
    // The server says when the route is one a form opens on (its catalog); the
    // URL-open parameters (useOpenFromUrl) say so too.
    const expectForm = input?.harap_formulir === true || OPEN_PARAM.test(parsed.search.slice(1)) || /\/(new|baru)$/.test(parsed.pathname);
    const forms = await waitForForms(expectForm);
    if (forms.length && onOpened) onOpened(forms);
    // Forms on the page that still hold unsaved input (a page keeps such a form
    // rather than replace it with the one the route asked for — useOpenFromUrl keepUnsaved).
    const dirty = registry.list().filter((entry) => isDirty(entry)).map((entry) => ({ id: entry.id, judul: String(entry.getConfig()?.title || entry.id) }));
    return { dibuka: true, rute: parsed.route, formulir: forms, ...(dirty.length ? { belum_disimpan: dirty } : {}) };
  }

  // A fill sets the form's state through React: give it a moment to commit
  // (the registry already answers with the values the AI set — aiFormModel formState).
  const fillPending = () => registry.list().some((entry) => [...entry.filled.values()].some((mark) => !mark.seen));

  async function readForms(input) {
    if (!registry.list().length) await sleep(settleMs);
    // The server opened a route a form opens on: the form may still be loading its lookups.
    const started = now();
    while (input?.harap_formulir === true && !registry.list().length && now() - started < formWaitMs) await sleep(150);
    if (fillPending()) await sleep(30);
    const here = getLocation();
    return { rute: `${here.pathname}${here.search || ''}`, formulir: registry.list().map(describeForm) };
  }

  async function fill(input) {
    const id = String(input?.formulir || '');
    let entry = registry.get(id);
    for (let waited = 0; !entry && waited < formWaitMs; waited += 150) {
      await sleep(150);
      entry = registry.get(id);
    }
    if (!entry) throw new Error('Formulir itu tidak terbuka di halaman ini.');
    const config = entry.getConfig() || {};
    if (!holdsAny(getPermissions(), config.permission)) throw new Error('Pengguna tidak punya izin untuk formulir ini.');
    if (config.mode === 'edit' && !recordOf(config)) throw new Error('Formulir ubah ini tidak menyebut data yang diubah.');
    const result = await fillFormAsync(entry, input?.isian, { now: now(), registry, ...lookupOptions });
    if (result.diisi.length && onFilled) onFilled(id, result);
    return { formulir: id, ...result };
  }

  const OPERATIONS = { buka_halaman: openRoute, baca_formulir: readForms, isi_form: fill };

  // One request at a time, in the order they arrive (open the page, then fill).
  let queue = Promise.resolve();
  return function run(call) {
    const job = queue.then(async () => {
      const operation = Object.prototype.hasOwnProperty.call(OPERATIONS, call?.tool) ? OPERATIONS[call.tool] : null;
      if (!operation) return { ok: false, error: 'Permintaan ini tidak dikenal halaman.' };
      try {
        return { ok: true, result: await operation(call.input || {}) };
      } catch (error) {
        return { ok: false, error: String(error?.message || 'Halaman tidak bisa menjalankannya').slice(0, 300) };
      }
    });
    queue = job.catch(() => {});
    return job;
  };
}
