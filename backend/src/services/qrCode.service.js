const QRCode = require('qrcode');
const integrationLog = require('./integrationLog.service');

function verificationUrl({ verificationCode, baseUrl }) {
  if (!verificationCode) throw new Error('verificationCode wajib');
  const root = (
    baseUrl ||
    process.env.PUBLIC_WEB_URL ||
    'https://prakasa-work-os.com'
  ).replace(/\/$/, '');

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
  verificationUrl,
  generateVerificationQr,
  generateVerificationQrBuffer,
};
