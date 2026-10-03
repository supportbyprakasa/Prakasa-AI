const { google } = require('googleapis');
const { fail } = require('../utils/response');

// Shared plumbing for every "Google app inside Prakasa Workspace" feature.
//
// userAuth(subject, scopes): acts AS that Workspace user through domain-wide
// delegation — the user only ever sees their own mail, chats, files, events.
// serviceAuth(scopes): acts as the service account itself (Analytics, where the
// service account is granted access to the GA property directly).
function credentials() {
  return {
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  };
}

function userAuth(subject, scopes) {
  return new google.auth.JWT({ ...credentials(), scopes, subject });
}

function serviceAuth(scopes) {
  return new google.auth.JWT({ ...credentials(), scopes });
}

const text = (error) => String(error?.response?.data?.error?.message || error?.response?.data?.error_description || error?.message || '');

// Every Google failure is mapped to a clear, actionable error. A raw 401/403
// from Google must never be forwarded as-is: the frontend treats any 401 as
// "your Prakasa Workspace session expired" and logs the user out.
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNABORTED']);

function handleGoogleError(error, res, next, { service = 'Google' } = {}) {
  const message = text(error);
  // The server couldn't reach Google at all (network / DNS / timeout) — never
  // show the user a raw "request to https://oauth2… failed" string.
  if (NETWORK_CODES.has(error?.code) || NETWORK_CODES.has(error?.cause?.code)
      || /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|socket hang up|network timeout/i.test(message)) {
    return fail(res, 'GOOGLE_UNREACHABLE',
      `Tidak dapat terhubung ke ${service} saat ini. Periksa koneksi internet server lalu coba lagi.`, 503);
  }
  if (/invalid_grant|invalid email or user id/i.test(message)) {
    return fail(res, 'GOOGLE_ACCOUNT_NOT_LINKED',
      'Email Anda belum terhubung ke akun Google Workspace yang valid. Hubungi admin.', 404);
  }
  if (/unauthorized_client|not authorized for any of the scopes/i.test(message)) {
    return fail(res, 'GOOGLE_SCOPE_NOT_GRANTED',
      `${service} belum diizinkan untuk aplikasi ini. Admin perlu menambahkan izinnya di Google Admin Console.`, 503);
  }
  if (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(message)) {
    return fail(res, 'GOOGLE_API_DISABLED',
      `API ${service} belum diaktifkan di Google Cloud project. Hubungi admin.`, 503);
  }
  const status = Number(error?.status || error?.code || error?.response?.status);
  if (status === 404) return fail(res, 'NOT_FOUND', 'Data tidak ditemukan di Google.', 404);
  if (status === 401 || status === 403) {
    return fail(res, 'GOOGLE_ACCESS_DENIED', `Tidak punya akses ke data ${service} ini.`, 502);
  }
  if (status === 429) return fail(res, 'GOOGLE_RATE_LIMITED', `${service} sedang sibuk. Coba lagi sebentar.`, 503);
  return next(error);
}

module.exports = { userAuth, serviceAuth, handleGoogleError };
