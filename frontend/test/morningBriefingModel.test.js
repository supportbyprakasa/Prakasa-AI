import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BRIEFING_VISIBLE_ROWS, briefingQuestion, briefingStatus, normalizeBriefing, readCollapsed, waitingText, wibHour, writeCollapsed,
} from '../src/pages/morningBriefingModel.js';
import { findingStatus, normalizeReview, valueChange } from '../src/pages/sales/accurateBatchReviewModel.js';
import { statusLabel, statusTone } from '../src/components/statusTone.js';

const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('the briefing answer is read into one safe shape', () => {
  const out = normalizeBriefing({
    headline: { total: 3, lead: '3 hal perlu Anda tindak hari ini', parts: [{ key: 'a', text: '2 persetujuan menunggu' }, { key: 'b' }] },
    items: [
      { key: 'approvals_waiting', label: 'Pengajuan menunggu keputusan Anda', count: 2, severity: 'danger', group: 'action', route: '/data-accurate/9', ageHours: 50, examples: [{ title: 'A', route: '//luar.invalid' }, { title: 'B' }, { title: 'C' }, { title: 'D' }] },
      { key: 'zero', label: 'Kosong', count: 0 },
      { key: 'x', label: 'X', count: 1, severity: 'aneh', route: 'https://luar.invalid' },
      null,
    ],
    tertunda: ['Sales'],
  });
  assert.deepEqual(out.items.map((i) => i.key), ['approvals_waiting', 'x'], 'empty rows are dropped');
  assert.equal(out.items[0].examples.length, 3);
  assert.equal(out.items[0].examples[0].route, null, 'no outside link');
  assert.deepEqual([out.items[1].severity, out.items[1].route], ['info', null]);
  assert.deepEqual(out.headline.parts, [{ key: 'a', text: '2 persetujuan menunggu' }]);
  assert.deepEqual(out.pending, ['Sales']);
  assert.equal(out.allClear, false);
  const empty = normalizeBriefing('rusak');
  assert.deepEqual([empty.items, empty.allClear, empty.headline.total], [[], true, 0]);
  assert.equal(normalizeBriefing({ items: [], tertunda: ['IT'] }).allClear, false, 'a skipped section is not "all clear"');
  assert.equal(BRIEFING_VISIBLE_ROWS, 6);
});

test('tone and label of a row come from the one status map', () => {
  assert.deepEqual(['danger', 'warning', 'info', 'lain'].map((s) => statusTone(briefingStatus(s))), ['error', 'warning', 'info', 'info']);
  assert.deepEqual(['danger', 'warning', 'info'].map((s) => statusLabel(briefingStatus(s))), ['Mendesak', 'Perlu perhatian', 'Info']);
  assert.deepEqual(['high', 'medium', 'low', 'lain'].map((s) => [statusTone(findingStatus(s)), statusLabel(findingStatus(s))]),
    [['error', 'Tinggi'], ['warning', 'Sedang'], ['default', 'Rendah'], ['default', 'Rendah']]);
});

test('greeting hour is WIB wherever the browser is; waiting time reads in hours then days', () => {
  assert.equal(wibHour(new Date('2026-10-02T01:30:00Z')), 8);
  assert.equal(wibHour(new Date('2026-10-02T18:00:00Z')), 1);
  assert.deepEqual([waitingText(null), waitingText(0), waitingText(5), waitingText(23.9), waitingText(24), waitingText(73)],
    ['', '', 'menunggu 5 jam', 'menunggu 23 jam', 'menunggu 1 hari', 'menunggu 3 hari']);
});

