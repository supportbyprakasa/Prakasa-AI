const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');

const {
  extractReadableText,
  generateArtifact,
  prepareUpload,
  sanitizeFileName,
} = require('../src/services/aiDocumentArtifact.service');

test('sanitizeFileName removes traversal and unsafe characters', () => {
  assert.equal(sanitizeFileName('../../Laporan Q3?.pdf'), 'Laporan Q3.pdf');
  assert.equal(sanitizeFileName('   '), 'document');
});

test('prepareUpload gzips compressible text and preserves original metadata', async () => {
  const content = Buffer.from('data penjualan\n'.repeat(2000));
  const prepared = await prepareUpload({
    buffer: content,
    fileName: 'penjualan.csv',
    mimeType: 'text/csv',
  });

  assert.equal(prepared.compressionMethod, 'gzip');
  assert.equal(prepared.storedMimeType, 'application/gzip');
  assert.match(prepared.storedName, /\.gz$/);
  assert.ok(prepared.storedBuffer.length < content.length);
  assert.equal(prepared.originalSize, content.length);

  const extracted = await extractReadableText({
    buffer: prepared.storedBuffer,
    storedMimeType: prepared.storedMimeType,
    originalMimeType: prepared.originalMimeType,
    originalName: prepared.originalName,
    compressionMethod: prepared.compressionMethod,
  });
  assert.equal(extracted.status, 'ready');
  assert.match(extracted.text, /data penjualan/);
});

test('prepareUpload keeps short text when gzip would not help', async () => {
  const prepared = await prepareUpload({
    buffer: Buffer.from('abc'),
    fileName: 'note.txt',
    mimeType: 'text/plain',
  });
  assert.equal(prepared.compressionMethod, 'none');
  assert.equal(prepared.storedName, 'note.txt');
});

test('generateArtifact creates readable PDF, DOCX, and XLSX buffers', async () => {
  const content = 'Laporan Penjualan\n\n| Produk | Nilai |\n| --- | ---: |\n| Alpha | 120 |';

  const pdf = await generateArtifact({ format: 'pdf', title: 'Laporan', content });
  assert.equal(pdf.mimeType, 'application/pdf');
  assert.ok(pdf.buffer.subarray(0, 4).toString() === '%PDF');
  assert.ok((await PDFDocument.load(pdf.buffer)).getPageCount() >= 1);

  const docx = await generateArtifact({ format: 'docx', title: 'Laporan', content });
  assert.equal(docx.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(docx.buffer.subarray(0, 2).toString(), 'PK');
  const docxText = await extractReadableText({
    buffer: docx.buffer,
    storedMimeType: docx.mimeType,
    originalMimeType: docx.mimeType,
    originalName: docx.fileName,
    compressionMethod: 'native',
  });
  assert.match(docxText.text, /Laporan Penjualan/);

  const xlsx = await generateArtifact({ format: 'xlsx', title: 'Laporan', content });
  assert.equal(xlsx.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(xlsx.buffer.subarray(0, 2).toString(), 'PK');
  const xlsxText = await extractReadableText({
    buffer: xlsx.buffer,
    storedMimeType: xlsx.mimeType,
    originalMimeType: xlsx.mimeType,
    originalName: xlsx.fileName,
    compressionMethod: 'native',
  });
  assert.match(xlsxText.text, /Produk/);
  assert.match(xlsxText.text, /Alpha/);
});
