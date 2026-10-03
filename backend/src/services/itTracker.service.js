const pool = require('../db/pool');
const M = require('./trackerModel');

// IT tickets ↔ Project Tracker ↔ Google Chat Space (owner, 1 Oct 2026).
// - A new ticket becomes an issue in the IT project chosen in Tiket IT →
//   Pengaturan tiket, and is announced in that project's Space (posted as the
//   IT manager who chose the project: the requester is usually not a member).
// - Ticket status moves the issue: open → "to do", in progress / waiting →
//   "in progress", resolved / closed / cancelled → "done".
// - Moving the issue in the tracker moves the ticket: "in progress" →
//   Sedang dikerjakan, "done" → Selesai. Each side is a no-op when the other is
//   already there, so the two never loop. Only an IT ticket manager of the same
//   company may move a linked issue, and only along the ticket's lifecycle.
// Every step is best effort: a Chat or tracker problem never loses a ticket.

const CATEGORY_FOR_STATUS = Object.freeze({
  open: 'todo', in_progress: 'in_progress', waiting_on_user: 'in_progress',
  resolved: 'done', closed: 'done', cancelled: 'done',
});
const PRIORITY_LABELS = Object.freeze({ low: 'Rendah', normal: 'Normal', high: 'Tinggi', urgent: 'Mendesak' });
const TRACKER_PRIORITY = Object.freeze({ low: 'low', normal: 'normal', high: 'high', urgent: 'urgent' });

const tracker = () => require('./tracker.service');
const support = () => require('./itSupport.service');
const tickets = () => require('./itTicket.service');

