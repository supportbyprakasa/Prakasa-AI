const { google } = require('googleapis');
const { driveClient } = require('./googleDrive.service');
const integrationLog = require('./integrationLog.service');

async function getDocPlainText(fileId, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_docs',
    operation: 'getDocPlainText',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { fileId },
    responseMeta: (result) => ({ textLength: result?.length || 0 }),
  }, async () => {
    const auth = driveClient().context._options.auth;
    const docs = google.docs({ version: 'v1', auth });
    const response = await docs.documents.get({ documentId: fileId });
    const body = response.data.body?.content || [];
    const parts = [];

    for (const element of body) {
      const paragraph = element.paragraph;
      if (!paragraph) continue;
      const line = (paragraph.elements || [])
        .map((item) => item.textRun?.content || '')
        .join('');
      if (line.trim()) parts.push(line);
    }

    return parts.join('\n');
  });
}

module.exports = { getDocPlainText };
