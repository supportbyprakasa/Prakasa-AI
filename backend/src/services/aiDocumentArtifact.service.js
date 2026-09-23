const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require('docx');
const JSZip = require('jszip');
const pdfParse = require('pdf-parse');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const MAX_SOURCE_BYTES = Number(process.env.AI_DOCUMENT_MAX_BYTES || 25 * 1024 * 1024);
const MAX_EXTRACTED_CHARS = Number(process.env.AI_DOCUMENT_MAX_EXTRACTED_CHARS || 100000);
const MAX_ZIP_UNCOMPRESSED_BYTES = 60 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5000;

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
};

const TEXT_MIMES = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/html',
  'text/xml',
  'application/json',
  'application/xml',
  'application/csv',
]);

const TEXT_EXTENSIONS = new Set(['.txt', '.csv', '.md', '.markdown', '.json', '.xml', '.html', '.htm']);
const NATIVE_COMPRESSED_MIMES = new Set([
  MIME.pdf,
  MIME.docx,
  MIME.xlsx,
  MIME.pptx,
  MIME.odt,
  MIME.ods,
  MIME.odp,
  'image/jpeg',
  'image/webp',
  'image/png',
  'application/zip',
  'application/gzip',
]);

function sanitizeFileName(value) {
  const base = path.basename(String(value || 'document'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (base || 'document').slice(0, 180);
}

function safeTitle(value) {
  return String(value || 'Dokumen AI').replace(/\s+/g, ' ').trim().slice(0, 140) || 'Dokumen AI';
}

function isCompressibleText(mimeType, fileName) {
  return TEXT_MIMES.has(String(mimeType || '').toLowerCase()) ||
    TEXT_EXTENSIONS.has(path.extname(String(fileName || '')).toLowerCase());
}

async function prepareUpload({ buffer, fileName, mimeType }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw validationError('File kosong');
  }
  if (buffer.length > MAX_SOURCE_BYTES) {
    throw validationError(`Ukuran file melebihi ${Math.floor(MAX_SOURCE_BYTES / 1024 / 1024)} MB`);
  }

  const originalName = sanitizeFileName(fileName);
  const originalMimeType = String(mimeType || 'application/octet-stream').toLowerCase();
  let storedBuffer = buffer;
  let storedName = originalName;
  let storedMimeType = originalMimeType;
  let compressionMethod = NATIVE_COMPRESSED_MIMES.has(originalMimeType) ? 'native' : 'none';

  if (buffer.length >= 1024 && isCompressibleText(originalMimeType, originalName)) {
    const compressed = await gzip(buffer, { level: 9 });
    if (compressed.length < buffer.length * 0.95) {
      storedBuffer = compressed;
      storedName = `${originalName}.gz`;
      storedMimeType = 'application/gzip';
      compressionMethod = 'gzip';
    }
  }

  return {
    originalName,
    originalMimeType,
    originalSize: buffer.length,
    storedName,
    storedMimeType,
    storedSize: storedBuffer.length,
    storedBuffer,
    compressionMethod,
  };
}

async function extractReadableText({
  buffer,
  storedMimeType,
  originalMimeType,
  originalName,
  compressionMethod,
}) {
  try {
    const sourceBuffer = compressionMethod === 'gzip' ? await gunzip(buffer) : buffer;
    if (!Buffer.isBuffer(sourceBuffer) || sourceBuffer.length > MAX_SOURCE_BYTES) {
      return result('', 'failed', 'File terlalu besar untuk dibaca AI');
    }

    const mimeType = String(originalMimeType || storedMimeType || '').toLowerCase();
    const extension = path.extname(String(originalName || '')).toLowerCase();
    let text = '';

    if (isCompressibleText(mimeType, originalName)) {
      text = sourceBuffer.toString('utf8').replace(/\u0000/g, '');
      if (mimeType === 'text/html' || ['.html', '.htm'].includes(extension)) {
        text = stripXml(text);
      }
    } else if (mimeType === MIME.pdf || extension === '.pdf') {
      const parsed = await pdfParse(sourceBuffer, { max: 200 });
      text = parsed.text || '';
    } else if (mimeType === MIME.xlsx || extension === '.xlsx') {
      text = await extractXlsx(sourceBuffer);
    } else if (
      mimeType === MIME.docx || mimeType === MIME.pptx ||
      mimeType === MIME.odt || mimeType === MIME.ods || mimeType === MIME.odp ||
      ['.docx', '.pptx', '.odt', '.ods', '.odp'].includes(extension)
    ) {
      text = await extractZippedXml(sourceBuffer, { mimeType, extension });
    } else if (mimeType.startsWith('image/')) {
      return result('', 'no_text', 'OCR gambar belum diaktifkan');
    } else {
      return result('', 'unsupported', 'Format dapat disimpan tetapi belum dapat dibaca AI');
    }

    const normalized = normalizeExtractedText(text);
    return normalized
      ? result(normalized, 'ready', null)
      : result('', 'no_text', 'Tidak ditemukan teks yang dapat dibaca');
  } catch (error) {
    return result('', 'failed', String(error.message || 'Ekstraksi gagal').slice(0, 500));
  }
}

async function extractXlsx(buffer) {
  const zip = await loadSafeZip(buffer);
  const sharedStrings = [];
  const sharedEntry = zip.file('xl/sharedStrings.xml');
  if (sharedEntry) {
    const xml = await sharedEntry.async('string');
    for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
      const text = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
        .map((item) => decodeEntities(stripXmlTagsOnly(item[1])))
        .join('');
      sharedStrings.push(text);
    }
  }

  const sheetNames = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort(naturalCompare)
    .slice(0, 25);
  const lines = [];
  let cellsRead = 0;
  let extractedChars = 0;

  const pushLine = (line) => {
    lines.push(line);
    extractedChars += line.length + 1;
  };

  for (const sheetName of sheetNames) {
    pushLine(`[Sheet: ${path.basename(sheetName, '.xml')}]`);
    const xml = await zip.file(sheetName).async('string');
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
      if (cellsRead >= 20000 || extractedChars >= MAX_EXTRACTED_CHARS) break;
      const values = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
        if (cellsRead >= 20000) break;
        cellsRead += 1;
        const attributes = cellMatch[1];
        const body = cellMatch[2];
        const type = attributes.match(/\bt="([^"]+)"/i)?.[1] || '';
        if (type === 'inlineStr') {
          values.push([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
            .map((item) => decodeEntities(stripXmlTagsOnly(item[1])))
            .join(''));
        } else {
          const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] || '';
          values.push(type === 's' ? (sharedStrings[Number(raw)] || '') : decodeEntities(raw));
        }
      }
      if (values.length) pushLine(values.join('\t'));
    }
    if (cellsRead >= 20000 || extractedChars >= MAX_EXTRACTED_CHARS) break;
  }
  return lines.join('\n');
}

