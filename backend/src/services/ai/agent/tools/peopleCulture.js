// People & Culture: onboarding/offboarding, checklist templates and the
// directory (docs/program-people-culture.md). Read only, through the module's
// own services, so the page rules apply unchanged:
//   - a workflow is read in full by People & Culture (hrga.view) and in the
//     limited view by its requester, its manager, a checklist task owner and
//     management (hrgaWorkflow.service accessOf); anyone else gets "not found";
//   - "my tasks" are bound to the asking user (the home card's rows);
//   - the directory is always read as a plain viewer (canManage: false): work
//     contact only, never the resign list, exclusions or People & Culture notes.
// KantorKu is the company's HRIS: leave, attendance, payroll and personal data
// are NOT in this app and there is no integration — every tool says so instead
// of letting the model invent an answer.
const workflows = require('../../../hrgaWorkflow.service');
const directory = require('../../../peopleDirectory.service');
const { hasPerm, text, int } = require('./_shared');

const HRGA_VIEW = 'hrga.view';
// A manager or checklist task owner in another division has no hrga.view but
// opens /hrga/workflows/:id (the route has no permission; the service decides).
// Their tasks reach them as notifications and on the home page, so the tools
// that only ever return the asker's own tasks or a workflow the service lets
// them read are granted with notification.view as well.
const INVOLVED = Object.freeze([HRGA_VIEW, 'notification.view']);
const MAX_ROWS = 50;

const KANTORKU = 'Cuti, absensi, dan gaji tidak ada di aplikasi ini: semuanya ada di KantorKu (HRIS perusahaan), dan Prakasa Workspace tidak tersambung ke KantorKu. '
  + 'Jangan menebak datanya; arahkan pengguna membuka KantorKu atau bertanya ke People & Culture.';

const TYPE_LABEL = { onboarding: 'Onboarding', offboarding: 'Offboarding' };
const STATUS_LABEL = {
  draft: 'Draft', pending_approval: 'Menunggu persetujuan', revision_requested: 'Perlu revisi', approved: 'Disetujui, checklist berjalan',
  in_progress: 'Checklist berjalan', completed: 'Selesai', rejected: 'Ditolak', cancelled: 'Dibatalkan',
};
const STATUS_FILTER = {
  draft: 'draft', menunggu_persetujuan: 'pending_approval', perlu_revisi: 'revision_requested', berjalan: 'running', selesai: 'completed', ditutup: 'closed',
};
const TASK_STATUS = { pending: 'Belum dikerjakan', in_progress: 'Sedang dikerjakan', blocked: 'Terhambat', completed: 'Selesai', skipped: 'Dilewati' };
const OPEN_TASK = ['pending', 'in_progress', 'blocked'];
const GROUP_LABEL = { it: 'IT', ga: 'GA', manager: 'Atasan', pc: 'People & Culture' };
const DEVICE_LABEL = { laptop: 'Laptop', pc: 'PC', none: 'Tidak perlu' };
const PHONE_LABEL = { mobile: 'Nomor HP perusahaan', ip_phone: 'Telepon IP', none: 'Tidak perlu' };
const APPROVAL_BASIS = { manager: 'Atasan langsung', division_head: 'Head divisi', management_office: 'Management Office' };
const typeOf = (v) => (v === 'onboarding' || v === 'offboarding' ? v : null);
const route = (id) => `/hrga/workflows/${id}`;
const dateLabel = (type) => (type === 'offboarding' ? 'hari_terakhir_kerja' : 'tanggal_masuk');
const notFound = (e) => e && (e.status === 404 || e.code === 'NOT_FOUND');

// ------------------------------------------------------------------ onboarding / offboarding

