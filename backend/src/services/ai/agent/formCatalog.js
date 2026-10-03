const fs = require('node:fs');
const path = require('node:path');
const { fieldClass, moneyLike, dynamicFieldFillable, DYNAMIC_TYPES } = require('./fieldPolicy');


// Forms Prakasa AI can open and fill (Wave C, docs/prakasa-ai-rencana.md §9.8,
// §9.9, §9.11). One file per module under forms/ (forms/<module>.js exports an
// array; a file starting with "_" is a helper and is skipped), found when the
// server starts — so two people adding forms for two modules never edit the
// same file. A form that breaks a rule below stops the server with a clear
// message: a wrong entry never reaches the model.
//
// The PAGE registers a form's fields in the browser (usePrakasaAIForm) and the
// agent reads them there (baca_formulir). The catalog is the server's own word
// on that form, so it never relies on what a browser says:
//   id          the id the page registers with usePrakasaAIForm (unique)
//   title       shown in the steps ("Mengisi 4 kolom di formulir Tiket IT")
//   route       how buka_halaman opens it: an in-app route; `<…>` marks a value
//               the agent takes from the page it is on or from a read tool
//   permission  the form's own permission (the code of its save endpoint); a
//               list means "any of" — for an endpoint that accepts alternatives
//   requires    codes the save endpoint needs IN ADDITION (all of them): a
//               router-wide gate (router.use(requirePermission('x.view'))) or a
//               second requirePermission on the route. The user must hold one
//               of `permission` AND every code of `requires`. The catalog is
//               never wider than the endpoint: test/aiFormsPermissions.test.js
//               compares every form with its endpoint's real middleware.
//   file        the component that registers it, relative to frontend/src
//   fields      the field policy:
//                 ai        names the AI may fill ('items' and 'items.itemName'
//                           for a rows field and its columns)
//                 userOnly  names listed to the AI but filled by the user only
//               A field the page registers but `ai` does not name is NOT
//               fillable. Names of secrets, bank accounts, decisions,
//               signatures and uploads (fieldPolicy.js) can never be in `ai`.
//   money       names in `ai` that hold rupiah — allowed only for the forms in
//               MONEY_FORMS (the user's own request amount; never a price)
//   mode        'create' (default) | 'edit' — an edit form also names `record`,
//               the type of the record it changes (audit: type + id)
//   note        for the model: what stays with the user on this form
//   dynamicFields  true for a form whose field NAMES are only known in the
//               browser (the placeholders of a document template). Such a field
//               is fillable only when its name is open (fieldPolicy.js: not a
//               secret, bank, decision, upload, personal or infrastructure
//               name), holds no rupiah and no phone number, and its type is
//               text, textarea or date (fieldPolicy.js dynamicFieldFillable).
//               Reviewed by hand: only the forms in DYNAMIC_FORMS.
//
// A form a page registers but no file lists cannot be filled.

const FORMS_DIR = path.join(__dirname, 'forms');
const ID = /^[A-Za-z][A-Za-z0-9_.-]{0,59}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_-]{0,59}(\.[A-Za-z][A-Za-z0-9_-]{0,59})?$/;
const PERMISSION = /^[a-z_]+(\.[a-z_]+)+$/;
const RECORD = /^[a-z][a-z0-9_]{0,39}$/;
// Forms whose field names come from the page at runtime. Reviewed by hand — a
// module file cannot add itself here.
const DYNAMIC_FORMS = Object.freeze(['doc-generate']);
const MAX_REQUIRES = 3;
const permissionsOf = (permission) => (Array.isArray(permission) ? permission : [permission]);
const validPermission = (permission) => {
  const list = permissionsOf(permission);
  return list.length > 0 && list.length <= 4 && list.every((code) => typeof code === 'string' && PERMISSION.test(code)) && new Set(list).size === list.length;
};
const FORBIDDEN = 'tidak pernah boleh diisi AI (rahasia, rekening bank, keputusan, tanda tangan, unggahan, data pribadi, atau pengenal infrastruktur)';
const ROUTE = /^\/[A-Za-z0-9\-._~/%]*(\?[A-Za-z0-9\-._~%=&+]*)?$/;
const HERE = '<halaman saat ini>';
// Forms where the AI may fill a rupiah field: the user's own request amount.
// Reviewed by hand — a module file cannot add itself here.
const MONEY_FORMS = Object.freeze(['payment-request']);

function formFiles(dir = FORMS_DIR) {
  return fs.readdirSync(dir).filter((file) => file.endsWith('.js') && !file.startsWith('_')).sort();
}