function ticketLink(id) {
  const base = String(process.env.APP_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  return `${base}/it/tickets/${id}`;
}

async function trackerBoard(entityId) {
  const settings = await support().getSettings(entityId);
  if (!settings.trackerProjectId) return { settings, board: null };
  const board = await tracker().loadProject(settings.trackerProjectId);
  if (!board || Number(board.entity_id) !== Number(entityId)) return { settings, board: null };
  return { settings, board };
}

async function linkNewTicket({ ticketId, entityId, title, description, priority, requesterId, sourcePage }) {
  const { settings, board } = await trackerBoard(entityId);
  if (!board) return null;
  const [[requester]] = await pool.query(
    `SELECT u.name, u.email, d.name AS departmentName
       FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ? LIMIT 1`,
    [requesterId],
  );
  const body = [
    description,
    '',
    `— Tiket IT #${ticketId} dari ${requester?.name || 'pengguna'}${requester?.departmentName ? ` (${requester.departmentName})` : ''}`,
    sourcePage ? `Halaman: ${sourcePage}` : null,
    `Tiket: ${ticketLink(ticketId)}`,
  ].filter((line) => line !== null).join('\n');
  const issue = await tracker().createSystemIssue(board, {
    title: `[Tiket IT #${ticketId}] ${title}`,
    description: body.slice(0, 5000),
    priority: TRACKER_PRIORITY[priority] || 'normal',
    reporterId: requesterId,
    labels: ['tiket-it'],
  });
  await pool.query('UPDATE it_tickets SET tracker_issue_id = ? WHERE id = ? AND tracker_issue_id IS NULL', [issue.id, ticketId]);

  // Announce in the Space, as the IT manager who linked the project.
  if (board.post_updates_to_space && settings.trackerPostAsUserId) {
    const [[poster]] = await pool.query("SELECT id, email, entity_id FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL LIMIT 1", [settings.trackerPostAsUserId]);
    if (poster?.email) {
      const text = [
        `🎫 Tiket IT #${ticketId} baru · ${issue.key}: ${title}`,
        `Dari ${requester?.name || 'pengguna'}${requester?.departmentName ? ` (${requester.departmentName})` : ''} · urgensi ${PRIORITY_LABELS[priority] || 'Normal'}`,
        ticketLink(ticketId),
      ].join('\n');
      await require('./trackerChat.service')
        .postUpdate({ sub: Number(poster.id), email: poster.email, entityId: Number(poster.entity_id) }, board.google_chat_space_name, text)
        .catch(() => false);
    }
  }
  return issue;
}

async function onTicketStatus(ticketId, nextStatus, actorId) {
  const [[row]] = await pool.query('SELECT tracker_issue_id FROM it_tickets WHERE id = ? LIMIT 1', [ticketId]);
  if (!row?.tracker_issue_id) return false;
  const category = CATEGORY_FOR_STATUS[nextStatus];
  if (!category) return false;
  return tracker().moveSystemIssue(Number(row.tracker_issue_id), category, actorId);
}

// Moving a linked issue is a ticket action: only an IT ticket manager
// (it_ticket.manage) of the ticket's own company may do it, and only along the
// ticket's own lifecycle. Space membership alone moves ordinary issues, never a
// ticket. Returns the steps the ticket takes, or the reason the move is refused.
function hasTicketManage(user) {
  return (user?.permissions || []).includes('it_ticket.manage');
}

function planIssueMove(ticketStatus, category) {
  if (category === 'in_progress') {
    if (['open', 'waiting_on_user', 'resolved'].includes(ticketStatus)) return { steps: ['in_progress'] };
    if (ticketStatus === 'in_progress') return { steps: [] };
    return { refuse: 'Tiket IT sudah ditutup atau dibatalkan dan tidak dapat dibuka lagi dari Project Tracker.' };
  }
  if (category === 'done') {
    if (ticketStatus === 'open') return { steps: ['in_progress', 'resolved'] };
    if (['in_progress', 'waiting_on_user'].includes(ticketStatus)) return { steps: ['resolved'] };
    return { steps: [] };
  }
  if (category === 'todo') {
    if (ticketStatus === 'open') return { steps: [] };
    return { refuse: 'Tiket IT yang sudah dikerjakan tidak dapat kembali ke Open. Ubah statusnya dari halaman tiket.' };
  }
  return { steps: [] };
}

async function linkedTicket(issueId) {
  const [[ticket]] = await pool.query('SELECT id, status, entity_id FROM it_tickets WHERE tracker_issue_id = ? LIMIT 1', [issueId]);
  return ticket || null;
}

function refused(ticket, message) {
  return Object.assign(new Error(`${message} (Tiket IT #${ticket.id}: /it/tickets/${ticket.id})`), {
    status: 403, code: 'IT_TICKET_LINKED', ticketId: Number(ticket.id),
  });
}

// Checked before the issue is moved: a move the ticket cannot follow is refused,
// so the board never shows "done" for a ticket that was not resolved.
async function assertIssueMove(issueId, category, user) {
  const ticket = await linkedTicket(issueId);
  if (!ticket) return null;
  if (Number(ticket.entity_id) !== Number(user.entityId) || !hasTicketManage(user)) {
    throw refused(ticket, 'Issue ini terhubung ke Tiket IT; statusnya hanya dapat dipindahkan oleh pengelola tiket IT.');
  }
  const plan = planIssueMove(ticket.status, category);
  if (plan.refuse) throw refused(ticket, plan.refuse);
  return ticket;
}

// After the issue moved: carry the move to the ticket, with the actor's own rights.
async function onIssueMoved(issueId, category, user) {
  const ticket = await linkedTicket(issueId);
  if (!ticket) return null;
  const result = { ticketId: Number(ticket.id), link: `/it/tickets/${ticket.id}`, from: ticket.status, status: ticket.status, synced: false };
  if (Number(ticket.entity_id) !== Number(user.entityId) || !hasTicketManage(user)) return { ...result, reason: 'not_allowed' };
  const plan = planIssueMove(ticket.status, category);
  if (plan.refuse) return { ...result, reason: 'invalid_transition' };
  const svc = tickets();
  for (const status of plan.steps) {
    await svc.updateStatus(ticket.id, { status, actorId: user.sub, canManage: true, entityId: user.entityId, fromTracker: true });
    result.status = status;
  }
  return { ...result, synced: true };
}

async function trackerIssueOf(issueId) {
  if (!issueId) return null;
  const [[row]] = await pool.query(
    `SELECT t.id, t.issue_number, b.project_key, b.name AS project_name, b.google_chat_space_name
       FROM tasks t JOIN boards b ON b.id = t.board_id
      WHERE t.id = ? AND t.deleted_at IS NULL LIMIT 1`,
    [issueId],
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    key: M.issueKey(row.project_key, row.issue_number),
    projectName: row.project_name,
    link: `/projects/${M.spaceIdOf(row.google_chat_space_name)}?issue=${row.id}`,
  };
}

module.exports = { CATEGORY_FOR_STATUS, linkNewTicket, onTicketStatus, planIssueMove, assertIssueMove, onIssueMoved, trackerIssueOf };

