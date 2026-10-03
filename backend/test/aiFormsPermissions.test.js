// The form catalog is never WIDER than the save endpoint (docs/prakasa-ai-rencana.md §9.14).
//
// ENDPOINTS is the hand-reviewed map: for every form of the catalog, the
// endpoint its "Simpan" button calls and that endpoint's permission rule, read
// from the routes file, the router-wide gates (router.use) and the service.
// The test then holds three things together:
//   1. the map matches the code: the rule written here answers exactly as the
//      endpoint's real requirePermission middleware does, for every set of the
//      codes involved (the routers are loaded and their middleware is run);
//   2. the catalog (any of `permission`, and all of `requires`) never lets a
//      user fill a form whose endpoint would refuse them;
//   3. the catalog is the SAME rule as the endpoint, except the forms in
//      NARROWER, each with its reason.
// A rule is a list of clauses that must ALL hold; a clause is a list of codes
// of which ANY one is enough: [['a'], ['b', 'c']] = a AND (b OR c).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-agent';

const formCatalog = require('../src/services/ai/agent/formCatalog');
const clientTools = require('../src/services/ai/agent/clientTools');

const one = (code) => [[code]];
const INFRA = one('it.infra.manage');
const TRACKER = one('google.chat.use');
const CALENDAR = [['meeting.view'], ['meeting.create']];
const MYDRIVE = [['mydrive.view'], ['mydrive.manage']];
const e = (routes, method, path, rule, service = null) => ({ routes, method, path, rule, service });

