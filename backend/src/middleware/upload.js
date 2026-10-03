const multer = require('multer');
const { uploadLimiter } = require('./rateLimits');

// Uploads (security review, Oct 2026): no HTML (a stored page could run script
// when opened) and no generic application/octet-stream, except for a short
// list of extensions whose content is checked below. Every binary type that
// has a signature (PDF, images, Office files) must actually start with it, so
// a renamed file cannot pass as a PDF or an image.
const ALLOWED = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/xml',
  'application/json',
  'application/xml',
  'application/csv',
  'application/rtf',
]);

const MAX_FILE_SIZE = Number(process.env.DOCUMENT_UPLOAD_MAX_BYTES || 25 * 1024 * 1024);
const ALLOWED_EXTENSION = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|png|jpe?g|webp|txt|csv|md|markdown|json|xml|rtf)$/i;

// ------------------------------------------------------------- content sniffing

const SIGNATURES = {
  pdf: (b) => b.subarray(0, 1024).includes('%PDF-'),
  png: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpeg: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  // docx/xlsx/pptx and odt/ods/odp are ZIP containers.
  zip: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  // Legacy doc/xls/ppt are OLE compound files.
  ole: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  // Plain text: no NUL byte in the first 8 KB.
  text: (b) => !b.subarray(0, 8192).includes(0),
};

const KIND_BY_MIME = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'zip',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'zip',
  'application/vnd.oasis.opendocument.text': 'zip',
  'application/vnd.oasis.opendocument.spreadsheet': 'zip',
  'application/vnd.oasis.opendocument.presentation': 'zip',
  'application/msword': 'ole',
  'application/vnd.ms-powerpoint': 'ole',
  // application/vnd.ms-excel is not listed: browsers send CSV files with it,
  // and some systems export ".xls" files that are really HTML/XML tables.
};

const KIND_BY_EXTENSION = {
  pdf: 'pdf', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp',
  docx: 'zip', xlsx: 'zip', pptx: 'zip', odt: 'zip', ods: 'zip', odp: 'zip',
  doc: 'ole', ppt: 'ole',
};

// Extensions a browser may send as application/octet-stream, with the type
// recorded instead once the content matches.
const OCTET_STREAM_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
};

const extensionOf = (name) => (String(name || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

function isOctetStream(file) {
  return file.mimetype === 'application/octet-stream' && Boolean(OCTET_STREAM_TYPES[extensionOf(file.originalname)]);
}

/** Whether the declared type and extension are accepted at all (before the content arrives). */
function acceptsFile(file) {
  if (!ALLOWED_EXTENSION.test(String(file.originalname || ''))) return false;
  return ALLOWED.has(file.mimetype) || isOctetStream(file);
}

/**
 * Checks a received file's bytes against its declared type and extension.
 * Returns the mimetype to record, or null when the content does not match.
 */
function sniffFile(file) {
  const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.alloc(0);
  const ext = extensionOf(file.originalname);
  const octet = file.mimetype === 'application/octet-stream';
  const mimetype = octet ? OCTET_STREAM_TYPES[ext] : file.mimetype;
  if (!mimetype) return null;

  const kinds = new Set([KIND_BY_MIME[mimetype], KIND_BY_EXTENSION[ext]].filter(Boolean));
  // A generic octet-stream must prove its type: .xls an OLE file, text a text file.
  if (octet && ext === 'xls') kinds.add('ole');
  if (octet && !kinds.size) kinds.add('text');
  for (const kind of kinds) {
    if (!SIGNATURES[kind](buffer)) return null;
  }
  return mimetype;
}

function contentError() {
  const error = new Error('Isi file tidak sesuai dengan jenis atau ekstensinya');
  error.status = 400;
  error.code = 'FILE_CONTENT_MISMATCH';
  return error;
}

function filesOf(req) {
  const list = [];
  if (req.file) list.push(req.file);
  if (Array.isArray(req.files)) list.push(...req.files);
  else if (req.files && typeof req.files === 'object') Object.values(req.files).forEach((group) => list.push(...group));
  return list;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!acceptsFile(file)) {
      const error = new Error('Tipe file tidak diizinkan');
      error.status = 400;
      error.code = 'FILE_TYPE_NOT_ALLOWED';
      return cb(error);
    }
    cb(null, true);
  },
});

// Every upload passes the per-user upload limiter first (middleware/rateLimits.js),
// then multer, then the content check; a route only writes `upload.single('file')`.
function limited(middleware) {
  return (req, res, next) => uploadLimiter(req, res, (limitError) => {
    if (limitError) return next(limitError);
    return middleware(req, res, (error) => {
      if (error) return next(error);
      for (const file of filesOf(req)) {
        const mimetype = sniffFile(file);
        if (!mimetype) return next(contentError());
        file.mimetype = mimetype;
      }
      return next();
    });
  });
}

module.exports = {
  single: (...args) => limited(upload.single(...args)),
  array: (...args) => limited(upload.array(...args)),
  fields: (...args) => limited(upload.fields(...args)),
  any: (...args) => limited(upload.any(...args)),
  none: (...args) => limited(upload.none(...args)),
  acceptsFile,
  sniffFile,
};