test('"Tanya Prakasa AI tentang ini" writes a question; it is put in the message box, never sent by the page', () => {
  assert.equal(briefingQuestion({ label: 'Tugas lewat tenggat', count: 2 }),
    'Tentang Tugas lewat tenggat (2) di ringkasan pagi saya: apa yang perlu saya tindak lebih dulu, dan mengapa?');
  const panel = read('components/ai/PrakasaAIToolPanel.jsx');
  const draft = panel.slice(panel.indexOf('const draftId'), panel.indexOf('const newConversation'));
  assert.match(draft, /autoSend: false/);
  assert.doesNotMatch(draft, /autoSend: true|send\(/);
  const context = read('context/PrakasaAIToolContext.jsx');
  assert.match(context, /const ask = useCallback/);
});

test('collapsed state is remembered per user and survives a browser without storage', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(readCollapsed(5, storage), false);
  writeCollapsed(5, true, storage);
  assert.equal(readCollapsed(5, storage), true);
  assert.equal(readCollapsed(6, storage), false, 'another user on the same browser');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readCollapsed(5, broken), false);
  assert.doesNotThrow(() => writeCollapsed(5, true, broken));
});

test('a review is read into one safe shape; rupiah only when the server sent it', () => {
  const out = normalizeReview({
    contents: [{ type: 'sales_invoice', label: 'Faktur', create: 2, update: '1', missing: null }],
    findings: [
      { code: 'NILAI_BERUBAH_BESAR', severity: 'high', title: 'Nilai berubah', count: 7, why: 'karena', examples: [
        { number: 'SI-1', percent: 50, before: 10000000, after: 15000000 }, { number: 'PO-1', percent: 100 }, { percent: 1 }, { number: 'a' }, { number: 'b' }, { number: 'c' }, { number: 'd' },
      ] },
      { code: 'X', severity: 'aneh' }, null,
    ],
    notChecked: [{ code: 'BARANG_TANPA_KONVERSI_SATUAN', title: 'Barang tanpa konversi satuan', reason: 'belum' }],
    aiNote: 'Catatan', aiStatus: 'ok', requestedByName: 'Uji',
  });
  assert.equal(out.findings[0].examples.length, 4, 'at most five, and only those with a number');
  assert.match(valueChange(out.findings[0].examples[0]), /10\.000\.000.*→.*15\.000\.000/);
  assert.equal(valueChange(out.findings[0].examples[1]), '', 'no value was sent: nothing is shown');
  assert.deepEqual([out.findings[1].severity, out.findings[1].count, out.findings[1].title], ['low', 0, 'X']);
  assert.deepEqual([out.contents[0].update, out.contents[0].missing], [1, 0]);
  assert.equal(normalizeReview(null), null);
});

test('the review panel cannot decide: no approval call, no touch of the page\'s decision controls', () => {
  const panel = read('pages/sales/AccurateBatchReview.jsx').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  assert.doesNotMatch(panel, /\/approvals\/|decide|setModal|onApprove|onReject|\.focus\(|\.click\(|autoFocus/);
  assert.match(panel, /Catatan AI — bukan keputusan/);
  const review = read('api/batchReviewStream.js');
  assert.deepEqual([...review.matchAll(/fetch\(`\$\{apiBaseUrl\}([^`]+)`/g)].map((m) => m[1]), ['/accurate/batches/${batchId}/review'], 'one request, to the review endpoint');
  assert.match(review, /\/accurate\/batches\/\$\{batchId\}\/review/);
  assert.doesNotMatch(review, /approvals|decide/);
  // The page keeps its own decision controls exactly where they were.
  const page = read('pages/sales/SalesAccurateBatch.jsx');
  assert.match(page, /api\.post\(`\/approvals\/\$\{state\.batch\.approvalRequestId\}\/decide`/);
  assert.equal((page.match(/\/decide`/g) || []).length, 1);
  assert.match(page, /<Button variant="secondary" icon="close" onClick=\{\(\) => setModal\('reject'\)\}>Tolak<\/Button>/);
  assert.match(page, /<Button icon="check" onClick=\{\(\) => setModal\('approve'\)\}>Setujui &amp; terapkan<\/Button>/);
});
