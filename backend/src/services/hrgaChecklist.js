// Onboarding/offboarding checklist rules (People & Culture wave 2, §2.1.3).
// Pure: the service, the reminder job and the tests share it.

const OWNER_GROUPS = Object.freeze(['it', 'ga', 'manager', 'pc']);
const GROUP_ORDER = Object.freeze({ it: 1, ga: 2, manager: 3, pc: 4 });
const REQUIRES = Object.freeze(['google', 'app', 'device', 'licenses', 'phone', 'desk', 'idCard']);

const CATEGORIES = Object.freeze([
  'google_workspace_access', 'shared_drive_access', 'device_handover', 'device_return', 'email_account',
  'software_license', 'account_deactivation', 'document_handover', 'exit_interview', 'custom',
  'app_account', 'app_account_deactivation', 'phone_line', 'phone_line_return', 'desk_setup', 'id_card',
  'id_card_return', 'access_revoke', 'team_orientation',
]);

// Holdings (devices, licences, numbers the leaver still has) become offboarding
// items from data, never from a template.
const HOLDING_CATEGORIES = Object.freeze(['device_return', 'phone_line_return']);

// Completed only through their action ("Serahkan perangkat", "Terima kembali", …),
// never by ticking, while the linked record is not in its target state (D13).
const ACTION_ONLY = Object.freeze(['device_handover', 'device_return', 'phone_line', 'phone_line_return', 'software_license']);
// Done outside the app in the Google admin console: completion needs an explicit confirmation.
const GOOGLE_CONFIRM = Object.freeze(['google_workspace_access', 'account_deactivation']);

// The permission a PIC of each team must hold (decision 12, P10).
const PIC_PERMISSION = Object.freeze({ it: 'device.assign', ga: 'ga.request.process' });

const item = (ownerGroup, category, title, offsetDays, requires = null) => Object.freeze({
  category, title, ownerGroup, offsetDays, ...(requires ? { requires } : {}),
});

