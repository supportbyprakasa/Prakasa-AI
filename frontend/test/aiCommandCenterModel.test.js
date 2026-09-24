import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampDocumentPanelWidth,
  closeOpenMarkdown,
  firstNameOf,
  getGooglePreviewUrl,
  greetingForHour,
  groupSessionsByRecency,
  isGenerationActive,
  normalizeStoredPanelWidth,
  parseSseEvents,
  recencyKey,
  resolveResponsiveMode,
  titleFromMessage,
} from '../src/pages/ai/aiCommandCenterModel.js';

test('closeOpenMarkdown temporarily closes markers left open mid-stream', () => {
  assert.equal(closeOpenMarkdown('**3. Samp'), '**3. Samp**');
  assert.equal(closeOpenMarkdown('**Judul '), '**Judul**');
  assert.equal(closeOpenMarkdown('a **b** c'), 'a **b** c');
  assert.equal(closeOpenMarkdown('pakai `npm'), 'pakai `npm`');
  assert.equal(closeOpenMarkdown('```js\nconst a = **1'), '```js\nconst a = **1\n```');
  assert.equal(closeOpenMarkdown('```js\nx\n```\nlalu **tebal'), '```js\nx\n```\nlalu **tebal**');
  assert.equal(closeOpenMarkdown(''), '');
});

test('parseSseEvents returns complete events and keeps the partial tail', () => {
  const first = parseSseEvents('event: delta\ndata: {"text":"Ha"}\n\n: keep-alive\n\nevent: delta\ndata: {"te');
  assert.deepEqual(first.events, [{ event: 'delta', data: '{"text":"Ha"}' }]);
  assert.equal(first.rest, 'event: delta\ndata: {"te');

  const second = parseSseEvents(`${first.rest}xt":"lo"}\n\nevent: done\ndata: {"ok":true}\n\n`);
  assert.deepEqual(second.events, [
    { event: 'delta', data: '{"text":"lo"}' },
    { event: 'done', data: '{"ok":true}' },
  ]);
  assert.equal(second.rest, '');
});

test('parseSseEvents handles CRLF, multi-line data and the default event name', () => {
  const { events } = parseSseEvents('data: line one\r\ndata: line two\r\n\r\n');
  assert.deepEqual(events, [{ event: 'message', data: 'line one\nline two' }]);
});

test('recencyKey buckets by local calendar day', () => {
  const now = new Date(2026, 8, 24, 9, 0);
  assert.equal(recencyKey(new Date(2026, 8, 24, 0, 5).toISOString(), now), 'today');
  assert.equal(recencyKey(new Date(2026, 8, 23, 23, 59).toISOString(), now), 'yesterday');
  assert.equal(recencyKey(new Date(2026, 8, 18, 12, 0).toISOString(), now), 'week');
  assert.equal(recencyKey(new Date(2026, 8, 1, 12, 0).toISOString(), now), 'month');
  assert.equal(recencyKey(new Date(2026, 5, 1, 12, 0).toISOString(), now), 'older');
  assert.equal(recencyKey(new Date(2026, 8, 25, 8, 0).toISOString(), now), 'today');
  assert.equal(recencyKey('not-a-date', now), 'older');
});

test('groupSessionsByRecency keeps order and drops empty groups', () => {
  const now = new Date(2026, 8, 24, 9, 0);
  const groups = groupSessionsByRecency([
    { id: 1, lastMessageAt: new Date(2026, 8, 24, 8, 0).toISOString() },
    { id: 2, lastMessageAt: null, createdAt: new Date(2026, 8, 24, 7, 0).toISOString() },
    { id: 3, lastMessageAt: new Date(2026, 5, 1).toISOString() },
  ], now);
  assert.deepEqual(groups.map((g) => g.key), ['today', 'older']);
  assert.deepEqual(groups[0].items.map((s) => s.id), [1, 2]);
  assert.deepEqual(groupSessionsByRecency(null, now), []);
});

test('greetingForHour follows Indonesian day parts', () => {
  assert.equal(greetingForHour(6), 'Selamat pagi');
  assert.equal(greetingForHour(12), 'Selamat siang');
  assert.equal(greetingForHour(16), 'Selamat sore');
  assert.equal(greetingForHour(21), 'Selamat malam');
  assert.equal(greetingForHour(2), 'Selamat malam');
});

test('titleFromMessage derives a short single-line title', () => {
  assert.equal(titleFromMessage('  Ringkas   laporan\nQ3  '), 'Ringkas laporan Q3');
  assert.equal(titleFromMessage(''), 'Percakapan baru');
  const long = 'Tolong bantu saya menyusun draft surat penawaran harga untuk pelanggan baru di Surabaya';
  const title = titleFromMessage(long, 40);
  assert.ok(title.length <= 41);
  assert.ok(title.endsWith('…'));
  assert.ok(!title.includes('  '));
});

test('firstNameOf prefers the first name, then the email local part', () => {
  assert.equal(firstNameOf({ name: 'Wahyudi Local', email: 'x@y.com' }), 'Wahyudi');
  assert.equal(firstNameOf({ name: '', email: 'admin@prakasafoods.com' }), 'admin');
  assert.equal(firstNameOf(null), '');
});

test('resolveResponsiveMode maps viewport breakpoints', () => {
  assert.equal(resolveResponsiveMode(480), 'mobile');
  assert.equal(resolveResponsiveMode(699), 'mobile');
  assert.equal(resolveResponsiveMode(700), 'tablet');
  assert.equal(resolveResponsiveMode(1179), 'tablet');
  assert.equal(resolveResponsiveMode(1180), 'desktop');
  assert.equal(resolveResponsiveMode(1440), 'desktop');
});

test('getGooglePreviewUrl only embeds recognized Google document URLs', () => {
  assert.equal(
    getGooglePreviewUrl('https://docs.google.com/document/d/doc-123/edit?tab=t.0'),
    'https://docs.google.com/document/d/doc-123/preview',
  );
  assert.equal(
    getGooglePreviewUrl('https://drive.google.com/file/d/file-456/view?usp=drive_link'),
    'https://drive.google.com/file/d/file-456/preview',
  );
  assert.equal(getGooglePreviewUrl('https://example.com/document.pdf'), null);
  assert.equal(getGooglePreviewUrl('not-a-url'), null);
});

test('clampDocumentPanelWidth keeps the supporting pane usable', () => {
  assert.equal(clampDocumentPanelWidth(420, 1440), 420);
  assert.equal(clampDocumentPanelWidth(120, 1440), 320);
  assert.equal(clampDocumentPanelWidth(900, 1440), 576);
  assert.equal(clampDocumentPanelWidth(420, 760), 320);
  assert.equal(clampDocumentPanelWidth(Number.NaN, 1440), 400);
});

test('normalizeStoredPanelWidth accepts safe numeric values only', () => {
  assert.equal(normalizeStoredPanelWidth('468', 1440), 468);
  assert.equal(normalizeStoredPanelWidth('not-a-width', 1440), 400);
  assert.equal(normalizeStoredPanelWidth(null, 1440), 400);
  assert.equal(normalizeStoredPanelWidth('560', 1180), 364);
});

test('isGenerationActive includes local sending and server generation', () => {
  assert.equal(isGenerationActive({ sending: true, generationStatus: 'idle' }), true);
  assert.equal(isGenerationActive({ sending: false, generationStatus: 'generating' }), true);
  assert.equal(isGenerationActive({ sending: false, generationStatus: 'failed' }), false);
  assert.equal(isGenerationActive({ sending: false, generationStatus: 'idle' }), false);
});