function validateForm(form, { seen = new Set(), moneyForms = MONEY_FORMS, dynamicForms = DYNAMIC_FORMS } = {}) {
  const errors = [];
  const say = (message) => errors.push(`${form?.id || '(tanpa id)'}: ${message}`);
  if (!form || typeof form !== 'object') return ['formulir harus berupa objek'];
  if (typeof form.id !== 'string' || !ID.test(form.id)) say('id tidak valid');
  else if (seen.has(form.id)) say('id dipakai dua kali');
  if (typeof form.title !== 'string' || !form.title.trim()) say('title wajib');
  if (typeof form.note !== 'string' || !form.note.trim()) say('note wajib (apa yang tetap di tangan pengguna)');
  if (!validPermission(form.permission)) say('permission wajib: kode izin endpoint simpan formulir ini (atau daftar kode: salah satu)');
  if (form.requires !== undefined) {
    const extra = form.requires;
    // (an empty list is "nothing besides": what a sealed form without `requires` carries)
    const valid = Array.isArray(extra) && extra.length <= MAX_REQUIRES
      && extra.every((code) => typeof code === 'string' && PERMISSION.test(code)) && new Set(extra).size === extra.length;
    if (!valid) say(`requires harus daftar paling banyak ${MAX_REQUIRES} kode izin yang semuanya wajib dipegang (di samping permission)`);
    else if (validPermission(form.permission) && extra.some((code) => permissionsOf(form.permission).includes(code))) say('requires mengulang kode yang sudah ada di permission');
  }
  if (form.dynamicFields !== undefined && typeof form.dynamicFields !== 'boolean') say('dynamicFields hanya boleh true');
  if (form.dynamicFields === true && !dynamicForms.includes(form.id)) say('dynamicFields: nama kolom dari halaman hanya untuk formulir yang ada di DYNAMIC_FORMS');
  if (typeof form.file !== 'string' || !/^(pages|components)\/[A-Za-z0-9_/.-]+\.jsx$/.test(form.file) || form.file.includes('..')) say('file wajib: komponen yang mendaftarkan formulir, relatif terhadap frontend/src');
  if (typeof form.route !== 'string' || !form.route) say('route wajib');
  else {
    const concrete = (form.route.startsWith(HERE) ? `/x${form.route.slice(HERE.length)}` : form.route).replace(/<[^<>]+>/g, '1');
    if (!ROUTE.test(concrete) || concrete.includes('..') || concrete.includes('//')) say(`route "${form.route}" bukan rute dalam aplikasi`);
  }
  const mode = form.mode === undefined ? 'create' : form.mode;
  if (!['create', 'edit'].includes(mode)) say("mode harus 'create' atau 'edit'");
  if (mode === 'edit' && (typeof form.record !== 'string' || !RECORD.test(form.record))) say("mode 'edit' wajib menyebut record (jenis data yang diubah, snake_case)");
  if (mode !== 'edit' && form.record !== undefined) say("record hanya untuk mode 'edit'");

  const ai = form.fields?.ai;
  const userOnly = form.fields?.userOnly ?? [];
  if (!Array.isArray(ai) || !ai.length) say('fields.ai wajib: nama kolom yang boleh diisi AI');
  if (!Array.isArray(userOnly)) say('fields.userOnly harus array');
  const money = form.money ?? [];
  if (!Array.isArray(money)) say('money harus array nama kolom');
  if (Array.isArray(ai) && Array.isArray(userOnly) && Array.isArray(money)) {
    const names = new Set();
    for (const name of [...ai, ...userOnly]) {
      if (typeof name !== 'string' || !FIELD.test(name)) { say(`nama kolom "${name}" tidak valid`); continue; }
      if (names.has(name)) say(`kolom "${name}" disebut dua kali`);
      names.add(name);
    }
    for (const name of ai.filter((item) => typeof item === 'string' && FIELD.test(item))) {
      const [parent, column] = name.split('.');
      // A forbidden class is refused by name — also for a column inside rows.
      for (const part of [parent, column].filter(Boolean)) {
        if (fieldClass(part) !== 'open') say(`kolom "${name}" ${FORBIDDEN}`);
      }
      if (column && !ai.includes(parent)) say(`kolom "${name}": daftar barisnya ("${parent}") belum ada di fields.ai`);
      if (moneyLike(column || parent)) {
        if (!moneyForms.includes(form.id)) say(`kolom "${name}" berisi rupiah: AI hanya boleh mengisi nominal permintaan pengguna sendiri, di formulir yang ada di MONEY_FORMS`);
        else if (!money.includes(name)) say(`kolom "${name}" berisi rupiah: sebut di money`);
      }
    }
    for (const name of money) if (!ai.includes(name)) say(`money "${name}" tidak ada di fields.ai`);
  }
  return errors;
}

