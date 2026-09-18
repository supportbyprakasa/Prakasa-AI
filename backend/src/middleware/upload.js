const multer = require('multer');

const ALLOWED = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'text/plain',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const okMime = ALLOWED.has(file.mimetype);
    const extOk = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|png|jpe?g|txt)$/i.test(file.originalname);
    if (!okMime || !extOk) return cb(new Error('Tipe file tidak diizinkan'));
    cb(null, true);
  },
});

module.exports = upload;
