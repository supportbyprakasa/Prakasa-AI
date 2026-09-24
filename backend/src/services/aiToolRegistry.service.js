// Central description of every application tool that Prakasa AI can assist with.
// A coverage test fails when a permission-visible frontend route has no descriptor here.

const RISK_TIERS = Object.freeze(['read', 'draft', 'confirmed_write', 'controlled_decision', 'system_administration']);
const CONFIRMATION = Object.freeze({
  read: 'none',
  draft: 'user_saves',
  confirmed_write: 'explicit_confirmation',
  controlled_decision: 'human_decides',
  system_administration: 'super_admin_confirms',
});
const ROLE_LEVELS = Object.freeze(['member', 'supervisor', 'head', 'admin']);

const COMMON_QUERY_KEYS = Object.freeze(['tab', 'status', 'q', 'search', 'from', 'to', 'page', 'view', 'type']);

function action(key, label, riskTier, { executor = null, permission = null, auditEvent = null } = {}) {
  return Object.freeze({
    key,
    label,
    riskTier,
    confirmationTier: CONFIRMATION[riskTier],
    executor: riskTier === 'controlled_decision' ? null : executor,
    permission,
    auditEvent: auditEvent || `ai_tool.${key}`,
  });
}

const EXPLAIN = action('explain', 'Jelaskan halaman atau record', 'read');
const SUMMARIZE = action('summarize', 'Ringkas data yang terlihat', 'read');
const FIND_GAPS = action('find_gaps', 'Cari data kosong atau tidak konsisten', 'read');
const DRAFT_NEXT = action('draft_next_step', 'Siapkan draft langkah berikutnya', 'draft');
const BASE_ACTIONS = [EXPLAIN, SUMMARIZE, FIND_GAPS, DRAFT_NEXT];

// Existing AI Command Center executors (confirmed through the action proposal flow).
const PROPOSE_TASK = action('propose_create_task', 'Usulkan task baru', 'confirmed_write', { executor: 'ai_command.create_task', permission: 'task.create' });
const PROPOSE_TASK_UPDATE = action('propose_update_task', 'Usulkan perubahan task', 'confirmed_write', { executor: 'ai_command.update_task', permission: 'task.update' });
const PROPOSE_DOCUMENT = action('propose_create_document', 'Usulkan dokumen baru', 'confirmed_write', { executor: 'ai_command.create_document', permission: 'document.create' });
const PROPOSE_EVENT = action('propose_calendar_event', 'Usulkan jadwal meeting', 'confirmed_write', { executor: 'ai_command.create_calendar_event', permission: 'meeting.create' });
const PROPOSE_APPROVAL = action('propose_approval_request', 'Usulkan pengajuan approval', 'confirmed_write', { executor: 'ai_command.create_approval', permission: 'approval.request' });
const PROPOSE_NOTIFICATION = action('propose_notification', 'Usulkan notifikasi', 'confirmed_write', { executor: 'ai_command.send_notification', permission: 'notification.view' });
const RECOMMEND_DECISION = action('recommend_decision', 'Rekomendasikan keputusan (manusia yang memutuskan)', 'controlled_decision');
const ADMIN_CHANGE_PREVIEW = action('preview_admin_change', 'Siapkan pratinjau perubahan konfigurasi', 'system_administration');

function tool(key, title, patterns, readPermission, extras = {}) {
  const actions = [...BASE_ACTIONS, ...(extras.actions || [])];
  const riskTier = actions.reduce(
    (highest, entry) => (RISK_TIERS.indexOf(entry.riskTier) > RISK_TIERS.indexOf(highest) ? entry.riskTier : highest),
    'read',
  );
  return Object.freeze({
    key,
    title,
    patterns: Object.freeze(patterns),
    readPermission,
    subjects: Object.freeze(extras.subjects || []),
    queryKeys: Object.freeze(extras.queryKeys || COMMON_QUERY_KEYS),
    starters: Object.freeze(extras.starters || {}),
    actions: Object.freeze(actions),
    riskTier,
    admin: Boolean(extras.admin),
    publishesState: extras.publishesState !== false,
  });
}

const admin = (key, title, patterns, permission, extras = {}) => tool(key, title, patterns, permission, {
  ...extras,
  admin: true,
  actions: [ADMIN_CHANGE_PREVIEW, ...(extras.actions || [])],
});

