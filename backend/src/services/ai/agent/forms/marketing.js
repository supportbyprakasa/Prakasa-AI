// Marketing forms Prakasa AI may fill (contract: ../formCatalog.js; how to add
// one: docs/prakasa-ai-rencana.md §9.9). Target products are Accurate items,
// chosen through the form's own search. Anggaran (rupiah) and status are the
// user's; closing a campaign is a decision and is not registered.
const FILE = 'pages/marketing/MarketingCampaigns.jsx';
const AI = ['name', 'objective', 'startOn', 'endOn', 'allChannels', 'channels', 'items', 'items.itemNo', 'notes'];
const NOTE = 'Anggaran dan status diisi pengguna. Produk target dipilih lewat pencarian produk di halaman (nama dan kode dari sistem pembukuan, jangan dikarang): bila hasilnya tidak tepat satu, '
  + 'tanyakan ke pengguna; daftar kosong berarti semua produk. Produk yang sudah dipilih pengguna tidak diubah.';

module.exports = [
  {
    id: 'marketing-campaign', title: 'Kampanye', route: '/marketing/campaigns?baru=1', permission: 'marketing.campaign.manage',
    file: FILE,
    fields: { ai: AI, userOnly: ['budget', 'status'] },
    note: NOTE,
  },
  {
    id: 'marketing-campaign-edit', title: 'Ubah kampanye', route: '/marketing/campaigns?ubah=<id kampanye>', permission: 'marketing.campaign.manage',
    file: FILE, mode: 'edit', record: 'marketing_campaign',
    fields: { ai: AI, userOnly: ['budget', 'status'] },
    note: `${NOTE} Kampanye yang sudah selesai atau dibatalkan: hanya catatan hasil yang bisa diubah. Menutup kampanye diputuskan pengguna.`,
  },
];
