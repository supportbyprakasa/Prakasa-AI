// The contract every Prakasa AI agent tool keeps (docs/prakasa-ai-rencana.md §9).
// agentTools.js validates each tool file against it when the server starts, so
// a tool that breaks a rule never reaches the model; test/aiAgentContract.test.js
// checks the same rules plus the things only a test can see (the source of
// run(), the size cap).
//
//   name        snake_case Indonesian, at most 40 characters, unique; a noun
//               phrase for what is READ — never a verb that saves, deletes,
//               approves, sends, changes or creates
//   module      page-tool key(s) of aiToolRegistry the tool serves, or 'general'
//   label       Indonesian, shown to the user as the step ("Membaca stok barang")
//   description for the model; must say what is NOT returned ("Tidak pernah …" / "Tanpa …")
//   inputSchema JSON schema: { type: 'object', properties, additionalProperties: false }
//   permission  string | string[] (any of) | null — null only with `public: true`
//   privateOnly the tool runs in private conversations without web research only
//   money       true when a result can carry rupiah: needs privateOnly AND a permission
//   run(user, input)  reads through the module's own service, with the user's scope
//
// Page tools (`client: true`, Wave C — docs/prakasa-ai-rencana.md §9.8) are the
// one other kind: the BROWSER carries them out on the page the user is looking
// at, so they have no run() and read no module data. `clientOp` names the only
// things a browser can be asked to do (CLIENT_OPS): open an in-app route, read
// the forms the page registered, set field values in such a form. There is no
// operation that presses a button: saving stays with the user. They are
// privateOnly, need no data permission (the form's own permission is checked
// per call) and say on which surface they are offered (`surfaces`). A server
// tool may name `surfaces` too: it is then offered only there.

const NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const MAX_NAME = 40;
const MAX_LABEL = 80;
const MIN_DESCRIPTION = 40;
// Verbs of the things the agent never does (owner rule: the agent only reads).
const WRITE_WORDS = Object.freeze(['simpan', 'hapus', 'setujui', 'kirim', 'ubah', 'buat']);
// A name that holds one of those words as a NOUN, reviewed by hand. Keep it short.
const READ_NAME_EXCEPTIONS = Object.freeze({
  jadwal_kirim: 'kata benda: jadwal pengiriman SO (alat baca sejak program 4.1)',
});
const NOT_RETURNED = /\b(tidak pernah|tanpa)\b/i;
const SCHEMA_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'array']);
// Everything a browser can be asked to do for the agent. Nothing here saves,
// submits, approves, deletes or sends, and nothing presses a button.
const CLIENT_OPS = Object.freeze(['navigate', 'readForms', 'fillForm']);
// Where a conversation runs: the side panel on a page, or the full-page Command Center.
const SURFACES = Object.freeze(['panel', 'full']);

// Central size cap: any list in a result is cut to this many entries and the
// object that holds it (and the result itself) is marked `terpotong: true`.
const MAX_LIST_ITEMS = 100;
// A text field longer than this is cut (one runaway note cannot fill the context).
const MAX_TEXT_CHARS = 4000;

const writeWordIn = (name) => String(name).split('_').find((part) => WRITE_WORDS.some((word) => part === word || part.startsWith(word))) || null;

