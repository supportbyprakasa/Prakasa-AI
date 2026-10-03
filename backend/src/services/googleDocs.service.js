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

// Fills {{placeholders}} in a Google Doc (body, headers and footers): one
// batchUpdate of replaceAllText per value, both "{{key}}" and "{{ key }}".
// values: { key: text }. Returns the number of replacements Google made.
async function replacePlaceholders(fileId, values, ctx = {}) {
  const entries = Object.entries(values || {});
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_docs',
    operation: 'replacePlaceholders',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { fileId, keys: entries.map(([k]) => k) },
    responseMeta: (result) => ({ replaced: result }),
  }, async () => {
    if (!entries.length) return 0;
    const auth = driveClient().context._options.auth;
    const docs = google.docs({ version: 'v1', auth });
    const requests = entries.flatMap(([key, value]) => [`{{${key}}}`, `{{ ${key} }}`].map((text) => ({
      replaceAllText: { containsText: { text, matchCase: true }, replaceText: String(value ?? '') },
    })));
    const response = await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests } });
    return (response.data.replies || []).reduce((n, r) => n + Number(r.replaceAllText?.occurrencesChanged || 0), 0);
  });
}

module.exports = { getDocPlainText, replacePlaceholders };
