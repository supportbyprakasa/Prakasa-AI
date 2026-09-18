const { google } = require('googleapis');
const { driveClient } = require('./googleDrive.service');

// Ambil isi dokumen Google Docs sebagai teks (untuk dikirim ke AI).
// Sheets/Slides: cukup ambil judul + metadata, isi lengkap ditangani fase lanjutan.
async function getDocPlainText(fileId) {
  const auth = driveClient().context._options.auth;
  const docs = google.docs({ version: 'v1', auth });
  const r = await docs.documents.get({ documentId: fileId });
  const body = r.data.body?.content || [];
  const parts = [];
  for (const el of body) {
    const p = el.paragraph;
    if (!p) continue;
    const line = (p.elements || []).map((e) => e.textRun?.content || '').join('');
    if (line.trim()) parts.push(line);
  }
  return parts.join('\n');
}

module.exports = { getDocPlainText };
