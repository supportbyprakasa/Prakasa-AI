const { ok, fail } = require('../utils/response');
const drive = require('../services/googleDrive.service');
const svc = require('../services/hrgaWorkflow.service');

// People & Culture → Onboarding & offboarding (wave 2, row 2.1). Thin: every
// rule lives in services/hrgaWorkflow.service.js, which always binds the
// signed-in user's entity and runs each write in one transaction.

function handle(res, next, e) {
  if (e && e.status && e.code) return fail(res, e.code, e.message, e.status, e.details);
  return next(e);
}

const run = (fn, status = 200) => async (req, res, next) => {
  try {
    const out = await fn(req);
    return ok(res, out, undefined, status);
  } catch (e) { return handle(res, next, e); }
};

const inTx = (fn, status = 200) => run((req) => svc.transact((tx) => fn(tx, req)), status);

// ------------------------------------------------------------------ reading

async function list(req, res, next) {
  try {
    const out = await svc.list(req.user, req.query || {});
    return ok(res, out.rows, out.meta);
  } catch (e) { return handle(res, next, e); }
}

const detail = run((req) => svc.detail(req.user, req.params.id));
const checklistPreview = run((req) => svc.checklistPreview(req.user, req.params.id));
const lookups = run((req) => svc.lookups(req.user));
const holdings = run((req) => svc.holdingsForKey(req.user, req.query.personKey));
const taskOptions = run((req) => svc.taskOptions(req.user, req.params.id, req.params.taskId));

// ------------------------------------------------------------------ writes

const create = inTx((tx, req) => svc.create(tx, req.user, req.body), 201);
const update = inTx((tx, req) => svc.updateDraft(tx, req.user, req.params.id, req.body));
const remove = inTx((tx, req) => svc.removeDraft(tx, req.user, req.params.id));
const submitForApproval = inTx((tx, req) => svc.submit(tx, req.user, req.params.id));
const withdraw = inTx((tx, req) => svc.withdraw(tx, req.user, req.params.id, req.body.note));
const cancel = inTx((tx, req) => svc.cancel(tx, req.user, req.params.id, req.body.reason));

const updateTask = inTx((tx, req) => svc.updateTask(tx, req.user, req.params.id, req.params.taskId, req.body));
const assignTask = inTx((tx, req) => svc.assignTask(tx, req.user, req.params.id, req.params.taskId, req.body.responsibleUserId ?? null));
const deviceHandover = inTx((tx, req) => svc.deviceHandover(tx, req.user, req.params.id, req.params.taskId, req.body));
const deviceReturn = inTx((tx, req) => svc.deviceReturn(tx, req.user, req.params.id, req.params.taskId, req.body));
const licenseAssign = inTx((tx, req) => svc.licenseAssign(tx, req.user, req.params.id, req.params.taskId, req.body));
const licenseRevoke = inTx((tx, req) => svc.licenseRevoke(tx, req.user, req.params.id, req.params.taskId));
const phoneLine = inTx((tx, req) => svc.phoneLine(tx, req.user, req.params.id, req.params.taskId, req.body));
const phoneLineReturn = inTx((tx, req) => svc.phoneLineReturn(tx, req.user, req.params.id, req.params.taskId));
const itTicket = inTx((tx, req) => svc.itTicket(tx, req.user, req.params.id, req.params.taskId, req.body), 201);
const holdingsSync = inTx((tx, req) => svc.holdingsSync(tx, req.user, req.params.id));
const linkKantorku = inTx((tx, req) => svc.setKantorku(tx, req.user, req.params.id, req.body));

// Decisions happen in the approval engine only (audit 0.2, S1), and the old
// free-form task link accepted ids of another entity (S5): both are gone.
function applyApprovalResult(req, res) {
  return fail(res, 'APPROVAL_VIA_ENGINE', 'Keputusan dilakukan di menu Approval', 410);
}
function linkTask(req, res) {
  return fail(res, 'GONE', 'Gunakan tombol aksi pada tugas (serahkan perangkat, terima kembali, lisensi, nomor)', 410);
}

/** Attachments: Shared Drive only (rule 1.0); hand-over notes or other, never KantorKu documents. */
async function uploadAttachment(req, res, next) {
  try {
    const { attachmentType = 'other', name } = req.body;
    if (!req.file) return fail(res, 'VALIDATION_ERROR', 'Pilih file yang diunggah', 400);
    // The workflow must exist in the user's entity before anything is uploaded.
    const wf = await svc.detail(req.user, req.params.id);
    if (wf.limited) return fail(res, 'NOT_FOUND', 'Onboarding/offboarding tidak ditemukan', 404);
    const parentId = String(process.env.GOOGLE_SHARED_DRIVE_ID || '').trim();
    if (!parentId) return fail(res, 'GOOGLE_DRIVE_NOT_CONFIGURED', 'Google Shared Drive belum dikonfigurasi. Isi GOOGLE_SHARED_DRIVE_ID.', 503);
    const up = await drive.uploadFile({
      name: req.file.originalname, mimeType: req.file.mimetype, buffer: req.file.buffer, parentId,
    });
    const out = await svc.transact((tx) => svc.addAttachment(tx, req.user, req.params.id, {
      attachmentType,
      driveFileId: up.id,
      webViewLink: up.webViewLink,
      name: name || up.name || req.file.originalname,
      mimeType: up.mimeType || req.file.mimetype,
      size: Number(up.size || req.file.size),
    }));
    return ok(res, out, undefined, 201);
  } catch (e) { return handle(res, next, e); }
}

// ------------------------------------------------------------------ templates and PIC

async function listChecklistTemplates(req, res, next) {
  try {
    const out = await svc.listTemplates(req.user, req.query || {});
    return ok(res, out.rows, { builtIn: out.builtIn });
  } catch (e) { return handle(res, next, e); }
}

const createChecklistTemplate = inTx((tx, req) => svc.createTemplate(tx, req.user, req.body), 201);
const updateChecklistTemplate = inTx((tx, req) => svc.updateTemplate(tx, req.user, req.params.id, req.body));
const getPic = run((req) => svc.getPicSettings(req.user));
const putPic = inTx((tx, req) => svc.putPicSettings(tx, req.user, req.body));

module.exports = {
  list, detail, checklistPreview, lookups, holdings, taskOptions,
  create, update, remove, submitForApproval, withdraw, cancel, applyApprovalResult,
  updateTask, assignTask, linkTask, deviceHandover, deviceReturn, licenseAssign, licenseRevoke,
  phoneLine, phoneLineReturn, itTicket, holdingsSync, linkKantorku, uploadAttachment,
  listChecklistTemplates, createChecklistTemplate, updateChecklistTemplate, getPic, putPic,
};
