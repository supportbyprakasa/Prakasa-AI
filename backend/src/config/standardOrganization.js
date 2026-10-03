const DIVISIONS = Object.freeze([
  { code: 'finance', name: 'Finance' },
  { code: 'procurement', name: 'Procurement' },
  { code: 'sales', name: 'Sales' },
  { code: 'people_culture', name: 'People & Culture' },
  { code: 'management_office', name: 'Management Office' },
  { code: 'retail_commerce', name: 'Retail Commerce' },
  { code: 'warehouse', name: 'Warehouse' },
  { code: 'marketing', name: 'Marketing' },
]);

const ROLE_LEVELS = Object.freeze(['member', 'supervisor', 'head']);
const unique = (values) => [...new Set(values)];

const COMMON_MEMBER = Object.freeze([
  'notification.view',
  'document.view', 'document.create', 'document.update',
  'template.view', 'document_type.view',
  'board.view', 'task.view', 'task.create', 'task.update', 'task.watch',
  'task.checklist.manage', 'task.activity.view',
  'chat.view', 'chat.send',
  'approval.view', 'approval.request',
  // Every division raises payment requests / reimbursements to Finance (migration 121).
  'finance.request',
  'signature.view', 'signature.request', 'signature.sign', 'signature.manage_asset',
  'meeting.view', 'meeting.create', 'meeting.update',
  'meeting.attach_recording', 'meeting.ai_summary',
  'search.global',
  'ai.use', 'ai.view', 'ai_command.use', 'ai_command.session.view',
  'ai_command.session.manage', 'ai_command.context.attach',
  'ai_command.action.propose', 'ai_command.department.view',
  // Every role can submit and track its own IT tickets, regardless of division.
  'it_ticket.view', 'it_ticket.create', 'it_ticket.comment', 'it_ticket.cancel_own',
  // Cap surat is a shared division asset — anyone in the division can use it.
  'letterhead.view',
  // My Drive is personal storage, not a divisional resource — every level gets it.
  'mydrive.view', 'mydrive.manage',
  // Google apps inside the workspace — each user only ever sees their own data.
  'google.mail.use', 'google.chat.use', 'google.docs.use', 'google.groups.view',
  // The entity's people directory: work contacts only (People & Culture wave 1).
  'people.directory.view',
  // Layanan GA (wave 2, row 2.2): everyone requests ATK/repairs and books rooms/vehicles.
  'ga.request.create',
]);

const COMMON_SUPERVISOR = Object.freeze([
  'board.manage', 'task.delete', 'task.watch.manage', 'task.dependency.manage',
  'approval.decide', 'approval_delegation.view',
  'meeting.cancel', 'meeting.confirm_action',
  'ai_command.action.confirm',
  // Dashboard divisi (migration 116): the division's own dashboard.
  'division_dashboard.view',
]);

const COMMON_HEAD = Object.freeze([
  'document.delete', 'template.manage',
  // A Head oversees the Project Tracker of their own division only; the
  // entity-wide view stays with Management Office and Super Admin.
  'management_dashboard.division',
  'approval_delegation.manage',
  // Only the division's Head uploads/replaces its letterhead.
  'letterhead.manage',
]);

const COMMON_PERMISSION_SETS = Object.freeze({
  member: COMMON_MEMBER,
  supervisor: COMMON_SUPERVISOR,
  head: COMMON_HEAD,
});

