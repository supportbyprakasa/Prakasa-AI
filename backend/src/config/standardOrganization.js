const DIVISIONS = Object.freeze([
  { code: 'operations', name: 'Operations' },
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
  'signature.view', 'signature.request', 'signature.sign', 'signature.manage_asset',
  'meeting.view', 'meeting.create', 'meeting.update',
  'meeting.attach_recording', 'meeting.ai_summary',
  'form.view', 'form.submit', 'form_submission.view',
  'workflow_instance.view', 'search.global',
  'kb.view', 'kb.query',
  'ai.use', 'ai.view', 'ai_command.use', 'ai_command.session.view',
  'ai_command.session.manage', 'ai_command.context.attach',
  'ai_command.action.propose', 'ai_command.department.view',
]);

const COMMON_SUPERVISOR = Object.freeze([
  'board.manage', 'task.delete', 'task.watch.manage', 'task.dependency.manage',
  'approval.decide', 'approval_delegation.view',
  'meeting.cancel', 'meeting.confirm_action',
  'ai_command.action.confirm',
  'workspace.cross_division.view', 'timeline.view', 'decision_log.view',
  'form_submission.manage', 'form_submission.transition',
  'workflow_instance.transition',
]);

const COMMON_HEAD = Object.freeze([
  'document.delete', 'template.manage', 'kb.manage',
  'decision_log.manage', 'brief.view',
  'data_classification.view', 'data_classification.manage',
  'approval_delegation.manage',
]);

const COMMON_PERMISSION_SETS = Object.freeze({
  member: COMMON_MEMBER,
  supervisor: COMMON_SUPERVISOR,
  head: COMMON_HEAD,
});

const DIVISION_PERMISSION_SETS = Object.freeze({
  operations: Object.freeze({
    member: Object.freeze([
      'it.dashboard.view', 'device.view', 'subscription.view',
    ]),
    supervisor: Object.freeze([
      'device.manage', 'device.assign', 'device.handover.manage',
      'device.log.manage', 'subscription.manage', 'subscription.renewal.request',
      'automation.view',
    ]),
    head: Object.freeze([
      'software_vendor.manage', 'subscription.license.manage',
      'subscription.invoice.manage', 'subscription.renewal.decide',
      'subscription.payment.manage', 'automation.manage',
      'workflow_definition.view', 'workflow_definition.manage',
    ]),
  }),
  finance: Object.freeze({
    member: Object.freeze([
      'finance.view', 'finance.request', 'finance.manage',
      'finance.document_check',
    ]),
    supervisor: Object.freeze(['finance.approve', 'finance.process']),
    head: Object.freeze([]),
  }),
  procurement: Object.freeze({
    member: Object.freeze([
      'finance.view', 'finance.request',
      'warehouse.movement.view',
    ]),
    supervisor: Object.freeze([]),
    head: Object.freeze([]),
  }),
  sales: Object.freeze({
    member: Object.freeze([
      'sales.customer.view', 'sales.customer.manage',
      'sales.inquiry.view', 'sales.inquiry.manage',
      'sales.pipeline.view', 'sales.pipeline.manage',
      'sales.visit.view', 'sales.visit.create',
      'sales.sample.view', 'sales.sample.request',
      'sales.quotation.view', 'sales.quotation.manage',
      'sales.field_bot.use', 'workspace.customer.view',
    ]),
    supervisor: Object.freeze(['sales.sample.approve']),
    head: Object.freeze([]),
  }),
  people_culture: Object.freeze({
    member: Object.freeze(['hrga.view', 'hrga.request', 'hrga.manage']),
    supervisor: Object.freeze(['hrga.approve', 'hrga.complete']),
    head: Object.freeze(['hrga.checklist_template.manage']),
  }),
  management_office: Object.freeze({
    member: Object.freeze([
      'workspace.cross_division.view', 'timeline.view', 'brief.view',
      'decision_log.view',
    ]),
    supervisor: Object.freeze(['management_dashboard.view']),
    head: Object.freeze(['activity_log.view']),
  }),
  retail_commerce: Object.freeze({
    member: Object.freeze([
      'sales.customer.view', 'sales.customer.manage',
      'sales.pipeline.view', 'sales.pipeline.manage',
      'sales.quotation.view', 'sales.quotation.manage',
      'sales.sample.view', 'sales.sample.request',
      'warehouse.movement.view', 'workspace.customer.view',
    ]),
    supervisor: Object.freeze(['sales.sample.approve']),
    head: Object.freeze([]),
  }),
  warehouse: Object.freeze({
    member: Object.freeze([
      'warehouse.movement.view', 'warehouse.movement.create',
      'warehouse.movement.update', 'warehouse.movement.submit',
      'warehouse.inbound.manage', 'warehouse.outbound.manage',
      'warehouse.sample.view', 'warehouse.sample.manage',
      'warehouse.checklist.view', 'warehouse.checklist.manage',
      'warehouse.delivery_proof.upload',
      'warehouse.incident.view', 'warehouse.incident.manage',
    ]),
    supervisor: Object.freeze([
      'warehouse.movement.approve', 'warehouse.movement.audit.view',
    ]),
    head: Object.freeze(['warehouse.movement.cancel']),
  }),
  marketing: Object.freeze({
    member: Object.freeze(['sales.customer.view', 'workspace.customer.view']),
    supervisor: Object.freeze(['template.manage']),
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

module.exports = {
  DIVISIONS,
  ROLE_LEVELS,
  COMMON_PERMISSION_SETS,
  DIVISION_PERMISSION_SETS,
  STANDARD_ROLES,
  permissionsForStandardRole,
};
