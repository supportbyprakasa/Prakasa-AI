// Pure display/logic helpers for IT Ticketing, mirroring backend/src/services/itTicket.service.js.
// The backend is the source of truth for what a transition is actually allowed to do;
// this only drives which options the UI offers so people aren't shown dead ends.

export const CATEGORY_LABELS = {
  device_damage: 'Kerusakan perangkat',
  new_device_request: 'Permintaan perangkat baru',
  access_software: 'Akses dan software',
  network: 'Jaringan dan konektivitas',
};

// Ticket wording for the shared statuses (the tone stays statusTone's).
export const STATUS_LABELS = {
  open: 'Terbuka',
  in_progress: 'Sedang dikerjakan',
  waiting_on_user: 'Menunggu respons pengaju',
  resolved: 'Selesai',
  closed: 'Ditutup',
  cancelled: 'Dibatalkan',
};

const TERMINAL_STATUSES = new Set(['closed', 'cancelled']);

const IT_TRANSITIONS = {
  open: ['in_progress', 'cancelled'],
  in_progress: ['waiting_on_user', 'resolved', 'cancelled'],
  waiting_on_user: ['in_progress', 'resolved', 'cancelled'],
  resolved: ['closed', 'in_progress'],
};
const REQUESTER_TRANSITIONS = { open: ['cancelled'] };

export function allowedNextStatuses(status, actor) {
  if (TERMINAL_STATUSES.has(status)) return [];
  return (actor === 'it' ? IT_TRANSITIONS : REQUESTER_TRANSITIONS)[status] || [];
}

// The button that moves a ticket to `to` (verb + object).
const TRANSITION_LABELS = {
  waiting_on_user: 'Tunggu respons pengaju',
  resolved: 'Tandai selesai',
  closed: 'Tutup tiket',
  cancelled: 'Batalkan tiket',
};
export function transitionLabel(from, to) {
  if (to === 'in_progress') return from === 'open' ? 'Mulai kerjakan' : 'Kerjakan lagi';
  return TRANSITION_LABELS[to] || STATUS_LABELS[to] || to;
}

// Decision actions in the detail header for IT staff (docs/ui-guideline.md
// §3.2): the step forward is the primary button, the other move a secondary
// one, and cancelling (destructive, confirmed) goes to the ⋮ menu.
const FORWARD_ORDER = ['resolved', 'closed', 'in_progress', 'waiting_on_user'];
export function ticketActions(status) {
  const next = allowedNextStatuses(status, 'it');
  const moves = next.filter((value) => value !== 'cancelled');
  const primary = FORWARD_ORDER.find((value) => moves.includes(value)) || null;
  return { primary, secondary: moves.filter((value) => value !== primary), canCancel: next.includes('cancelled') };
}
