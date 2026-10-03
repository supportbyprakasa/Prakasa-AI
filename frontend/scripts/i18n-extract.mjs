// Builds the translation catalog of the language switch: every user-visible
// Indonesian string of the frontend, and every backend string the UI renders.
//
//   node scripts/i18n-extract.mjs            rewrite the catalog and todo files
//   node scripts/i18n-extract.mjs --check    exit 1 when the catalog is stale
//   node scripts/i18n-extract.mjs --stats    print counts per chunk (no write)
//
// Output (frontend/src/i18n/catalog/):
//   strings.json                       [{ text, kind, regex?, vars?, sources, chunk }]
//   chunks/<chunk>.todo.json           { "<Indonesian>": "" }            not yet translated
//   chunks/<chunk>.patterns.todo.json  [{ id, regex, vars, sources, en: "" }]
// Chunk assignment is sticky: a string keeps the chunk strings.json already
// gives it, so translators' en/<chunk>.json files never move. A string that is
// new since the last run goes to `backend-seeds` (database seeds) or to
// `additions` (everything else).
// Translations live in frontend/src/i18n/en/ and are never written here: a
// string leaves the todo files once en/ (or a same list) covers it.
//
// It prefers over-extraction: a string that is not interface text goes to
// src/i18n/ignore.json (or a chunk's en/<chunk>.same.json when it is simply
// identical in English).
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasLetters, normalizeText, templateToRegexSource } from '../src/i18n/translate.js';

const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(FRONTEND, '..');
const I18N = join(FRONTEND, 'src/i18n');
const CATALOG = join(I18N, 'catalog');
const CHUNKS = join(CATALOG, 'chunks');
const EN = join(I18N, 'en');
const CHUNK_TARGET = 500;
const CHUNK_MAX = 600;