async function extractZippedXml(buffer, { mimeType, extension }) {
  const zip = await loadSafeZip(buffer);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);

  let names = [];
  if (mimeType === MIME.docx || extension === '.docx') {
    names = entries.map((entry) => entry.name).filter((name) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(name));
  } else if (mimeType === MIME.pptx || extension === '.pptx') {
    names = entries.map((entry) => entry.name).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name));
    names.sort(naturalCompare);
  } else {
    names = entries.map((entry) => entry.name).filter((name) => /(^|\/)content\.xml$/i.test(name));
  }

  const parts = [];
  for (const name of names.slice(0, 250)) {
    const xml = await zip.file(name).async('string');
    parts.push(stripXml(xml));
    if (parts.join('\n').length >= MAX_EXTRACTED_CHARS) break;
  }
  return parts.join('\n');
}

async function generateArtifact({ format, title, content }) {
  const normalizedFormat = String(format || '').toLowerCase();
  const safeContent = String(content || '').slice(0, 200000);
  const artifactTitle = safeTitle(title);
  if (!safeContent.trim()) throw validationError('Isi dokumen kosong');

  if (normalizedFormat === 'pdf') return generatePdf(artifactTitle, safeContent);
  if (normalizedFormat === 'docx') return generateDocx(artifactTitle, safeContent);
  if (normalizedFormat === 'xlsx') return generateXlsx(artifactTitle, safeContent);
  if (['txt', 'md', 'csv'].includes(normalizedFormat)) {
    const mimeType = normalizedFormat === 'csv' ? 'text/csv' : normalizedFormat === 'md' ? 'text/markdown' : 'text/plain';
    return {
      buffer: Buffer.from(safeContent, 'utf8'),
      mimeType,
      fileName: `${sanitizeFileName(artifactTitle)}.${normalizedFormat}`,
      format: normalizedFormat,
    };
  }
  throw validationError('Format artifact tidak didukung');
}