const ENDPOINTS = {
  // ---- Kalender (router.use: meeting.view)
  'calendar-event': e('googleCalendar', 'post', '/events', CALENDAR),
  'calendar-event-edit': e('googleCalendar', 'patch', '/events/:eventId', CALENDAR),
  // ---- Dokumen
  'doc-template': e('docTemplates', 'post', '/', one('template.manage'), 'the service also limits a manager to their own division'),
  'doc-template-edit': e('docTemplates', 'patch', '/:id', one('template.manage'), 'own division, or company-wide for cross-division managers'),
  'doc-generate': e('docTemplates', 'post', '/:id/generate', [['template.view'], ['document.create']]),
  'doc-kop': e('docTemplates', 'put', '/kops/:scope', one('template.manage'), 'own division, or company-wide for cross-division managers'),
  'doc-division-file': e('divisionStorage', 'post', '/files', [['document.view'], ['document.create']], 'own division, or workspace.cross_division.view'),
  'mydrive-file': e('myDrive', 'post', '/files', MYDRIVE),
  'mydrive-folder': e('myDrive', 'post', '/folders', MYDRIVE),
  // ---- Finance
  'payment-request': e('finance', 'post', '/payment-requests', one('finance.request')),
  // ---- GA
  'ga-request-facility_repair': e('ga', 'post', '/requests', one('ga.request.create')),
  'ga-request-other': e('ga', 'post', '/requests', one('ga.request.create')),
  'ga-request-atk': e('ga', 'post', '/requests', one('ga.request.create')),
  'ga-booking-room': e('ga', 'post', '/bookings', one('ga.request.create')),
  'ga-resource': e('ga', 'post', '/resources', one('ga.resource.manage')),
  'ga-resource-edit': e('ga', 'patch', '/resources/:id', one('ga.resource.manage')),
  'ga-request-assign': e('ga', 'post', '/requests/:id/assign', one('ga.request.process')),
  'ga-ops-maintenance': e('ga', 'post', '/ops/maintenance', one('ga.ops.manage')),
  'ga-ops-maintenance-edit': e('ga', 'patch', '/ops/maintenance/:id', one('ga.ops.manage')),
  'ga-ops-contract': e('ga', 'post', '/ops/contracts', one('ga.ops.manage')),
  'ga-ops-contract-edit': e('ga', 'patch', '/ops/contracts/:id', one('ga.ops.manage')),
  'ga-ops-bill': e('ga', 'post', '/ops/bills', one('ga.ops.manage')),
  'ga-ops-bill-edit': e('ga', 'patch', '/ops/bills/:id', one('ga.ops.manage')),
  'ga-ops-maintenance-log': e('ga', 'post', '/ops/maintenance/:id/logs', [['ga.ops.view'], ['ga.ops.manage', 'ga.request.process']]),
  // ---- IT
  'it-ticket': e('itTickets', 'post', '/', one('it_ticket.create')),
  'it-help': e('itTickets', 'post', '/', one('it_ticket.create')),
  'it-ticket-comment': e('itTickets', 'post', '/:id/comments', one('it_ticket.comment'), 'the ticket must be one the user may see'),
  'it-device': e('it', 'post', '/devices', one('device.manage')),
  'it-device-edit': e('it', 'patch', '/devices/:id', one('device.manage')),
  'it-device-status': e('it', 'patch', '/devices/:id/status', one('device.manage')),
  'it-device-return': e('it', 'patch', '/assignments/:id/return', one('device.assign')),
  'it-device-maintenance': e('it', 'post', '/devices/:id/maintenance', one('device.log.manage')),
  'it-device-repair': e('it', 'post', '/devices/:id/repairs', one('device.log.manage')),
  'it-bast-device': e('it', 'post', '/assignments/:id/bast', [['device.handover.manage', 'ga.ops.manage']]),
  'it-location': e('it', 'post', '/locations', one('device.manage')),
  'it-location-edit': e('it', 'patch', '/locations/:id', one('device.manage')),
  'it-subscription': e('it', 'post', '/subscriptions', one('subscription.manage')),
  'it-subscription-invoice': e('it', 'post', '/subscriptions/:id/invoices', one('subscription.invoice.manage')),
  'it-license': e('it', 'post', '/subscriptions/:id/licenses', one('subscription.license.manage')),
  'it-infra-network': e('itInfrastructure', 'post', '/network-devices', INFRA),
  'it-infra-network-edit': e('itInfrastructure', 'patch', '/network-devices/:id', INFRA),
  'it-infra-isp': e('itInfrastructure', 'post', '/isp-links', INFRA),
  'it-infra-isp-edit': e('itInfrastructure', 'patch', '/isp-links/:id', INFRA),
  'it-infra-cctv': e('itInfrastructure', 'post', '/cctv', INFRA),
  'it-infra-cctv-edit': e('itInfrastructure', 'patch', '/cctv/:id', INFRA),
  'it-infra-backup': e('itInfrastructure', 'post', '/backups', INFRA),
  'it-infra-backup-edit': e('itInfrastructure', 'patch', '/backups/:id', INFRA),
  'it-infra-phone': e('itInfrastructure', 'post', '/phone-lines', INFRA),
  'it-infra-phone-edit': e('itInfrastructure', 'patch', '/phone-lines/:id', INFRA),
  'it-infra-vendor': e('it', 'post', '/vendors', [['software_vendor.manage', 'it.infra.manage']]),
  'it-infra-vendor-edit': e('it', 'patch', '/vendors/:id', [['software_vendor.manage', 'it.infra.manage']]),
  'it-cctv-status': e('itInfrastructure', 'post', '/cctv/:id/status', INFRA),
  'it-backup-check': e('itInfrastructure', 'post', '/backups/:id/checks', INFRA),
  'it-gws-review': e('itInfrastructure', 'post', '/gws-reviews', INFRA),
  'it-phone-holder': e('itInfrastructure', 'post', '/phone-lines/:id/holder', INFRA),
  'it-bast-phone': e('it', 'post', '/infrastructure/phone-lines/:id/bast', [['it.infra.manage', 'ga.ops.manage']]),
  // ---- Manajemen
  'management-escalation-followup': e('managementDashboard', 'patch', '/escalations/:source/:sourceId', [['management_dashboard.view', 'management_dashboard.division']], 'a division Head only for their own division'),
  'management-target': e('managementDashboard', 'put', '/targets', one('management_dashboard.view')),
  // ---- Marketing
  'marketing-campaign': e('marketing', 'post', '/campaigns', one('marketing.campaign.manage')),
  'marketing-campaign-edit': e('marketing', 'patch', '/campaigns/:id', one('marketing.campaign.manage')),
  // ---- People & Culture
  'hr-onboarding': e('hrga', 'post', '/workflows', one('hrga.request')),
  'hr-offboarding': e('hrga', 'post', '/workflows', one('hrga.request')),
  'hr-onboarding-edit': e('hrga', 'patch', '/workflows/:id', one('hrga.request'), 'the requester, or hrga.manage, while the request is still editable'),
  'hr-offboarding-edit': e('hrga', 'patch', '/workflows/:id', one('hrga.request'), 'the requester, or hrga.manage, while the request is still editable'),
  'hr-checklist-pic': e('people', 'put', '/settings/pic', one('hrga.checklist_template.manage')),
  'hr-checklist-template': e('hrga', 'post', '/checklist-templates', one('hrga.checklist_template.manage')),
  'hr-checklist-template-edit': e('hrga', 'patch', '/checklist-templates/:id', one('hrga.checklist_template.manage')),
  'hr-task-assign': e('hrga', 'patch', '/workflows/:id/tasks/:taskId/assign', one('hrga.manage')),
  // No permission code on the route: the service lets the task's responsible user, or hrga.manage.
  'hr-task-it-ticket': e('hrga', 'post', '/workflows/:id/tasks/:taskId/it-ticket', [], "the task's responsible user, or hrga.manage"),
  'hr-task-device-handover': e('hrga', 'post', '/workflows/:id/tasks/:taskId/device-handover', one('device.assign'), "the task's responsible user, or hrga.manage"),
  'hr-task-device-return': e('hrga', 'post', '/workflows/:id/tasks/:taskId/device-return', one('device.assign'), "the task's responsible user, or hrga.manage"),
  'hr-task-license': e('hrga', 'post', '/workflows/:id/tasks/:taskId/license-assign', one('subscription.license.manage'), "the task's responsible user, or hrga.manage"),
  'people-person': e('people', 'post', '/directory', one('people.directory.manage')),
  'people-person-edit': e('people', 'patch', '/directory/:key', one('people.directory.manage')),
  // ---- Project Tracker (router.use: google.chat.use; the service checks space membership)
  'tracker-issue': e('tracker', 'post', '/projects/:projectId/issues', TRACKER, 'member of the project space'),
  'tracker-issue-comment': e('tracker', 'post', '/issues/:issueId/comments', TRACKER, 'member of the project space'),
  'tracker-sprint': e('tracker', 'post', '/projects/:projectId/sprints', TRACKER, 'member of the project space'),
  'tracker-sprint-edit': e('tracker', 'patch', '/sprints/:sprintId', TRACKER, 'member of the project space'),
  'tracker-project-division': e('tracker', 'patch', '/projects/:projectId', TRACKER, 'member of the project space'),
  // ---- Sales
  'sales-lead': e('sales', 'post', '/leads', one('sales.customer.manage')),
  'sales-lead-edit': e('sales', 'patch', '/leads/:id', one('sales.customer.manage')),
  'sales-lead-link': e('sales', 'patch', '/leads/:id', one('sales.customer.manage')),
  'sales-visit': e('sales', 'post', '/leads/:id/visits', one('sales.customer.manage')),
  'sales-customer': e('sales', 'post', '/customers', one('sales.customer.manage')),
  'sales-customer-convert': e('sales', 'post', '/leads/:id/convert', one('sales.customer.manage')),
  'sales-customer-edit': e('sales', 'patch', '/customers/:id', one('sales.customer.manage')),
  'sales-order': e('sales', 'post', '/orders', one('sales.order.manage')),
  'sales-order-edit': e('sales', 'patch', '/orders/:id', one('sales.order.manage')),
  'sales-order-delivery': e('sales', 'post', '/orders/:id/delivery', one('sales.order.manage')),
  'sales-order-invoice': e('sales', 'post', '/orders/:id/invoice', one('sales.order.manage')),
  'sales-product': e('sales', 'post', '/products', one('sales.master.manage')),
  'sales-product-edit': e('sales', 'patch', '/products/:id', one('sales.master.manage')),
  'sales-document-settings': e('sales', 'put', '/document-settings', one('sales.master.manage')),
  'sales-exchange': e('sales', 'post', '/invoice-exchanges', one('sales.order.manage')),
  'sales-exchange-edit': e('sales', 'patch', '/invoice-exchanges/:id', one('sales.order.manage')),
  // ---- Tugas
  task: e('tasks', 'post', '/', one('task.create')),
  'task-board': e('boards', 'post', '/', one('board.manage')),
  'task-edit': e('tasks', 'patch', '/:id', one('task.update'), 'a task the user may see (taskAccess)'),
  'task-comment': e('tasks', 'post', '/:id/comments', one('task.update'), 'a task the user may see (taskAccess)'),
  'task-checklist-item': e('tasks', 'post', '/:id/checklist', one('task.checklist.manage'), 'a task the user may see (taskAccess)'),
  'task-dependency': e('tasks', 'post', '/:id/dependencies', one('task.dependency.manage'), 'a task the user may see (taskAccess)'),
  // ---- Warehouse
  'warehouse-movement-inbound': e('warehouse', 'post', '/movements', one('warehouse.movement.create')),
  'warehouse-movement-outbound': e('warehouse', 'post', '/movements', one('warehouse.movement.create')),
  'warehouse-movement-inbound-edit': e('warehouse', 'patch', '/movements/:type/:id', one('warehouse.movement.update')),
  'warehouse-movement-outbound-edit': e('warehouse', 'patch', '/movements/:type/:id', one('warehouse.movement.update')),
  'warehouse-checklist': e('warehouse', 'post', '/checklists', one('warehouse.checklist.manage')),
  'warehouse-incident': e('warehouse', 'post', '/incidents', one('warehouse.incident.manage')),
};