// ------------------------------------------------------------------ areas
// First match wins; the order is also the priority when a string is used in
// several areas (it goes to the first area only).
const AREAS = [
  ['components-ai', /^frontend\/src\/components\/ai\//],
  ['components-work', /^frontend\/src\/components\/(tasks|gantt|charts|support)\//],
  ['shell', /^frontend\/src\/(components\/|context\/|api\/|styles\/|App\.jsx|main\.jsx|pages\/(Login|ChangePasswordRequired|NotFound|AccessNotReady|ComingSoon)\.jsx|pages\/login\/)/],
  ['pages-home', /^frontend\/src\/pages\/(Dashboard\.jsx|dashboardModel\.js|ActivityLogs\.jsx|notifications\/|approvals\/|calendar\/|public\/|mydrive\/)/],
  ['pages-admin', /^frontend\/src\/pages\/(admin|accurate)\//],
  ['pages-sales', /^frontend\/src\/pages\/sales\//],
  ['pages-warehouse', /^frontend\/src\/pages\/(warehouse|procurement)\//],
  ['pages-finance', /^frontend\/src\/pages\/(finance|retail|marketing)\//],
  ['pages-people', /^frontend\/src\/pages\/(hrga|people|ga)\//],
  ['pages-it', /^frontend\/src\/pages\/it\//],
  ['pages-management', /^frontend\/src\/pages\/(management|advanced|projects|tasks)\//],
  ['pages-ai-docs', /^frontend\/src\/pages\/(ai|documents|signatures|google)\//],
  ['handbook', /^frontend\/src\/pages\/handbook\//],
  ['pages-other', /^frontend\/src\//],
  ['backend-controllers', /^backend\/src\/controllers\//],
  ['backend-services', /^backend\/src\/services\//],
  ['backend-management', /^backend\/src\/(management|config)\//],
  ['backend-other', /^backend\/src\//],
  // Interface text stored in the database by migrations and seed code (role,
  // division and permission names, approval matrix names …). Always last: a
  // string an earlier area already uses stays there.
  ['backend-seeds', /^backend\/migrations\//],
];
const AREA_ORDER = ['shell', ...AREAS.map(([name]) => name).filter((name) => name !== 'shell')];
const areaOf = (file) => AREAS.find(([, re]) => re.test(file))[0];

const FRONTEND_SKIP = /^frontend\/src\/(i18n\/|pages\/dev\/|components\/LanguageSwitch\.jsx)/;
const BACKEND_DIRS = ['controllers', 'services', 'routes', 'middleware', 'config', 'management', 'jobs', 'utils'];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function sourceFiles() {
  const front = walk(join(FRONTEND, 'src')).filter((f) => /\.(js|jsx)$/.test(f));
  const back = BACKEND_DIRS.flatMap((dir) => walk(join(REPO, 'backend/src', dir))).filter((f) => f.endsWith('.js'));
  return [...front, ...back]
    .map((path) => ({ path, rel: relative(REPO, path).split('\\').join('/') }))
    .filter((f) => !FRONTEND_SKIP.test(f.rel))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

// ------------------------------------------------------------- heuristics

// JSX attributes that never hold interface text.
const ATTR_DENY = new Set([
  'className', 'class', 'id', 'key', 'type', 'name', 'to', 'href', 'src', 'variant', 'tone', 'size', 'icon', 'role', 'htmlFor',
  'autoComplete', 'inputMode', 'method', 'target', 'rel', 'as', 'align', 'placement', 'symbol', 'status', 'accept', 'pattern',
  'd', 'viewBox', 'fill', 'stroke', 'xmlns', 'style', 'lang', 'dir', 'mode', 'kind', 'field', 'permission', 'value',
  'defaultValue', 'tooltipPlacement', 'orientation', 'loading', 'decoding', 'crossOrigin', 'referrerPolicy', 'sandbox',
  'points', 'transform', 'preserveAspectRatio', 'strokeLinecap', 'strokeLinejoin', 'textAnchor', 'dominantBaseline',
  'layout', 'position', 'justify', 'direction', 'color', 'scope', 'wrap', 'enterKeyHint', 'autoCapitalize', 'form', 'list',
  'path', 'element', 'index', 'rows', 'cols', 'step', 'min', 'max', 'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry',
  'x1', 'x2', 'y1', 'y2', 'dx', 'dy', 'offset', 'gradientUnits', 'clipPath', 'mask', 'filter', 'spellCheck', 'capture',
  'context', 'dataTitle', 'dataSubtitle', 'translate',
]);
// Object keys whose value is a code, never text.
const KEY_DENY = new Set([
  'key', 'id', 'type', 'kind', 'icon', 'symbol', 'to', 'path', 'href', 'permission', 'permissions', 'tone', 'variant', 'size',
  'align', 'field', 'accessor', 'className', 'status', 'method', 'role', 'mode', 'view', 'color', 'sortKey', 'param',
  'endpoint', 'url', 'resource', 'event', 'code', 'format', 'module', 'entityType', 'roleKey', 'table', 'column', 'sql',
  'env', 'mimeType', 'contentType', 'encoding', 'scope', 'action', 'provider', 'model', 'route', 'slug', 'source',
  'accept', 'inputMode', 'autoComplete', 'storageKey', 'queryKey', 'testId', 'sort', 'order', 'dir', 'locale', 'timeZone',
  'translateContext', 'translate', 'data', 'separator',
]);
// Object keys whose value is text even when it is one lowercase word.
const KEY_TEXT = /^(label|labels|title|description|header|placeholder|hint|message|text|tooltip|empty|helper|caption|subtitle|summary|note|unit|suffix|prefix|name|short|long|singular|plural|noun|verb|confirmLabel|cancelLabel|emptyText|heading|body|detail|reason|question|answer|starter|prompt)$/i;
const LABEL_MAP_NAME = /LABEL|TEXT|NAME|TITLE|UNIT|COPY|MESSAGE|WORD|HINT|DESCRIPTION|TERM/i;
// Calls whose string arguments are codes or developer text.
const CALL_DENY = /^(require|import|includes|startsWith|endsWith|indexOf|lastIndexOf|has|get|set|delete|getItem|setItem|removeItem|addEventListener|removeEventListener|dispatchEvent|querySelector|querySelectorAll|closest|matches|getAttribute|setAttribute|hasAttribute|removeAttribute|toggleAttribute|createElement|createElementNS|matchMedia|split|match|matchAll|test|padStart|padEnd|localeCompare|can|hasPermission|hasAnyPermission|requirePermission|authorize|append|add|remove|toggle|contains|Symbol|RegExp|URLSearchParams|URL|post|put|patch|fetch|emit|on|once|off|query|execute|raw|getPropertyValue|setProperty|lazy|lazyPage|encode|decode|digest|createHash|createHmac|update|toString|from|readFileSync|writeFileSync|join|resolve|header|setHeader|getHeader|status|type|cookie|char|charAt|slice|substring|getEnv|use|route|all|options|head|describe|it|test|sendFile|redirect|at|keyOf|col|field|orderBy|groupBy|where|select|table|increments|references|inTable|onDelete|index|unique|dropTable|createTable|hasTable|hasColumn)$/;
const LOG_OBJECTS = /^(console|logger|log|debug)$/;
const KEYBOARD_KEYS = new Set([
  'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab', 'Backspace', 'Delete', 'Shift',
  'Control', 'Alt', 'Meta', 'PageUp', 'PageDown', 'Space',
]);
const CSS_UNITS = new Set(['px', 'ms', 'rem', 'em', 'vh', 'vw', 'fr', 'deg', 's', 'x']);
const SQL = /\b(SELECT|FROM|WHERE|JOIN|INSERT|UPDATE|DELETE|ORDER BY|GROUP BY|LIMIT|VALUES|COALESCE|IS NULL|IS NOT NULL|DESC|ASC|HAVING|UNION|DISTINCT|COUNT\(|SUM\(|CASE WHEN|INTERVAL|CURDATE|NOW\(\)|ON DUPLICATE)\b|= \?|\?\)|^\s*(AND|OR|SET|ON|AS|IN|LIKE)\b/;
// SQL fragments without a keyword: "b.status IN (…)", "cancelled_at = NOW()".
const SQL_FRAGMENT = /\b[a-z]{1,3}\.[a-z_]+\b.*([=(),]|\bAS\b|\bIN\b)|\b[a-z]+_[a-z_]+\s*(=|IS\b|IN\b|<|>|\+|-|\))|^[A-Z_]+\(|\bAS [a-z]+[A-Z_a-z]*\b/;
// Query languages of Google APIs, quoted code lists, HTTP header values.
const QUERY_FRAGMENT = /^\(?'[a-z_]+'(?:, ?'[a-z_]+')*\)?$|\b[\w.]+ ?(=|<>|<) ?('|"|\$\d|\?|true\b|false\b|\w+ \+)|\b(desc|asc)$|\bin (parents|owners)\b|\bCOLLATE\b|\bNOT LIKE\b|max-age=|^Subject: /;
const PROMPT_NAME = /prompt|systemMessage|instruction|persona|SYSTEM/;

// A string that is a code rather than text, by shape alone. `text` is
// normalised; a pattern template passes its literal part.
function isCodeShaped(raw) {
  if (!hasLetters(raw)) return true;
  // A quoted code: 'retail_commerce'.
  const text = raw.replace(/^(['"`])(.*)\1$/, '$2');
  if (text !== raw && !/\s/.test(text)) return true;
  if (KEYBOARD_KEYS.has(text)) return true;
  if (/^(https?:|mailto:|tel:|data:|blob:|wss?:)/i.test(text) || (text.includes('://') && !/\s/.test(text))) return true;
  if (/^[./#@~]|^--|^\\/.test(text) && !/\s/.test(text)) return true;
  if (/^\/[\w:/.*?=&-]*$/.test(text)) return true;
  if (/(^|\s)(pw-|prakasa-|is-|has-|hb-|ai-|md-)[a-z]/.test(text) || text.includes('__')) return true;
  if (/=>|\$\{|<\/|\/>|^<[a-z!]|;$|:\s*[\w#-]+;/.test(text)) return true;
  if (/[{};]/.test(text) && !/\s/.test(text)) return true;
  if (/^_[a-z]+$/.test(text)) return true;
  // "Kas/bank", "Ditolak/dibatalkan", "Onboarding/offboarding": two words
  // joined by a slash, the first capitalised — a label, not a path.
  if (/^\p{Lu}\p{Ll}{2,}\/\p{L}\p{Ll}{2,}$/u.test(text)) return false;
  if (!/\s/.test(text)) {
    // One token: snake_case, dotted.codes, kebab-case, paths, MIME types.
    if (/^[a-z0-9*]+(?:[_.:/\-+][a-z0-9*]+)+$/.test(text)) return true;
    if (/^[A-Za-z0-9*]+(?:[_.:/][A-Za-z0-9*_]+)+$/.test(text)) return true;
    // Field lists, paths, trailing-punctuation codes ("license.", "sales:").
    if (/[,()[\]]/.test(text) && !/^\(?[A-Za-z]+\)?[,.]?$/.test(text)) return true;
    if (/^[\w./-]*\/[\w./-]*$/.test(text)) return true;
    if (/^[a-z_]+[.:]$/.test(text)) return true;
    // CONSTANT_CASE / abbreviations (identical in both languages).
    if (/^[A-Z0-9_\-./+&]+$/.test(text)) return true;
    // camelCase / PascalCase identifiers.
    if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(text) || /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/.test(text)) return true;
    // Tokens with digits ("h1", "utf8", "2xl") and CSS units.
    if (/^[a-z]*\d[a-z0-9]*$/i.test(text) || CSS_UNITS.has(text)) return true;
    if (/^\w+\/[\w.+*-]+$/.test(text)) return true;
    if (/^[\w.+-]+@[\w.-]+$/.test(text)) return true;
    if (/^[a-z]+(?:[-_][A-Za-z0-9]+)+$/.test(text)) return true;
    if (/[=&?]/.test(text)) return true;
  }
  // Date / number format tokens ("s.d." — sampai dengan — is a word, not a format).
  if (/^[YMDHhmsdy\-/:. T]+$/.test(text) && text !== 's.d.') return true;
  // Space-separated class lists or code lists ("a-b c-d", "foo_bar baz").
  // An Indonesian phrase with one hyphenated or slashed word is text, not a
  // code list: "sistem offline/sebagian", "akun eks-karyawan masih aktif".
  if (/^[a-z0-9_\-.:/ ]+$/.test(text) && /[_\-.:/]/.test(text) && !/[.:] |\.$/.test(text)
    && text.split(' ').every((token) => /^[a-z0-9]+(?:[_\-.:/][a-z0-9]+)*$/.test(token))
    && text.split(' ').some((token) => /[_\-:/]/.test(token))) {
    const tokens = text.split(' ');
    const coded = tokens.filter((token) => /[_\-:/.]/.test(token)).length;
    if (tokens.some((token) => /[_:]/.test(token)) || coded * 2 > tokens.length) return true;
  }
  return false;
}

const isSingleLowerToken = (text) => /^[a-z][a-z0-9]*$/.test(text);

const calleeName = (callee) => {
  if (!callee) return '';
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
    return callee.property?.name || callee.property?.value || '';
  }
  return '';
};
const calleeObject = (callee) => {
  let node = callee;
  while (node && (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')) node = node.object;
  return node?.type === 'Identifier' ? node.name : '';
};
const keyName = (node) => (node.key?.type === 'Identifier' ? node.key.name : String(node.key?.value ?? ''));

// The variable an object / array literal is assigned to, looking through
// Object.freeze(…) and similar wrappers: const UNITS = Object.freeze([…]).
function declaredName(path) {
  let p = path;
  while (p && (p.node.type === 'CallExpression' && /^(freeze|seal)$/.test(calleeName(p.node.callee)))) p = p.parentPath;
  return p?.node.type === 'VariableDeclarator' ? p.node.id?.name || '' : '';
}

// A literal marked as interface text by hand: /* i18n */ 'dibatalkan'. For a
// word the heuristics take for a code (one lowercase word in an array, a call
// argument, a fallback) although the UI shows it.
const isMarked = (node) => (node.leadingComments || []).some((c) => c.type === 'CommentBlock' && c.value.trim() === 'i18n');

// Where a literal sits: walks up through expressions that just pass a value
// on (a ? b : c, a || b, (a), `…${x}…`'s own parent is NOT transparent).
// Returns { drop: true } or { ui: boolean } (ui = text is expected here, so a
// single lowercase word is kept too).
function contextOf(path, backend) {
  let child = path;
  let parent = path.parentPath;
  while (parent) {
    const node = parent.node;
    const type = node.type;
    if (type === 'ConditionalExpression') {
      if (node.test === child.node) return { drop: true };
    } else if (type === 'LogicalExpression' || type === 'ParenthesizedExpression' || type === 'TSAsExpression'
      || type === 'SequenceExpression' || type === 'AwaitExpression') {
      // transparent
    } else {
      break;
    }
    child = parent;
    parent = parent.parentPath;
  }
  if (!parent) return { ui: false };
  const node = parent.node;
  switch (node.type) {
    case 'ImportDeclaration': case 'ExportNamedDeclaration': case 'ExportAllDeclaration': case 'ImportExpression':
    case 'TSLiteralType': case 'Directive': case 'DirectiveLiteral':
      return { drop: true };
    case 'ObjectProperty': {
      if (node.key === child.node && !node.computed) return { drop: true };
      if (node.computed && node.key === child.node) return { drop: true };
      const key = keyName(node);
      if (PROMPT_NAME.test(key) && backend) return { drop: true };
      if (KEY_TEXT.test(key)) return { ui: true };
      // A value of a label map: const STATUS_LABELS = { draft: 'draf' }. The
      // map's name decides, even for a key that usually holds a code
      // (FIELD_LABELS = { type: 'tipe', status: 'status' }).
      const ownerName = declaredName(parent.parentPath?.parentPath);
      const labelMap = LABEL_MAP_NAME.test(ownerName || '');
      if (labelMap && /^[A-Z][A-Z0-9_]*$/.test(ownerName)) return { ui: true };
      if (KEY_DENY.has(key)) return { ui: false, codeKey: true };
      return { ui: labelMap };
    }
    case 'MemberExpression': case 'OptionalMemberExpression':
      return node.property === child.node ? { drop: true } : { ui: false };
    case 'BinaryExpression':
      // Comparisons are codes; "+" is handled as a concatenation template.
      return node.operator === '+' ? { ui: true, concat: true } : { drop: true };
    case 'SwitchCase':
      return { drop: true };
    case 'JSXAttribute': {
      const name = node.name?.name?.name || node.name?.name || '';
      if (ATTR_DENY.has(name) || /^on[A-Z]/.test(name)) return { drop: true };
      if (/^data-/.test(name) && name !== 'data-pw-tooltip' && name !== 'data-label') return { drop: true };
      return { ui: true };
    }
    case 'JSXExpressionContainer': {
      const owner = parent.parentPath?.node;
      if (owner?.type === 'JSXAttribute') {
        const name = owner.name?.name?.name || owner.name?.name || '';
        if (ATTR_DENY.has(name) || /^on[A-Z]/.test(name)) return { drop: true };
        if (/^data-/.test(name) && name !== 'data-pw-tooltip' && name !== 'data-label') return { drop: true };
      }
      return { ui: true };
    }
    case 'CallExpression': case 'OptionalCallExpression': case 'NewExpression': {
      if (node.callee === child.node) return { drop: true };
      const name = calleeName(node.callee);
      const object = calleeObject(node.callee);
      if (LOG_OBJECTS.test(object) || LOG_OBJECTS.test(name)) return { drop: true };
      if (CALL_DENY.test(name)) return { ui: false, codeKey: true, codeCall: true };
      if (/^use[A-Z]/.test(name)) return { ui: false };
      return { ui: false };
    }
    case 'VariableDeclarator': {
      const name = node.id?.name || '';
      if (backend && PROMPT_NAME.test(name)) return { drop: true };
      return { ui: LABEL_MAP_NAME.test(name) };
    }
    case 'AssignmentPattern':
      return { ui: false };
    case 'ReturnStatement': case 'ArrowFunctionExpression':
      return { ui: true };
    case 'TemplateLiteral':
      return { ui: true };
    case 'ArrayExpression': {
      const ownerName = declaredName(parent.parentPath);
      return { ui: LABEL_MAP_NAME.test(ownerName || '') || /MONTH|DAY|WEEK/i.test(ownerName || '') };
    }
    case 'TaggedTemplateExpression':
      return { drop: true };
    default:
      return { ui: false };
  }
}

// Whether a literal is inside a logging / database call, a throw of a
// developer-only assertion, etc. (any depth).
function insideDeniedCall(path) {
  for (let p = path.parentPath; p; p = p.parentPath) {
    const node = p.node;
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const object = calleeObject(node.callee);
      const name = calleeName(node.callee);
      if (LOG_OBJECTS.test(object)) return true;
      if (/^(query|execute|raw|addEventListener|removeEventListener|querySelector|querySelectorAll|closest|matches|setItem|getItem|lazy|lazyPage)$/.test(name)) return true;
    }
    if (node.type === 'JSXAttribute') {
      const name = node.name?.name?.name || node.name?.name || '';
      if (name === 'className' || name === 'style') return true;
    }
    if (node.type === 'ImportDeclaration') return true;
    if (/Function|Program|ClassBody/.test(node.type) && node.type !== 'ArrowFunctionExpression') return false;
  }
  return false;
}

// React's JSX text rule: lines are trimmed and joined with one space.
function cleanJsxText(value) {
  const lines = value.split(/\r\n|\n|\r/);
  if (lines.length === 1) return value;
  return lines
    .map((line, index) => {
      let text = line.replace(/\t/g, ' ');
      if (index !== 0) text = text.replace(/^ +/, '');
      if (index !== lines.length - 1) text = text.replace(/ +$/, '');
      return text;
    })
    .filter(Boolean)
    .join(' ');
}

// ------------------------------------------------------------ extraction

// Record-data zones that probably show an interface label: a DataGrid column
// with `render`, or a KeyValue item, whose value contains text or a label map
// but has no `translate` flag. Reviewed by hand (catalog/data-zones.review.json).
// A zone judged to be record data is listed in src/i18n/data-zones.reviewed.json
// ({ file, kind, name, reason }) and leaves the review file; so the review
// file only ever holds zones nobody has looked at yet.
//   node scripts/i18n-extract.mjs --review [path-prefix]   print them (no write)
const LABEL_HINT = /['"`][^'"`\n]*\p{L}{3,}[^'"`\n]*['"`]|\b[A-Z][A-Z0-9]*_(?:LABELS?|TEXTS?|NAMES?)\b|[lL]abel(?:For|Of)?\(|statusLabel\(/u;
function reviewZones(ast, code, file, review) {
  // A model file (.js) builds the { label, value } lines a page hands to KeyValue.
  const model = file.rel.endsWith('.js');
  const propOf = (node, name) => node.properties.find((p) => p.type === 'ObjectProperty' && !p.computed && keyName(p) === name);
  const stripped = (node) => code.slice(node.start, node.end)
    .replace(/\b(?:className|status|icon|to|key|size|tone|variant|priority|href|type)=(?:"[^"]*"|'[^']*'|\{`[^`]*`\})/g, '')
    .replace(/<(?:StatusBadge|PriorityBadge|Button|IconButton)\b[\s\S]*?(?:\/>|<\/(?:Button)>)/g, '')
    // A label already opted in with <Translate> (or {...doTranslate}).
    .replace(/<Translate\b[\s\S]*?<\/Translate>/g, '')
    .replace(/<(\w+)\b[^>]*\{\.\.\.doTranslate\}[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/\?\s*'[^'\p{L}]*'|:\s*'[^'\p{L}]*'|\|\|\s*'[^'\p{L}]*'/gu, '');
  traverse(ast, {
    ObjectExpression(path) {
      const node = path.node;
      if (propOf(node, 'translate')) return;
      const render = propOf(node, 'render');
      const value = propOf(node, 'value');
      const label = propOf(node, 'label');
      let kind = null;
      let target = null;
      // A render given by reference (`render: typeLabel`, `render: label(MAP)('key')`)
      // cannot be read here: it is always listed when its name says "label" / "text".
      let byReference = false;
      if (render && propOf(node, 'header') && /Function/.test(render.value.type)) { kind = 'grid-column'; target = render.value; }
      else if (render && propOf(node, 'header') && ['Identifier', 'CallExpression', 'MemberExpression'].includes(render.value.type)) {
        kind = 'grid-column'; target = render.value; byReference = /label|text|status|kind|type/i.test(code.slice(render.value.start, render.value.end));
        if (!byReference) return;
      } else if (label && value && !propOf(node, 'onClick') && !propOf(node, 'icon') && !propOf(node, 'options') && !propOf(node, 'key')
        && !['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral'].includes(value.value.type)
        && path.parentPath.node.type === 'ArrayExpression' && (/KeyValue/.test(code) || model)) { kind = 'key-value'; target = value.value; }
      if (!target || (!byReference && !LABEL_HINT.test(stripped(target)))) return;
      const name = propOf(node, kind === 'grid-column' ? 'header' : 'label');
      review.push({
        kind,
        source: `${file.rel}:${node.loc.start.line}`,
        name: code.slice(name.value.start, name.value.end).slice(0, 60),
        value: code.slice(target.start, target.end).replace(/\s+/g, ' ').slice(0, 160),
      });
    },
  });
}

function extractFile(file, ignore, review, add) {
  const code = readFileSync(file.path, 'utf8');
  const backend = file.rel.startsWith('backend/');
  let ast;
  try {
    ast = parse(code, {
      sourceType: backend ? 'unambiguous' : 'module',
      plugins: ['jsx', 'importAttributes'],
      errorRecovery: true,
      allowReturnOutsideFunction: true,
    });
  } catch (error) {
    throw new Error(`i18n-extract: cannot parse ${file.rel}: ${error.message}`);
  }
  if (review && !backend) reviewZones(ast, code, file, review);
  const consumed = new WeakSet();
  const sliceOf = (node) => code.slice(node.start, node.end).replace(/\s+/g, ' ').slice(0, 80);
  const where = (node) => `${file.rel}:${node.loc.start.line}`;

  const emitExact = (raw, node, ctx) => {
    const text = normalizeText(raw);
    if (!text || !hasLetters(text) || ignore.has(text)) return;
    if (ctx !== 'jsxText') {
      if (isCodeShaped(text)) return;
      if (backend && (SQL.test(text) || SQL_FRAGMENT.test(text) || QUERY_FRAGMENT.test(text) || text.length > 400)) return;
      if (isSingleLowerToken(text) && !ctx.ui) {
        // I18N_DEBUG_LOWER=1 lists the single lowercase words that were taken for codes.
        if (process.env.I18N_DEBUG_LOWER) console.error(`LOWER ${text}\t${where(node)}`);
        return;
      }
      if (ctx.codeCall && !/\s/.test(text)) return;
      if (ctx.codeKey && !/\s/.test(text) && !/^[A-Z][a-z]/.test(text)) return;
    }
    add({ text, kind: 'exact', source: where(node) });
  };

  const emitTemplate = (pieces, node, ctx) => {
    // pieces: strings (literal text) and nodes (interpolations).
    let n = 0;
    const vars = [];
    const template = normalizeText(pieces.map((piece) => {
      if (typeof piece === 'string') return piece;
      n += 1;
      vars.push(sliceOf(piece));
      return `$${n}`;
    }).join(''));
    const literal = normalizeText(template.replace(/\$\d+/g, ' '));
    if (!hasLetters(literal) || ignore.has(template)) return;
    if (/\$\d+\$\d+/.test(template) && literal.length < 3) return;
    // "$1 berjalan: $2", "atasan: $1": one lowercase word and a colon is a
    // label inside a spaced template, not a code ("sales:").
    const colonLabel = /^\p{Ll}{3,}:$/u.test(literal) && /\s/.test(template);
    if (!colonLabel && (isCodeShaped(literal) || isCodeShaped(template.replace(/\$\d+/g, 'x')))) return;
    if (!/\s/.test(template) && /[/=?&:#]/.test(template)) return;
    if (literal.split(' ').every((token) => CSS_UNITS.has(token))) return;
    // "stok cukup < $1 hari" is a sentence with a comparison, not a query.
    const prose = /\p{Ll}{4,} \p{Ll}{4,}/u.test(literal) && !/['"=]/.test(template);
    if (backend && (SQL.test(template) || SQL_FRAGMENT.test(template) || (QUERY_FRAGMENT.test(template) && !prose) || literal.length > 400)) return;
    if (!/\s/.test(template) && !/\p{Ll}{2}/u.test(literal)) return;
    if (isSingleLowerToken(literal) && !ctx.ui) return;
    add({ text: template, kind: 'pattern', vars, source: where(node) });
  };

  // a + 'b' + c → ['a-node', 'b', 'c-node']; null when it is not a string concat.
  const flattenConcat = (node) => {
    if (node.type === 'BinaryExpression' && node.operator === '+') return [...flattenConcat(node.left), ...flattenConcat(node.right)];
    if (node.type === 'StringLiteral') { consumed.add(node); return [node.value]; }
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) { consumed.add(node); return [node.quasis[0].value.cooked ?? '']; }
    return [node];
  };

  const debugDrop = (path, why) => {
    if (!process.env.I18N_DEBUG_DROPS) return;
    const value = path.node.type === 'StringLiteral' ? path.node.value : sliceOf(path.node);
    if (/^\p{Lu}\p{Ll}+ \p{L}/u.test(value)) console.error(`DROP ${why} ${where(path.node)} ${JSON.stringify(value.slice(0, 90))}`);
  };
  traverse(ast, {
    JSXText(path) {
      emitExact(cleanJsxText(path.node.value), path.node, 'jsxText');
    },
    BinaryExpression(path) {
      const node = path.node;
      if (node.operator !== '+') return;
      if (path.parentPath.node.type === 'BinaryExpression' && path.parentPath.node.operator === '+') return;
      const hasText = (n) => (n.type === 'BinaryExpression' && n.operator === '+' ? hasText(n.left) || hasText(n.right)
        : (n.type === 'StringLiteral' && hasLetters(n.value)) || (n.type === 'TemplateLiteral' && n.quasis.some((q) => hasLetters(q.value.cooked || ''))));
      if (!hasText(node)) return;
      const ctx = contextOf(path, backend);
      if (ctx.drop || insideDeniedCall(path)) return;
      const pieces = flattenConcat(node);
      if (pieces.every((piece) => typeof piece === 'string')) emitExact(pieces.join(''), node, { ...ctx, ui: true });
      else emitTemplate(pieces, node, { ...ctx, ui: true });
    },
    StringLiteral(path) {
      if (consumed.has(path.node)) return;
      if (isMarked(path.node)) { add({ text: normalizeText(path.node.value), kind: 'exact', source: where(path.node) }); return; }
      const ctx = contextOf(path, backend);
      if (ctx.concat) return;
      if (ctx.drop || insideDeniedCall(path)) { debugDrop(path, ctx.drop ? 'ctx' : 'call'); return; }
      emitExact(path.node.value, path.node, ctx);
    },
    TemplateLiteral(path) {
      const node = path.node;
      if (consumed.has(node)) return;
      const ctx = contextOf(path, backend);
      if (ctx.concat) return;
      if (ctx.drop || insideDeniedCall(path)) { debugDrop(path, ctx.drop ? 'ctx' : 'call'); return; }
      if (node.expressions.length === 0) { emitExact(node.quasis[0].value.cooked ?? '', node, ctx); return; }
      const pieces = [];
      node.quasis.forEach((quasi, index) => {
        pieces.push(quasi.value.cooked ?? '');
        if (index < node.expressions.length) pieces.push(node.expressions[index]);
      });
      emitTemplate(pieces, node, { ...ctx, ui: true });
    },
  });
}

// ------------------------------------------------------- database seeds
// Interface text the database holds and the UI shows: literals of INSERT /
// UPDATE statements on the label tables in backend/migrations/*.sql, plus
// names built by seed code (the standard roles of standardOrganization.js).
// Rows typed by an administrator are record data and are not read here.
const SEED_TABLES = new Set([
  'roles', 'permissions', 'departments', 'document_types', 'approval_matrix', 'board_columns', 'notification_rules',
  'signature_rules', 'hrga_checklist_templates', 'ga_resources', 'ga_maintenance_items', 'org_locations',
  'document_templates', 'software_vendors',
]);
const SEED_AREA = 'backend-seeds';

function sqlTokens(sql) {
  const tokens = [];
  const re = /--[^\n]*|\/\*[\s\S]*?\*\/|'((?:[^'\\]|\\.|'')*)'|"((?:[^"\\]|\\.|"")*)"|`[^`]*`|[A-Za-z_@][\w$.@]*|<>|!=|<=|>=|:=|[^\s]/g;
  let line = 1;
  let last = 0;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    for (let i = last; i < m.index; i += 1) if (sql[i] === '\n') line += 1;
    last = m.index;
    const raw = m[0];
    if (raw.startsWith('--') || raw.startsWith('/*')) continue;
    if (m[1] !== undefined || m[2] !== undefined) {
      const quote = raw[0];
      const value = (m[1] ?? m[2]).split(quote + quote).join(quote).replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r', 0: '' }[c] ?? c));
      tokens.push({ type: 'string', value, line });
    } else if (/^[A-Za-z_@`]/.test(raw)) tokens.push({ type: 'word', value: raw.replace(/`/g, ''), upper: raw.replace(/`/g, '').toUpperCase(), line });
    else tokens.push({ type: 'punct', value: raw, line });
  }
  return tokens;
}

function extractSeedSql(rel, sql, emit) {
  const tokens = sqlTokens(sql);
  // Statements: split on top-level ';'.
  const statements = [];
  let current = [];
  for (const token of tokens) {
    if (token.type === 'punct' && token.value === ';') { if (current.length) statements.push(current); current = []; } else current.push(token);
  }
  if (current.length) statements.push(current);
  for (const st of statements) {
    const head = st[0].upper;
    let table = null;
    if (head === 'UPDATE') table = st[1]?.value;
    else if (head === 'INSERT' || head === 'REPLACE') table = st[st.findIndex((t) => t.upper === 'INTO') + 1]?.value;
    if (!table || !SEED_TABLES.has(table.toLowerCase())) continue;
    // A literal is a stored VALUE unless it is compared with something
    // (WHERE code = 'x', IN ('a', 'b'), LIKE '%x%', CASE … WHEN 'x').
    const inList = [];   // per open paren: opened by IN ( ?
    let depth = 0;
    let setClause = false;   // UPDATE … SET <here> WHERE
    const consumed = new Set();
    for (let i = 0; i < st.length; i += 1) {
      const token = st[i];
      if (token.type === 'word') {
        if (depth === 0 && head === 'UPDATE' && token.upper === 'SET') setClause = true;
        if (depth === 0 && token.upper === 'WHERE') setClause = false;
        // CONCAT('Data Accurate — ', d.name) → the template "Data Accurate — $1".
        if (token.upper === 'CONCAT' && st[i + 1]?.value === '(') {
          const args = [[]];
          let level = 0;
          for (let j = i + 1; j < st.length; j += 1) {
            const t = st[j];
            if (t.type === 'punct' && t.value === '(') { level += 1; if (level === 1) continue; }
            if (t.type === 'punct' && t.value === ')') { level -= 1; if (level === 0) break; }
            if (level === 1 && t.type === 'punct' && t.value === ',') args.push([]);
            else args[args.length - 1].push({ t, j });
          }
          const literal = (arg) => arg.length === 1 && arg[0].t.type === 'string';
          if (args.some(literal) && args.some((arg) => !literal(arg))) {
            let n = 0;
            const vars = [];
            const template = args.map((arg) => {
              if (literal(arg)) { consumed.add(arg[0].j); return arg[0].t.value; }
              n += 1;
              vars.push(arg.map(({ t }) => (t.type === 'string' ? `'${t.value}'` : t.value)).join(' ').slice(0, 80));
              return `$${n}`;
            }).join('');
            emit({ text: template, kind: 'pattern', vars, source: `${rel}:${token.line}` });
          }
        }
        continue;
      }
      if (token.type === 'punct') {
        if (token.value === '(') { depth += 1; inList.push(st[i - 1]?.upper === 'IN'); }
        else if (token.value === ')') { depth -= 1; inList.pop(); }
        continue;
      }
      if (consumed.has(i)) continue;
      const prev = st[i - 1];
      const compared = inList[inList.length - 1]
        || ['LIKE', 'WHEN'].includes(prev?.upper)
        || ['<>', '!=', '<', '>', '<=', '>='].includes(prev?.value)
        || (prev?.value === '=' && !(setClause && depth === 0));
      if (compared) continue;
      emit({ text: token.value, kind: 'exact', source: `${rel}:${token.line}` });
    }
  }
}

function extractSeeds(ignore, add) {
  const emit = (entry) => {
    const text = normalizeText(entry.text);
    const literal = entry.kind === 'pattern' ? normalizeText(text.replace(/\$\d+/g, ' ')) : text;
    if (!literal || !hasLetters(literal) || ignore.has(text)) return;
    if (isCodeShaped(literal) || isCodeShaped(text.replace(/\$\d+/g, 'x')) || isSingleLowerToken(literal)) return;
    if (/^%|%$/.test(text)) return;
    add({ ...entry, text, area: SEED_AREA });
  };
  const dir = join(REPO, 'backend/migrations');
  for (const path of walk(dir).filter((f) => f.endsWith('.sql')).sort()) {
    extractSeedSql(relative(REPO, path).split('\\').join('/'), readFileSync(path, 'utf8'), emit);
  }
  // Seed code: the standard role names ("Finance Head") are assembled from the
  // division name and the level, so no literal exists for them.
  const organization = join(REPO, 'backend/src/config/standardOrganization.js');
  if (existsSync(organization)) {
    const { DIVISIONS = [], STANDARD_ROLES = [] } = require(organization);
    const source = 'backend/src/config/standardOrganization.js:1';
    for (const division of DIVISIONS) emit({ text: division.name, kind: 'exact', source });
    for (const role of STANDARD_ROLES) emit({ text: role.name, kind: 'exact', source });
  }
}

// ---------------------------------------------------------------- catalog

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);

export function loadTranslations() {
  const exact = {};
  const templates = {};
  const same = new Set(readJson(join(I18N, 'same.json'), []).map(normalizeText));
  if (existsSync(EN)) {
    for (const name of readdirSync(EN).sort()) {
      if (!name.endsWith('.json')) continue;
      const content = readJson(join(EN, name), {});
      if (name.endsWith('.same.json')) for (const text of content) same.add(normalizeText(text));
      else if (name.endsWith('.patterns.json')) Object.assign(templates, content);
      else for (const [key, value] of Object.entries(content)) exact[normalizeText(key)] = value;
    }
  }
  return { exact, templates, same };
}

export const zoneReview = [];
const zoneKey = (file, kind, name) => `${file}\u0000${kind}\u0000${name}`;
// Zones still to review: everything found minus data-zones.reviewed.json.
export function pendingZones() {
  const reviewed = new Set(readJson(join(I18N, 'data-zones.reviewed.json'), []).map((z) => zoneKey(z.file, z.kind, z.name)));
  return zoneReview.filter((z) => !reviewed.has(zoneKey(z.source.replace(/:\d+$/, ''), z.kind, z.name)));
}

export function buildCatalog() {
  const ignore = new Set(readJson(join(I18N, 'ignore.json'), []).map(normalizeText));
  const found = new Map();
  const add = (entry) => {
    const id = `${entry.kind}\u0000${entry.text}`;
    let item = found.get(id);
    if (!item) {
      item = { text: entry.text, kind: entry.kind, sources: [], areas: new Set() };
      if (entry.kind === 'pattern') { item.regex = templateToRegexSource(entry.text); item.vars = entry.vars; }
      found.set(id, item);
    }
    item.sources.push(entry.source);
    item.areas.add(entry.area || areaOf(entry.source.replace(/:\d+$/, '')));
  };
  for (const file of sourceFiles()) extractFile(file, ignore, zoneReview, add);
  extractSeeds(ignore, add);
  // Sticky chunks: the chunk strings.json already gives a string is kept.
  const previous = new Map(readJson(join(CATALOG, 'strings.json'), []).map((s) => [`${s.kind}\u0000${s.text}`, s.chunk]));
  const sticky = previous.size > 0;
  // Area = the first one (in AREA_ORDER) that uses the string; inside an area
  // strings keep source order and are cut into chunks of about CHUNK_TARGET
  // (first run only — afterwards new strings go to `additions`).
  const byArea = new Map(AREA_ORDER.map((name) => [name, []]));
  for (const item of found.values()) {
    const area = AREA_ORDER.find((name) => item.areas.has(name));
    byArea.get(area).push(item);
  }
  const strings = [];
  for (const [area, items] of byArea) {
    if (!items.length) continue;
    const parts = items.length > CHUNK_MAX ? Math.ceil(items.length / CHUNK_TARGET) : 1;
    const size = Math.ceil(items.length / parts);
    items.forEach((item, index) => {
      const computed = parts === 1 ? area : `${area}-${Math.floor(index / size) + 1}`;
      const chunk = sticky
        ? previous.get(`${item.kind}\u0000${item.text}`) || (area === SEED_AREA ? SEED_AREA : 'additions')
        : computed;
      const entry = { text: item.text, kind: item.kind };
      if (item.kind === 'pattern') { entry.regex = item.regex; entry.vars = item.vars; }
      entry.sources = item.sources;
      entry.chunk = chunk;
      strings.push(entry);
    });
  }
  return strings;
}

// A catalog entry is covered when en/ translates it or a same list names it.
export function isCovered(entry, translations) {
  if (translations.same.has(entry.text)) return true;
  const value = entry.kind === 'exact' ? translations.exact[entry.text] : translations.templates[entry.text];
  return typeof value === 'string' && value.trim() !== '';
}

const signature = (strings) => strings.map((s) => `${s.kind}\u0000${s.text}`).sort();

function writeOutputs(strings) {
  const translations = loadTranslations();
  mkdirSync(CHUNKS, { recursive: true });
  for (const name of readdirSync(CHUNKS)) if (name.endsWith('.todo.json')) rmSync(join(CHUNKS, name));
  writeFileSync(join(CATALOG, 'strings.json'), `${JSON.stringify(strings, null, 1)}\n`);
  writeFileSync(join(CATALOG, 'data-zones.review.json'), `${JSON.stringify(pendingZones(), null, 1)}\n`);
  const chunks = [...new Set(strings.map((s) => s.chunk))];
  for (const chunk of chunks) {
    const todo = strings.filter((s) => s.chunk === chunk && !isCovered(s, translations));
    const exact = Object.fromEntries(todo.filter((s) => s.kind === 'exact').map((s) => [s.text, '']));
    const patterns = todo.filter((s) => s.kind === 'pattern')
      .map((s) => ({ id: s.text, regex: s.regex, vars: s.vars, sources: s.sources.slice(0, 3), en: '' }));
    if (Object.keys(exact).length) writeFileSync(join(CHUNKS, `${chunk}.todo.json`), `${JSON.stringify(exact, null, 1)}\n`);
    if (patterns.length) writeFileSync(join(CHUNKS, `${chunk}.patterns.todo.json`), `${JSON.stringify(patterns, null, 1)}\n`);
  }
}

function printStats(strings) {
  const translations = loadTranslations();
  const rows = new Map();
  for (const s of strings) {
    const row = rows.get(s.chunk) || { exact: 0, pattern: 0, todo: 0 };
    row[s.kind] += 1;
    if (!isCovered(s, translations)) row.todo += 1;
    rows.set(s.chunk, row);
  }
  let exact = 0; let pattern = 0; let todo = 0;
  for (const [chunk, row] of rows) {
    console.log(`${chunk.padEnd(26)} exact ${String(row.exact).padStart(5)}  patterns ${String(row.pattern).padStart(4)}  todo ${String(row.todo).padStart(5)}`);
    exact += row.exact; pattern += row.pattern; todo += row.todo;
  }
  console.log(`${'TOTAL'.padEnd(26)} exact ${String(exact).padStart(5)}  patterns ${String(pattern).padStart(4)}  todo ${String(todo).padStart(5)}`);
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) {
  const strings = buildCatalog();
  if (process.argv.includes('--check')) {
    const current = signature(readJson(join(CATALOG, 'strings.json'), []));
    const next = signature(strings);
    const had = new Set(current);
    const has = new Set(next);
    const added = next.filter((s) => !had.has(s));
    const removed = current.filter((s) => !has.has(s));
    if (added.length || removed.length) {
      const show = (list) => list.slice(0, 15).map((s) => `    ${s.replace('\u0000', ': ')}`).join('\n');
      console.error(`i18n catalog is stale: ${added.length} new, ${removed.length} removed. Run: node scripts/i18n-extract.mjs`);
      if (added.length) console.error(`  new:\n${show(added)}`);
      if (removed.length) console.error(`  removed:\n${show(removed)}`);
      process.exit(1);
    }
  } else if (process.argv.includes('--review')) {
    const prefix = process.argv[process.argv.indexOf('--review') + 1] || '';
    console.log(JSON.stringify(pendingZones().filter((z) => z.source.includes(prefix)), null, 1));
  } else if (process.argv.includes('--stats')) {
    printStats(strings);
  } else {
    writeOutputs(strings);
    printStats(strings);
  }
}
