// Calendar forms Prakasa AI may fill (contract: ../formCatalog.js; how to add
// one: docs/prakasa-ai-rencana.md §9.9). The event is saved to the user's own
// Google Calendar by the user; guests are never the AI's to add.
// Every /google-calendar route needs meeting.view first (router.use), then
// meeting.create to write: both, never one of them.
const REQUIRES = ['meeting.view'];
const FILE = 'pages/calendar/EventFormModal.jsx';
const AI = ['summary', 'location', 'description', 'allDay', 'startDate', 'startTime', 'endDate', 'endTime'];
const USER_ONLY = ['attendees', 'addMeet', 'notify'];

module.exports = [
  {
    id: 'calendar-event', title: 'Buat event', route: '/calendar?baru=1', permission: 'meeting.create', requires: REQUIRES,
    file: FILE,
    fields: { ai: AI, userOnly: USER_ONLY },
    note: 'Tamu, email undangan ke tamu, dan Google Meet diisi pengguna: menyimpan event dengan tamu mengirim undangan sungguhan. Jam memakai WIB dan hanya ada bila event bukan seharian. Isi tanggal dan jam selesai bersama tanggal dan jam mulai.',
  },
  {
    id: 'calendar-event-edit', title: 'Ubah event', route: '/calendar?ubah=<id event>', permission: 'meeting.create', requires: REQUIRES,
    file: FILE, mode: 'edit', record: 'calendar_event',
    fields: { ai: AI, userOnly: USER_ONLY },
    note: 'Id event: dari acara_kalender_saya (kolom rute), atau pengguna membuka event lalu menekan "Ubah event"; rute hanya membuka event di kalender utama pengguna yang boleh ia ubah. Tamu, pemberitahuan email ke tamu, dan Google Meet diisi pengguna: menyimpan perubahan bisa mengirim email sungguhan ke tamu.',
  },
];
