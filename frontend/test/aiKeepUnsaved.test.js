import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFormRegistry, fillForm, syncForm, unsavedForms } from '../src/components/ai/aiFormModel.js';

// A link or Prakasa AI's buka_halaman never replaces (or covers) a form that
// holds unsaved input (docs/prakasa-ai-rencana.md §9.14): every page that opens
// a dialog from the URL says `keepUnsaved`, or is on the reviewed list below.

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const read = (file) => readFileSync(join(SRC, file), 'utf8');
const withoutComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(name)) out.push(full.slice(SRC.length));
  }
  return out;
}

const FIELDS = [{ name: 'title', label: 'Judul', type: 'text' }, { name: 'note', label: 'Catatan', type: 'textarea' }];
function register(registry, id, values = { title: '', note: '' }) {
  const state = { values: { ...values } };
  registry.register(id, () => ({
    title: id, permission: 'x.create', initialValues: { title: '', note: '' }, fields: FIELDS,
    getValues: () => state.values, setValues: (patch) => { state.values = { ...state.values, ...patch }; },
  }));
  syncForm(registry.get(id), registry);
  return state;
}

test('unsavedForms: a form with input typed by the user or filled by the AI counts; an untouched one does not', () => {
  const registry = createFormRegistry();
  assert.deepEqual(unsavedForms(registry.list(), true), [], 'no form on the page');
  const backup = register(registry, 'it-backup');
  register(registry, 'it-network');
  assert.deepEqual(unsavedForms(registry.list(), true), [], 'two open forms, nothing entered');
  // The user types.
  backup.values = { ...backup.values, title: 'Backup NAS' };
  assert.deepEqual(unsavedForms(registry.list(), true).map((entry) => entry.id), ['it-backup']);
  // The AI fills the other one: unsaved as well, before the page has even rendered it.
  const result = fillForm(registry.get('it-network'), [{ kolom: 'note', isi: 'Switch lantai 2' }], { registry });
  assert.deepEqual(result.diisi, ['note']);
  assert.deepEqual(unsavedForms(registry.list(), true).map((entry) => entry.id), ['it-backup', 'it-network']);
  // Cleared again: nothing to keep.
  backup.values = { ...backup.values, title: '' };
  assert.deepEqual(unsavedForms(registry.list(), true).map((entry) => entry.id), ['it-network']);
});

test('unsavedForms with a list: only the dialogs the opener would replace count, never the form in the page itself', () => {
  const registry = createFormRegistry();
  const comment = register(registry, 'tracker-issue-comment');
  const sprint = register(registry, 'tracker-sprint');
  const DIALOGS = ['tracker-issue', 'tracker-sprint', 'tracker-sprint-edit'];
  comment.values = { ...comment.values, note: 'komentar yang belum dikirim' };
  assert.deepEqual(unsavedForms(registry.list(), DIALOGS), [], 'an unsaved comment does not stop a dialog');
  assert.equal(unsavedForms(registry.list(), true).length, 1, 'a page of dialogs only would keep it');
  sprint.values = { ...sprint.values, title: 'Sprint 12' };
  assert.deepEqual(unsavedForms(registry.list(), DIALOGS).map((entry) => entry.id), ['tracker-sprint']);
  // Off (the default of the hook), or a wrong value: nothing is kept.
  for (const off of [false, undefined, null, 'ya', 1, {}]) assert.deepEqual(unsavedForms(registry.list(), off === undefined ? false : off), [], String(off));
  assert.deepEqual(unsavedForms(null, true), []);
  assert.deepEqual(unsavedForms(registry.list(), []), [], 'an empty list names no form');
});

