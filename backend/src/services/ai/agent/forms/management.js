// The follow-up is saved by PATCH /management/escalations/:source/:sourceId,
// which answers the entity-wide view OR a division Head (their own division):
// its permission is "any of". A target is entity-wide only.
// Management forms Prakasa AI may fill (contract: ../formCatalog.js; how to add
// one: docs/prakasa-ai-rencana.md §9.9). Both record a decision, so the AI
// writes only the note: the follow-up status and its owner, and the target
// number (often rupiah), stay with the user.
module.exports = [
  {
    id: 'management-escalation-followup', title: 'Tindak lanjut eskalasi', route: '/escalations?ubah=<sumber>-<id sumber>', permission: ['management_dashboard.view', 'management_dashboard.division'],
    file: 'pages/advanced/Escalations.jsx', mode: 'edit', record: 'escalation_followup',
    fields: { ai: ['note'], userOnly: ['status', 'ownerUserId'] },
    note: 'Hanya catatan yang diisi AI. Status tindak lanjut (termasuk menandai selesai) dan penanggung jawabnya diisi pengguna. '
      + 'Sumber dan id sumber: kolom "rute_tindak_lanjut" di data eskalasi terbuka. Head divisi hanya bisa membuka eskalasi divisinya sendiri.',
  },
  {
    id: 'management-target', title: 'Ubah target', route: '/targets?ubah=<id divisi>-<kunci metrik>', permission: 'management_dashboard.view',
    file: 'pages/advanced/Targets.jsx', mode: 'edit', record: 'division_target',
    fields: { ai: ['note'], userOnly: ['value'] },
    note: 'Hanya catatan yang diisi AI. Angka target adalah keputusan manajemen dan hanya diisi pengguna; menghapus target juga. '
      + 'Id divisi dan kunci metrik: kolom "rute_ubah" di data target dan realisasi.',
  },
];
