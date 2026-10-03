const JSZip = require('jszip');
const pool = require('../db/pool');
const drive = require('./googleDrive.service');
const googleDocs = require('./googleDocs.service');
const { logWith } = require('./activityLog.service');
const { insertWithNumber } = require('./nextNumber');
const { resolveFolder } = require('../controllers/folderMappingRules.controller');
const { decryptBuffer } = require('./signature.service');
const kit = require('./docxKit');
const { todayWib } = require('../utils/wibTime');
const { STANDARD_FIELDS, BUILTIN_TEMPLATES, BLANK_TEMPLATE_BLOCKS, fieldLabel } = require('../config/docTemplates');

// Template dokumen, kop & footer per divisi, and documents made from them
// (migration 115). Everything lives in the company Shared Drive:
//   Shared Drive / Template dokumen            the templates (Google Docs)
//   Shared Drive / Template dokumen / Kop & footer   one kop doc per division
//   the division's folder (folder_mapping_rules)     the documents made
// A document = the template exported to .docx, joined with the division's
// kop (exported too, so edits made in Google Docs count), imported as a new
// Google Doc in the division's folder, then its {{placeholders}} filled.
//
// Who: a division Head (template.manage) manages its division's templates and
// kop; company-wide ones need template.manage plus management_dashboard.view
// or workspace.cross_division.view (Management Office Head, Super Admin).
// Anyone with document.create makes documents for their own division.

class DocTemplateError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const has = (user, code) => (user?.permissions || []).includes(code);
const crossDivision = (user) => has(user, 'workspace.cross_division.view');
const companyWide = (user) => crossDivision(user) || has(user, 'management_dashboard.view');
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const longDate = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const isoTs = (v) => (v ? new Date(v).toISOString() : null);
const parseJson = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};

/** May this user manage templates/kop of this scope (department id or null = company-wide)? */
function canManageScope(user, departmentId) {
  if (!has(user, 'template.manage')) return false;
  if (departmentId == null) return companyWide(user);
  return crossDivision(user) || Number(departmentId) === Number(user.departmentId);
}

function assertManage(user, departmentId) {
  if (!canManageScope(user, departmentId)) {
    throw new DocTemplateError('FORBIDDEN', departmentId == null
      ? 'Template dan kop untuk seluruh perusahaan dikelola Head Management Office atau Super Admin'
      : 'Anda hanya bisa mengelola template dan kop divisi Anda sendiri', 403);
  }
}

async function departmentOf(db, entityId, departmentId) {
  if (departmentId == null) return null;
  const [[row]] = await db.query('SELECT id, name, code FROM departments WHERE id = ? AND entity_id = ? AND deleted_at IS NULL LIMIT 1', [departmentId, entityId]);
  if (!row) throw new DocTemplateError('DEPARTMENT_INVALID', 'Divisi tidak ditemukan', 400, { field: 'departmentId' });
  return { id: Number(row.id), name: row.name, code: row.code };
}

async function peopleCultureId(db, entityId) {
  const [[row]] = await db.query("SELECT id FROM departments WHERE entity_id = ? AND code = 'people_culture' AND deleted_at IS NULL LIMIT 1", [entityId]);
  if (!row) throw new DocTemplateError('NO_PC_DIVISION', 'Divisi People & Culture belum ada', 409);
  return Number(row.id);
}

async function entityName(db, entityId) {
  const [[row]] = await db.query('SELECT name FROM entities WHERE id = ? LIMIT 1', [entityId]);
  return row?.name || '';
}

// ------------------------------------------------------------ Drive folders
function sharedDriveId() {
  const id = String(process.env.GOOGLE_SHARED_DRIVE_ID || '').trim();
  if (!id) throw new DocTemplateError('GOOGLE_DRIVE_NOT_CONFIGURED', 'Google Shared Drive belum dikonfigurasi (GOOGLE_SHARED_DRIVE_ID).', 503);
  return id;
}

async function templatesFolder(ctx) {
  const root = sharedDriveId();
  const folder = await drive.ensureFolder({ name: 'Template dokumen', parentId: root, sharedDriveId: root }, ctx);
  return folder.id;
}

async function kopFolder(ctx) {
  const root = sharedDriveId();
  const parent = await templatesFolder(ctx);
  const folder = await drive.ensureFolder({ name: 'Kop & footer', parentId: parent, sharedDriveId: root }, ctx);
  return folder.id;
}

