import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KINDS, SCOPES, VIEWS, editorFrameUrl, editorRoute, emptyCopy, fileDateCell, fileDateColumn, fileDateLabel, frameHint,
  isScope, isValidFileId, isView, kindConfig, mergeFiles, normalizeSearch, openInGoogleUrl, ownerLabel, relativeTime,
} from '../src/pages/google/googleFilesModel.js';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

test('each kind has its Indonesian title, create label and route', () => {
  assert.deepEqual(Object.keys(KINDS), ['document', 'spreadsheet', 'presentation']);
  assert.equal(KINDS.document.createLabel, 'Buat dokumen');
  assert.equal(KINDS.spreadsheet.createLabel, 'Buat spreadsheet');
  assert.equal(KINDS.presentation.createLabel, 'Buat presentasi');
  assert.deepEqual(Object.values(KINDS).map((k) => k.title), ['Docs', 'Sheets', 'Slides']);
  assert.equal(kindConfig('nope'), KINDS.document);
  assert.equal(kindConfig('__proto__'), KINDS.document);
});

test('tabs are Terbaru / Milik saya / Dibagikan ke saya', () => {
  assert.deepEqual(SCOPES.map((s) => s.label), ['Terbaru', 'Milik saya', 'Dibagikan ke saya']);
  assert.equal(isScope('shared'), true);
  assert.equal(isScope('trash'), false);
});

test('the list has a grid and a list layout', () => {
  assert.deepEqual(VIEWS.map((v) => v.value), ['grid', 'list']);
  assert.equal(isView('list'), true);
  assert.equal(isView('table'), false);
});

test('file ids are validated strictly', () => {
  assert.equal(isValidFileId(ID), true);
  for (const bad of ['', 'short', '../../x/y/z/w', 'abc?rm=full&x=1', 'javascript:alert(1)', 'a'.repeat(129), null, 42]) {
    assert.equal(isValidFileId(bad), false, String(bad));
  }
});

test('editorFrameUrl builds the minimal-chrome Google editor URL only for a valid id', () => {
  assert.equal(editorFrameUrl('document', ID), `https://docs.google.com/document/d/${ID}/edit`);
  assert.equal(editorFrameUrl('spreadsheet', ID), `https://docs.google.com/spreadsheets/d/${ID}/edit`);
  assert.equal(editorFrameUrl('presentation', ID), `https://docs.google.com/presentation/d/${ID}/edit`);
  assert.equal(editorFrameUrl('document', '../evil'), null);
  assert.equal(editorFrameUrl('folder', ID), null);
});

test('editorRoute maps a kind to its in-app route', () => {
  assert.equal(editorRoute('document', ID), `/docs/${ID}`);
  assert.equal(editorRoute('spreadsheet', ID), `/sheets/${ID}`);
  assert.equal(editorRoute('presentation', ID), `/slides/${ID}`);
  assert.equal(editorRoute('document', 'x/../../admin'), null);
});

test('openInGoogleUrl trusts only Google hosts and falls back to the built editor URL', () => {
  assert.equal(openInGoogleUrl('document', ID, `https://docs.google.com/document/d/${ID}/edit?usp=drivesdk`), `https://docs.google.com/document/d/${ID}/edit?usp=drivesdk`);
  assert.equal(openInGoogleUrl('spreadsheet', ID, 'https://evil.example.com/phish'), `https://docs.google.com/spreadsheets/d/${ID}/edit`);
  assert.equal(openInGoogleUrl('spreadsheet', ID, 'javascript:alert(1)'), `https://docs.google.com/spreadsheets/d/${ID}/edit`);
  assert.equal(openInGoogleUrl('presentation', ID, null), `https://docs.google.com/presentation/d/${ID}/edit`);
  assert.equal(openInGoogleUrl('presentation', 'bad', null), null);
});

test('frameHint never reports a problem once the frame loaded', () => {
  assert.equal(frameHint({ loaded: false, timedOut: false }), 'loading');
  assert.equal(frameHint({ loaded: false, timedOut: true }), 'not-loaded');
  assert.equal(frameHint({ loaded: true, timedOut: true }), null);
  assert.equal(frameHint({ loaded: true, timedOut: false }), null);
});

