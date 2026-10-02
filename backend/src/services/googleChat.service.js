const { google } = require('googleapis');
const integrationLog = require('./integrationLog.service');

function getAuth(subject) {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: [
      'https://www.googleapis.com/auth/chat.spaces',
      'https://www.googleapis.com/auth/chat.messages',
      'https://www.googleapis.com/auth/chat.memberships',
    ],
    subject: subject || process.env.GOOGLE_CHAT_DELEGATED_USER || undefined,
  });
}

function chatClient(subject) {
  return google.chat({ version: 'v1', auth: getAuth(subject) });
}

// Every board gets its own Space, created as the board's creator so it shows
// up under their own Google Chat the same way a Space they made by hand would.
async function createSpace({ displayName, creatorEmail }, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_chat',
    operation: 'createSpace',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { displayName, creatorEmail },
    responseMeta: (result) => ({ spaceName: result?.name }),
  }, async () => {
    const chat = chatClient(creatorEmail);
    const response = await chat.spaces.create({
      requestBody: { displayName, spaceType: 'SPACE' },
    });
    return response.data;
  });
}

async function listMessages({ spaceName, actingEmail, pageSize = 50, pageToken }, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_chat',
    operation: 'listMessages',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { spaceName, pageSize, pageToken },
    responseMeta: (result) => ({ count: result?.messages?.length || 0 }),
  }, async () => {
    const chat = chatClient(actingEmail);
    const response = await chat.spaces.messages.list({
      parent: spaceName,
      pageSize,
      pageToken,
      orderBy: 'createTime desc',
    });
    return response.data;
  });
}

async function createMessage({ spaceName, text, senderEmail }, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_chat',
    operation: 'createMessage',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { spaceName, senderEmail },
    responseMeta: (result) => ({ messageName: result?.name }),
  }, async () => {
    const chat = chatClient(senderEmail);
    const response = await chat.spaces.messages.create({
      parent: spaceName,
      requestBody: { text },
    });
    return response.data;
  });
}

async function getMessage({ messageName, actingEmail }, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_chat',
    operation: 'getMessage',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { messageName },
    responseMeta: (result) => ({ messageName: result?.name }),
  }, async () => {
    const chat = chatClient(actingEmail);
    const response = await chat.spaces.messages.get({ name: messageName });
    return response.data;
  });
}

module.exports = { createSpace, listMessages, createMessage, getMessage };