/** The division's folder for a document type (folder rules), else "Dokumen <Divisi>" at the Shared Drive root. */
async function divisionFolder(entityId, department, documentType, ctx) {
  const ruled = await resolveFolder({ entityId, departmentId: department.id, documentType: documentType || '*' });
  if (ruled) return ruled;
  const root = sharedDriveId();
  const folder = await drive.ensureFolder({ name: `Dokumen ${department.name}`, parentId: root, sharedDriveId: root }, ctx);
  return folder.id;
}

// ------------------------------------------------------------ kop & footer
const KOP_COLUMNS = `k.id, k.entity_id, k.department_id, k.layout, k.company_name, k.header_lines, k.footer_text,
  k.show_page_number, k.accent_color, k.logo_mime, (k.logo_blob IS NOT NULL) AS has_logo, k.drive_file_id,
  k.web_view_link, k.version, k.updated_at, u.name AS updated_by_name`;

const kopShape = (r) => ({
  id: Number(r.id),
  departmentId: r.department_id != null ? Number(r.department_id) : null,
  layout: r.layout,
  companyName: r.company_name,
  headerLines: r.header_lines || '',
  footerText: r.footer_text || '',
  showPageNumber: Number(r.show_page_number) === 1,
  accentColor: r.accent_color,
  hasLogo: Number(r.has_logo) === 1,
  driveFileId: r.drive_file_id || null,
  webViewLink: r.web_view_link || null,
  version: Number(r.version),
  updatedAt: isoTs(r.updated_at),
  updatedByName: r.updated_by_name || null,
});

/** Every division with its kop (or none), the company-wide kop first, and the company name. */
async function listKops(db, user) {
  const entityId = user.entityId;
  const [rows] = await db.query(
    `SELECT ${KOP_COLUMNS} FROM doc_kops k LEFT JOIN users u ON u.id = k.updated_by WHERE k.entity_id = ?`,
    [entityId],
  );
  const [departments] = await db.query('SELECT id, name FROM departments WHERE entity_id = ? AND deleted_at IS NULL ORDER BY name', [entityId]);
  const byDept = new Map(rows.map((r) => [r.department_id == null ? 0 : Number(r.department_id), kopShape(r)]));
  const [letterheads] = await db.query('SELECT department_id FROM letterhead_assets WHERE entity_id = ?', [entityId]);
  const withLetterhead = new Set(letterheads.map((r) => Number(r.department_id)));
  const scopes = [
    { departmentId: null, departmentName: 'Seluruh perusahaan', kop: byDept.get(0) || null, canManage: canManageScope(user, null), hasLetterheadImage: false },
    ...departments.map((d) => ({
      departmentId: Number(d.id),
      departmentName: d.name,
      kop: byDept.get(Number(d.id)) || null,
      canManage: canManageScope(user, d.id),
      hasLetterheadImage: withLetterhead.has(Number(d.id)),
    })),
  ];
  return { companyName: await entityName(db, entityId), scopes };
}

async function kopRow(db, entityId, departmentId) {
  const [[row]] = await db.query(
    `SELECT k.* FROM doc_kops k WHERE k.entity_id = ? AND k.department_key = ? LIMIT 1`,
    [entityId, departmentId == null ? 0 : Number(departmentId)],
  );
  return row || null;
}

/** The kop a division's documents use: its own, else the company-wide one, else none. */
async function kopFor(db, entityId, departmentId) {
  return (await kopRow(db, entityId, departmentId)) || (departmentId != null ? kopRow(db, entityId, null) : null);
}

async function letterheadImage(db, departmentId) {
  if (departmentId == null) return null;
  const [[row]] = await db.query('SELECT encrypted_blob, iv, auth_tag FROM letterhead_assets WHERE department_id = ? LIMIT 1', [departmentId]);
  if (!row) return null;
  return decryptBuffer({ encrypted: row.encrypted_blob, iv: row.iv, authTag: row.auth_tag });
}

const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg' };
const MAX_LOGO_BYTES = 1024 * 1024;

/**
 * Save a scope's kop settings and (re)build its Google Doc. body: { layout,
 * companyName, headerLines, footerText, showPageNumber, accentColor,
 * logoBase64 (string = new logo, null = remove, undefined = keep), version? }
 */
