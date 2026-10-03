import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Wave C2 coverage (docs/prakasa-ai-rencana.md §9.10, §9.11): every form in the
// app is in the inventory — registered with Prakasa AI, pending, or excluded
// with a reason. A new form file that is in none fails here. `pending` does not
// fail: its count is printed, and falls as the modules register their forms.
//
// Inventory: src/components/ai/formInventory/<module>.json, one file per module
// so two people registering forms never edit the same file:
//   { file, form, what, status: 'registered' | 'pending' | 'excluded', id?, reason? }

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const INVENTORY_DIR = join(SRC, 'components/ai/formInventory');
const read = (file) => readFileSync(join(SRC, file), 'utf8');

// Which source paths each inventory file owns. `shared` is everything else.
const OWNERS = {
  tasks: ['pages/tasks/', 'components/tasks/', 'components/gantt/', 'pages/projects/', 'pages/calendar/'],
  sales: ['pages/sales/', 'pages/marketing/'],
  finance: ['pages/finance/', 'pages/warehouse/', 'pages/procurement/', 'pages/advanced/'],
  ga: ['pages/ga/'],
  it: ['pages/it/', 'components/support/'],
  people: ['pages/hrga/', 'pages/people/', 'pages/documents/', 'pages/mydrive/'],
};
const ownerOf = (file) => Object.keys(OWNERS).find((module) => OWNERS[module].some((prefix) => file.startsWith(prefix))) || 'shared';

// A form file: a <form>, or a dialog / sheet that holds an input control.
const GENERIC = new Set(['components/Modal.jsx', 'components/FullScreenDialog.jsx', 'components/SideSheet.jsx']);
const FORM_TAG = /<form[\s>]/;
const DIALOG_TAG = /<(Modal|FullScreenDialog|SideSheet)[\s>]/;
const CONTROL_TAG = /<(Input|Textarea|Select|DateInput|TimeInput|Switch|Checkbox|Radio|Segmented|input|textarea|select)[\s>]/;
function formFiles(dir = SRC, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { formFiles(path, found); continue; }
    const file = relative(SRC, path).split('\\').join('/');
    if (!name.endsWith('.jsx') || file.startsWith('pages/dev/') || GENERIC.has(file)) continue;
    const code = readFileSync(path, 'utf8');
    if (FORM_TAG.test(code) || (DIALOG_TAG.test(code) && CONTROL_TAG.test(code))) found.push(file);
  }
  return found.sort();
}

const inventory = readdirSync(INVENTORY_DIR).filter((name) => name.endsWith('.json')).sort()
  .flatMap((name) => JSON.parse(readFileSync(join(INVENTORY_DIR, name), 'utf8')).map((entry) => ({ ...entry, module: name.replace(/\.json$/, '') })));
const catalog = createRequire(import.meta.url)('../../backend/src/services/ai/agent/formCatalog.js');
const { OUT: HANDBOOK_FORMS, buildAiForms, serialize: serializeAiForms } = await import('../scripts/build-ai-forms.mjs');
const { default: HANDBOOK } = await import('../src/pages/handbook/handbookContent.js');

test('every form file in the app is in the inventory: registered, pending, or excluded with a reason', () => {
  const listed = new Set(inventory.map((entry) => entry.file));
  const missing = formFiles().filter((file) => !listed.has(file));
  assert.deepEqual(missing, [], `form files in no inventory — add each to src/components/ai/formInventory/${missing.length ? ownerOf(missing[0]) : '<modul>'}.json as registered, pending, or excluded with a reason`);

  const seen = new Set();
  for (const entry of inventory) {
    const where = `${entry.module}.json: ${entry.file} · ${entry.form}`;
    assert.ok(existsSync(join(SRC, entry.file)), `${where}: the file does not exist`);
    assert.ok(entry.form && entry.what, `${where}: form and what are required`);
    assert.ok(['registered', 'pending', 'excluded'].includes(entry.status), `${where}: status`);
    assert.equal(entry.module, ownerOf(entry.file), `${where}: this file belongs in ${ownerOf(entry.file)}.json`);
    assert.equal(seen.has(`${entry.file}|${entry.form}`), false, `${where}: listed twice`);
    seen.add(`${entry.file}|${entry.form}`);
    if (entry.status === 'excluded') assert.ok(typeof entry.reason === 'string' && entry.reason.length > 15, `${where}: an excluded form says why`);
  }
});

test('what is never registered stays excluded: credentials, signatures, admin, Google mail and chat, decisions', () => {
  const NEVER = ['pages/admin/', 'pages/google/', 'pages/signatures/', 'pages/Login.jsx', 'pages/ChangePasswordRequired.jsx', 'components/ReasonDialog.jsx'];
  for (const entry of inventory.filter((item) => NEVER.some((prefix) => item.file.startsWith(prefix)))) {
    assert.equal(entry.status, 'excluded', `${entry.file} · ${entry.form}`);
    assert.doesNotMatch(read(entry.file), /usePrakasaAIForm|defineAIForm/, `${entry.file} must not register a form with Prakasa AI`);
  }
  for (const file of NEVER.filter((path) => path.endsWith('.jsx'))) assert.ok(inventory.some((entry) => entry.file === file), file);
  assert.ok(inventory.filter((entry) => entry.file.startsWith('pages/admin/')).length >= 10);
});