// Forms whose catalog rule is deliberately NARROWER than the endpoint.
const NARROWER = {
  'hr-task-it-ticket': 'the endpoint has no permission code (the service lets the responsible user or hrga.manage); a catalog entry must name one, and hrga.view is what the workflow page shows the task dialog to in full',
};

const ruleAllows = (rule, held) => rule.every((clause) => clause.some((code) => held.has(code)));
const catalogRule = (form) => [[...form.permissions], ...form.requires.map((code) => [code])];
const codesOf = (...rules) => [...new Set(rules.flat(2))].sort();
function subsets(codes) {
  const out = [];
  for (let mask = 0; mask < 2 ** codes.length; mask += 1) out.push(new Set(codes.filter((_, index) => mask & (2 ** index))));
  return out;
}
const show = (held) => `{${[...held].join(', ') || 'tanpa izin'}}`;

// The endpoint's own requirePermission middleware — the router-wide gates that
// come before the route, then the route's — run with a user holding `held`.
const routers = new Map();
function middlewareOf(entry) {
  if (!routers.has(entry.routes)) routers.set(entry.routes, require(`../src/routes/${entry.routes}.routes`)); // eslint-disable-line global-require, import/no-dynamic-require
  const router = routers.get(entry.routes);
  const at = router.stack.findIndex((layer) => layer.route?.path === entry.path && layer.route.methods[entry.method]);
  assert.ok(at >= 0, `${entry.routes}.routes has no ${entry.method.toUpperCase()} ${entry.path}`);
  const isGate = (layer) => layer.name === 'requirePermissionMiddleware';
  // A router-wide gate has no route and no path of its own (router.use(requirePermission(...))).
  const routerWide = router.stack.slice(0, at).filter((layer) => !layer.route && isGate(layer)).map((layer) => layer.handle);
  const own = router.stack[at].route.stack.filter(isGate).map((layer) => layer.handle);
  return [...routerWide, ...own];
}
function endpointAllows(gates, held) {
  const req = { user: { permissions: [...held] } };
  const res = { status() { return this; }, json() { return this; } };
  return gates.every((gate) => {
    let passed = false;
    gate(req, res, () => { passed = true; });
    return passed;
  });
}

