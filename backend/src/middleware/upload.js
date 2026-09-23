const multer = require('multer');

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
  'text/html',
  'text/xml',
  'application/json',
  'application/xml',
  'application/csv',
  'application/rtf',
  'application/octet-stream',
]);

const MAX_FILE_SIZE = Number(process.env.DOCUMENT_UPLOAD_MAX_BYTES || 25 * 1024 * 1024);
const ALLOWED_EXTENSION = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|png|jpe?g|webp|txt|csv|md|markdown|json|xml|html?|rtf)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    const okMime = ALLOWED.has(file.mimetype);
    const extOk = ALLOWED_EXTENSION.test(file.originalname);
    if (!okMime || !extOk) {
      const error = new Error('Tipe file tidak diizinkan');
      error.status = 400;
      error.code = 'FILE_TYPE_NOT_ALLOWED';
      return cb(error);
    }
    cb(null, true);
  },
});

module.exports = upload;
