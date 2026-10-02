import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const PAGES = new URL('../src/pages/', import.meta.url).pathname;

// Pages still rendering a hand-built <table>, pending migration to DataGrid. Shrink only.
const PENDING_MIGRATION = new Set([]);

// Printed documents (A4 paper), not data lists: their tables are part of the
// document layout and must print exactly, so they are plain HTML tables.
const PRINT_DOCUMENTS = new Set(['sales/SalesPrint.jsx']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

test('every list/CRUD table in a page is rendered by DataGrid', () => {
  const offenders = walk(PAGES)
    .filter((path) => path.endsWith('.jsx'))
    .map((path) => relative(PAGES, path))
    .filter((file) => !PENDING_MIGRATION.has(file) && !PRINT_DOCUMENTS.has(file))
    .filter((file) => /<table[\s>]/.test(readFileSync(join(PAGES, file), 'utf8')));

  assert.deepEqual(offenders, [], `Use components/datagrid/DataGrid (or DataTable) instead of a raw <table> in: ${offenders.join(', ')}`);
});

test('the pending-migration list only names files that still need it', () => {
  const stale = [...PENDING_MIGRATION].filter((file) => (
    !/<table[\s>]/.test(readFileSync(join(PAGES, file), 'utf8'))
  ));
  assert.deepEqual(stale, [], `Remove from PENDING_MIGRATION, already migrated: ${stale.join(', ')}`);
});
