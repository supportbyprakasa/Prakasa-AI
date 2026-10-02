-- Permission descriptions in Indonesian (final UI audit, 1 Oct 2026: the
-- Peran/Izin pages showed mixed English such as "Lihat activity log", "CRUD
-- user"). Catalog text only: codes, grants and business data are untouched.
-- Idempotent.
SET NAMES utf8mb4;

UPDATE permissions SET description = 'Lihat log aktivitas' WHERE code = 'activity_log.view';
UPDATE permissions SET description = 'Lihat percakapan AI yang dibagikan ke entitas' WHERE code = 'ai_command.entity.view';
UPDATE permissions SET description = 'Audit baca-saja percakapan AI privat di entitas sendiri' WHERE code = 'ai_command.private_audit';
UPDATE permissions SET description = 'Kelola papan & kolom' WHERE code = 'board.manage';
UPDATE permissions SET description = 'Lihat papan tugas' WHERE code = 'board.view';
UPDATE permissions SET description = 'Kelola tata letak dashboard per peran' WHERE code = 'dashboard_layout.manage';
UPDATE permissions SET description = 'Kelola katalog widget dashboard' WHERE code = 'dashboard_widget.manage';
UPDATE permissions SET description = 'Kelola catatan keputusan' WHERE code = 'decision_log.manage';
UPDATE permissions SET description = 'Lihat catatan keputusan' WHERE code = 'decision_log.view';
UPDATE permissions SET description = 'Serahkan/tarik perangkat ke/dari karyawan' WHERE code = 'device.assign';
UPDATE permissions SET description = 'Kelola catatan perawatan, perbaikan, dan garansi perangkat' WHERE code = 'device.log.manage';
UPDATE permissions SET description = 'Lihat dashboard divisi sendiri: angka utama, tren 12 bulan, grafik capaian bulanan, dan eskalasi divisi' WHERE code = 'division_dashboard.view';
UPDATE permissions SET description = 'Akses lintas entitas, khusus administrator global' WHERE code = 'entity.cross_access';
UPDATE permissions SET description = 'Tambah, ubah, dan hapus entitas' WHERE code = 'entity.manage';
UPDATE permissions SET description = 'Proses pengajuan Finance (di luar persetujuan)' WHERE code = 'finance.manage';
UPDATE permissions SET description = 'Proses alur onboarding/offboarding (di luar persetujuan)' WHERE code = 'hrga.manage';
UPDATE permissions SET description = 'Buat alur onboarding/offboarding' WHERE code = 'hrga.request';
UPDATE permissions SET description = 'Lihat log integrasi' WHERE code = 'integration_log.view';
UPDATE permissions SET description = 'Lihat dashboard manajemen' WHERE code = 'management_dashboard.view';
UPDATE permissions SET description = 'Lihat insight Marketing: omzet per channel dan produk (agregat, DPP), pelanggan baru, leads per area, dan hasil kampanye' WHERE code = 'marketing.insight.view';
UPDATE permissions SET description = 'Konfirmasi butir tindak lanjut dari AI menjadi tugas' WHERE code = 'meeting.confirm_action';
UPDATE permissions SET description = 'Tambah, ubah, dan hapus peran' WHERE code = 'role.manage';
UPDATE permissions SET description = 'Kelola pelanggan sales' WHERE code = 'sales.customer.manage';
UPDATE permissions SET description = 'Lihat pelanggan sales' WHERE code = 'sales.customer.view';
UPDATE permissions SET description = 'Lihat log cek awal tanda tangan oleh AI' WHERE code = 'signature_precheck.view';
UPDATE permissions SET description = 'Kelola aturan tanda tangan' WHERE code = 'signature_rule.manage';
UPDATE permissions SET description = 'Lihat aturan tanda tangan' WHERE code = 'signature_rule.view';
UPDATE permissions SET description = 'Ajukan permintaan tanda tangan' WHERE code = 'signature.request';
UPDATE permissions SET description = 'Lihat permintaan tanda tangan' WHERE code = 'signature.view';
UPDATE permissions SET description = 'Lihat riwayat aktivitas tugas' WHERE code = 'task.activity.view';
UPDATE permissions SET description = 'Kelola checklist tugas' WHERE code = 'task.checklist.manage';
UPDATE permissions SET description = 'Buat tugas' WHERE code = 'task.create';
UPDATE permissions SET description = 'Hapus tugas' WHERE code = 'task.delete';
UPDATE permissions SET description = 'Kelola ketergantungan antartugas' WHERE code = 'task.dependency.manage';
UPDATE permissions SET description = 'Ubah tugas' WHERE code = 'task.update';
UPDATE permissions SET description = 'Lihat tugas' WHERE code = 'task.view';
UPDATE permissions SET description = 'Pantau tugas (ikuti/berhenti mengikuti sendiri)' WHERE code = 'task.watch';
UPDATE permissions SET description = 'Kelola pemantau tugas (tambah/hapus orang lain)' WHERE code = 'task.watch.manage';
UPDATE permissions SET description = 'Tambah, ubah, dan hapus pengguna' WHERE code = 'user.manage';
UPDATE permissions SET description = 'Lihat data lintas divisi (Management Office dan Super Admin)' WHERE code = 'workspace.cross_division.view';
UPDATE permissions SET description = 'Lihat ruang kerja pelanggan' WHERE code = 'workspace.customer.view';
UPDATE permissions SET description = 'Lihat ruang kerja Management Office' WHERE code = 'workspace.management_office.view';
UPDATE permissions SET description = 'Lihat ruang kerja Marketing' WHERE code = 'workspace.marketing.view';
UPDATE permissions SET description = 'Lihat ruang kerja Operations (sudah tidak dipakai; GA di People & Culture)' WHERE code = 'workspace.operations.view';
UPDATE permissions SET description = 'Lihat ruang kerja Procurement' WHERE code = 'workspace.procurement.view';
UPDATE permissions SET description = 'Lihat ruang kerja Retail Commerce' WHERE code = 'workspace.retail_commerce.view';
