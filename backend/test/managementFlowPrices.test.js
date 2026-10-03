const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveTool, TOOLS } = require('../src/services/aiToolRegistry.service');

// Program 3.3 (owner decision P1): purchase prices are read in one place, and
// Prakasa AI never reads the margin estimate, purchase prices or stock values.
const SRC = path.join(__dirname, '..', 'src');
const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'src');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : (e.name.endsWith('.js') ? [full] : []);
});
const rel = (f) => path.relative(SRC, f);
const read = (f) => fs.readFileSync(f, 'utf8');

test('only the price service and the procurement provider read the pc_po_price* views', () => {
  const readers = walk(SRC).filter((f) => /pc_po_price/.test(read(f))).map(rel).sort();
  assert.deepEqual(readers, ['management/providers/procurement.js', 'services/procurementPrices.service.js']);
});

test('the flow page reads prices only through marginLines / latestCosts, with prices === true set by the controller', () => {
  const svc = read(path.join(SRC, 'services/managementFlow.service.js'));
  assert.doesNotMatch(svc, /pc_po_price/);
  assert.match(svc, /prices\.latestCosts\(entityId, .*\{ prices: true \}\)/);
  assert.match(svc, /canSeePrices === true/);
  const provider = read(path.join(SRC, 'management/providers/flow.js'));
  assert.doesNotMatch(provider, /procurementPrices|pc_po_price|marginLines|latestCosts|mg_invoice_lines_accurate|mg_stock_idle_accurate/, 'no price, margin or stock value reaches the management provider');
});

// Narrow on purpose: the AI context may SAY it does not read the margin; it
// must never reach the price readers.
const PRICE_READERS = /management-dashboard\/margin|marginLines|latestCosts|pc_po_price|procurementPrices/;

test('Prakasa AI never reaches the price readers', () => {
  const ai = [
    ...walk(path.join(SRC, 'services/ai')),
    ...['aiToolRegistry.service.js', 'aiContext.service.js', 'aiToolContext.service.js', 'aiCommand.service.js']
      .map((f) => path.join(SRC, 'services', f)).filter((f) => fs.existsSync(f)),
  ];
  assert.ok(ai.length > 4);
  for (const f of ai) assert.doesNotMatch(read(f), PRICE_READERS, rel(f));
});

test('the Alur & Margin page is a management-only AI tool that publishes no state', () => {
  const { tool } = resolveTool('/management/flow');
  assert.equal(tool.key, 'management-flow');
  assert.equal(tool.title, 'Alur & margin');
  assert.deepEqual([].concat(tool.readPermission), ['management_dashboard.view']);
  assert.equal(tool.publishesState, false);
  assert.equal(TOOLS.filter((t) => t.key === 'management-flow').length, 1);
  const context = read(path.join(SRC, 'services/aiToolContext.service.js'));
  assert.match(context, /tool\.key === 'management-flow'[\s\S]{0,200}tidak membaca perkiraan margin, harga beli, atau nilai stok/);
});

test('the flow pages publish no Prakasa AI context', () => {
  const dir = path.join(FRONTEND, 'pages/advanced');
  const files = [path.join(dir, 'ManagementFlow.jsx'), ...fs.readdirSync(path.join(dir, 'flow')).map((f) => path.join(dir, 'flow', f))];
  for (const f of files) assert.doesNotMatch(read(f), /usePublishPrakasaAIContext|PrakasaAIToolContext/, path.basename(f));
});
