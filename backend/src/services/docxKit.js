const JSZip = require('jszip');
const {
  AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, Packer, PageNumber, Paragraph, Table, TableCell,
  TableRow, TextRun, VerticalAlign, WidthType,
} = require('docx');

// Word (.docx) building blocks for documents made from templates (migration
// 115). Google Drive imports a .docx as a Google Doc, so the app builds:
//   - a division's kop (header) and footer: buildKopDocx;
//   - the built-in templates' bodies: buildTemplateDocx;
// and joins a template (exported from Google Docs) with a division's kop
// (also exported, so edits made in Google Docs are kept): mergeKop. Placeholders
// are {{key}}; the Docs API fills them in after the import.

const PLACEHOLDER_RE = /\{\{\s*([a-z][a-z0-9_]{0,59})\s*\}\}/gi;

/** Unique placeholder keys in a text, in order of first appearance (lower case). */
function placeholdersIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(PLACEHOLDER_RE)) {
    const key = m[1].toLowerCase();
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

// ------------------------------------------------------------ images
/** Width/height of a PNG or JPEG, or null. */
function imageSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) === 0x89504e47) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), type: 'png' };
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buffer.length) {
      if (buffer[i] !== 0xff) { i += 1; continue; }
      const marker = buffer[i + 1];
      const length = buffer.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7), type: 'jpg' };
      }
      i += 2 + length;
    }
  }
  return null;
}

function fit(size, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / size.width, maxHeight / size.height, 1);
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

function imageRun(buffer, maxWidth, maxHeight) {
  const size = imageSize(buffer);
  if (!size) return null;
  return new ImageRun({ type: size.type, data: buffer, transformation: fit(size, maxWidth, maxHeight) });
}

// ------------------------------------------------------------ kop & footer
const GREY = '5F6368';
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER };
const hex = (color) => String(color || '#1A73E8').replace('#', '').toUpperCase();
const linesOf = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6);

function textBlock({ companyName, headerLines, accentColor, alignment }) {
  return [
    new Paragraph({ alignment, spacing: { after: 20 }, children: [new TextRun({ text: companyName, bold: true, size: 28, color: hex(accentColor), font: 'Arial' })] }),
    ...linesOf(headerLines).map((line) => new Paragraph({ alignment, spacing: { after: 0 }, children: [new TextRun({ text: line, size: 17, color: GREY, font: 'Arial' })] })),
  ];
}

// The line under the kop, in the accent colour.
const rule = (accentColor) => new Paragraph({
  spacing: { before: 60, after: 0 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: hex(accentColor), space: 1 } },
  children: [],
});

/**
 * kop: { layout: 'logo_left'|'centered'|'letterhead_image', companyName, headerLines,
 *        footerText, showPageNumber, accentColor, logo: Buffer|null, letterhead: Buffer|null, scopeLabel }
 */
function kopHeaderChildren(kop) {
  if (kop.layout === 'letterhead_image' && kop.letterhead) {
    const image = imageRun(kop.letterhead, 620, 140);
    if (image) return [new Paragraph({ alignment: AlignmentType.CENTER, children: [image] })];
  }
  const logo = kop.logo ? imageRun(kop.logo, 150, 64) : null;
  if (kop.layout === 'centered' || !logo) {
    return [
      ...(logo ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [logo] })] : []),
      ...textBlock({ ...kop, alignment: AlignmentType.CENTER }),
      rule(kop.accentColor),
    ];
  }
  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: NO_BORDERS,
      rows: [new TableRow({
        children: [
          new TableCell({ width: { size: 22, type: WidthType.PERCENTAGE }, verticalAlign: VerticalAlign.CENTER, borders: NO_BORDERS, children: [new Paragraph({ children: [logo] })] }),
          new TableCell({ width: { size: 78, type: WidthType.PERCENTAGE }, verticalAlign: VerticalAlign.CENTER, borders: NO_BORDERS, children: textBlock({ ...kop, alignment: AlignmentType.RIGHT }) }),
        ],
      })],
    }),
    rule(kop.accentColor),
  ];
}

function kopFooterChildren(kop) {
  const out = linesOf(kop.footerText).map((line) => new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: line, size: 16, color: GREY, font: 'Arial' })],
  }));
  if (kop.showPageNumber) {
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 40 },
      children: [new TextRun({ children: ['Halaman ', PageNumber.CURRENT, ' dari ', PageNumber.TOTAL_PAGES], size: 16, color: GREY, font: 'Arial' })],
    }));
  }
  return out.length ? out : [new Paragraph({ children: [] })];
}

