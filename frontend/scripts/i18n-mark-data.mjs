// Marks record values in JSX as data the language switch must never translate.
//
//   node scripts/i18n-mark-data.mjs          add data-no-translate where missing
//   node scripts/i18n-mark-data.mjs --dry    only list what would change
//
// It finds host elements (<span>, <td>, <strong>, <Link> …) whose only content
// is record data — `{row.customerName}`, `{order.number || '—'}` — and adds
// data-no-translate="" to them. "Record data" = a member expression whose last
// property is a data field (a name, number, code, note, address, email …);
// labels (`item.label`, `column.header`, `tab.title`) are left alone. Anything
// else (data mixed with text, values passed through helpers or components) is
// marked by hand with <NoTranslate> / {...noTranslate} (src/i18n/NoTranslate.jsx).
// Re-running it changes nothing.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
const DRY = process.argv.includes('--dry');
const ATTR = 'data-no-translate';

// Last property of a member expression that names record data.
const DATA_FIELD = /(?:^n|N)ame$|Number$|No$|Code$|^code$|[eE]mail$|[pP]hone$|^notes$|Notes$|[aA]ddress$|^sku$|Sku$|^unit$|Unit$|^reference|Reference$|Ref$|^number$|^subject$|^snippet$|^comment$|^memo$|^remarks?$|^keterangan$|^plate|^npwp$|^city$|^username$|^serial|Serial$|^brand$|^model$|^vendor$|^customer$|^warehouse$|^channel$/;
// Names kept in the database but written by the product itself (roles,
// divisions, permissions, types, stages …): interface text, left translatable.
const PRODUCT_NAME = /^(role|department|division|dept|permission|type|category|status|stage|column|template|module|menu|group|section|kind|documentType|docType|metric|policy|entity|matrix|rule|tool|provider|step|checklist|label|board|sprint|platform)[A-Z]?\w*Name$|^(statusName|typeName|categoryName)$/;
const PRODUCT_OWNER = /role|department|division|dept|permission|type|category|stage|column|template|module|section|metric|policy|option|tab|step|item$|config|provider|tool|entity|matrix|rule|kind|group|board|sprint|platform|^(o|opt|t|s|d|c|e|g|m|p)$/i;
// Elements that render text themselves and take attributes.
const HOST = /^[a-z]/;
const PASS_THROUGH = new Set(['Link', 'NavLink']);

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

function lastProperty(node) {
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    if (node.computed) return null;
    return node.property.type === 'Identifier' ? node.property.name : null;
  }
  return null;
}

// `row.name`, `row.name || '—'`, `row.a?.name ?? row.code`, `String(row.code)`.
function isDataExpression(node) {
  if (!node) return false;
  if (node.type === 'LogicalExpression') {
    const fallback = (side) => (side.type === 'StringLiteral' && !/\p{L}/u.test(side.value)) || isDataExpression(side);
    return isDataExpression(node.left) && fallback(node.right);
  }
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'String' && node.arguments.length === 1) {
    return isDataExpression(node.arguments[0]);
  }
  const name = lastProperty(node);
  if (!name || !DATA_FIELD.test(name) || PRODUCT_NAME.test(name)) return false;
  if (name === 'name' || name === 'code' || name === 'unit') {
    const owner = node.object;
    const ownerName = owner.type === 'Identifier' ? owner.name : lastProperty(owner) || '';
    if (PRODUCT_OWNER.test(ownerName)) return false;
  }
  return true;
}

let changedFiles = 0;
let marks = 0;
for (const file of walk(SRC).filter((f) => f.endsWith('.jsx') && !f.includes('/i18n/') && !f.includes('/pages/dev/'))) {
  const code = readFileSync(file, 'utf8');
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true });
  const inserts = [];
  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      const tag = opening.name.type === 'JSXIdentifier' ? opening.name.name : '';
      if (!tag || !(HOST.test(tag) || PASS_THROUGH.has(tag))) return;
      if (opening.attributes.some((a) => a.type === 'JSXAttribute' && (a.name.name === ATTR || a.name.name === 'data-translate'))) return;
      const children = path.node.children.filter((child) => !(child.type === 'JSXText' && child.value.trim() === ''));
      if (!children.length) return;
      let data = 0;
      for (const child of children) {
        if (child.type === 'JSXText') { if (/\p{L}/u.test(child.value)) return; continue; }
        if (child.type !== 'JSXExpressionContainer' || !isDataExpression(child.expression)) return;
        data += 1;
      }
      if (!data) return;
      inserts.push({ at: opening.name.end, line: opening.loc.start.line });
    },
  });
  if (!inserts.length) continue;
  changedFiles += 1;
  marks += inserts.length;
  if (DRY) {
    for (const insert of inserts) console.log(`${relative(SRC, file)}:${insert.line}`);
    continue;
  }
  let out = code;
  for (const insert of inserts.sort((a, b) => b.at - a.at)) out = `${out.slice(0, insert.at)} ${ATTR}=""${out.slice(insert.at)}`;
  writeFileSync(file, out);
}
console.log(`${DRY ? 'would mark' : 'marked'} ${marks} elements in ${changedFiles} files`);