const DIVISION_PERMISSION_SETS = Object.freeze({
  finance: Object.freeze({
    member: Object.freeze([
      'finance.view', 'finance.request', 'finance.manage',
      'finance.document_check',
      // Piutang & Utang from Accurate (migration 117).
      'finance.receivable.view', 'finance.payable.view',
    ]),
    supervisor: Object.freeze(['finance.approve', 'finance.process', 'accurate.batch.view']),
    head: Object.freeze([]),
  }),
  procurement: Object.freeze({
    member: Object.freeze([
      'finance.view', 'finance.request',
      'warehouse.movement.view',
      'workspace.procurement.view',
      // POs, vendors and incoming goods from Accurate — quantities and dates.
      'procurement.view',
    ]),
    // Purchase prices only for the Supervisor/Head (P1); pulling from Accurate is read-only.
    // Total stock and days of cover without per-gudang (D2 extended 30 Sep): Saran pesan ulang, and Prakasa AI for them.
    supervisor: Object.freeze(['accurate.batch.view', 'procurement.price.view', 'procurement.accurate.sync', 'procurement.reorder.view']),
    head: Object.freeze([]),
  }),
  sales: Object.freeze({
    member: Object.freeze([
      'sales.customer.view', 'sales.customer.manage',
      'sales.pipeline.view', 'sales.order.view', 'sales.order.manage',
    ]),
    // Members see the customers, leads and orders they own; supervisors see all
    // and keep the SKU list and the salesperson mapping.
    supervisor: Object.freeze(['sales.master.manage', 'sales.data.view_all', 'accurate.batch.view', 'retail.insight.view', 'marketing.insight.view']),
    head: Object.freeze([]),
  }),
  // IT lives under People & Culture: onboarding/offboarding already provisions
  // devices and accounts, so device and subscription ownership follows.
  people_culture: Object.freeze({
    member: Object.freeze([
      'hrga.view', 'hrga.request',
      'it.dashboard.view', 'device.view', 'subscription.view',
      // IT infrastructure registers (wave 2, row 2.3), IP addresses and costs included.
      'it.infra.view',
      // Layanan GA: People & Culture processes every request and booking.
      'ga.request.process',
      // Operasional GA (upkeep, contracts, utility bills): GA staff see them
      // and record upkeep done (migration 114).
      'ga.ops.view',
    ]),
    supervisor: Object.freeze([
      // Rooms and vehicles per location (Layanan GA).
      'ga.resource.manage',
      // Operasional GA schedules, contracts and bills.
      'ga.ops.manage',
      // Editing anyone's workflow, reassigning and cancelling (wave 2, audit 0.2: not the Member).
      'hrga.manage',
      'hrga.approve', 'hrga.complete',
      // Directory, org chart and exclusions are People & Culture's (wave 1, rule 11).
      'people.directory.manage',
      'device.manage', 'device.assign', 'device.handover.manage',
      'device.log.manage', 'subscription.manage', 'subscription.renewal.request',
      'it_ticket.manage',
      // IT infrastructure registers and the IT report import (wave 2, row 2.3).
      'it.infra.manage',
    ]),
    head: Object.freeze([
      'hrga.checklist_template.manage',
      'software_vendor.manage', 'subscription.license.manage',
      'subscription.invoice.manage', 'subscription.renewal.decide',
      'subscription.payment.manage',
    ]),
  }),
  management_office: Object.freeze({
    member: Object.freeze([
      'workspace.management_office.view', 'analytics.view',
    ]),
    // Oversight: stock and the Accurate reconciliation (quantities only), and
    // Procurement with purchase prices (P1: the Management Office sees them), read-only.
    supervisor: Object.freeze(['management_dashboard.view', 'warehouse.stock.view', 'warehouse.recon.view', 'procurement.view', 'procurement.price.view', 'procurement.reorder.view', 'retail.insight.view', 'finance.receivable.view', 'finance.payable.view', 'marketing.insight.view', 'finance.view']),
    // Oversight of every division's Accurate batches (deciding stays with the divisions).
    head: Object.freeze(['activity_log.view', 'accurate.batch.view']),
  }),
  retail_commerce: Object.freeze({
    member: Object.freeze([
      'sales.customer.view', 'sales.customer.manage',
      'sales.pipeline.view', 'sales.order.view', 'sales.order.manage',
      'warehouse.movement.view', 'workspace.retail_commerce.view', 'sales.data.view_all',
      // Marketplace performance page (migration 120).
      'retail.insight.view',
    ]),
    supervisor: Object.freeze(['sales.master.manage', 'accurate.batch.view']),
    head: Object.freeze([]),
  }),
  warehouse: Object.freeze({
    member: Object.freeze([
      'warehouse.movement.view', 'warehouse.movement.create',
      'warehouse.movement.update', 'warehouse.movement.submit',
      'warehouse.inbound.manage', 'warehouse.outbound.manage',
      'warehouse.checklist.view', 'warehouse.checklist.manage',
      'warehouse.incident.view', 'warehouse.incident.manage',
      'warehouse.stock.view', 'warehouse.recon.view',
    ]),
    supervisor: Object.freeze([
      'warehouse.movement.approve', 'warehouse.movement.audit.view', 'accurate.batch.view',
      'warehouse.accurate.sync', 'warehouse.recon.resolve',
    ]),
    head: Object.freeze(['warehouse.movement.cancel']),
  }),
  marketing: Object.freeze({
    member: Object.freeze([
      'sales.customer.view', 'sales.data.view_all', 'workspace.marketing.view', 'analytics.view',
      // Produk & channel, Kampanye (migration 119).
      'marketing.insight.view',
    ]),
    supervisor: Object.freeze(['template.manage', 'marketing.campaign.manage']),
    head: Object.freeze([]),
  }),
});