async function buildKopDocx(kop) {
  const doc = new Document({
    creator: 'Prakasa Workspace',
    title: `Kop & footer — ${kop.scopeLabel || kop.companyName}`,
    sections: [{
      headers: { default: new Header({ children: kopHeaderChildren(kop) }) },
      footers: { default: new Footer({ children: kopFooterChildren(kop) }) },
      children: [
        new Paragraph({ children: [new TextRun({ text: `Kop & footer dokumen — ${kop.scopeLabel || kop.companyName}`, bold: true, size: 28 })] }),
        new Paragraph({ children: [new TextRun({ text: 'Header (kop) dan footer dokumen ini dipakai untuk setiap dokumen yang dibuat dari template di Prakasa Workspace. Isi bagian ini tidak ikut ke dokumen.', size: 22, color: GREY })] }),
        new Paragraph({ children: [new TextRun({ text: 'Mengubah kop di sini langsung (Google Docs) juga berlaku, tetapi akan tertimpa bila pengaturan kop disimpan ulang dari aplikasi.', size: 22, color: GREY })] }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

// ------------------------------------------------------------ template bodies
// A small block language for the built-in templates:
//   { title } { subtitle } { text, bold? } { fields: [[label, value], …], bordered? } { signatures: [[role, name, position], …] } { gap }
function templateChildren(blocks) {
  const out = [];
  const run = (text, extra = {}) => new TextRun({ text, size: 22, font: 'Arial', ...extra });
  for (const b of blocks) {
    if (b.title) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 }, children: [run(b.title, { bold: true, size: 28 })] }));
    else if (b.subtitle) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [run(b.subtitle)] }));
    else if (b.text !== undefined) out.push(new Paragraph({ alignment: b.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT, spacing: { after: 120 }, children: [run(b.text, { bold: Boolean(b.bold) })] }));
    else if (b.gap) out.push(new Paragraph({ children: [] }));
    else if (b.fields) {
      const border = b.bordered ? { style: BorderStyle.SINGLE, size: 4, color: 'BDC1C6' } : NO_BORDER;
      const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders,
        rows: b.fields.map(([label, value]) => new TableRow({
          children: [
            new TableCell({ width: { size: 32, type: WidthType.PERCENTAGE }, borders, children: [new Paragraph({ children: [run(label)] })] }),
            new TableCell({ width: { size: 68, type: WidthType.PERCENTAGE }, borders, children: [new Paragraph({ children: [run(b.bordered ? value : `: ${value}`)] })] }),
          ],
        })),
      }));
      out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    } else if (b.signatures) {
      const cols = b.signatures.length;
      const cell = (children) => new TableCell({ width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE }, borders: NO_BORDERS, children });
      const centered = (text, extra) => new Paragraph({ alignment: AlignmentType.CENTER, children: [run(text, extra)] });
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: NO_BORDERS,
        rows: [
          new TableRow({ children: b.signatures.map(([role]) => cell([centered(role)])) }),
          new TableRow({ children: b.signatures.map(() => cell([new Paragraph({ children: [] }), new Paragraph({ children: [] }), new Paragraph({ children: [] })])) }),
          new TableRow({ children: b.signatures.map(([, name]) => cell([centered(`( ${name} )`, { bold: true })])) }),
          new TableRow({ children: b.signatures.map(([, , position]) => cell([centered(position || '', { color: GREY, size: 20 })])) }),
        ],
      }));
    }
  }
  return out;
}

async function buildTemplateDocx({ title, blocks }) {
  const doc = new Document({ creator: 'Prakasa Workspace', title, sections: [{ children: templateChildren(blocks) }] });
  return Packer.toBuffer(doc);
}

// ------------------------------------------------------------ merge kop into a template
const REL_TYPE = {
  header: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
  footer: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
};
const CONTENT_TYPE = {
  header: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  footer: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
};
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', emf: 'image/x-emf', wmf: 'image/x-wmf' };

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};

function parseRels(xml) {
  return [...String(xml).matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => ({
    raw: m[0], id: attr(m[0], 'Id'), type: attr(m[0], 'Type'), target: attr(m[0], 'Target'), mode: attr(m[0], 'TargetMode'),
  }));
}

// The default header/footer relationship ids of the LAST section of a document.xml.
function defaultRefs(documentXml) {
  const sects = [...String(documentXml).matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)];
  const last = sects.length ? sects[sects.length - 1][0] : '';
  const ref = (kind) => {
    const tags = [...last.matchAll(new RegExp(`<w:${kind}Reference\\b[^>]*/>`, 'g'))].map((m) => m[0]);
    const tag = tags.find((t) => attr(t, 'w:type') === 'default') || tags[0];
    return tag ? attr(tag, 'r:id') : null;
  };
  return { header: ref('header'), footer: ref('footer') };
}

