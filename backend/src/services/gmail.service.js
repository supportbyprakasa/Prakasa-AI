const { google } = require('googleapis');
const integrationLog = require('./integrationLog.service');

function getAuth(subject) {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    subject: subject || process.env.GOOGLE_GMAIL_SENDER || undefined,
  });
}

function gmailClient(subject) {
  return google.gmail({ version: 'v1', auth: getAuth(subject) });
}

function encodeBase64Url(input) {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Plain-text only — this sends system notifications, not rich mail.
// Header values never carry a line break (no header injection).
const oneLine = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();

function buildRawMessage({ to, from, subject, text, replyTo }) {
  const headers = [
    `To: ${oneLine(to)}`,
    from ? `From: ${oneLine(from)}` : null,
    replyTo ? `Reply-To: ${oneLine(replyTo)}` : null,
    `Subject: =?UTF-8?B?${Buffer.from(oneLine(subject), 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
  ].filter(Boolean);
  return `${headers.join('\r\n')}\r\n\r\n${text}`;
}

// Testing phase — who may receive email from the app before go-live.
// Owner, 2 Oct 2026: "kalau mau testing terkirimnya ke support@prakasagroup.com
// dulu aja … banyak yang komplain email manajemen di-spam test … berlaku
// sebelum difinalkan untuk production".
//   EMAIL_TEST_REDIRECT  one address: EVERY email goes there instead of its
//                        real recipient (the subject names who it was for).
//   EMAIL_TEST_ALLOWLIST comma-separated: only these recipients receive mail,
//                        the others are dropped (used when no redirect is set).
// Fail closed: outside production, with neither set, nothing is sent at all,
// so a test server started with a blank environment cannot mail employees.
// Reserved test domains never receive mail.
const RESERVED_EMAIL = /@(?:[^@]+\.)?(?:invalid|test|example|localhost|example\.(?:com|net|org))$/i;
const normalise = (email) => String(email || '').trim().toLowerCase();
const isProduction = () => process.env.NODE_ENV === 'production';

function emailAllowlist() {
  return String(process.env.EMAIL_TEST_ALLOWLIST || '').split(',').map(normalise).filter(Boolean);
}

function emailRedirect() {
  const to = String(process.env.EMAIL_TEST_REDIRECT || '').trim();
  return to && !RESERVED_EMAIL.test(to) ? to : '';
}

/** The recipients that may actually receive this email (to may be "a, b"). */
function allowedRecipients(to) {
  const list = emailAllowlist();
  const real = String(to || '').split(',').map((v) => v.trim()).filter(Boolean)
    .filter((email) => !RESERVED_EMAIL.test(email));
  if (list.length) return real.filter((email) => list.includes(normalise(email)));
  return isProduction() ? real : [];
}

/** Where an email really goes: { to, subject } or null when it must not be sent. */
function route({ to, subject }) {
  const redirect = emailRedirect();
  if (redirect) {
    const intended = String(to || '').split(',').map((v) => v.trim()).filter(Boolean);
    if (!intended.length) return null;
    return { to: redirect, subject: `[UJI untuk ${intended.join(', ')}] ${subject}` };
  }
  const recipients = allowedRecipients(to);
  return recipients.length ? { to: recipients.join(', '), subject } : null;
}

async function sendMail({ to, subject, text, senderEmail, replyTo }, ctx = {}) {
  const routed = route({ to, subject });
  if (!routed) return { skipped: true, reason: 'recipient_not_allowed' };
  ({ to, subject } = routed);
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_gmail',
    operation: 'sendMail',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { to, subject },
    responseMeta: (result) => ({ messageId: result?.id }),
  }, async () => {
    const gmail = gmailClient(senderEmail);
    const from = senderEmail || process.env.GOOGLE_GMAIL_SENDER || undefined;
    const raw = encodeBase64Url(buildRawMessage({ to, from, subject, text, replyTo }));
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    return response.data;
  });
}

module.exports = { sendMail, buildRawMessage, allowedRecipients, emailAllowlist, emailRedirect, route };