async function saveKop(user, departmentId, body) {
  const entityId = user.entityId;
  assertManage(user, departmentId);
  const department = await departmentOf(pool, entityId, departmentId);
  const current = await kopRow(pool, entityId, departmentId);
  if (current && body.version !== undefined && Number(body.version) !== Number(current.version)) {
    throw new DocTemplateError('VERSION_CONFLICT', 'Kop ini sudah diubah orang lain. Muat ulang, lalu ulangi perubahan Anda.', 409);
  }
  let logo = current?.logo_blob || null;
  let logoMime = current?.logo_mime || null;
  if (body.logoBase64 === null) { logo = null; logoMime = null; }
  if (typeof body.logoBase64 === 'string') {
    const buffer = Buffer.from(body.logoBase64.replace(/^data:[^,]+,/, ''), 'base64');
    const size = kit.imageSize(buffer);
    if (!size || buffer.length > MAX_LOGO_BYTES) {
      throw new DocTemplateError('LOGO_INVALID', 'Logo harus gambar PNG atau JPG, paling besar 1 MB', 400, { field: 'logo' });
    }
    logo = buffer;
    logoMime = size.type === 'png' ? 'image/png' : 'image/jpeg';
  }
  if (body.layout === 'letterhead_image' && !(await letterheadImage(pool, departmentId))) {
    throw new DocTemplateError('NO_LETTERHEAD', 'Divisi ini belum punya gambar kop surat. Pilih tata letak lain atau unggah gambar kop di Cap surat.', 400, { field: 'layout' });
  }

  const settings = {
    layout: body.layout,
    companyName: String(body.companyName || '').trim(),
    headerLines: String(body.headerLines || '').trim() || null,
    footerText: String(body.footerText || '').trim() || null,
    showPageNumber: Boolean(body.showPageNumber),
    accentColor: body.accentColor || '#1A73E8',
  };
  const scopeLabel = department ? department.name : 'Seluruh perusahaan';
  const ctx = { entityId, userId: user.sub, subjectType: 'doc_kop' };
  const docx = await kit.buildKopDocx({
    ...settings, logo, letterhead: settings.layout === 'letterhead_image' ? await letterheadImage(pool, departmentId) : null, scopeLabel,
  });

  // Same Google Doc (and link) when it exists; a new one otherwise.
  let file = null;
  if (current?.drive_file_id) {
    try {
      file = await drive.replaceDocContent({ fileId: current.drive_file_id, buffer: docx }, ctx);
      file = { ...file, webViewLink: file.webViewLink || current.web_view_link };
    } catch { file = null; }
  }
  if (!file) file = await drive.importDocx({ name: `Kop & footer — ${scopeLabel}`, buffer: docx, parentId: await kopFolder(ctx) }, ctx);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let id;
    if (current) {
      await conn.query(
        `UPDATE doc_kops SET layout = ?, company_name = ?, header_lines = ?, footer_text = ?, show_page_number = ?, accent_color = ?,
                logo_blob = ?, logo_mime = ?, drive_file_id = ?, web_view_link = ?, updated_by = ?, version = version + 1
          WHERE id = ?`,
        [settings.layout, settings.companyName, settings.headerLines, settings.footerText, settings.showPageNumber ? 1 : 0, settings.accentColor,
          logo, logoMime, file.id, file.webViewLink || null, user.sub, current.id],
      );
      id = Number(current.id);
    } else {
      const [ins] = await conn.query(
        `INSERT INTO doc_kops (entity_id, department_id, layout, company_name, header_lines, footer_text, show_page_number, accent_color,
                               logo_blob, logo_mime, drive_file_id, web_view_link, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [entityId, departmentId, settings.layout, settings.companyName, settings.headerLines, settings.footerText, settings.showPageNumber ? 1 : 0,
          settings.accentColor, logo, logoMime, file.id, file.webViewLink || null, user.sub, user.sub],
      );
      id = Number(ins.insertId);
    }
    await logWith(conn, {
      entityId, userId: user.sub, action: current ? 'doc_kop.update' : 'doc_kop.create', subjectType: 'doc_kop', subjectId: id,
      metadata: { departmentId, ...settings, logo: logo ? 'ada' : 'tidak ada', driveFileId: file.id },
    });
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  const [[row]] = await pool.query(`SELECT ${KOP_COLUMNS} FROM doc_kops k LEFT JOIN users u ON u.id = k.updated_by WHERE k.entity_id = ? AND k.department_key = ?`, [entityId, departmentId == null ? 0 : departmentId]);
  return kopShape(row);
}

async function kopLogo(user, departmentId) {
  const row = await kopRow(pool, user.entityId, departmentId);
  if (!row?.logo_blob) return null;
  return { mimeType: row.logo_mime, base64: Buffer.from(row.logo_blob).toString('base64') };
}

// ------------------------------------------------------------ templates
const TEMPLATE_COLUMNS = `t.id, t.entity_id, t.department_id, d.name AS department_name, t.name, t.template_key, t.document_type,
  t.document_prefix, t.description, t.drive_template_file_id, t.web_view_link, t.placeholders_json, t.checked_at, t.is_active,
  t.updated_at`;

function templateShape(r, user) {
  const placeholders = parseJson(r.placeholders_json) || [];
  const builtin = BUILTIN_TEMPLATES.find((b) => b.key === r.template_key) || null;
  return {
    id: Number(r.id),
    departmentId: r.department_id != null ? Number(r.department_id) : null,
    departmentName: r.department_name || 'Seluruh perusahaan',
    name: r.name,
    templateKey: r.template_key || null,
    builtin: Boolean(builtin),
    subjectType: builtin?.subjectType || null,
    documentType: r.document_type,
    prefix: r.document_prefix,
    description: r.description || null,
    driveFileId: r.drive_template_file_id,
    webViewLink: r.web_view_link || null,
    placeholders: placeholders.map((key) => ({ key, label: fieldLabel(key), standard: STANDARD_FIELDS.includes(key) })),
    checkedAt: isoTs(r.checked_at),
    isActive: Number(r.is_active) === 1,
    updatedAt: isoTs(r.updated_at),
    canManage: user ? canManageScope(user, r.department_id) : false,
  };
}

const visibleTo = (user) => (crossDivision(user)
  ? { sql: '', args: [] }
  : { sql: ' AND (t.department_id IS NULL OR t.department_id = ?)', args: [user.departmentId ?? 0] });

async function listTemplates(db, user) {
  const v = visibleTo(user);
  const [rows] = await db.query(
    `SELECT ${TEMPLATE_COLUMNS} FROM document_templates t LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.entity_id = ? AND t.deleted_at IS NULL AND t.drive_template_file_id IS NOT NULL${v.sql}
      ORDER BY t.template_key IS NULL, t.name ASC, t.id ASC`,
    [user.entityId, ...v.args],
  );
  const templates = rows.map((r) => templateShape(r, user));
  const prepared = new Set(templates.map((t) => t.templateKey).filter(Boolean));
  const missingBuiltins = BUILTIN_TEMPLATES.filter((b) => !prepared.has(b.key)).map((b) => ({ key: b.key, name: b.name, description: b.description }));
  return { templates, missingBuiltins };
}

async function getTemplate(db, user, id) {
  const v = visibleTo(user);
  const [[row]] = await db.query(
    `SELECT ${TEMPLATE_COLUMNS} FROM document_templates t LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.id = ? AND t.entity_id = ? AND t.deleted_at IS NULL${v.sql} LIMIT 1`,
    [id, user.entityId, ...v.args],
  );
  if (!row) throw new DocTemplateError('NOT_FOUND', 'Template tidak ditemukan', 404);
  return row;
}

async function templateByKey(db, entityId, key) {
  const [[row]] = await db.query(
    `SELECT ${TEMPLATE_COLUMNS} FROM document_templates t LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.entity_id = ? AND t.template_key = ? AND t.deleted_at IS NULL LIMIT 1`,
    [entityId, key],
  );
  return row || null;
}

/** Placeholder keys of a .docx (body, headers, footers), runs joined. */
async function placeholdersOfDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const parts = Object.keys(zip.files).filter((f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f));
  let text = '';
  for (const part of parts) text += (await zip.file(part).async('string')).replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
  return kit.placeholdersIn(text);
}

/** Built-in BAST templates (People & Culture) not yet in the Shared Drive are made now. */
async function prepareBuiltins(user) {
  const entityId = user.entityId;
  const pcId = await peopleCultureId(pool, entityId);
  assertManage(user, pcId);
  const ctx = { entityId, userId: user.sub, subjectType: 'document_template' };
  const folderId = await templatesFolder(ctx);
  const made = [];
  for (const b of BUILTIN_TEMPLATES) {
    if (await templateByKey(pool, entityId, b.key)) continue;
    const docx = await kit.buildTemplateDocx({ title: b.name, blocks: b.blocks });
    const placeholders = await placeholdersOfDocx(docx);
    const file = await drive.importDocx({ name: `Template — ${b.name}`, buffer: docx, parentId: folderId }, ctx);
    const [ins] = await pool.query(
      `INSERT INTO document_templates (entity_id, department_id, name, template_key, document_type, document_prefix, description,
                                       drive_template_file_id, drive_template_mime, web_view_link, placeholders_json, checked_at, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'application/vnd.google-apps.document', ?, ?, UTC_TIMESTAMP(), 1, ?)`,
      [entityId, pcId, b.name, b.key, b.documentType, b.prefix, b.description, file.id, file.webViewLink || null, JSON.stringify(placeholders), user.sub],
    );
    await logWith(pool, {
      entityId, userId: user.sub, action: 'document_template.create', subjectType: 'document_template', subjectId: Number(ins.insertId),
      metadata: { templateKey: b.key, name: b.name, builtin: true, driveFileId: file.id },
    });
    made.push(b.key);
  }
  return { made };
}

const DRIVE_ID_RE = /^[A-Za-z0-9_-]{20,128}$/;
/** A Google Docs link or a bare file id → the file id, or null. */
function driveFileIdOf(value) {
  const s = String(value || '').trim();
  const m = /\/d\/([A-Za-z0-9_-]{20,128})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{20,128})/.exec(s);
  if (m) return m[1];
  return DRIVE_ID_RE.test(s) ? s : null;
}

/**
 * A new custom template: a blank guide (source 'blank') or a COPY of an
 * existing Google Doc (source 'copy', sourceUrl) — the original stays untouched.
 */
async function createTemplate(user, body) {
  const entityId = user.entityId;
  const departmentId = body.departmentId ?? null;
  assertManage(user, departmentId);
  await departmentOf(pool, entityId, departmentId);
  const ctx = { entityId, userId: user.sub, subjectType: 'document_template' };
  const folderId = await templatesFolder(ctx);
  let file;
  if (body.source === 'copy') {
    const sourceId = driveFileIdOf(body.sourceUrl);
    if (!sourceId) throw new DocTemplateError('SOURCE_INVALID', 'Tempel tautan Google Docs yang valid', 400, { field: 'sourceUrl' });
    let meta;
    try { meta = await drive.getFileMeta(sourceId, ctx); } catch {
      throw new DocTemplateError('SOURCE_UNREACHABLE', 'Dokumen tidak bisa dibuka aplikasi. Pastikan dokumen ada di Shared Drive perusahaan atau dibagikan ke akun layanan aplikasi.', 400, { field: 'sourceUrl' });
    }
    if (meta?.mimeType && meta.mimeType !== 'application/vnd.google-apps.document') {
      throw new DocTemplateError('SOURCE_NOT_DOC', 'Template harus berupa Google Docs', 400, { field: 'sourceUrl' });
    }
    file = await drive.copyFile({ fileId: sourceId, name: `Template — ${body.name}`, parentId: folderId }, ctx);
  } else {
    const docx = await kit.buildTemplateDocx({ title: body.name, blocks: BLANK_TEMPLATE_BLOCKS });
    file = await drive.importDocx({ name: `Template — ${body.name}`, buffer: docx, parentId: folderId }, ctx);
  }
  const placeholders = await placeholdersOfDocx(await drive.exportDocx(file.id, ctx));
  const [ins] = await pool.query(
    `INSERT INTO document_templates (entity_id, department_id, name, document_type, document_prefix, description,
                                     drive_template_file_id, drive_template_mime, web_view_link, placeholders_json, checked_at, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'application/vnd.google-apps.document', ?, ?, UTC_TIMESTAMP(), 1, ?)`,
    [entityId, departmentId, body.name, body.documentType || 'umum', body.prefix || 'DOK', body.description || null, file.id, file.webViewLink || null, JSON.stringify(placeholders), user.sub],
  );
  const id = Number(ins.insertId);
  await logWith(pool, {
    entityId, userId: user.sub, action: 'document_template.create', subjectType: 'document_template', subjectId: id,
    metadata: { name: body.name, departmentId, source: body.source, driveFileId: file.id },
  });
  return templateShape(await getTemplate(pool, user, id), user);
}

async function updateTemplate(user, id, body) {
  const row = await getTemplate(pool, user, id);
  assertManage(user, row.department_id);
  const sets = [];
  const args = [];
  const changed = {};
  for (const [field, col] of [['name', 'name'], ['prefix', 'document_prefix'], ['description', 'description'], ['isActive', 'is_active']]) {
    if (body[field] === undefined) continue;
    if (field === 'name' && row.template_key) continue; // built-ins keep their name
    sets.push(`${col} = ?`);
    args.push(field === 'isActive' ? (body.isActive ? 1 : 0) : body[field]);
    changed[field] = body[field];
  }
  if (sets.length) {
    await pool.query(`UPDATE document_templates SET ${sets.join(', ')} WHERE id = ? AND entity_id = ?`, [...args, id, user.entityId]);
    await logWith(pool, { entityId: user.entityId, userId: user.sub, action: 'document_template.update', subjectType: 'document_template', subjectId: Number(id), metadata: changed });
  }
  return templateShape(await getTemplate(pool, user, id), user);
}

/** Read the template again from Google Docs and store the placeholders it has now. */
async function checkTemplate(user, id) {
  const row = await getTemplate(pool, user, id);
  const placeholders = await placeholdersOfDocx(await drive.exportDocx(row.drive_template_file_id, { entityId: user.entityId, userId: user.sub, subjectType: 'document_template', subjectId: Number(id) }));
  await pool.query('UPDATE document_templates SET placeholders_json = ?, checked_at = UTC_TIMESTAMP() WHERE id = ?', [JSON.stringify(placeholders), id]);
  return templateShape(await getTemplate(pool, user, id), user);
}

// ------------------------------------------------------------ making a document
const SECRET_KEY_RE = /(password|sandi|pin|puk|iccid|token|secret)/i;

/**
 * Make a document from a template for a division. values: { key: text } for
 * the template's own placeholders; the standard ones are filled here.
 * opts: { subjectType, subjectId, title, conn } — `conn` (a transaction) lets
 * a caller link the document to its record in the same commit.
 */
async function generate(user, { templateId, templateRow = null, departmentId = null, values = {}, title = null, subjectType = null, subjectId = null }) {
  const entityId = user.entityId;
  const row = templateRow || await getTemplate(pool, user, templateId);
  if (Number(row.is_active) !== 1) throw new DocTemplateError('TEMPLATE_INACTIVE', 'Template ini sedang tidak dipakai', 409);
  // The document belongs to the template's division; a company-wide template
  // makes it for the user's own division (or the one chosen, with cross-division access).
  let deptId = row.department_id != null ? Number(row.department_id) : (departmentId ?? user.departmentId);
  if (row.department_id == null && departmentId != null && Number(departmentId) !== Number(user.departmentId) && !crossDivision(user)) {
    throw new DocTemplateError('FORBIDDEN', 'Anda hanya bisa membuat dokumen untuk divisi Anda sendiri', 403);
  }
  if (deptId == null) throw new DocTemplateError('DEPARTMENT_REQUIRED', 'Pilih divisi tujuan dokumen', 400, { field: 'departmentId' });
  deptId = Number(deptId);
  const department = await departmentOf(pool, entityId, deptId);
  const ctx = { entityId, userId: user.sub, subjectType: subjectType || 'generated_document', subjectId: subjectId || null };

  const folderId = await divisionFolder(entityId, department, row.document_type, ctx);
  const kop = await kopFor(pool, entityId, deptId);
  const [[me]] = await pool.query('SELECT name FROM users WHERE id = ?', [user.sub]);
  const company = await entityName(pool, entityId);
  const today = todayWib();
  const cleanValues = Object.fromEntries(Object.entries(values || {})
    .filter(([k]) => /^[a-z][a-z0-9_]{0,59}$/.test(k) && !STANDARD_FIELDS.includes(k))
    .map(([k, v]) => [k, String(v ?? '').slice(0, 2000)]));

  const conn = await pool.getConnection();
  let release = async () => {};
  try {
    await conn.beginTransaction();
    const prefix = String(row.document_prefix || 'DOK').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'DOK';
    const docTitle = String(title || row.name).slice(0, 150);
    let file;
    const numbered = await insertWithNumber(conn, { table: 'generated_documents', column: 'doc_number', prefix, entityId }, async (number) => {
      const templateDocx = await drive.exportDocx(row.drive_template_file_id, ctx);
      const docx = kop?.drive_file_id ? await kit.mergeKop(templateDocx, await drive.exportDocx(kop.drive_file_id, ctx)) : templateDocx;
      file = await drive.importDocx({ name: `${docTitle} — ${number}`, buffer: docx, parentId: folderId }, ctx);
      const filled = {
        ...cleanValues,
        nomor_dokumen: number,
        tanggal: longDate(today),
        perusahaan: company,
        divisi: department.name,
        dibuat_oleh: me?.name || '',
      };
      await googleDocs.replacePlaceholders(file.id, filled, ctx);
      const stored = Object.fromEntries(Object.entries(cleanValues).filter(([k]) => !SECRET_KEY_RE.test(k)));
      const [ins] = await conn.query(
        `INSERT INTO generated_documents (entity_id, department_id, template_id, template_key, doc_number, title, drive_file_id, web_view_link,
                                          folder_id, subject_type, subject_id, field_values, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [entityId, deptId, row.id, row.template_key || null, number, docTitle, file.id, file.webViewLink || null, folderId,
          subjectType, subjectId, JSON.stringify(stored), user.sub],
      );
      return Number(ins.insertId);
    });
    release = numbered.release;
    await logWith(conn, {
      entityId, userId: user.sub, action: 'document.generate', subjectType: 'generated_document', subjectId: numbered.result,
      metadata: { number: numbered.number, templateId: Number(row.id), templateKey: row.template_key || null, departmentId: deptId, subjectType, subjectId, driveFileId: file.id, kop: Boolean(kop?.drive_file_id) },
    });
    await conn.commit();
    return {
      id: numbered.result,
      number: numbered.number,
      title: docTitle,
      driveFileId: file.id,
      webViewLink: file.webViewLink || null,
      departmentId: deptId,
      departmentName: department.name,
      withKop: Boolean(kop?.drive_file_id),
    };
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw e;
  } finally {
    await release();
    conn.release();
  }
}

