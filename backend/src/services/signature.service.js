const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

function getKey() {
  const raw = process.env.SIGNATURE_ENCRYPTION_KEY || '';
  if (raw.length < 32) throw new Error('SIGNATURE_ENCRYPTION_KEY minimal 32 karakter');
  // derive 32 bytes via sha256 supaya valid untuk aes-256
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptBuffer(buffer) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return {
    encrypted: enc,
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

function decryptBuffer({ encrypted, iv, authTag }) {
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = { encryptBuffer, decryptBuffer, sha256 };