test('the hook drops the parameter and opens nothing while such a form is unsaved; it never saves', () => {
  const hook = withoutComments(read('components/ai/useOpenFromUrl.js'));
  assert.match(hook, /export const hasUnsavedForm = \(keep = true\) => unsavedForms\(aiFormRegistry\.list\(\), keep\)\.length > 0;/);
  assert.match(hook, /\{ enabled = true, keepUnsaved = false \} = \{\}/, 'off unless the page says so');
  // The opener is skipped, the parameter is removed either way.
  assert.match(hook, /if \(!hasUnsavedForm\(keep\.current\)\) latest\.current\(value\);\s*setParams\(\(current\) => \{\s*const next = new URLSearchParams\(current\);\s*next\.delete\(param\);/);
  assert.doesNotMatch(hook, /api\.|fetch\(|\.click\(|dispatchEvent|requestSubmit|\.submit\b/);
});

// Openers that need no keepUnsaved, each reviewed: ONE dialog behind one
// boolean (opening it again changes nothing), next to forms in the page itself
// that a dialog does not replace.
const SINGLE_DIALOG = {
  'components/tasks/TaskChecklist.jsx': 'adds one row to the checklist in the page itself (a boolean)',
  'components/tasks/TaskDependencies.jsx': 'one dialog behind a boolean; the task page has its edit and comment forms in the page itself',
  'pages/ga/GaRequestDetail.jsx': 'one registered dialog ("Tugaskan"); opening it again changes nothing',
  'pages/sales/SalesCustomerDetail.jsx': 'one dialog behind a boolean',
  'pages/sales/SalesCustomers.jsx': 'one dialog behind a boolean',
  'pages/it/SubscriptionDetail.jsx': 'one dialog behind a boolean',
  'pages/hrga/WorkflowList.jsx': 'one dialog behind a boolean',
};

test('every page that opens a dialog from the URL keeps an unsaved form, or is on the reviewed single-dialog list', () => {
  const hosts = walk(SRC).filter((file) => file !== 'components/ai/useOpenFromUrl.js' && /useOpenFromUrl\(/.test(withoutComments(read(file))));
  assert.ok(hosts.length >= 30, `only ${hosts.length} hosts found`);
  const without = [];
  let kept = 0;
  for (const file of hosts) {
    const code = withoutComments(read(file));
    // Each call, up to the statement's end: "useOpenFromUrl('x', …, { … });"
    const calls = code.split(/(?=^\s*useOpenFromUrl\()/m).filter((part) => /^\s*useOpenFromUrl\(/.test(part)).map((part) => {
      let depth = 0;
      for (let i = part.indexOf('('); i < part.length; i += 1) {
        if (part[i] === '(') depth += 1;
        else if (part[i] === ')') { depth -= 1; if (depth === 0) return part.slice(0, i + 1); }
      }
      return part;
    });
    assert.ok(calls.length > 0, file);
    const keeps = calls.filter((call) => /keepUnsaved: (true|[A-Z_]+)\b/.test(call));
    if (SINGLE_DIALOG[file]) {
      assert.equal(keeps.length, 0, `${file} now says keepUnsaved: remove it from SINGLE_DIALOG`);
      assert.equal(calls.length, 1, `${file} has ${calls.length} openers: one dialog host for several forms needs keepUnsaved`);
      continue;
    }
    kept += keeps.length;
    if (keeps.length !== calls.length) without.push(`${file} (${calls.length - keeps.length} of ${calls.length})`);
  }
  assert.deepEqual(without, [], 'an opener without keepUnsaved on a page with several forms');
  for (const file of Object.keys(SINGLE_DIALOG)) assert.ok(hosts.includes(file), `${file} no longer opens from the URL`);
  assert.ok(kept >= 40, `${kept} openers keep an unsaved form`);
});

test('the pages named in the plan: one dialog host, several forms', () => {
  const count = (file) => (withoutComments(read(file)).match(/keepUnsaved: (true|[A-Z_]+)\b/g) || []).length;
  assert.deepEqual({
    infrastructure: count('pages/it/Infrastructure.jsx'),
    gaOperations: count('pages/ga/GaOperations.jsx'),
    gaServices: count('pages/ga/GaServices.jsx'),
    devices: count('pages/it/Devices.jsx') + count('pages/it/LocationsPanel.jsx'),
    deviceDetail: count('pages/it/DeviceDetail.jsx'),
    salesOrders: count('pages/sales/SalesOrders.jsx'),
    hrWorkflow: count('pages/hrga/HrgaWorkflowDetail.jsx'),
    docTemplates: count('pages/documents/DocTemplates.jsx'),
    calendar: count('pages/calendar/Calendar.jsx'),
  }, { infrastructure: 3, gaOperations: 3, gaServices: 2, devices: 2, deviceDetail: 2, salesOrders: 3, hrWorkflow: 2, docTemplates: 4, calendar: 2 });
  // A list names real form ids of that page (a typo would keep nothing).
  const LISTS = {
    'pages/projects/ProjectTracker.jsx': ['pages/projects/CreateIssueModal.jsx', 'pages/projects/SprintDialog.jsx', 'pages/projects/DivisionDialog.jsx'],
    'pages/hrga/ChecklistTemplates.jsx': ['pages/hrga/ChecklistTemplates.jsx'],
    'pages/sales/SalesLeads.jsx': ['pages/sales/SalesLeads.jsx', 'pages/sales/SalesForms.jsx'],
  };
  for (const [file, sources] of Object.entries(LISTS)) {
    const code = read(file);
    const list = code.match(/const [A-Z_]+_FORMS = \[([^\]]+)\];/);
    assert.ok(list, `${file}: the list of dialog forms`);
    const ids = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const known = sources.map(read).join('\n');
    assert.ok(ids.length >= 2, file);
    for (const id of ids) assert.ok(known.includes(`'${id}'`), `${file}: "${id}" is not a form id of the page`);
  }
  // The two pages that read their own URL parameter use the same check.
  assert.match(read('pages/sales/SalesOrderDetail.jsx'), /if \(open && !hasUnsavedForm\(\)\) setModal\(open\);/);
  assert.match(read('pages/sales/SalesLeads.jsx'), /if \(canManage && !hasUnsavedForm\(LEAD_DIALOG_FORMS\)\) setModal\('visit'\);/);
  // HR workflow: a decision dialog the user opened (not a registered form) is not replaced either.
  assert.match(read('pages/hrga/HrgaWorkflowDetail.jsx'), /setDialog\(fromUrl\(\{ kind, task \}\)\)/);
});