const partPath = (target) => (target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`);
const relsPathOf = (part) => part.replace(/^(.*\/)?([^/]+)$/, (_, dir = '', file) => `${dir}_rels/${file}.rels`);

/**
 * The template's body with the kop's default header and footer: the
 * template's own header/footer references are replaced in every section and
 * a "different first page" is switched off, so every page shows the kop.
 * Returns a .docx Buffer. When the kop has no header or footer, that part of
 * the template stays as it is.
 */
async function mergeKop(templateBuffer, kopBuffer) {
  const tpl = await JSZip.loadAsync(templateBuffer);
  const kop = await JSZip.loadAsync(kopBuffer);
  const kopDoc = await kop.file('word/document.xml').async('string');
  const kopRels = parseRels(await kop.file('word/_rels/document.xml.rels').async('string'));
  const refs = defaultRefs(kopDoc);

  let docXml = await tpl.file('word/document.xml').async('string');
  let docRelsXml = await tpl.file('word/_rels/document.xml.rels').async('string');
  let typesXml = await tpl.file('[Content_Types].xml').async('string');
  const added = [];

  for (const kind of ['header', 'footer']) {
    const rel = kopRels.find((r) => r.id === refs[kind]);
    if (!rel) continue;
    const sourcePart = partPath(rel.target);
    const xmlFile = kop.file(sourcePart);
    if (!xmlFile) continue;
    const name = `kop${kind[0].toUpperCase()}${kind.slice(1)}`;
    const targetPart = `word/${name}.xml`;
    tpl.file(targetPart, await xmlFile.async('nodebuffer'));

    // The part's own relationships (images, links), with media copied under new names.
    const sourceRels = kop.file(relsPathOf(sourcePart));
    if (sourceRels) {
      let relsXml = await sourceRels.async('string');
      for (const r of parseRels(relsXml)) {
        if (r.mode === 'External' || !/\/image$/.test(r.type || '')) continue;
        const mediaFile = kop.file(partPath(r.target));
        if (!mediaFile) continue;
        const file = r.target.split('/').pop();
        const newTarget = `media/${name}_${file}`;
        tpl.file(`word/${newTarget}`, await mediaFile.async('nodebuffer'));
        relsXml = relsXml.replace(r.raw, r.raw.replace(`Target="${r.target}"`, `Target="${newTarget}"`));
        const ext = file.split('.').pop().toLowerCase();
        if (IMAGE_TYPES[ext] && !new RegExp(`<Default\\b[^>]*Extension="${ext}"`, 'i').test(typesXml)) {
          typesXml = typesXml.replace(/(<Types\b[^>]*>)/, `$1<Default Extension="${ext}" ContentType="${IMAGE_TYPES[ext]}"/>`);
        }
      }
      tpl.file(`word/_rels/${name}.xml.rels`, relsXml);
    }

    // Template relationships: drop its own headers/footers of this kind, add the kop's.
    const id = `rIdKop${kind[0].toUpperCase()}${kind.slice(1)}`;
    for (const r of parseRels(docRelsXml)) if (r.type === REL_TYPE[kind] || r.id === id) docRelsXml = docRelsXml.replace(r.raw, '');
    docRelsXml = docRelsXml.replace('</Relationships>', `<Relationship Id="${id}" Type="${REL_TYPE[kind]}" Target="${name}.xml"/></Relationships>`);
    if (!typesXml.includes(`PartName="/${targetPart}"`)) {
      typesXml = typesXml.replace('</Types>', `<Override PartName="/${targetPart}" ContentType="${CONTENT_TYPE[kind]}"/></Types>`);
    }
    added.push({ kind, id });
  }

  if (added.length) {
    docXml = docXml.replace(/<w:sectPr\b([^>]*)>([\s\S]*?)<\/w:sectPr>/g, (whole, attrs, inner) => {
      let body = inner;
      for (const { kind } of added) body = body.replace(new RegExp(`<w:${kind}Reference\\b[^>]*/>`, 'g'), '');
      body = body.replace(/<w:titlePg\b[^>]*\/>/g, '');
      const refsXml = added.map(({ kind, id }) => `<w:${kind}Reference w:type="default" r:id="${id}"/>`).join('');
      return `<w:sectPr${attrs}>${refsXml}${body}</w:sectPr>`;
    });
    // A section without sectPr at all (rare) gets one at the end of the body.
    if (!/<w:sectPr\b/.test(docXml)) {
      const refsXml = added.map(({ kind, id }) => `<w:${kind}Reference w:type="default" r:id="${id}"/>`).join('');
      docXml = docXml.replace('</w:body>', `<w:sectPr>${refsXml}</w:sectPr></w:body>`);
    }
    if (!/xmlns:r=/.test(docXml.slice(0, 2000))) {
      docXml = docXml.replace(/<w:document\b/, '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
    }
  }

  tpl.file('word/document.xml', docXml);
  tpl.file('word/_rels/document.xml.rels', docRelsXml);
  tpl.file('[Content_Types].xml', typesXml);
  return tpl.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = {
  PLACEHOLDER_RE, placeholdersIn, imageSize, buildKopDocx, buildTemplateDocx, mergeKop, parseRels, defaultRefs,
};
