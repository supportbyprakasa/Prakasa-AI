const router = require('express').Router();
const { invalidateOnWrite } = require('../middleware/cachedResponse');

// A successful write in a division module drops the cached answers built on
// it (utils/memo.js): its own pages and the management figures (dashboard
// KPIs, escalations, targets), which every module reports into.
// 'brief:' is the home page's morning briefing (services/morningBriefing.service.js):
// any module write can change what someone has to do today.
const MANAGEMENT = ['mgmt:', 'mgmtkpi:', 'esc:', 'brief:'];
const writes = (...own) => invalidateOnWrite(...own, ...MANAGEMENT);
router.use('/auth', require('./auth.routes'));
router.use('/entities', require('./entities.routes'));
router.use('/departments', require('./departments.routes'));
router.use('/users', require('./users.routes'));
router.use('/workspace-sync', require('./workspaceSync.routes'));
router.use('/roles', require('./roles.routes'));
router.use('/permissions', require('./permissions.routes'));
router.use('/activity-logs', require('./activityLogs.routes'));
router.use('/documents', invalidateOnWrite('brief:'), require('./documents.routes'));
router.use('/division-storage', require('./divisionStorage.routes'));
router.use('/my-drive', require('./myDrive.routes'));
router.use('/work-summary', require('./workSummary.routes'));
router.use('/google-mail', require('./googleMail.routes'));
router.use('/google-chat', require('./googleChat.routes'));
router.use('/google-docs', require('./googleDocs.routes'));
router.use('/google-calendar', require('./googleCalendar.routes'));
router.use('/google-groups', require('./googleGroups.routes'));
router.use('/google-analytics', require('./googleAnalytics.routes'));
router.use('/tracker', writes(), require('./tracker.routes'));
router.use('/realtime', require('./realtime.routes'));
router.use('/letterhead', require('./letterhead.routes'));
router.use('/document-templates', require('./documentTemplates.routes'));
router.use('/doc-templates', require('./docTemplates.routes'));
router.use('/retail-commerce', writes('retail:'), require('./retailCommerce.routes'));
router.use('/marketing', writes('marketing:'), require('./marketing.routes'));
router.use('/folder-mapping-rules', require('./folderMappingRules.routes'));
router.use('/ai', require('./ai.routes'));
router.use('/boards', writes(), require('./boards.routes'));
router.use('/tasks', writes(), require('./tasks.routes'));
router.use('/approvals', writes(), require('./approvals.routes'));
router.use('/signatures', invalidateOnWrite('brief:'), require('./signatures.routes')); // authenticated signature routes
router.use('/notifications', require('./notifications.routes'));
router.use('/sales', writes('sales:'), require('./sales.routes'));
router.use('/warehouse', writes('warehouse:'), require('./warehouse.routes'));
router.use('/procurement', writes(), require('./procurement.routes'));
router.use('/it', writes(), require('./it.routes'));
router.use('/finance/reports', writes('finance:'), require('./finance.reports.routes'));
router.use('/finance', writes('finance:'), require('./finance.routes'));
router.use('/hrga', writes(), require('./hrga.routes'));
router.use('/people', writes(), require('./people.routes'));
router.use('/ga', writes(), require('./ga.routes'));
router.use('/search', require('./search.routes'));
router.use('/management-dashboard', writes(), require('./managementDashboard.routes'));
router.use('/document-types', require('./documentTypes.routes'));
router.use('/signature-rules', require('./signatureRules.routes'));
router.use('/integration-logs', require('./integrationLogs.routes'));
router.use('/integrations/accurate', require('./accurateIntegration.routes'));
// Prakasa AI Wave D2: "Periksa dengan AI" on a Data Accurate batch. Not under
// /sales: a review reads only, so it must not drop the cached Sales figures.
router.use('/accurate', require('./accurateReview.routes'));
// Pengajuan ke Accurate (master data proposed from the app, migration 145).
router.use('/accurate-write', writes('sales:'), require('./accurateWrite.routes'));
router.use('/approval-matrix', require('./approvalMatrix.routes'));
router.use('/approval-delegations', require('./approvalDelegations.routes'));
router.use('/signature-precheck', require('./signaturePrecheck.routes'));
router.use('/signature-qr', require('./signatureQr.routes'));
router.use('/ai-command', require('./aiCommand.routes'));
router.use('/ai-agent', require('./aiAgent.routes'));
module.exports = router;