// Built-in templates (title Indonesian; offsetDays relative to the join date / last day).
const BUILT_IN = Object.freeze({
  onboarding: Object.freeze([
    item('it', 'google_workspace_access', 'Buat akun Google Workspace (konsol admin)', -2, 'google'),
    item('it', 'app_account', 'Buat akun Prakasa Workspace', -1, 'app'),
    item('it', 'shared_drive_access', 'Beri akses Shared Drive divisi', 0, 'google'),
    item('it', 'device_handover', 'Serahkan perangkat kerja', 0, 'device'),
    item('it', 'software_license', 'Berikan lisensi', 0, 'licenses'),
    // Company numbers: GA runs the operator subscriptions (owner, 1 Oct 2026: IT and GA work together on devices and numbers).
    item('ga', 'phone_line', 'Serahkan nomor telepon/HP perusahaan', 0, 'phone'),
    item('ga', 'desk_setup', 'Siapkan meja kerja', -1, 'desk'),
    item('ga', 'id_card', 'Siapkan kartu identitas/akses', 0, 'idCard'),
    item('manager', 'team_orientation', 'Orientasi tim dan tugas pertama', 0),
    item('pc', 'email_account', 'Kirim informasi hari pertama', -1),
  ]),
  offboarding: Object.freeze([
    item('it', 'account_deactivation', 'Nonaktifkan akun Google Workspace (konsol admin)', 0),
    item('it', 'app_account_deactivation', 'Nonaktifkan akun Prakasa Workspace', 0, 'app'),
    item('it', 'access_revoke', 'Cabut akses server/NAS dan aplikasi lain; ganti password bersama yang ia ketahui (di luar aplikasi)', 0),
    item('ga', 'id_card_return', 'Terima kembali kartu identitas/akses', 0),
    item('manager', 'document_handover', 'Serah terima pekerjaan dan dokumen', -1),
    item('pc', 'exit_interview', 'Exit interview', -1),
  ]),
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(day, n) {
  if (!DATE_RE.test(String(day || ''))) return null;
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(n || 0));
  return d.toISOString().slice(0, 10);
}

/** Due = base day + offset, never earlier than the approval day (decision 10, D5). */
function dueDate(baseDay, offsetDays, approvalDay) {
  const due = addDays(baseDay, offsetDays) || approvalDay;
  return approvalDay && due < approvalDay ? approvalDay : due;
}

/** Whether a template item applies to an onboarding with these needs. */
function itemApplies(entry, { workflowType, needs, hasAccount }) {
  const req = entry.requires;
  if (!req) return true;
  if (workflowType === 'offboarding') return req === 'app' ? Boolean(hasAccount) : true;
  const n = needs || {};
  switch (req) {
    case 'google': return Boolean(n.google);
    case 'app': return Boolean(n.app);
    case 'device': return Boolean(n.device) && n.device !== 'none';
    case 'licenses': return Array.isArray(n.licenses) && n.licenses.length > 0;
    case 'phone': return Boolean(n.phone) && n.phone !== 'none';
    case 'desk': return Boolean(n.desk);
    case 'idCard': return Boolean(n.idCard);
    default: return true;
  }
}

/**
 * The items of a checklist (without responsible users): template items that
 * apply, one licence item per requested subscription (onboarding), and the
 * leaver's holdings (offboarding). Sorted by team, then template order.
 */
function planItems({ workflowType, templateItems, needs, hasAccount, subscriptions = [], holdings = null, baseDay, approvalDay }) {
  const out = [];
  const productOf = new Map(subscriptions.map((s) => [Number(s.id), s.productName]));
  (templateItems || []).forEach((entry, index) => {
    if (!itemApplies(entry, { workflowType, needs, hasAccount })) return;
    if (HOLDING_CATEGORIES.includes(entry.category)) return;
    if (workflowType === 'offboarding' && entry.category === 'software_license') return;
    const base = {
      category: entry.category,
      ownerGroup: OWNER_GROUPS.includes(entry.ownerGroup) ? entry.ownerGroup : 'pc',
      title: entry.title,
      description: entry.description || null,
      dueDate: dueDate(baseDay, entry.offsetDays, approvalDay),
      order: index,
    };
    if (workflowType === 'onboarding' && entry.category === 'software_license') {
      for (const id of (needs?.licenses || [])) {
        const product = productOf.get(Number(id)) || 'software';
        out.push({ ...base, title: `Berikan lisensi ${product}`, linkedSubscriptionId: Number(id) });
      }
      return;
    }
    out.push(base);
  });
  if (workflowType === 'offboarding' && holdings) {
    let order = 1000;
    const due = dueDate(baseDay, 0, approvalDay);
    for (const d of holdings.devices || []) {
      out.push({ category: 'device_return', ownerGroup: 'it', title: `Terima kembali ${d.name}`, description: null, dueDate: due, order: order++, linkedDeviceAssignmentId: Number(d.assignmentId) });
    }
    for (const l of holdings.licenses || []) {
      out.push({ category: 'software_license', ownerGroup: 'it', title: `Cabut lisensi ${l.productName}`, description: null, dueDate: due, order: order++, linkedSubscriptionLicenseId: Number(l.licenseId), linkedSubscriptionId: Number(l.subscriptionId) });
    }
    for (const p of holdings.phoneLines || []) {
      out.push({ category: 'phone_line_return', ownerGroup: 'ga', title: `Terima kembali nomor ${p.label}`, description: null, dueDate: due, order: order++, linkedPhoneLineId: Number(p.id) });
    }
  }
  return out
    .sort((a, b) => GROUP_ORDER[a.ownerGroup] - GROUP_ORDER[b.ownerGroup] || a.order - b.order)
    .map(({ order, ...rest }, i) => ({ ...rest, sortOrder: GROUP_ORDER[rest.ownerGroup] * 100 + i }));
}

/** Holdings return items that are not on the checklist yet (holdings-sync, D14). */
function missingHoldingItems(planned, tasks) {
  const has = (key, id) => tasks.some((t) => Number(t[key]) === Number(id));
  return planned.filter((p) => (
    (p.category === 'device_return' && !has('linked_device_assignment_id', p.linkedDeviceAssignmentId))
    || (p.category === 'software_license' && p.linkedSubscriptionLicenseId && !has('linked_subscription_license_id', p.linkedSubscriptionLicenseId))
    || (p.category === 'phone_line_return' && !has('linked_phone_line_id', p.linkedPhoneLineId))
  ));
}

/** Template item validation shared with the route (category per type, holdings refused). */
function templateItemProblem(workflowType, entry) {
  if (!CATEGORIES.includes(entry.category)) return `Kategori "${entry.category}" tidak dikenal`;
  if (HOLDING_CATEGORIES.includes(entry.category)) return 'Pengembalian perangkat/nomor dibuat otomatis dari kepemilikan, bukan dari template';
  if (workflowType === 'offboarding' && entry.category === 'software_license') return 'Pencabutan lisensi dibuat otomatis dari kepemilikan, bukan dari template';
  if (workflowType === 'onboarding' && ['device_return', 'account_deactivation', 'app_account_deactivation', 'id_card_return', 'phone_line_return', 'exit_interview'].includes(entry.category)) {
    return 'Kategori ini untuk offboarding';
  }
  if (workflowType === 'offboarding' && ['device_handover', 'phone_line', 'app_account', 'google_workspace_access', 'shared_drive_access', 'desk_setup', 'id_card', 'team_orientation'].includes(entry.category)) {
    return 'Kategori ini untuk onboarding';
  }
  return null;
}

module.exports = {
  OWNER_GROUPS, GROUP_ORDER, REQUIRES, CATEGORIES, HOLDING_CATEGORIES, ACTION_ONLY, GOOGLE_CONFIRM, PIC_PERMISSION,
  BUILT_IN, addDays, dueDate, itemApplies, planItems, missingHoldingItems, templateItemProblem,
};