const tugasSaya = {
  name: 'tugas_onboarding_saya',
  module: ['hr-onboarding', 'hr-offboarding', 'hr-workflows'],
  label: 'Membaca tugas onboarding/offboarding Anda',
  description: 'Tugas checklist onboarding dan offboarding yang menjadi tanggung jawab pengguna yang bertanya dan belum selesai, di alur yang sedang berjalan: '
    + 'judul tugas, untuk karyawan siapa, tenggat, terlambat atau tidak, dan rute alurnya. Urut tenggat terdekat. Pakai untuk "tugas onboarding saya apa saja" dan "kapan tenggatnya". '
    + 'Hanya tugas milik pengguna itu sendiri, tidak pernah tugas orang lain. Tanpa data pribadi karyawan (telepon pribadi, alamat, NIK) dan tanpa cuti, absensi, atau gaji: itu ada di KantorKu.',
  inputSchema: {
    type: 'object',
    properties: {
      jenis: { type: 'string', enum: ['onboarding', 'offboarding'], description: 'Kosongkan untuk keduanya' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal tugas (default 25)' },
    },
    additionalProperties: false,
  },
  permission: INVOLVED,
  privateOnly: true,
  async run(user, input = {}) {
    const out = await workflows.myTasks(user, { limit: int(input.jumlah, { max: MAX_ROWS, fallback: 25 }), type: typeOf(input.jenis) });
    return {
      total_tugas_terbuka: out.total,
      ditampilkan: out.rows.length,
      terlambat: out.rows.filter((r) => r.late).length,
      tugas: out.rows.map((r) => ({
        id_tugas: r.id,
        judul: r.title,
        kelompok: GROUP_LABEL[r.ownerGroup] || r.ownerGroup,
        status: TASK_STATUS[r.status] || r.status,
        tenggat: r.dueDate,
        terlambat: r.late,
        jenis: TYPE_LABEL[r.workflowType] || r.workflowType,
        nomor_alur: r.workflowNumber,
        karyawan: r.employeeName,
        jabatan: r.position,
        divisi: r.departmentName,
        [dateLabel(r.workflowType)]: r.baseDate,
        rute: route(r.workflowId),
      })),
      ...(out.total ? {} : { catatan: 'Tidak ada tugas onboarding/offboarding yang terbuka untuk Anda.' }),
      catatan_kantorku: KANTORKU,
    };
  },
};

const daftarAlur = {
  name: 'daftar_onboarding_offboarding',
  module: ['hr-onboarding', 'hr-offboarding'],
  label: 'Membaca daftar onboarding dan offboarding',
  description: 'Daftar alur onboarding/offboarding perusahaan seperti di halaman Onboarding dan Offboarding (hanya People & Culture): nomor, karyawan, jabatan, divisi, '
    + 'tanggal masuk atau hari terakhir, status, kemajuan checklist (selesai dari total, berapa yang terlambat), pengaju dan PIC, plus hitungan per status. '
    + 'Saring dengan jenis, status, atau cari nama/nomor. Tanpa isi checklist (pakai status_onboarding_offboarding), tanpa alasan keluar, catatan, kontak pribadi, '
    + 'dan tidak pernah cuti, absensi, atau gaji: itu ada di KantorKu.',
  inputSchema: {
    type: 'object',
    properties: {
      jenis: { type: 'string', enum: ['onboarding', 'offboarding'] },
      status: { type: 'string', enum: Object.keys(STATUS_FILTER), description: 'berjalan = checklist sedang dikerjakan; ditutup = ditolak atau dibatalkan' },
      cari: { type: 'string', maxLength: 100, description: 'Nama karyawan atau nomor alur' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal alur (default 20)' },
    },
    additionalProperties: false,
  },
  permission: HRGA_VIEW,
  privateOnly: true,
  async run(user, input = {}) {
    const out = await workflows.list(user, {
      type: typeOf(input.jenis), status: STATUS_FILTER[input.status] || null, q: text(input.cari, 100),
      page: 1, limit: int(input.jumlah, { max: MAX_ROWS, fallback: 20 }),
    });
    const c = out.meta.counts;
    return {
      ringkasan: {
        semua: c.all, draft: c.draft, menunggu_persetujuan: c.pending_approval, perlu_revisi: c.revision_requested,
        berjalan: c.running, selesai: c.completed, ditutup: c.closed,
      },
      total_cocok: out.meta.total,
      ditampilkan: out.rows.length,
      alur: out.rows.map((r) => ({
        id: r.id,
        nomor: r.workflowNumber,
        jenis: TYPE_LABEL[r.workflowType] || r.workflowType,
        karyawan: r.employeeName,
        jabatan: r.position,
        divisi: r.departmentName,
        [dateLabel(r.workflowType)]: r.baseDate,
        status: STATUS_LABEL[r.status] || r.status,
        tugas_total: r.totalTasks,
        tugas_selesai: r.doneTasks,
        tugas_terlambat: r.lateTasks,
        pengaju: r.requesterName,
        pic: r.picName,
        rute: route(r.id),
      })),
      catatan_kantorku: KANTORKU,
    };
  },
};

// The id of a workflow from its number, only through what the user may already
// list: the whole entity for People & Culture, else the workflows of their own tasks.
async function idOfNumber(user, number) {
  const wanted = number.toLowerCase();
  if (hasPerm(user, HRGA_VIEW)) {
    const out = await workflows.list(user, { q: number, page: 1, limit: 10 });
    return out.rows.find((r) => String(r.workflowNumber).toLowerCase() === wanted)?.id || null;
  }
  const mine = await workflows.myTasks(user, { limit: 100 });
  return mine.rows.find((r) => String(r.workflowNumber).toLowerCase() === wanted)?.workflowId || null;
}

const statusAlur = {
  name: 'status_onboarding_offboarding',
  module: ['hr-workflows', 'hr-onboarding', 'hr-offboarding'],
  label: 'Membaca status onboarding/offboarding',
  description: 'Status satu alur onboarding/offboarding: karyawan, jabatan, divisi, atasan, lokasi kerja, tanggal masuk atau hari terakhir, status, siapa yang sedang ditunggu keputusannya, '
    + 'kebutuhan yang diminta (akun, perangkat, lisensi, nomor, meja, kartu) dan butir checklist yang masih terbuka dengan penanggung jawab dan tenggatnya '
    + '(semua_tugas = true untuk yang sudah selesai juga). Isi id (dari daftar atau tugas) atau nomor alur. Hanya untuk People & Culture dan pihak yang terlibat '
    + '(pengaju, atasan, penanggung jawab tugas, manajemen), seperti di halamannya; orang lain mendapat "tidak ditemukan". '
    + 'Tanpa alasan keluar, catatan, lampiran, referensi KantorKu, email atau telepon pribadi; tidak pernah cuti, absensi, atau gaji: itu ada di KantorKu.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'integer', minimum: 1, description: 'Id alur (dari daftar_onboarding_offboarding atau tugas_onboarding_saya)' },
      nomor: { type: 'string', maxLength: 40, description: 'Nomor alur, mis. ONB-202610-0001' },
      semua_tugas: { type: 'boolean', description: 'true = sertakan tugas yang sudah selesai atau dilewati' },
    },
    additionalProperties: false,
  },
  permission: INVOLVED,
  privateOnly: true,
  async run(user, input = {}) {
    const nomor = text(input.nomor, 40);
    let id = Number.isInteger(input.id) && input.id > 0 ? input.id : null;
    if (!id && !nomor) return { ditemukan: false, catatan: 'Isi id atau nomor alur.' };
    const none = {
      ditemukan: false,
      catatan: 'Alur ini tidak ada, atau Anda bukan People & Culture dan tidak terlibat di dalamnya (pengaju, atasan, penanggung jawab tugas).',
    };
    if (!id) id = await idOfNumber(user, nomor);
    if (!id) return none;
    let wf;
    try {
      wf = await workflows.detail(user, id);
    } catch (e) {
      if (notFound(e)) return none;
      throw e;
    }
    const tasks = wf.tasks || [];
    const open = tasks.filter((t) => OPEN_TASK.includes(t.status));
    const shown = input.semua_tugas === true ? tasks : open;
    const needs = wf.workflowType === 'onboarding' && wf.needs ? wf.needs : null;
    const waiting = (wf.approval?.steps || []).filter((s) => s.status === 'pending' && s.activatedAt);
    return {
      ditemukan: true,
      akses: wf.limited ? 'terbatas (Anda terlibat di alur ini, bukan People & Culture)' : 'penuh (People & Culture)',
      alur: {
        id: wf.id,
        nomor: wf.workflowNumber,
        jenis: TYPE_LABEL[wf.workflowType] || wf.workflowType,
        status: STATUS_LABEL[wf.status] || wf.status,
        karyawan: wf.employeeName,
        jabatan: wf.position,
        divisi: wf.departmentName,
        atasan: wf.managerName,
        lokasi_kerja: wf.locationName,
        [dateLabel(wf.workflowType)]: wf.baseDate,
        pengaju: wf.requesterName,
        pic: wf.picName,
        diajukan: wf.submittedAt,
        disetujui: wf.approvedAt,
        selesai: wf.completedAt,
        dibatalkan: wf.cancelledAt,
        rute: route(wf.id),
      },
      ...(wf.status === 'pending_approval' ? {
        persetujuan: {
          dasar_penyetuju: APPROVAL_BASIS[wf.approverBasis] || null,
          menunggu_keputusan: waiting.map((s) => s.approverName || s.escalatedToRoleName || s.approverRoleName).filter(Boolean),
          catatan: 'Keputusan dilakukan penyetujunya sendiri di menu Approval.',
        },
      } : {}),
      ...(needs ? {
        kebutuhan: {
          akun_google: Boolean(needs.google),
          akun_aplikasi: Boolean(needs.app),
          perangkat: DEVICE_LABEL[needs.device] || null,
          nomor_perusahaan: PHONE_LABEL[needs.phone] || null,
          meja_kerja: Boolean(needs.desk),
          kartu_identitas: Boolean(needs.idCard),
          lisensi: (wf.needLicenses || []).map((l) => l.productName),
        },
      } : {}),
      checklist: {
        total: tasks.length,
        selesai: tasks.length - open.length,
        terbuka: open.length,
        terlambat: tasks.filter((t) => t.late).length,
        ...(tasks.length ? {} : { catatan: 'Checklist dibuat saat pengajuan disetujui.' }),
      },
      tugas: shown.map((t) => ({
        id_tugas: t.id,
        judul: t.title,
        kelompok: GROUP_LABEL[t.ownerGroup] || t.ownerGroup,
        penanggung_jawab: t.responsibleName,
        status: TASK_STATUS[t.status] || t.status,
        tenggat: t.dueDate,
        terlambat: t.late,
        ...(t.completedAt ? { selesai_pada: t.completedAt, diselesaikan_oleh: t.completedByName } : {}),
        tugas_saya: Number(t.responsibleUserId) === Number(user.sub),
      })),
      catatan_kantorku: KANTORKU,
    };
  },
};