test('every form of the catalog has a reviewed endpoint rule, and the map names no other form', () => {
  const ids = formCatalog.FORMS.map((form) => form.id).sort();
  assert.deepEqual(Object.keys(ENDPOINTS).sort(), ids);
  assert.equal(ids.length, 107);
  for (const id of Object.keys(NARROWER)) assert.ok(ENDPOINTS[id], id);
});

test('the reviewed map matches the code: each rule answers exactly as the endpoint\'s real middleware, for every set of the codes involved', () => {
  let checked = 0;
  for (const [id, entry] of Object.entries(ENDPOINTS)) {
    const gates = middlewareOf(entry);
    assert.equal(gates.length, entry.rule.length, `${id}: ${entry.method.toUpperCase()} ${entry.path} has ${gates.length} permission gate(s), the map lists ${entry.rule.length}`);
    // An unrelated permission never opens a gate.
    const codes = [...codesOf(entry.rule, catalogRule(formCatalog.byId.get(id))), 'tidak.terkait'];
    for (const held of subsets(codes)) {
      assert.equal(endpointAllows(gates, held), ruleAllows(entry.rule, held), `${id}: with ${show(held)} the endpoint and the map disagree`);
      checked += 1;
    }
  }
  assert.ok(checked > 400, `${checked} permission sets checked`);
});

test('the catalog is never wider than the endpoint: whoever may have a form filled may also save it', () => {
  for (const form of formCatalog.FORMS) {
    const entry = ENDPOINTS[form.id];
    const gates = middlewareOf(entry);
    for (const held of subsets(codesOf(entry.rule, catalogRule(form)))) {
      const user = { permissions: [...held] };
      if (!formCatalog.mayFill(user, form)) continue;
      assert.equal(endpointAllows(gates, held), true, `${form.id}: the catalog lets ${show(held)} fill it, but ${entry.method.toUpperCase()} ${entry.path} refuses them`);
    }
  }
});

