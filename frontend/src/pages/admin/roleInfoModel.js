// What each role does, for the ⓘ beside a role in Pengguna → Organisasi dan
// role. Standard roles are named <division>.<member|supervisor|head>; the two
// global roles have their own text; anything else is a custom role whose
// meaning is its permission list (page Peran).

const DIVISION_WORK = {
  sales: 'pipeline, pelanggan, leads, dan Data Sales dari Accurate',
  warehouse: 'barang masuk dan keluar, stok, dan pencocokan dengan Accurate',
  procurement: 'PO, barang datang, dan pemasok dari Accurate',
  people_culture: 'onboarding, offboarding, Layanan GA, Tiket IT, dan aset IT',
  retail_commerce: 'pelanggan dan Data Sales kanal ritel, serta stok Warehouse',
  marketing: 'pelanggan dan leads (tanpa data order)',
  finance: 'alat kerja harian; modul Finance masih disiapkan',
};

// What a Supervisor approves or runs, per division (from the standard role
// permissions in backend/src/config/standardOrganization.js).
const SUPERVISOR_DUTY = {
  sales: 'menyetujui batch data Accurate Sales',
  warehouse: 'menyetujui pergerakan barang dan batch data Accurate Warehouse',
  procurement: 'menyetujui batch data Accurate Procurement',
  people_culture: 'memproses Tiket IT, mengelola onboarding/offboarding, dan mengatur Layanan GA',
  retail_commerce: 'menyetujui batch data Accurate Retail Commerce',
  marketing: 'menyetujui permintaan di divisinya',
  finance: 'menyetujui batch data Accurate Finance',
};

const levelText = (level, division) => ({
  member: 'Mengerjakan tugas harian dan mengajukan permintaan di divisinya.',
  supervisor: `Seperti Member, ditambah ${SUPERVISOR_DUTY[division]}.`,
  head: `Seperti Supervisor (${SUPERVISOR_DUTY[division]}), ditambah dashboard manajemen, eskalasi, dan target yang dibatasi ke divisinya.`,
}[level]);

const MANAGEMENT_OFFICE = {
  member: 'Melihat laporan Google Analytics. Tidak melihat data divisi.',
  supervisor: 'Memantau semua divisi: dashboard manajemen, eskalasi, target, peta program, alur & margin, stok, dan Google Analytics.',
  head: 'Seperti Supervisor, ditambah batch data Accurate dan log aktivitas (jejak audit seluruh aplikasi).',
};

const GLOBAL = {
  'system.super_admin': {
    summary: 'Akses penuh ke semua data semua divisi dan semua pengaturan sistem, termasuk kata sandi semua akun.',
    note: 'Berikan hanya kepada orang yang berhak melihat seluruh data perusahaan.',
  },
  'system.admin': {
    summary: 'Mengelola pengguna, peran, divisi, dan aturan tanpa bisa melihat data divisi mana pun.',
    note: 'Hanya bisa memberi peran Anggota. Tidak bisa mengatur atau mereset kata sandi, dan tidak bisa mengubah akses dirinya sendiri, akun Super Admin, Accurate, atau pengaturan AI. Tidak perlu divisi.',
  },
};

// role: { name, roleKey, roleLevel, departmentName } → { title, lines: [] }
export function roleInfo(role) {
  const title = role?.name || 'Peran';
  const key = String(role?.roleKey || '');
  if (GLOBAL[key]) return { title, lines: [GLOBAL[key].summary, GLOBAL[key].note] };
  const [division, level] = key.split('.');
  if (division === 'management_office' && MANAGEMENT_OFFICE[level]) {
    return { title, lines: [MANAGEMENT_OFFICE[level]] };
  }
  if (DIVISION_WORK[division] && levelText(level, division)) {
    const where = role?.departmentName || 'divisi ini';
    return { title, lines: [levelText(level, division), `Pekerjaan ${where}: ${DIVISION_WORK[division]}.`] };
  }
  return { title, lines: ['Peran khusus. Isinya mengikuti izin yang dipilih untuk peran ini di halaman Peran.'] };
}

// Administrator Sistem exists to keep someone out of division data; a division
// role next to it lets that data back in. Returns the warning, or ''.
export function roleMixWarning(selectedRoles = []) {
  const admin = selectedRoles.some((role) => role?.roleKey === 'system.admin');
  const divisionRoles = selectedRoles.filter((role) => role?.departmentId != null);
  if (!admin || !divisionRoles.length) return '';
  return `Administrator Sistem digabung dengan ${divisionRoles.map((role) => role.name).join(', ')}: pengguna ini tetap bisa melihat data divisi tersebut.`;
}