// ------------------------------------------------------------------ checklist templates

const templateItem = (i) => ({
  judul: i.title,
  kelompok: GROUP_LABEL[i.ownerGroup] || i.ownerGroup,
  kategori: i.category,
  hari_dari_tanggal_acuan: Number(i.offsetDays) || 0,
  ...(i.requires ? { hanya_bila_dibutuhkan: i.requires } : {}),
});

const templateChecklist = {
  name: 'template_checklist_karyawan',
  module: ['hr-checklists'],
  label: 'Membaca template checklist',
  description: 'Template checklist onboarding/offboarding (halaman Template checklist, Head People & Culture): template bawaan aplikasi dan template buatan per divisi, '
    + 'aktif atau tidak, dengan butirnya (judul, kelompok penanggung jawab IT/GA/Atasan/People & Culture, selisih hari dari tanggal masuk atau hari terakhir). '
    + 'Pakai untuk "apa saja checklist onboarding divisi X". Hanya membaca template; tanpa data karyawan dan tidak pernah cuti, absensi, atau gaji (ada di KantorKu).',
  inputSchema: {
    type: 'object',
    properties: {
      jenis: { type: 'string', enum: ['onboarding', 'offboarding'] },
      divisi: { type: 'string', maxLength: 80, description: 'Nama divisi; kosongkan untuk semua' },
    },
    additionalProperties: false,
  },
  permission: 'hrga.checklist_template.manage',
  privateOnly: true,
  async run(user, input = {}) {
    const jenis = typeOf(input.jenis);
    const divisi = text(input.divisi, 80).toLowerCase();
    const out = await workflows.listTemplates(user, jenis ? { workflowType: jenis } : {});
    const rows = out.rows.filter((r) => !divisi || String(r.departmentName || '').toLowerCase().includes(divisi)).slice(0, MAX_ROWS);
    const builtIn = Object.entries(out.builtIn || {}).filter(([type]) => !jenis || type === jenis);
    return {
      template_buatan: rows.map((r) => ({
        id: r.id,
        nama: r.name,
        jenis: TYPE_LABEL[r.workflowType] || r.workflowType,
        divisi: r.departmentName || 'Semua divisi',
        aktif: r.isActive,
        terakhir_diperbarui: r.updatedAt,
        diperbarui_oleh: r.updatedByName,
        jumlah_butir: (r.items || []).length,
        butir: (r.items || []).map(templateItem),
      })),
      template_bawaan: builtIn.map(([type, items]) => ({
        jenis: TYPE_LABEL[type] || type,
        jumlah_butir: items.length,
        butir: items.map(templateItem),
      })),
      catatan: 'Divisi tanpa template buatan yang aktif memakai template bawaan. Pengembalian perangkat, lisensi, dan nomor saat offboarding dibuat otomatis dari yang masih dipegang karyawan, bukan dari template.',
      rute: '/hrga/checklist-templates',
    };
  },
};