test('mergeFiles appends the next page without duplicates', () => {
  const merged = mergeFiles([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }, { id: 'c' }, null]);
  assert.deepEqual(merged.map((f) => f.id), ['a', 'b', 'c']);
  assert.deepEqual(mergeFiles(undefined, [{ id: 'x' }]).map((f) => f.id), ['x']);
});

test('normalizeSearch trims, collapses whitespace and caps length', () => {
  assert.equal(normalizeSearch('  rapat   bulanan '), 'rapat bulanan');
  assert.equal(normalizeSearch('x'.repeat(250)).length, 100);
  assert.equal(normalizeSearch(null), '');
});

test('relativeTime speaks Indonesian', () => {
  const now = new Date(2026, 8, 28, 15, 0, 0);
  assert.equal(relativeTime(new Date(2026, 8, 28, 14, 59, 40).toISOString(), now), 'Baru saja');
  assert.equal(relativeTime(new Date(2026, 8, 28, 14, 45).toISOString(), now), '15 menit lalu');
  assert.equal(relativeTime(new Date(2026, 8, 28, 11, 0).toISOString(), now), '4 jam lalu');
  assert.equal(relativeTime(new Date(2026, 8, 27, 23, 0).toISOString(), now), 'Kemarin');
  assert.equal(relativeTime(new Date(2026, 8, 24, 9, 0).toISOString(), now), '4 hari lalu');
  assert.equal(relativeTime(new Date(2026, 4, 12).toISOString(), now), '12 Mei 2026');
  assert.match(relativeTime(new Date(2024, 4, 12).toISOString(), now), /2024/);
  assert.equal(relativeTime('', now), '');
  assert.equal(relativeTime('not a date', now), '');
});

test('fileDateLabel shows last opened on Terbaru, last modified elsewhere', () => {
  const now = new Date(2026, 8, 28, 15, 0, 0);
  const file = { viewedByMeTime: new Date(2026, 8, 28, 14, 50).toISOString(), modifiedTime: new Date(2026, 8, 27, 10).toISOString() };
  assert.equal(fileDateLabel(file, 'recent', now), 'Dibuka 10 menit lalu');
  assert.equal(fileDateLabel(file, 'mine', now), 'Diubah kemarin');
  assert.equal(fileDateLabel({ modifiedTime: file.modifiedTime }, 'recent', now), 'Diubah kemarin');
  assert.equal(fileDateLabel({ modifiedTime: new Date(2026, 8, 28, 14, 59, 50).toISOString() }, 'mine', now), 'Diubah baru saja');
  assert.equal(fileDateLabel({ modifiedTime: new Date(2026, 4, 12).toISOString() }, 'mine', now), 'Diubah 12 Mei 2026');
});

test('the list layout date column follows the tab', () => {
  const now = new Date(2026, 8, 28, 15, 0, 0);
  const file = { viewedByMeTime: new Date(2026, 8, 28, 14, 50).toISOString(), modifiedTime: new Date(2026, 8, 27, 10).toISOString() };
  assert.equal(fileDateColumn('recent'), 'Terakhir dibuka');
  assert.equal(fileDateColumn('shared'), 'Terakhir diubah');
  assert.equal(fileDateCell(file, 'recent', now), '10 menit lalu');
  assert.equal(fileDateCell(file, 'mine', now), 'Kemarin');
  assert.equal(fileDateCell({ modifiedTime: file.modifiedTime }, 'recent', now), 'Diubah kemarin');
});

test('ownerLabel prefers Saya, then shared drive, then the owner name', () => {
  assert.equal(ownerLabel({ ownedByMe: true, ownerName: 'saya' }), 'Saya');
  assert.equal(ownerLabel({ inSharedDrive: true }), 'Drive bersama');
  assert.equal(ownerLabel({ ownerName: 'Budi' }), 'Budi');
  assert.equal(ownerLabel(null), '');
});

test('emptyCopy fits the tab and the search', () => {
  assert.match(emptyCopy('spreadsheet', 'recent', 'budget').title, /Tidak ada spreadsheet yang cocok/);
  assert.match(emptyCopy('presentation', 'shared', '').title, /dibagikan/);
  assert.match(emptyCopy('document', 'mine', '').title, /milik Anda/);
});
