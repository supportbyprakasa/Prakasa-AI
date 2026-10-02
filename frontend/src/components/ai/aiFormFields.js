// Short ways to describe a form to Prakasa AI (Wave C2a,
// docs/prakasa-ai-rencana.md §9.9). Pure: no React, no DOM, nothing that saves.
//
//   const TICKET = defineAIForm({
//     id: 'it-ticket', title: 'Tiket IT', permission: 'it_ticket.create', submitLabel: 'Ajukan tiket',
//     fields: [f.text('title', 'Judul', { required: true, maxLength: 190 }), f.select('priority', 'Prioritas', PRIORITIES)],
//   });
//   const ai = usePrakasaAIForm(TICKET, { enabled: open, values, setValues, setErrors, initialValues: EMPTY });
//
// The rules of what the AI may fill live in aiFormModel.js; a builder only
// writes the field spec. Labels are the Indonesian labels the form shows.

import { DYNAMIC_TYPES, dynamicFieldFillable, validFieldName } from './aiFormModel.js';

const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,59}$/;
const PERMISSION = /^[a-z_]+(\.[a-z_]+)+$/;
// One permission code, or a list of up to four that means "any of" (an
// endpoint that accepts alternatives). The server's catalog names the same.
const validPermission = (permission) => {
  const list = Array.isArray(permission) ? permission : [permission];
  return list.length > 0 && list.length <= 4 && list.every((code) => PERMISSION.test(String(code || '')));
};
const spec = (type) => (name, label, options = {}) => ({ ...options, name, label, type });
const choice = (type) => (name, label, choices, options = {}) => ({ ...options, name, label, type, options: choices });
const found = (type) => (name, label, search, options = {}) => ({ ...options, name, label, type, search });

export const f = Object.freeze({
  text: spec('text'),
  textarea: spec('textarea'),
  number: spec('number'), // { min, max, step }
  date: spec('date'), // YYYY-MM-DD (WIB)
  time: spec('time'), // JJ:MM
  datetime: spec('datetime'), // YYYY-MM-DDTJJ:MM (WIB), as a datetime-local field holds it
  month: spec('month'), // YYYY-MM
  checkbox: spec('checkbox'), // also Switch
  select: choice('select'), // choices: [{ value, label }]
  radio: choice('radio'), // also Segmented
  multiselect: choice('multiselect'), // the form holds an array of values
  // A rupiah amount the USER asks for (their own request) — never a price,
  // discount, budget or target. The server's catalog must allow the form (money).
  rupiah: (name, label, options = {}) => ({ min: 0, ...options, name, label, type: 'number', currency: true }),
  // A record chosen with the page's own search: search = async (text) => [{ value, label, hint }].
  // `value` is whatever the form's state holds for the choice (an id, or the record).
  lookup: found('lookup'),
  // An employee from the directory, where the page has a people picker. Work contact only in `hint`.
  person: found('person'),
  // Repeating line items. columns = field specs; options: { maxRows, allowAdd, emptyRow, getRows, setRows, required }.
  rows: (name, label, columns, options = {}) => ({ ...options, name, label, type: 'rows', columns }),
  // Fields whose NAMES come from data (the placeholders of a document template):
  // items = [{ name, label, type?: 'text' | 'textarea' | 'date', ...options }]. A name
  // that is not open (personal, infrastructure, secret, bank …) or holds rupiah is
  // listed as user-only; a name the registry cannot hold is left out. The server's
  // catalog must mark the form `dynamicFields: true`.
  dynamic: (items) => (Array.isArray(items) ? items : []).filter((item) => item && validFieldName(item.name)).map(({ name, label, type = 'text', ...options }) => (
    dynamicFieldFillable(name, type) ? { ...options, name, label, type } : { ...options, name, label, type: DYNAMIC_TYPES.includes(type) ? type : 'text', aiFillable: false }
  )),
  // Listed for the AI (so it can tell the user), never filled by it.
  userOnly: (name, label, type = 'text', options = {}) => ({ ...options, name, label, type, aiFillable: false }),
  // Shown with its value, never changed (an edit form's fixed fields).
  readOnly: (name, label, type = 'text', options = {}) => ({ ...options, name, label, type, readOnly: true }),
});

// The part of a registration that never changes: checked once, when the module loads.
export function defineAIForm({ id, title, permission, submitLabel = 'Simpan', mode = 'create', fields = [] }) {
  if (id !== undefined && typeof id !== 'function' && !NAME.test(String(id))) throw new Error(`defineAIForm: id "${id}" tidak valid`);
  if (!title) throw new Error(`defineAIForm(${id}): title wajib`);
  if (typeof permission !== 'function' && !validPermission(permission)) throw new Error(`defineAIForm(${id}): permission wajib (kode izin endpoint simpan formulir ini, atau daftar kode: salah satu)`);
  if (!['create', 'edit'].includes(mode)) throw new Error(`defineAIForm(${id}): mode harus 'create' atau 'edit'`);
  if (typeof fields !== 'function' && !Array.isArray(fields)) throw new Error(`defineAIForm(${id}): fields harus array atau fungsi`);
  return Object.freeze({ id, title, permission: Array.isArray(permission) ? Object.freeze([...permission]) : permission, submitLabel, mode, fields });
}

const pick = (value, context) => (typeof value === 'function' ? value(context) : value);

// definition + the component's state → what usePrakasaAIForm registers.
//   values            the form's state object
//   setValues         its React setter (called with an updater) — or
//   apply(patch)      the form's own way to take several values — or
//   setters           { field: (value) => … } for forms with one state per field
//   setErrors         optional React setter of the errors object: filled fields lose their error
//   onFill(patch)     optional, before the values are set (e.g. mark the form as touched)
//   validate(values)  optional: the form's own rules → { field: 'pesan' }
//   initialValues     what counts as "not typed by the user": the empty form, or the loaded record
//   record            { type, id } of the record an edit form changes
//   context           passed to `fields`, `id` and `title` when they are functions (options that load later)
//   enabled           a dialog registers only while it is open (and, for an edit form, loaded)
//   ready             false while the options of a select or the page's lookups are still loading:
//                     the form registers only once they are there, so the AI never reads an empty option list
export function bindAIForm(definition, {
  values, setValues, apply, setters, setErrors, onFill, validate, initialValues, record, context, enabled = true, ready = true, fields, id, title, submitLabel,
} = {}) {
  const set = (patch) => {
    if (onFill) onFill(patch);
    if (apply) apply(patch);
    else {
      const rest = {};
      for (const [name, value] of Object.entries(patch)) {
        if (setters && typeof setters[name] === 'function') setters[name](value);
        else rest[name] = value;
      }
      if (Object.keys(rest).length && setValues) setValues((current) => ({ ...current, ...rest }));
    }
    if (setErrors) setErrors((current) => ({ ...current, ...Object.fromEntries(Object.keys(patch).map((name) => [name, undefined])) }));
  };
  return {
    id: id ?? pick(definition.id, context),
    title: title ?? pick(definition.title, context),
    // A function when one definition serves forms saved under different rules (context decides).
    permission: pick(definition.permission, context),
    submitLabel: submitLabel ?? pick(definition.submitLabel, context),
    mode: definition.mode,
    ...(definition.mode === 'edit' ? { record } : {}),
    enabled: Boolean(enabled) && ready !== false && (definition.mode !== 'edit' || Boolean(record && record.id !== undefined && record.id !== null && record.id !== '')),
    ...(initialValues ? { initialValues } : {}),
    fields: fields ?? pick(definition.fields, context) ?? [],
    getValues: () => values,
    setValues: set,
    ...(validate ? { validate } : {}),
  };
}
