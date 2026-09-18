const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/meetings.controller');

const createBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  agenda: z.string().nullable().optional(),
  location: z.string().max(255).nullable().optional(),
  meetingType: z.enum(['internal', 'client', 'vendor', 'interview', 'other']).optional(),
  startTime: z.string(),
  endTime: z.string(),
  timezone: z.string().max(64).optional(),
  participants: z.array(z.object({
    userId: z.number().int().positive().optional(),
    email: z.string().email().optional(),
    name: z.string().max(150).optional(),
    role: z.enum(['organizer', 'required', 'optional', 'guest']).optional(),
  })).optional(),
  links: z.array(z.object({
    linkedType: z.enum(['task', 'project', 'customer', 'document', 'sales_pipeline', 'approval_request', 'other']),
    linkedId: z.number().int().positive(),
    notes: z.string().max(500).nullable().optional(),
  })).optional(),
  contextRecordId: z.number().int().positive().nullable().optional(),
  withMeet: z.boolean().optional(),
});

const updateBody = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  agenda: z.string().nullable().optional(),
  location: z.string().max(255).nullable().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  timezone: z.string().max(64).optional(),
  status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled', 'rescheduled']).optional(),
});

const attachBody = z.object({
  recordingLink: z.string().url().max(500).nullable().optional(),
  transcriptLink: z.string().url().max(500).nullable().optional(),
  recordingDriveFileId: z.string().max(190).nullable().optional(),
  transcriptDriveFileId: z.string().max(190).nullable().optional(),
});

const linkBody = z.object({
  linkedType: z.enum(['task', 'project', 'customer', 'document', 'sales_pipeline', 'approval_request', 'other']),
  linkedId: z.number().int().positive(),
  notes: z.string().max(500).nullable().optional(),
});

router.use(requireAuth);
router.get('/', requirePermission('meeting.view'), ctrl.list);
router.get('/:id', requirePermission('meeting.view'), ctrl.detail);
router.post('/', requirePermission('meeting.create'), validate(createBody), ctrl.create);
router.patch('/:id', requirePermission('meeting.update'), validate(updateBody), ctrl.update);
router.post('/:id/cancel', requirePermission('meeting.cancel'), ctrl.cancel);
router.post('/:id/recording', requirePermission('meeting.attach_recording'), validate(attachBody), ctrl.attachRecording);
router.post('/:id/links', requirePermission('meeting.update'), validate(linkBody), ctrl.link);
router.delete('/:id/links/:linkId', requirePermission('meeting.update'), ctrl.unlink);

module.exports = router;