const TOOLS = Object.freeze([
  tool('dashboard', 'Beranda', ['/', '/hub/:slug'], null, {
    starters: { member: ['Apa yang perlu saya kerjakan hari ini?'], supervisor: ['Ringkas antrean tim saya'], head: ['Apa risiko utama divisi minggu ini?'] },
  }),
  tool('search', 'Pencarian', ['/search'], 'search.global'),
  tool('notifications', 'Notifikasi', ['/notifications'], 'notification.view', { actions: [PROPOSE_NOTIFICATION] }),
  tool('ai-command', 'AI Command Center', ['/ai-command'], 'ai_command.session.view', { publishesState: false }),
  tool('documents', 'Dokumen', ['/documents'], 'document.view', {
    actions: [PROPOSE_DOCUMENT],
    starters: { member: ['Bantu saya menyusun draft dokumen'], supervisor: ['Dokumen mana yang perlu direview?'], head: ['Standar dokumen apa yang perlu diperbarui?'] },
  }),
  tool('templates', 'Template', ['/templates'], 'template.view', { actions: [PROPOSE_DOCUMENT] }),
  tool('tasks', 'Tasks', ['/tasks', '/tasks/:id'], 'task.view', {
    subjects: [{ pattern: '/tasks/:id', type: 'task', params: ['id'] }],
    actions: [PROPOSE_TASK, PROPOSE_TASK_UPDATE],
    starters: { member: ['Pecah pekerjaan ini menjadi task'], supervisor: ['Task mana yang terlambat atau macet?'], head: ['Tren penyelesaian task divisi'] },
  }),
  tool('chat', 'Chat', ['/chat'], 'chat.view', { actions: [PROPOSE_TASK] }),
  tool('approvals', 'Approvals', ['/approvals', '/approvals/:id'], 'approval.view', {
    subjects: [{ pattern: '/approvals/:id', type: 'approval_request', params: ['id'] }],
    actions: [PROPOSE_APPROVAL, RECOMMEND_DECISION],
    starters: { member: ['Apa yang perlu saya lengkapi agar approval cepat disetujui?'], supervisor: ['Rangkum approval yang menunggu keputusan saya'], head: ['Approval mana yang sering terlambat?'] },
  }),
  tool('approval-delegations', 'Delegasi Approval', ['/admin/approval-delegations'], 'approval_delegation.view'),
  tool('signatures', 'Tanda tangan', ['/signatures', '/signatures/:id'], 'signature.view', { actions: [RECOMMEND_DECISION] }),
  tool('signature-asset', 'Tanda tangan saya', ['/signatures/asset'], 'signature.manage_asset', { publishesState: false }),
  tool('meetings', 'Meetings', ['/meetings', '/meetings/:id'], 'meeting.view', { actions: [PROPOSE_EVENT, PROPOSE_TASK] }),
  tool('forms', 'Formulir', ['/forms', '/forms/:slug'], 'form.view'),
  tool('form-submissions', 'Submission formulir', ['/forms/submissions', '/forms/submissions/:id'], 'form_submission.view'),
  tool('sales-pipeline', 'Sales Pipeline', ['/sales/pipeline'], 'sales.pipeline.view', {
    starters: { member: ['Siapkan follow-up untuk deal saya'], supervisor: ['Deal mana yang berisiko macet?'], head: ['Tren konversi pipeline bulan ini'] },
  }),
  tool('sales-customers', 'Customers', ['/sales/customers', '/sales/customers/:id'], 'sales.customer.view'),
  tool('sales-samples', 'Sample Requests', ['/sales/sample-requests'], 'sales.sample.view', { actions: [RECOMMEND_DECISION] }),
  tool('field-sales', 'Field Sales Bot', ['/sales/field-bot'], 'sales.field_bot.use'),
  tool('warehouse', 'Warehouse', ['/warehouse', '/warehouse/movements/:type/new', '/warehouse/movements/:type/:id', '/warehouse/movements/:type/:id/edit'], ['warehouse.movement.view', 'warehouse.sample.view'], {
    subjects: [
      { pattern: '/warehouse/movements/:type/:id', type: 'warehouse_movement', params: ['type', 'id'] },
      { pattern: '/warehouse/movements/:type/:id/edit', type: 'warehouse_movement', params: ['type', 'id'] },
    ],
    queryKeys: ['tab', 'status', 'q', 'from', 'to', 'page', 'version'],
    actions: [
      action('extract_movement_lines', 'Ekstrak baris barang dari dokumen sumber', 'draft', { permission: 'warehouse.movement.create' }),
      action('compare_movement_source', 'Bandingkan barang dengan dokumen sumber', 'read', { permission: 'warehouse.movement.view' }),
      action('recommend_movement_decision', 'Rekomendasikan setujui, revisi, atau tolak', 'controlled_decision', { permission: 'warehouse.movement.approve' }),
    ],
    starters: {
      member: ['Ekstrak baris barang dari packing list atau invoice', 'Periksa apakah draft ini sudah lengkap sebelum diajukan'],
      supervisor: ['Ringkas pergerakan yang menunggu review saya', 'Cari selisih jumlah, satuan, batch, atau kedaluwarsa'],
      head: ['Pergerakan mana yang sering direvisi atau dibatalkan?', 'Rangkum riwayat barang keluar bulan ini'],
    },
  }),
  tool('it-dashboard', 'IT Dashboard', ['/it/dashboard'], 'it.dashboard.view'),
  tool('devices', 'Devices', ['/it/devices', '/it/devices/:id'], 'device.view'),
  tool('subscriptions', 'Software Subscriptions', ['/it/subscriptions', '/it/subscriptions/:id'], 'subscription.view', { actions: [RECOMMEND_DECISION] }),
  tool('finance', 'Payment Requests', ['/finance/payment-requests', '/finance/payment-requests/:id'], 'finance.view', {
    actions: [PROPOSE_APPROVAL, RECOMMEND_DECISION],
    starters: { member: ['Cek kelengkapan dokumen permintaan pembayaran'], supervisor: ['Permintaan mana yang perlu diproses dulu?'], head: ['Pengecualian pembayaran bulan ini'] },
  }),
  tool('hr-onboarding', 'Onboarding', ['/hrga/onboarding'], 'hrga.view', { actions: [PROPOSE_TASK] }),
  tool('hr-offboarding', 'Offboarding', ['/hrga/offboarding'], 'hrga.view', { actions: [PROPOSE_TASK] }),
  tool('hr-workflows', 'Workflow HRGA', ['/hrga/workflows/:id'], 'hrga.view', { actions: [RECOMMEND_DECISION] }),
  tool('hr-checklists', 'Checklist Templates', ['/hrga/checklist-templates'], 'hrga.checklist_template.manage'),
  tool('workspaces', 'Workspaces', ['/workspaces'], 'workspace.customer.view'),
  tool('cross-workspaces', 'Kolaborasi lintas divisi', ['/workspaces-cross'], 'workspace.cross_division.view'),
  tool('knowledge-base', 'Knowledge Base', ['/kb'], 'kb.view', { actions: [PROPOSE_DOCUMENT] }),
  tool('automation', 'Automation', ['/automation'], 'automation.view'),
  tool('decision-log', 'Decision Log', ['/decision-log'], 'decision_log.view'),
  tool('management', 'Management Dashboard', ['/management'], 'management_dashboard.view', {
    starters: { head: ['Apa pengecualian lintas divisi yang perlu perhatian?'] },
  }),
  tool('brief', 'AI Brief', ['/brief'], 'brief.view'),
  tool('timeline', 'Timeline', ['/timeline'], 'timeline.view'),
  tool('data-classification', 'Data Classification', ['/data-classification'], 'data_classification.view'),
  admin('users', 'Users', ['/admin/users'], 'user.manage', { publishesState: false }),
  admin('entities', 'Entities', ['/admin/entities'], 'entity.manage'),
  admin('departments', 'Departments', ['/admin/departments'], 'department.manage'),
  admin('roles', 'Roles', ['/admin/roles'], 'role.manage'),
  admin('permissions', 'Permissions', ['/admin/permissions'], 'permission.manage'),
  admin('folder-rules', 'Folder Rules', ['/admin/folder-rules'], 'folder_rule.manage'),
  admin('form-builder', 'Form Builder', ['/admin/forms', '/admin/forms/new', '/admin/forms/:id'], 'form.manage'),
  admin('workflow-builder', 'Workflow Builder', ['/admin/workflows', '/admin/workflows/new', '/admin/workflows/:id'], 'workflow_definition.manage'),
  admin('document-types', 'Document Types', ['/admin/document-types'], 'document_type.manage'),
  admin('signature-rules', 'Signature Rules', ['/admin/signature-rules'], 'signature_rule.view'),
  admin('dashboard-layouts', 'Dashboard Layouts', ['/admin/dashboard-layouts'], 'dashboard_layout.manage'),
  admin('integration-logs', 'Integration Logs', ['/admin/integration-logs'], 'integration_log.view'),
  admin('approval-matrix', 'Approval Matrix', ['/admin/approval-matrix'], 'approval_matrix.view'),
  admin('signature-precheck', 'Signature Precheck', ['/admin/signature-precheck'], 'signature_precheck.view'),
  admin('ai-usage', 'AI Usage', ['/admin/ai-usage'], 'ai_command.usage.view'),
  admin('ai-provider-settings', 'AI Provider Settings', ['/admin/ai-provider-settings'], 'ai.provider.manage', { publishesState: false }),
  admin('activity-logs', 'Activity Logs', ['/activity-logs'], 'activity_log.view'),
]);

