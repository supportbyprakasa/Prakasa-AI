// The send channel for "Pengajuan ke Accurate" (services/accurateWriteRequests.service.js).
//
// Owner's decision (3 Oct 2026): Accurate stays the source of truth, Prakasa
// Workspace proposes changes to it, and nothing is tested against a real
// Accurate database. So this channel is CLOSED: every send is answered with
// "blocked", the request stays in the queue, and nothing leaves the app.
//
// Opening it later is a separate, owner-approved step, in this order:
//   1. a test database in Accurate (never the production company file first);
//   2. the OAuth connection re-granted with the write scopes the record types
//      need (customer_save, vendor_save) — accurateConnection.service.js
//      refuses anything but *_view today;
//   3. accurateReadOnly.js widened to allow exactly those save endpoints,
//      with their own allowlist and tests;
//   4. ACCURATE_WRITE_ENABLED=1 in the environment.
// Until all four are done, `send` never performs a request.

// What each record type would send, by Accurate's own parameter names.
// Pure, so the mapping is tested without any connection.
const PARAMS = Object.freeze({
  customer: Object.freeze({
    number: 'customerNo', name: 'name', category: 'category.name', contactPerson: 'contactName',
    phone: 'mobilePhone', businessPhone: 'workPhone', email: 'email', address: 'billStreet', city: 'billCity', notes: 'notes',
  }),
  vendor: Object.freeze({
    number: 'vendorNo', name: 'name', category: 'category.name', contactPerson: 'contactName',
    phone: 'mobilePhone', businessPhone: 'workPhone', email: 'email', address: 'billStreet', city: 'billCity', notes: 'notes',
  }),
});

function toAccurateParams(request) {
  const map = PARAMS[request.recordType];
  if (!map) throw new Error(`Jenis data "${request.recordType}" tidak dikenal`);
  const out = {};
  for (const [key, param] of Object.entries(map)) {
    const value = request.payload?.[key];
    if (value !== undefined && value !== null && value !== '') out[param] = value;
  }
  // An update names the existing record; a create leaves the id to Accurate.
  if (request.action === 'update' && request.accurateId) out.id = request.accurateId;
  return out;
}

const enabled = () => process.env.ACCURATE_WRITE_ENABLED === '1';

// Returns { sent: false, blocked: true, reason, message } while the channel is
// closed. A future open channel returns { sent: true, accurateId, number,
// response } or throws ({ permanent: true } for a refusal that will not pass
// on retry, e.g. a validation error from Accurate).
async function send(request) {
  const params = toAccurateParams(request);
  if (!enabled()) {
    return {
      sent: false, blocked: true, reason: 'ACCURATE_WRITE_DISABLED',
      message: 'Pengiriman ke Accurate belum dinyalakan. Pengajuan menunggu di antrean.',
      params,
    };
  }
  return {
    sent: false, blocked: true, reason: 'ACCURATE_WRITE_NOT_WIRED',
    message: 'Saluran tulis ke Accurate belum disambungkan (scope tulis OAuth dan endpoint simpan belum dibuka). Pengajuan menunggu di antrean.',
    params,
  };
}

module.exports = { PARAMS, toAccurateParams, enabled, send };
