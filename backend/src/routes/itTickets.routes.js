const router = require('express').Router();
const { z } = require('zod');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/itTickets.controller');
const { CATEGORIES, PRIORITIES } = require('../services/itTicket.service');

const createBody = z.object({
  category: z.enum(CATEGORIES),
  title: z.string().min(1).max(190),
  description: z.string().min(1).max(4000),
  priority: z.enum(PRIORITIES).optional(),
  deviceId: z.number().int().positive().nullable().optional(),
  // The page the request was sent from ("Bantuan IT" in the top bar), for IT's context.
  sourcePage: z.string().trim().max(200).regex(/^\//).nullable().optional(),
});

const supportBody = z.object({
  email: z.string().trim().min(3).max(190),
  sendEmail: z.boolean(),
  trackerProjectId: z.number().int().positive().nullable().optional(),
}).strict();

const statusBody = z.object({
  status: z.enum(['open', 'in_progress', 'waiting_on_user', 'resolved', 'closed', 'cancelled']),
});

const commentBody = z.object({
  body: z.string().min(1).max(4000),
});

// IT support mailbox for new tickets (People & Culture Supervisor/Head).
router.get('/support-settings', requirePermission('it_ticket.manage'), ctrl.supportSettings);
router.put('/support-settings', requirePermission('it_ticket.manage'), validate(supportBody), ctrl.saveSupportSettings);
router.get('/my-devices', requirePermission('it_ticket.create'), ctrl.myDevices);
router.post('/', requirePermission('it_ticket.create'), validate(createBody), ctrl.create);
router.get('/', requirePermission('it_ticket.view'), ctrl.list);
router.get('/:id', requirePermission('it_ticket.view'), ctrl.detail);
router.patch('/:id/status', requirePermission('it_ticket.view'), validate(statusBody), ctrl.updateStatus);
router.post('/:id/comments', requirePermission('it_ticket.comment'), validate(commentBody), ctrl.addComment);
router.post('/:id/attachments', requirePermission('it_ticket.view'), upload.single('file'), ctrl.uploadAttachment);

module.exports = router;