const permissionsByRoleKey = new Map();
const STANDARD_ROLES = Object.freeze(DIVISIONS.flatMap((division) => {
  const divisionSets = DIVISION_PERMISSION_SETS[division.code];
  const memberPermissions = unique([
    ...COMMON_MEMBER,
    ...divisionSets.member,
  ]);
  const supervisorPermissions = unique([
    ...memberPermissions,
    ...COMMON_SUPERVISOR,
    ...divisionSets.supervisor,
  ]);
  const headPermissions = unique([
    ...supervisorPermissions,
    ...COMMON_HEAD,
    ...divisionSets.head,
  ]);
  const permissionSets = {
    member: Object.freeze(memberPermissions),
    supervisor: Object.freeze(supervisorPermissions),
    head: Object.freeze(headPermissions),
  };

  return ROLE_LEVELS.map((level) => {
    const key = `${division.code}.${level}`;
    permissionsByRoleKey.set(key, permissionSets[level]);
    return Object.freeze({
      key,
      name: `${division.name} ${level[0].toUpperCase()}${level.slice(1)}`,
      departmentCode: division.code,
      level,
      permissions: permissionSets[level],
    });
  });
}));

function permissionsForStandardRole(roleKey) {
  return permissionsByRoleKey.get(roleKey) || [];
}

// Administrator Sistem (system.admin): global, no division, configuration only.
// It never holds a permission that reads division data (sales, warehouse,
// procurement, finance, HR/GA processing, IT assets, management dashboards,
// activity logs, documents, other people's AI sessions). Migration 112 seeds
// it and migration 123 revokes the integration/AI codes; test/systemAdminRole.test.js
// keeps this list equal to 112 minus 123.
const SYSTEM_ADMIN_PERMISSIONS = [
  'user.manage', 'role.manage', 'permission.manage', 'department.manage', 'entity.manage',
  'approval_matrix.view', 'approval_matrix.manage',
  'signature_rule.view', 'signature_rule.manage',
  'document_type.view', 'document_type.manage', 'folder_rule.manage',
  'notification.manage_rule',
  // Accurate connection and AI provider/routing settings are Super Admin only
  // (migration 123): they decide where company data comes from and goes to.
  'integration_log.view',
  'notification.view',
  'it_ticket.create', 'it_ticket.view', 'it_ticket.comment', 'it_ticket.cancel_own',
  'google.mail.use', 'google.chat.use', 'google.docs.use', 'google.groups.view',
  'meeting.view', 'mydrive.view',
];

// Divisions that no longer exist as their own division, and where that work
// lives now. Operations (owner, 1 Oct 2026): GA runs office operations, inside
// People & Culture (Layanan GA). Migration 113 soft-deleted the empty division.
const RETIRED_DIVISIONS = Object.freeze({
  operations: 'Pekerjaan operasional ditangani GA (People & Culture → Layanan GA).',
});

// Roles that belong to no division. Super Admin sees everything; Administrator
// Sistem only configures.
const GLOBAL_ROLE_KEYS = ['system.super_admin', 'system.admin'];

module.exports = {
  DIVISIONS,
  ROLE_LEVELS,
  COMMON_PERMISSION_SETS,
  DIVISION_PERMISSION_SETS,
  STANDARD_ROLES,
  SYSTEM_ADMIN_PERMISSIONS,
  GLOBAL_ROLE_KEYS,
  RETIRED_DIVISIONS,
  permissionsForStandardRole,
};