async function listGenerated(db, user, { subjectType = null, subjectId = null, subjectIds = null, limit = 100 } = {}) {
  const where = ['g.entity_id = ?'];
  const args = [user.entityId];
  if (!crossDivision(user)) { where.push('g.department_id = ?'); args.push(user.departmentId ?? 0); }
  if (subjectType) { where.push('g.subject_type = ?'); args.push(subjectType); }
  if (subjectId) { where.push('g.subject_id = ?'); args.push(subjectId); }
  if (Array.isArray(subjectIds) && subjectIds.length) { where.push('g.subject_id IN (?)'); args.push(subjectIds.slice(0, 200)); }
  const [rows] = await db.query(
    `SELECT g.id, g.doc_number, g.title, g.web_view_link, g.drive_file_id, g.template_key, g.subject_type, g.subject_id,
            g.department_id, d.name AS department_name, t.name AS template_name, u.name AS created_by_name, g.created_at
       FROM generated_documents g
       LEFT JOIN departments d ON d.id = g.department_id
       LEFT JOIN document_templates t ON t.id = g.template_id
       LEFT JOIN users u ON u.id = g.created_by
      WHERE ${where.join(' AND ')}
      ORDER BY g.id DESC LIMIT ${Math.min(Number(limit) || 100, 500)}`,
    args,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    number: r.doc_number,
    title: r.title,
    webViewLink: r.web_view_link || null,
    driveFileId: r.drive_file_id,
    templateKey: r.template_key || null,
    templateName: r.template_name || null,
    subjectType: r.subject_type || null,
    subjectId: r.subject_id != null ? Number(r.subject_id) : null,
    departmentId: Number(r.department_id),
    departmentName: r.department_name || null,
    createdByName: r.created_by_name || null,
    createdAt: isoTs(r.created_at),
  }));
}

module.exports = {
  DocTemplateError, canManageScope, listKops, saveKop, kopLogo, kopFor, listTemplates, getTemplate, templateByKey, templateShape,
  prepareBuiltins, createTemplate, updateTemplate, checkTemplate, generate, listGenerated, placeholdersOfDocx, driveFileIdOf, longDate,
};