async function generatePdf(title, content) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const size = [595.28, 841.89];
  const margin = 52;
  const bodySize = 10.5;
  const lineHeight = 15;
  let page = pdf.addPage(size);
  let y = size[1] - margin;

  const drawLine = (line, options = {}) => {
    const font = options.bold ? bold : regular;
    const fontSize = options.size || bodySize;
    if (y < margin + lineHeight) {
      page = pdf.addPage(size);
      y = size[1] - margin;
    }
    page.drawText(toPdfSafeText(line), {
      x: margin,
      y,
      size: fontSize,
      font,
      color: rgb(0.12, 0.12, 0.12),
    });
    y -= options.gap || lineHeight;
  };

  for (const line of wrapPdfLine(title, bold, 18, size[0] - margin * 2)) {
    drawLine(line, { bold: true, size: 18, gap: 23 });
  }
  y -= 8;
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) { y -= 8; continue; }
    const heading = /^#{1,3}\s+/.test(trimmed);
    const clean = trimmed.replace(/^#{1,3}\s+/, '').replace(/^[-*]\s+/, '- ');
    const font = heading ? bold : regular;
    const fontSize = heading ? 13 : bodySize;
    for (const line of wrapPdfLine(clean, font, fontSize, size[0] - margin * 2)) {
      drawLine(line, { bold: heading, size: fontSize, gap: heading ? 18 : lineHeight });
    }
  }

  return {
    buffer: Buffer.from(await pdf.save({ useObjectStreams: true })),
    mimeType: MIME.pdf,
    fileName: `${sanitizeFileName(title)}.pdf`,
    format: 'pdf',
  };
}

async function generateDocx(title, content) {
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: '' }),
  ];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      children.push(new Paragraph({ text: '' }));
    } else if (/^#{1,3}\s+/.test(trimmed)) {
      children.push(new Paragraph({
        text: trimmed.replace(/^#{1,3}\s+/, ''),
        heading: HeadingLevel.HEADING_2,
      }));
    } else {
      children.push(new Paragraph({
        children: [new TextRun(trimmed)],
        bullet: /^[-*]\s+/.test(trimmed) ? { level: 0 } : undefined,
      }));
    }
  }

  const document = new Document({
    creator: 'Prakasa AI',
    title,
    sections: [{ children }],
  });
  return {
    buffer: await Packer.toBuffer(document),
    mimeType: MIME.docx,
    fileName: `${sanitizeFileName(title)}.docx`,
    format: 'docx',
  };
}

async function generateXlsx(title, content) {
  const zip = new JSZip();
  const table = parseMarkdownTable(content);
  const rows = table.length ? table : [['Konten'], ...content.split(/\r?\n/).filter(Boolean).map((line) => [line])];

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sanitizeSheetName(title))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
  const rowXml = rows.map((values, rowIndex) => {
    const cells = values.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${rowXml}</sheetData>
</worksheet>`);

  return {
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }),
    mimeType: MIME.xlsx,
    fileName: `${sanitizeFileName(title)}.xlsx`,
    format: 'xlsx',
  };
}

function parseMarkdownTable(content) {
  const lines = String(content || '').split(/\r?\n/).map((line) => line.trim());
  for (let index = 0; index < lines.length - 2; index += 1) {
    if (!lines[index].includes('|') || !/^\|?\s*:?-{3,}/.test(lines[index + 1])) continue;
    const rows = [splitMarkdownRow(lines[index])];
    for (let rowIndex = index + 2; rowIndex < lines.length && lines[rowIndex].includes('|'); rowIndex += 1) {
      rows.push(splitMarkdownRow(lines[rowIndex]));
    }
    return rows.filter((row) => row.some(Boolean));
  }
  return [];
}

function splitMarkdownRow(line) {
  return line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function wrapPdfLine(value, font, fontSize, maxWidth) {
  const words = toPdfSafeText(value).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function toPdfSafeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/•/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function stripXml(xml) {
  return decodeEntities(
    String(xml || '')
      .replace(/<w:tab\/?\s*>/gi, '\t')
      .replace(/<w:br\/?\s*>/gi, '\n')
      .replace(/<\/(w:p|a:p|text:p|table:table-row)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  );
}

function stripXmlTagsOnly(value) {
  return String(value || '').replace(/<[^>]+>/g, '');
}

async function loadSafeZip(buffer) {
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > MAX_ZIP_ENTRIES) throw new Error('Arsip memiliki terlalu banyak file');
  const declaredSize = entries.reduce(
    (sum, entry) => sum + Number(entry._data?.uncompressedSize || 0),
    0
  );
  if (declaredSize > MAX_ZIP_UNCOMPRESSED_BYTES) throw new Error('Ukuran hasil ekstraksi arsip terlalu besar');
  return zip;
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function normalizeExtractedText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, MAX_EXTRACTED_CHARS);
}

function sanitizeSheetName(value) {
  return safeTitle(value).replace(/[\\/?*\[\]:]/g, '').slice(0, 31) || 'Dokumen AI';
}

function columnName(index) {
  let value = index;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function result(text, status, error) {
  return { text: String(text || '').slice(0, MAX_EXTRACTED_CHARS), status, error };
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

module.exports = {
  MAX_EXTRACTED_CHARS,
  MIME,
  extractReadableText,
  generateArtifact,
  parseMarkdownTable,
  prepareUpload,
  sanitizeFileName,
};