test('a registered form is in the server\'s catalog under the same id and file, and the other way round', () => {
  const registered = inventory.filter((entry) => entry.status === 'registered');
  for (const entry of registered) {
    const where = `${entry.module}.json: ${entry.file} · ${entry.form}`;
    const listed = catalog.byId.get(entry.id);
    assert.ok(listed, `${where}: id "${entry.id}" is not in backend/src/services/ai/agent/forms/`);
    assert.equal(listed.file, entry.file, `${where}: the catalog names another file`);
    assert.match(read(entry.file), /usePrakasaAIForm\(/, `${where}: the file does not call usePrakasaAIForm`);
  }
  const ids = registered.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'a form id is registered once');
  for (const form of catalog.FORMS) assert.ok(ids.includes(form.id), `catalog form "${form.id}" (${form.file}) is not marked registered in the inventory`);
  // A file that registers a form has at least one registered entry.
  for (const file of formFiles()) {
    if (/usePrakasaAIForm\(/.test(read(file))) assert.ok(registered.some((entry) => entry.file === file), `${file} calls usePrakasaAIForm but no inventory entry is "registered"`);
  }
});

test('a registration never holds a way to save: no submit handler, no API write', () => {
  const files = [...new Set(inventory.filter((entry) => entry.status === 'registered').map((entry) => entry.file))];
  for (const file of files) {
    const code = read(file);
    // usePrakasaAIForm({...}); · usePrakasaAIForm(DEF, {...}); · defineAIForm({...});
    const blocks = [...code.matchAll(/(?:usePrakasaAIForm|defineAIForm)\(([\s\S]*?)\n {0,2}\}\);/g)].map((match) => match[1]);
    assert.ok(blocks.length >= 1, `${file} registers a form`);
    for (const block of blocks) {
      assert.doesNotMatch(block, /\bsubmit\b|\bonSubmit\b|\bhandleSubmit\b|\bsave\b|\bonSave\b|api\.(post|patch|put|delete)/, `${file}: the registration must not hold a way to save`);
    }
    // One permission code, or a list that means "any of" (an endpoint that accepts alternatives).
    assert.match(blocks.join('\n'), /permission: (\[)?'[a-z_]+(\.[a-z_]+)+'/, `${file}: the form names its permission`);
    assert.match(code, /\{ai\.notice\}/, `${file} shows the notice`);
  }
});

test('progress: registered / pending / excluded per module', () => {
  const count = (list, status) => list.filter((entry) => entry.status === status).length;
  const modules = [...new Set(inventory.map((entry) => entry.module))];
  const lines = modules.map((module) => {
    const own = inventory.filter((entry) => entry.module === module);
    return `  ${module.padEnd(8)} terdaftar ${String(count(own, 'registered')).padStart(2)} · menunggu ${String(count(own, 'pending')).padStart(2)} · dikecualikan ${String(count(own, 'excluded')).padStart(2)}`;
  });
  const pending = count(inventory, 'pending');
  // eslint-disable-next-line no-console
  console.log(`Formulir Prakasa AI (${inventory.length} formulir di ${new Set(inventory.map((entry) => entry.file)).size} file):\n${lines.join('\n')}\n  MENUNGGU didaftarkan: ${pending}`);
  assert.equal(count(inventory, 'registered') + pending + count(inventory, 'excluded'), inventory.length);
  assert.ok(count(inventory, 'registered') >= 9, 'the pilot forms stay registered');
});

test('the handbook\'s table "Formulir yang bisa diisi AI" is generated from the catalog and current: every form, once, per module', () => {
  assert.equal(readFileSync(HANDBOOK_FORMS, 'utf8'), serializeAiForms(buildAiForms()), 'src/pages/handbook/aiForms.generated.js is stale: cd frontend && node scripts/build-ai-forms.mjs');
  const tables = buildAiForms();
  assert.equal(tables.reduce((sum, table) => sum + table.rows.length, 0), catalog.FORMS.length);
  for (const table of tables) {
    assert.match(table.title, /^Formulir yang bisa diisi AI: \S/);
    for (const row of table.rows) assert.ok(row.length === 3 && row.every((cell) => typeof cell === 'string' && cell.trim()), `${table.title}: ${row}`);
  }
  // Every catalog title is in the table of its module.
  for (const form of catalog.FORMS) assert.ok(tables.some((table) => table.rows.some((row) => row[0] === form.title)), form.id);
  // The handbook shows them in "AI mengisi formulir, Anda yang menyimpan" — no hand-kept copy next to them.
  const section = HANDBOOK.find((chapter) => chapter.id === 'prakasa-ai').sections.find((item) => item.id === 'ai-mengisi-formulir');
  const shown = section.body.filter((block) => block.type === 'table');
  assert.deepEqual(shown.map((block) => block.title), tables.map((table) => table.title));
  assert.deepEqual(shown.map((block) => block.rows), tables.map((table) => table.rows));
  for (const block of shown) assert.deepEqual(block.columns, ['Formulir', 'Dibuka dari', 'Yang tetap Anda isi sendiri']);
  // What the AI never fills is said in words too.
  const text = JSON.stringify(section.body);
  for (const word of ['NIK', 'gaji', 'alamat IP', 'nomor seri', 'kunci lisensi', 'rekening bank', 'Harga', 'hitung fisik']) assert.ok(text.includes(word), word);
});