test('the catalog states the SAME rule as the endpoint (alternatives and combinations), except the reviewed narrower forms', () => {
  const differs = [];
  for (const form of formCatalog.FORMS) {
    const entry = ENDPOINTS[form.id];
    const same = subsets(codesOf(entry.rule, catalogRule(form))).every((held) => formCatalog.mayFill({ permissions: [...held] }, form) === ruleAllows(entry.rule, held));
    if (!same) differs.push(form.id);
  }
  assert.deepEqual(differs.sort(), Object.keys(NARROWER).sort());
  for (const reason of Object.values(NARROWER)) assert.ok(reason.length > 40);
  // The combinations (AND) found by the audit.
  const requires = Object.fromEntries(formCatalog.FORMS.filter((form) => form.requires.length).map((form) => [form.id, [...form.requires]]));
  assert.deepEqual(requires, {
    'calendar-event': ['meeting.view'],
    'calendar-event-edit': ['meeting.view'],
    'doc-generate': ['template.view'],
    'doc-division-file': ['document.view'],
    'mydrive-file': ['mydrive.view'],
    'mydrive-folder': ['mydrive.view'],
    'ga-ops-maintenance-log': ['ga.ops.view'],
  });
  // The alternatives (any of).
  const anyOf = Object.fromEntries(formCatalog.FORMS.filter((form) => form.permissions.length > 1).map((form) => [form.id, [...form.permissions]]));
  assert.deepEqual(anyOf, {
    'ga-ops-maintenance-log': ['ga.ops.manage', 'ga.request.process'],
    'it-bast-device': ['device.handover.manage', 'ga.ops.manage'],
    'it-infra-vendor': ['it.infra.manage', 'software_vendor.manage'],
    'it-infra-vendor-edit': ['it.infra.manage', 'software_vendor.manage'],
    'it-bast-phone': ['it.infra.manage', 'ga.ops.manage'],
    'management-escalation-followup': ['management_dashboard.view', 'management_dashboard.division'],
  });
});

test('`requires` is enforced where the form is listed, read and filled — and a wrong entry stops the catalog', () => {
  const form = formCatalog.byId.get('ga-ops-maintenance-log');
  const may = (...permissions) => formCatalog.mayFill({ permissions }, form);
  assert.deepEqual([may('ga.ops.manage'), may('ga.request.process'), may('ga.ops.view'), may('ga.ops.view', 'ga.request.process'), may('ga.ops.view', 'ga.ops.manage')],
    [false, false, false, true, true]);
  const listed = (...permissions) => formCatalog.formsFor({ permissions }).map((item) => item.formulir);
  assert.equal(listed('document.create').includes('doc-generate'), false);
  assert.ok(listed('document.create', 'template.view').includes('doc-generate'));
  assert.equal(listed('meeting.create').includes('calendar-event'), false);
  assert.ok(listed('meeting.create', 'meeting.view').includes('calendar-event'));
  // The page says "meeting.create" and the user holds it, but not the endpoint's other code: refused.
  const raw = { id: 'calendar-event', judul: 'Buat event', izin: 'meeting.create', kolom: [{ nama: 'summary', label: 'Judul', tipe: 'text', bisa_diisi: true }] };
  const refused = clientTools.cleanForm(raw, { permissions: ['meeting.create'] });
  assert.deepEqual([refused.out.bisa_diisi, refused.out.alasan], [false, 'Pengguna tidak punya izin untuk formulir ini.']);
  assert.notEqual(clientTools.cleanForm(raw, { permissions: ['meeting.create', 'meeting.view'] }).out.bisa_diisi, false);
  // The contract.
  const base = { id: 'uji-form', title: 'Uji', route: '/uji?baru=1', permission: 'uji.manage', file: 'pages/uji/Uji.jsx', fields: { ai: ['title'], userOnly: [] }, note: 'Pengguna yang menyimpan.' };
  assert.deepEqual(formCatalog.validateForm({ ...base, requires: ['uji.view'] }), []);
  for (const wrong of ['uji.view', ['uji.view', 'uji.view'], ['Bukan Kode'], ['a.b', 'c.d', 'e.f', 'g.h'], ['uji.manage']]) {
    assert.match(formCatalog.validateForm({ ...base, requires: wrong }).join(' '), /requires/, JSON.stringify(wrong));
  }
});