function validateTool(tool, { moduleKeys = null } = {}) {
  const errors = [];
  const say = (message) => errors.push(`${tool?.name || '(tanpa nama)'}: ${message}`);
  if (!tool || typeof tool !== 'object') return ['alat harus berupa objek'];

  if (typeof tool.name !== 'string' || !NAME.test(tool.name)) say('name harus snake_case huruf kecil');
  else {
    if (tool.name.length > MAX_NAME) say(`name lebih dari ${MAX_NAME} karakter`);
    const word = writeWordIn(tool.name);
    if (word && !READ_NAME_EXCEPTIONS[tool.name]) say(`name memuat kata kerja tulis "${word}" — agen hanya membaca`);
  }

  const modules = [].concat(tool.module || []);
  if (!modules.length || modules.some((m) => typeof m !== 'string' || !m)) say('module wajib diisi (kunci halaman di aiToolRegistry, atau "general")');
  else if (moduleKeys) {
    for (const m of modules) if (m !== 'general' && !moduleKeys.has(m)) say(`module "${m}" tidak ada di aiToolRegistry`);
  }

  if (typeof tool.label !== 'string' || !tool.label.trim() || tool.label.length > MAX_LABEL) say('label wajib (bahasa Indonesia, tampil sebagai langkah)');
  if (typeof tool.description !== 'string' || tool.description.trim().length < MIN_DESCRIPTION) say('description terlalu pendek');
  else if (!NOT_RETURNED.test(tool.description)) say('description harus menyebut apa yang TIDAK dikembalikan ("Tidak pernah …" atau "Tanpa …")');

  const schema = tool.inputSchema;
  if (!schema || schema.type !== 'object') say('inputSchema.type harus "object"');
  else {
    if (schema.additionalProperties !== false) say('inputSchema.additionalProperties harus false');
    const props = schema.properties;
    if (!props || typeof props !== 'object' || Array.isArray(props)) say('inputSchema.properties wajib (boleh kosong)');
    else {
      for (const [key, spec] of Object.entries(props)) {
        if (!NAME.test(key)) say(`input "${key}" harus snake_case`);
        if (!spec || !SCHEMA_TYPES.has(spec.type)) say(`input "${key}" butuh type yang dikenal`);
      }
      for (const key of schema.required || []) if (!(key in props)) say(`required "${key}" tidak ada di properties`);
    }
  }

  const perms = tool.permission === null || tool.permission === undefined ? [] : [].concat(tool.permission);
  if (perms.some((code) => typeof code !== 'string' || !/^[a-z_]+(\.[a-z_]+)+$/.test(code))) say('permission harus kode izin (string) atau daftar kode');
  if (tool.privateOnly !== undefined && typeof tool.privateOnly !== 'boolean') say('privateOnly harus boolean');

  if (tool.client === true) {
    // A page tool: carried out by the browser, never by the server.
    if (!CLIENT_OPS.includes(tool.clientOp)) say(`clientOp harus salah satu dari ${CLIENT_OPS.join(', ')}`);
    if (tool.run !== undefined) say('alat halaman (client: true) tidak punya run — browser yang menjalankannya');
    if (tool.privateOnly !== true) say('client: true mewajibkan privateOnly: true');
    if (perms.length || tool.public === true) say('alat halaman tidak memakai izin data (permission: null, tanpa public)');
    if (tool.money === true) say('alat halaman tidak boleh money: true');
    const surfaces = [].concat(tool.surfaces || []);
    if (!surfaces.length || surfaces.some((surface) => !SURFACES.includes(surface))) say(`surfaces wajib (${SURFACES.join(' / ')})`);
    return errors;
  }
  if (tool.client !== undefined && tool.client !== false) say('client harus boolean');
  if (tool.clientOp !== undefined) say('clientOp hanya untuk alat halaman (client: true)');
  // A server tool may name the surfaces it is offered on (daftar_formulir: only where a page tool is).
  if (tool.surfaces !== undefined) {
    const surfaces = [].concat(tool.surfaces);
    if (!surfaces.length || surfaces.some((surface) => !SURFACES.includes(surface))) say(`surfaces harus dari ${SURFACES.join(' / ')}`);
  }

  if (!perms.length && tool.public !== true) say('permission wajib; alat tanpa izin harus menulis `public: true`');
  if (perms.length && tool.public === true) say('alat dengan permission tidak boleh `public: true`');

  if (tool.money === true) {
    if (tool.privateOnly !== true) say('money: true mewajibkan privateOnly: true');
    if (!perms.length) say('money: true mewajibkan permission (izin uang modulnya)');
  }
  if (typeof tool.run !== 'function') say('run(user, input) wajib');
  return errors;
}

function validateTools(tools, options = {}) {
  const errors = [];
  const seen = new Set();
  for (const tool of tools) {
    errors.push(...validateTool(tool, options));
    if (tool?.name) {
      if (seen.has(tool.name)) errors.push(`${tool.name}: nama dipakai dua kali`);
      seen.add(tool.name);
    }
  }
  return errors;
}

// Cuts every list to MAX_LIST_ITEMS and every long text to MAX_TEXT_CHARS.
// Returns a new value; Dates and other scalars pass through untouched.
function capResult(value, { maxItems = MAX_LIST_ITEMS, maxText = MAX_TEXT_CHARS } = {}) {
  let cut = false;
  const walk = (node) => {
    if (typeof node === 'string') {
      if (node.length <= maxText) return node;
      cut = true;
      return `${node.slice(0, maxText)}…`;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object' && !(node instanceof Date)) {
      const out = {};
      let cutHere = false;
      for (const [key, child] of Object.entries(node)) {
        if (Array.isArray(child) && child.length > maxItems) {
          out[key] = child.slice(0, maxItems).map(walk);
          cutHere = true;
        } else {
          out[key] = walk(child);
        }
      }
      if (cutHere) { out.terpotong = true; cut = true; }
      return out;
    }
    return node;
  };
  if (Array.isArray(value)) {
    const over = value.length > maxItems;
    const list = (over ? value.slice(0, maxItems) : value).map(walk);
    return over || cut ? { daftar: list, terpotong: true } : list;
  }
  const out = walk(value);
  if (cut && out && typeof out === 'object') out.terpotong = true;
  return out;
}

module.exports = {
  MAX_NAME, MAX_LIST_ITEMS, MAX_TEXT_CHARS, WRITE_WORDS, READ_NAME_EXCEPTIONS, NOT_RETURNED, CLIENT_OPS, SURFACES,
  validateTool, validateTools, capResult, writeWordIn,
};