function validateForms(forms, options = {}) {
  const errors = [];
  const seen = new Set();
  for (const form of forms) {
    errors.push(...validateForm(form, { ...options, seen }));
    if (form?.id) seen.add(form.id);
  }
  return errors;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Does an opened route open this form? ("/ga?baru=atk", "/tasks?board=3&baru=1")
function routeMatcher(route) {
  const anywhere = route.startsWith(HERE);
  const [pathPart, search = ''] = (anywhere ? route.slice(HERE.length) : route).split('?');
  const pathRe = anywhere ? null : new RegExp(`^${pathPart.split(/<[^<>]+>/).map(escape).join('[^/]+')}$`);
  const needed = search.split('&').filter(Boolean).map((pair) => {
    const [key, value = ''] = pair.split('=');
    return [key, value.startsWith('<') ? null : value];
  });
  return ({ pathname, search: query = '' }) => {
    if (pathRe && !pathRe.test(pathname)) return false;
    const params = new URLSearchParams(query);
    return needed.every(([key, value]) => params.get(key) !== null && params.get(key) !== '' && (value === null || params.get(key) === value));
  };
}

function seal(form, file) {
  return Object.freeze({
    ...form,
    mode: form.mode || 'create',
    module: file.replace(/\.js$/, ''),
    fields: Object.freeze({ ai: Object.freeze([...form.fields.ai]), userOnly: Object.freeze([...(form.fields.userOnly || [])]) }),
    money: Object.freeze([...(form.money || [])]),
    permission: Array.isArray(form.permission) ? Object.freeze([...form.permission]) : form.permission,
    permissions: Object.freeze(permissionsOf(form.permission)),
    requires: Object.freeze([...(form.requires || [])]),
    dynamicFields: form.dynamicFields === true,
    fillable: new Set(form.fields.ai),
    opens: routeMatcher(form.route),
  });
}

function loadForms(dir = FORMS_DIR) {
  const loaded = [];
  for (const file of formFiles(dir)) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const exported = require(path.join(dir, file));
    if (!Array.isArray(exported)) throw new Error(`Formulir AI: ${file} harus mengekspor array formulir`);
    for (const form of exported) loaded.push({ form, file });
  }
  const errors = validateForms(loaded.map((entry) => entry.form));
  if (errors.length) throw new Error(`Katalog formulir AI melanggar aturan:\n- ${errors.join('\n- ')}`);
  return loaded.map(({ form, file }) => seal(form, file));
}

const FORMS = Object.freeze(loadForms());
const byId = new Map(FORMS.map((form) => [form.id, form]));
const holds = (user, code) => (user?.permissions || []).includes(code);
// Any of the form's permissions (one code for most forms) AND every code the
// endpoint needs besides (`requires`): never wider than the save endpoint.
const mayFill = (user, form) => form.permissions.some((code) => holds(user, code)) && (form.requires || []).every((code) => holds(user, code));

// May the AI fill this field of this form? The catalog's list, or — on a form
// whose field names come from the page — the name policy and the field's type.
function allows(form, name, type = null) {
  if (form.fillable.has(name)) return true;
  if (!form.dynamicFields || name.includes('.') || form.fields.userOnly.includes(name)) return false;
  return dynamicFieldFillable(name, type);
}

const plain = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// What a `<…>` in a route stands for: what the agent must know to open the form.
const needsOf = (route) => [...route.matchAll(/<([^<>]+)>/g)].map((match) => match[1]).filter((value) => value !== 'halaman saat ini');
const asListed = (form) => ({
  formulir: form.id, judul: form.title, rute: form.route, ...(form.mode === 'edit' ? { mode: 'ubah' } : {}),
  ...(needsOf(form.route).length ? { rute_butuh: needsOf(form.route) } : {}), catatan: form.note,
});

// The forms this user may open, as the model sees them. `page`: an in-app
// pathname ("/ga") — forms that open under it; `search`: words of the id,
// title or note.
function formsFor(user, { page = null, search = null } = {}) {
  let list = FORMS.filter((form) => mayFill(user, form));
  if (page) {
    const base = String(page).split('?')[0].replace(/\/+$/, '') || '/';
    const under = (form) => {
      if (form.route.startsWith(HERE)) return true;
      const own = form.route.split('?')[0];
      return own === base || own.startsWith(`${base}/`) || new RegExp(`^${own.split(/<[^<>]+>/).map(escape).join('[^/]+')}$`).test(base);
    };
    list = list.filter(under);
  }
  const words = plain(search).split(' ').filter(Boolean);
  if (words.length) list = list.filter((form) => { const hay = plain(`${form.id} ${form.title} ${form.note} ${form.module} ${form.route}`); return words.every((word) => hay.includes(word)); });
  return list.map(asListed);
}

// Does opening this route open a listed form? (the browser then waits for it)
const opensForm = (parsed) => FORMS.some((form) => form.opens(parsed));

module.exports = {
  FORMS, MONEY_FORMS, DYNAMIC_FORMS, DYNAMIC_TYPES, FORMS_DIR, byId, formsFor, mayFill, allows, needsOf, opensForm, formFiles, loadForms, validateForm, validateForms, routeMatcher,
};