// ------------------------------------------------------------------ directory

const person = (p) => ({
  kunci: p.key,
  nama: p.name,
  jabatan: p.position,
  divisi: p.departmentName,
  atasan: p.managerName,
  email_kerja: p.workEmail,
  telepon_kerja: p.workPhone,
  lokasi_kerja: p.locationName,
  rute: `/people/directory/${p.key}`,
});

const direktori = {
  name: 'direktori_karyawan',
  module: ['people-directory'],
  label: 'Membaca direktori karyawan',
  description: 'Direktori perusahaan: kontak kerja karyawan aktif — nama, jabatan, divisi, atasan langsung, email kerja, telepon/ekstensi kerja, dan lokasi kerja. '
    + 'Pakai untuk "siapa saja di divisi X" (isi divisi), "siapa yang menangani Y" (cari dengan kata di jabatan, mis. "pajak" atau "IT"), mencari satu orang (cari nama atau email), '
    + 'atau isi kunci untuk satu orang beserta bawahan langsungnya. Hanya kontak kerja: tidak pernah telepon pribadi, alamat rumah, NIK, tanggal lahir, gaji, rekening, '
    + 'atau daftar karyawan resign. Tanpa cuti dan absensi: itu ada di KantorKu.',
  inputSchema: {
    type: 'object',
    properties: {
      cari: { type: 'string', maxLength: 100, description: 'Nama, email kerja, atau kata di jabatan' },
      divisi: { type: 'string', maxLength: 80, description: 'Nama divisi, mis. Finance atau People & Culture' },
      kunci: { type: 'string', maxLength: 12, description: 'Kunci direktori satu orang (dari hasil daftar), mis. p12' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal orang (default 25)' },
    },
    additionalProperties: false,
  },
  permission: 'people.directory.view',
  // Names with work email and phone of the whole company: never next to web
  // research or in a conversation other people read later.
  privateOnly: true,
  async run(user, input = {}) {
    const viewer = { canManage: false };
    const kunci = text(input.kunci, 12);
    if (kunci) {
      const found = await directory.detail(user.entityId, kunci, viewer);
      if (!found) return { ditemukan: false, catatan: 'Orang ini tidak ada di direktori (atau sudah tidak aktif).', catatan_kantorku: KANTORKU };
      return {
        ditemukan: true,
        orang: person(found),
        bawahan_langsung: (found.directReports || []).slice(0, MAX_ROWS).map((r) => ({
          kunci: r.key, nama: r.name, jabatan: r.position, divisi: r.departmentName, rute: `/people/directory/${r.key}`,
        })),
        catatan_kantorku: KANTORKU,
      };
    }
    const limit = int(input.jumlah, { max: MAX_ROWS, fallback: 25 });
    const divisi = text(input.divisi, 80).toLowerCase();
    // The service filters a division by id; the name is matched here on the
    // rows it returns (the directory of one company is a few hundred rows).
    const out = await directory.list(user.entityId, { q: text(input.cari, 100), page: 1, limit: divisi ? 500 : limit }, viewer);
    const matched = divisi ? out.rows.filter((r) => String(r.departmentName || '').toLowerCase().includes(divisi)) : out.rows;
    const total = divisi ? matched.length : out.meta.total;
    const rows = matched.slice(0, limit);
    return {
      total_cocok: total,
      ditampilkan: rows.length,
      orang: rows.map(person),
      ...(rows.length ? {} : { catatan: divisi ? 'Tidak ada orang yang cocok. Periksa nama divisinya.' : 'Tidak ada orang yang cocok di direktori.' }),
      catatan_kantorku: KANTORKU,
    };
  },
};

module.exports = [tugasSaya, daftarAlur, statusAlur, templateChecklist, direktori];
module.exports.KANTORKU = KANTORKU;
