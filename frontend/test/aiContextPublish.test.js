import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Program 4.1: the Warehouse/Procurement pages tell Prakasa AI what is on screen
// (filters and the SO/PO/vendor open) — never a price.
const PAGES = {
  'pages/warehouse/WarehouseToday.jsx': 'warehouse',
  'pages/warehouse/WarehouseShipping.jsx': 'warehouse',
  'pages/warehouse/WarehouseStock.jsx': 'warehouse',
  'pages/procurement/ProcurementToday.jsx': 'procurement',
  'pages/procurement/ProcurementOrders.jsx': 'procurement',
  'pages/procurement/ProcurementVendors.jsx': 'procurement',
  'pages/procurement/ProcurementPrices.jsx': 'procurement',
};

test('each page publishes its AI context under its own tool, with no price in it', () => {
  for (const [file, key] of Object.entries(PAGES)) {
    const src = fs.readFileSync(path.join(import.meta.dirname, '../src', file), 'utf8');
    const call = src.match(/usePublishPrakasaAIContext\(\{[^;]*\}\);/s);
    assert.ok(call, file);
    assert.match(call[0], new RegExp(`toolKey: '${key}'`), file);
    // The tab's own name aside ("prices" is a tab), nothing price-like is published.
    assert.doesNotMatch(call[0].replace(/tab: '[a-z]+'/, ''), /price|harga|value|spend|rupiah|amount/i, file);
  }
  const prices = fs.readFileSync(path.join(import.meta.dirname, '../src/pages/procurement/ProcurementPrices.jsx'), 'utf8');
  assert.match(prices, /visibleState: \{ tab: 'prices' \}/, 'the price tab publishes only its name');
});
