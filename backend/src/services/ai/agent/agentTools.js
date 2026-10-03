const fs = require('node:fs');
const path = require('node:path');
const { validateTools, capResult } = require('./toolContract');
const { assertToolOutput } = require('./outputGuard');

// Tools the Prakasa AI agent may call while answering. One file per module
// under tools/ (tools/<module>.js exports an array; a file starting with "_"
// is a helper and is skipped) — see docs/prakasa-ai-rencana.md §9 for the
// contract and the checklist for adding one. Every tool:
//   - runs with the permissions of the signed-in user, re-read on each call;
//   - only reads (risk tier "read") — writing stays with the user in the UI;
//   - returns plainly labelled fields, so the model cannot mistake one number
//     for another;
//   - has its result passed through the output guard (no personal data keys;
//     rupiah keys only from a `money` tool) and the central size cap.
// `label` is what the conversation shows while the step runs.
// 4.1: Warehouse/Procurement quantities in supplyTools.js (private conversations
// only, never prices). The user's notifications are private-only too.

const TOOLS_DIR = path.join(__dirname, 'tools');
const hasPerm = (user, code) => (user.permissions || []).includes(code);
const allowedBy = (user, permission) => !permission || [].concat(permission).some((code) => hasPerm(user, code));
const denied = () => Object.assign(new Error('Alat ini tidak tersedia untuk Anda'), { status: 403, code: 'FORBIDDEN' });

function toolFiles(dir = TOOLS_DIR) {
  return fs.readdirSync(dir).filter((file) => file.endsWith('.js') && !file.startsWith('_')).sort();
}

// What the rest of the server sees: the declared tool, with run() wrapped so
// the permission re-check, the output guard and the size cap cannot be skipped.
// `impl` keeps the tool's own function (tests read its source).
function seal(tool, file) {
  if (tool.client === true) return sealClient(tool, file);
  const impl = tool.run;
  return Object.freeze({
    ...tool,
    module: Object.freeze([].concat(tool.module)),
    file,
    impl,
    async run(user, input = {}) {
      if (!allowedBy(user, tool.permission)) throw denied();
      const clean = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
      const result = await impl(user, clean);
      return capResult(assertToolOutput(result, { money: tool.money === true }));
    },
  });
}

// A page tool (client: true) has no code of its own on the server: the browser
// carries it out (clientTools.js sends the request and checks the answer). It
// has no run() at all, so nothing can call it as if it read data.
function sealClient(tool, file) {
  return Object.freeze({
    ...tool,
    module: Object.freeze([].concat(tool.module)),
    surfaces: Object.freeze([].concat(tool.surfaces)),
    file,
    impl: null,
  });
}

function loadTools(dir = TOOLS_DIR) {
  const loaded = [];
  for (const file of toolFiles(dir)) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const exported = require(path.join(dir, file));
    if (!Array.isArray(exported)) throw new Error(`Alat AI: ${file} harus mengekspor array alat`);
    for (const tool of exported) loaded.push({ tool, file });
  }
  // eslint-disable-next-line global-require
  const moduleKeys = new Set(require('../../aiToolRegistry.service').TOOLS.map((entry) => entry.key));
  const errors = validateTools(loaded.map((entry) => entry.tool), { moduleKeys });
  if (errors.length) throw new Error(`Alat AI melanggar kontrak:\n- ${errors.join('\n- ')}`);
  return loaded.map(({ tool, file }) => seal(tool, file));
}

const TOOLS = Object.freeze(loadTools());
const byName = new Map(TOOLS.map((t) => [t.name, t]));

// A tool that reads division data or the user's own notifications (privateOnly) runs
// only in a private conversation: in a shared one its answer would reach people whose
// own permissions may not allow it.
// Never together with web research either: item and customer names come from
// Accurate and could carry text asking the model to search for stock figures.
const sessionAllows = (tool, session) => !tool.privateOnly || (session?.visibility === 'private' && !session?.web_research);
// A page tool is offered only where the conversation runs on a surface it
// names: the side panel on a page ('panel'), or the Command Center ('full').
// Without a surface (a non-streamed answer, a caller that does not say) none is.
const surfaceAllows = (tool, surface) => (tool.client || tool.surfaces ? [].concat(tool.surfaces).includes(surface) : true);
function toolsFor(user, session = null, { surface = null } = {}) {
  return TOOLS.filter((t) => allowedBy(user, t.permission) && sessionAllows(t, session) && surfaceAllows(t, surface));
}
const PRIVATE_ONLY_TOOLS = Object.freeze(TOOLS.filter((t) => t.privateOnly).map((t) => t.name));
const CLIENT_TOOLS = Object.freeze(TOOLS.filter((t) => t.client).map((t) => t.name));

function labelOf(name) {
  return byName.get(name)?.label || null;
}

function schemaOf(tool) {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

module.exports = {
  TOOLS, PRIVATE_ONLY_TOOLS, CLIENT_TOOLS, TOOLS_DIR, toolsFor, labelOf, schemaOf, byName, toolFiles, loadTools, allowedBy,
};