const TOOLS_BY_KEY = new Map(TOOLS.map((entry) => [entry.key, entry]));

function splitPath(pathname) {
  return String(pathname || '').split('?')[0].split('#')[0].split('/').filter(Boolean);
}

function matchPattern(pattern, segments) {
  const parts = splitPath(pattern);
  if (parts.length !== segments.length) return null;
  const params = {};
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index].startsWith(':')) {
      params[parts[index].slice(1)] = decodeURIComponent(segments[index]);
    } else if (parts[index] !== segments[index]) {
      return null;
    }
  }
  return params;
}

// Most specific pattern wins: more literal segments beat parameters.
function resolveTool(pathname) {
  const segments = splitPath(pathname);
  let best = null;
  for (const entry of TOOLS) {
    for (const pattern of entry.patterns) {
      const params = matchPattern(pattern, segments);
      if (!params) continue;
      const literals = splitPath(pattern).filter((part) => !part.startsWith(':')).length;
      if (!best || literals > best.literals) best = { tool: entry, pattern, params, literals };
    }
  }
  if (!best) return null;
  const subject = best.tool.subjects.find((entry) => entry.pattern === best.pattern) || null;
  return { tool: best.tool, pattern: best.pattern, params: best.params, subject };
}

const hasPerm = (user, code) => (user?.permissions || []).includes(code);

