const QRCode = require('qrcode');
const integrationLog = require('./integrationLog.service');

// PUBLIC_WEB_URL is the frontend the QR links to. Production must set it (a
// QR printed with a wrong domain cannot be fixed later); development falls
// back to the local Vite server.
function publicWebUrl(env = process.env) {
  const value = String(env.PUBLIC_WEB_URL || '').trim();
  if (value) return value;
  if (env.NODE_ENV === 'production') {
    const error = new Error('PUBLIC_WEB_URL belum diatur di server; QR verifikasi tidak bisa dibuat.');
    error.status = 503;
    error.code = 'PUBLIC_WEB_URL_MISSING';
    throw error;
  }
  return 'http://localhost:5173';
}

function verificationUrl({ verificationCode, baseUrl }) {
  if (!verificationCode) throw new Error('verificationCode wajib');
  const root = String(baseUrl || publicWebUrl()).replace(/\/$/, '');

  return `${root}/verify/${encodeURIComponent(verificationCode)}`;
}

async function generateVerificationQr({
  verificationCode,
  baseUrl,
  entityId = null,
  userId = null,
  subjectId = null,
}) {
  const payload = verificationUrl({ verificationCode, baseUrl });

  return integrationLog.wrap(
    {
      entityId,
      userId,
      provider: 'internal',
      operation: 'qrcode.generate_data_url',
      subjectType: 'document_verification',
      subjectId,
      requestMeta: { verificationCodeLength: verificationCode.length },
      responseMeta: () => ({ payload }),
    },
    async () => ({
      dataUrl: await QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 320,
      }),
      payload,
    })
  );
}

async function generateVerificationQrBuffer({
  verificationCode,
  baseUrl,
  entityId = null,
  userId = null,
  subjectId = null,
}) {
  const payload = verificationUrl({ verificationCode, baseUrl });

  return integrationLog.wrap(
    {
      entityId,
      userId,
      provider: 'internal',
      operation: 'qrcode.generate_png',
      subjectType: 'document_verification',
      subjectId,
      requestMeta: { verificationCodeLength: verificationCode.length },
      responseMeta: (result) => ({
        payload,
        size: result.buffer.length,
      }),
    },
    async () => ({
      buffer: await QRCode.toBuffer(payload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 240,
      }),
      payload,
    })
  );
}

module.exports = {
  publicWebUrl,
  verificationUrl,
  generateVerificationQr,
  generateVerificationQrBuffer,
};
