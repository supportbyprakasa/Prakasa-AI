import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const visibleBrandFiles = [
  'index.html',
  'src/pages/Login.jsx',
  'src/components/Navbar.jsx',
  'src/pages/DivisionHub.jsx',
  'src/components/ai/AIAccountMenu.jsx',
  'src/pages/ai/AICommandCenter.jsx',
  '../backend/src/app.js',
  '../backend/src/services/pdf.service.js',
  '../README.md',
];

test('user-visible product name is Prakasa Workspace', async () => {
  const oldBrand = /Prakasa(?: AI)? Work OS|Kembali ke Work OS/g;
  const failures = [];

  for (const file of visibleBrandFiles) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    if (oldBrand.test(source)) failures.push(file);
    oldBrand.lastIndex = 0;
  }

  assert.deepEqual(failures, []);
});
