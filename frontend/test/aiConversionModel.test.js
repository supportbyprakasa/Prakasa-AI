import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_FILE_FORMATS, EXPORT_GOOGLE_FORMATS, FORMAT_LABELS, artifactMessage, conversionMenuItems, googleExportItems, isNativeFormat,
} from '../src/components/ai/aiConversionModel.js';

// Wave 1 "dokumen dan file" (docs/prakasa-ai-rencana.md §10.1): the chips
// under an answer and the "Konversi ke…" menu of a document.

test('an answer becomes a PDF, Word, Excel or PowerPoint file, or a Google Doc, Sheet or Slides', () => {
  assert.deepEqual(EXPORT_FILE_FORMATS, ['pdf', 'docx', 'xlsx', 'pptx']);
  assert.deepEqual(EXPORT_GOOGLE_FORMATS, ['gdoc', 'gsheet', 'gslides']);
  assert.deepEqual(googleExportItems().map((item) => item.label), ['Google Doc', 'Google Sheet', 'Google Slides']);
  for (const format of [...EXPORT_FILE_FORMATS, ...EXPORT_GOOGLE_FORMATS]) assert.ok(FORMAT_LABELS[format], format);
});

test('the conversion menu follows the server list, in a fixed order, ignoring what it does not know', () => {
  assert.deepEqual(conversionMenuItems(['txt', 'gdoc', 'pdf', 'docx', 'md']).map((item) => item.value), ['pdf', 'docx', 'txt', 'md', 'gdoc']);
  assert.deepEqual(conversionMenuItems(['PDF', 'zip', null]).map((item) => item.value), ['pdf']);
  assert.deepEqual(conversionMenuItems([]), []);
  assert.deepEqual(conversionMenuItems(undefined), []);
  const [item] = conversionMenuItems(['gsheet']);
  assert.equal(item.label, 'Google Sheet');
  assert.match(item.description, /Google Sheets/);
});

test('a Google-native result is opened, not downloaded; a file is downloaded', () => {
  assert.equal(isNativeFormat('gdoc'), true);
  assert.equal(isNativeFormat('GSLIDES'), true);
  assert.equal(isNativeFormat('pdf'), false);
  assert.equal(isNativeFormat(null), false);
  assert.match(artifactMessage('gdoc'), /Google Doc dibuat di Shared Drive/);
  assert.doesNotMatch(artifactMessage('gdoc'), /diunduh/);
  assert.match(artifactMessage('pptx'), /PPTX dibuat, disimpan di Shared Drive, dan diunduh/);
  assert.match(artifactMessage('pdf', { converted: true }), /^Salinan PDF dibuat/);
  assert.match(artifactMessage('gsheet', { converted: true }), /^Salinan Google Sheet dibuat di Shared Drive/);
});