function canRead(user, entry) {
  if (!entry.readPermission) return true;
  const required = Array.isArray(entry.readPermission) ? entry.readPermission : [entry.readPermission];
  return required.some((code) => hasPerm(user, code));
}

function toolError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function assertToolAccess({ user, tool: entry, operation = 'read' }) {
  if (!entry) throw toolError('Alat tidak dikenal', 404, 'AI_TOOL_UNKNOWN');
  if (!canRead(user, entry)) throw toolError('Anda tidak memiliki akses ke alat ini', 403, 'FORBIDDEN');
  if (operation !== 'read') {
    const found = entry.actions.find((candidate) => candidate.key === operation);
    if (!found) throw toolError('Aksi AI tidak dikenal untuk alat ini', 404, 'AI_TOOL_ACTION_UNKNOWN');
    if (found.permission && !hasPerm(user, found.permission)) {
      throw toolError('Anda tidak memiliki izin untuk aksi ini', 403, 'FORBIDDEN');
    }
  }
  return true;
}

function startersFor(entry, level) {
  const own = entry.starters[level] || (level === 'admin' ? entry.starters.head : null) || [];
  const generic = [
    `Jelaskan halaman ${entry.title} dan apa yang bisa saya lakukan di sini`,
    'Ringkas data yang sedang terlihat',
    'Cari data yang kosong atau tidak konsisten',
  ];
  const byLevel = {
    member: 'Bantu saya menyiapkan draft untuk langkah berikutnya',
    supervisor: 'Apa yang perlu saya review atau tindak lanjuti?',
    head: 'Apa tren, risiko, atau pengecualian yang perlu saya perhatikan?',
    admin: entry.admin ? 'Jelaskan dampak perubahan konfigurasi di halaman ini' : 'Apa yang perlu saya periksa di sini?',
  };
  return [...own, ...generic, byLevel[level] || byLevel.member].slice(0, 6);
}

function toolDto(entry, user, level = 'member') {
  return {
    key: entry.key,
    title: entry.title,
    patterns: entry.patterns,
    riskTier: entry.riskTier,
    admin: entry.admin,
    queryKeys: entry.queryKeys,
    subjectTypes: [...new Set(entry.subjects.map((subject) => subject.type))],
    starters: startersFor(entry, level),
    actions: entry.actions
      .filter((candidate) => !candidate.permission || hasPerm(user, candidate.permission))
      .map((candidate) => ({
        key: candidate.key,
        label: candidate.label,
        riskTier: candidate.riskTier,
        confirmationTier: candidate.confirmationTier,
        executorAvailable: Boolean(candidate.executor),
      })),
  };
}

function listToolsForUser(user, level = 'member') {
  return TOOLS.filter((entry) => canRead(user, entry)).map((entry) => toolDto(entry, user, level));
}

module.exports = {
  RISK_TIERS,
  ROLE_LEVELS,
  TOOLS,
  TOOLS_BY_KEY,
  resolveTool,
  canRead,
  assertToolAccess,
  listToolsForUser,
  toolDto,
  startersFor,
  toolError,
};
