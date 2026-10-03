const { google } = require('googleapis');
const integrationLog = require('./integrationLog.service');

// Directory API always requires impersonating a real Workspace Super Admin —
// unlike Drive (service account acts as itself, a Shared Drive member),
// domain directory data belongs to the admin scope and can't be read "as"
// the service account itself.
function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/admin.directory.user.readonly'],
    subject: process.env.GOOGLE_ADMIN_DELEGATED_USER || undefined,
  });
}

async function listDomainUsers(ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_directory',
    operation: 'listDomainUsers',
    requestMeta: {},
    responseMeta: (result) => ({ count: result?.length || 0 }),
  }, async () => {
    if (!process.env.GOOGLE_ADMIN_DELEGATED_USER) {
      const error = new Error('GOOGLE_ADMIN_DELEGATED_USER belum diisi di .env');
      error.code = 'GOOGLE_ADMIN_NOT_CONFIGURED';
      throw error;
    }
    const admin = google.admin({ version: 'directory_v1', auth: getAuth() });
    const users = [];
    let pageToken;
    do {
      const response = await admin.users.list({
        customer: 'my_customer',
        maxResults: 500,
        projection: 'full',
        pageToken,
      });
      users.push(...(response.data.users || []));
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return users
      .filter((user) => !user.suspended)
      .map((user) => ({
        email: user.primaryEmail,
        name: user.name?.fullName || user.primaryEmail,
        orgUnitPath: user.orgUnitPath || null,
        isAdmin: Boolean(user.isAdmin || user.isDelegatedAdmin),
      }));
  });
}

module.exports = { listDomainUsers };
