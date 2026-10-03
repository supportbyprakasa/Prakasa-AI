// Daily work: the task board (Tugas) and the Project Tracker.
//
// Rules these tools keep:
//   - tasks follow the page's rule exactly (taskAccess: own division,
//     company-wide, or the user is assignee, reporter, watcher, or may see the
//     board); a task of another division answers "tidak ditemukan", like the page;
//   - Project Tracker access is membership of the project's Google Chat space,
//     checked by tracker.service exactly as the Project Tracker page does (a
//     read-only space lookup AS the user, cached). No other Google call, and
//     nothing is posted to a space;
//   - private conversations only: a shared chat would show one division's work
//     to people of another;
//   - counts, dates and states. No rupiah, no personal data, no file content.
const tasks = require('../../../task.service');
const taskAccess = require('../../../taskAccess.service');
const boards = require('../../../board.service');
const tracker = require('../../../tracker.service');
const trackerReports = require('../../../trackerReports.service');
const { text, int } = require('./_shared');

const MAX_ROWS = 50;
const MAX_PROJECTS = 15;
const TASK_STATES = { aktif: 'open', terlambat: 'overdue', jatuh_tempo_7_hari: 'due_soon', selesai: 'done' };
const ISSUE_STATES = { belum_mulai: 'todo', dikerjakan: 'in_progress', selesai: 'done' };
const ISSUE_STATE_LABEL = { todo: 'belum_mulai', in_progress: 'dikerjakan', done: 'selesai' };

const id = (v) => (Number.isInteger(v) && v > 0 ? v : null);
// DATE columns arrive as UTC-midnight Dates: the calendar day.
const day = (v) => {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const iso = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
// Today in WIB, as a calendar day.
const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const isFinal = (status) => tasks.FINAL_STATUSES.has(status);
const notFoundAsNote = (error, note) => {
  if (error?.status === 404 || error?.code === 'NOT_FOUND') return { ditemukan: false, catatan: note };
  throw error;
};

// ---------------------------------------------------------------- Tugas

const tugasSaya = {
  name: 'tugas_saya',
  module: ['tasks'],
  label: 'Membaca daftar tugas',
  description: 'Daftar tugas di papan tugas (Task Board). Cakupan "saya" (default) = tugas yang ditugaskan ke pengguna atau yang ia laporkan; '
    + 'cakupan "divisi" = semua tugas yang boleh ia lihat di halaman Tugas (divisinya sendiri, tugas tanpa divisi, dan tugas tempat ia terlibat; lintas divisi hanya untuk Management Office). '
    + 'Memberi ringkasan jumlah (aktif, terlambat, jatuh tempo 7 hari, selesai) dan daftar: judul, status, prioritas, tenggat, hari terlambat, penanggung jawab, papan, kolom, progres. '
    + 'Bisa disaring status, papan, atau kata di judul. Pakai untuk "tugas saya apa saja", "yang terlambat", "tugas di papan X". '
    + 'Tidak pernah tugas divisi lain, isi lampiran, atau issue Project Tracker (pakai issue_saya).',
  inputSchema: {
    type: 'object',
    properties: {
      cakupan: { type: 'string', enum: ['saya', 'divisi'], description: 'saya (default) atau divisi' },
      status: { type: 'string', enum: Object.keys(TASK_STATES), description: 'Kosong = semua status' },
      papan_id: { type: 'integer', minimum: 1, description: 'Hanya tugas di papan ini (id dari ringkasan_papan)' },
      cari: { type: 'string', maxLength: 100, description: 'Kata di judul tugas' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal tugas (default 20)' },
    },
    additionalProperties: false,
  },
  permission: 'task.view',
  privateOnly: true,
  async run(user, input = {}) {
    const scope = input.cakupan === 'divisi' ? 'divisi' : 'saya';
    const result = await tasks.listTasksForUser({
      user,
      filters: {
        mine: scope === 'saya',
        state: TASK_STATES[input.status] || null,
        boardId: id(input.papan_id),
        q: text(input.cari, 100),
        limit: int(input.jumlah, { max: MAX_ROWS, fallback: 20 }),
      },
    });
    const me = Number(user.sub);
    return {
      cakupan: scope === 'saya' ? 'tugas yang ditugaskan ke Anda atau Anda laporkan' : 'semua tugas yang boleh Anda lihat di halaman Tugas',
      ringkasan: {
        aktif: result.counts.open,
        terlambat: result.counts.overdue,
        jatuh_tempo_7_hari: result.counts.dueSoon,
        selesai: result.counts.done,
      },
      total_cocok: result.total,
      ditampilkan: result.rows.length,
      tugas: result.rows.map((r) => ({
        id: Number(r.id),
        judul: r.title,
        status: r.status,
        prioritas: r.priority,
        tenggat: day(r.dueDate),
        terlambat_hari: Number(r.daysLate) > 0 ? Number(r.daysLate) : 0,
        penanggung_jawab: r.assigneeName || null,
        peran_anda: Number(r.assigneeId) === me ? 'penanggung jawab' : (Number(r.reporterId) === me ? 'pelapor' : null),
        papan: r.boardName || null,
        kolom: r.columnName || null,
        divisi: r.departmentName || null,
        progres_persen: Number(r.progressPercent) || 0,
        rute: `/tasks/${Number(r.id)}`,
      })),
      ...(result.total > result.rows.length ? { catatan: `Hanya ${result.rows.length} dari ${result.total} tugas ditampilkan; persempit dengan status, papan, atau kata kunci.` } : {}),
    };
  },
};

const detailTugas = {
  name: 'detail_tugas',
  module: ['tasks'],
  label: 'Membaca detail tugas',
  description: 'Detail satu tugas berdasarkan id: judul, deskripsi, status, prioritas, penanggung jawab, pelapor, tanggal mulai dan tenggat, progres, '
    + 'checklist (butir dan mana yang sudah selesai), ketergantungan (tugas yang harus selesai dulu dan tugas yang menunggu tugas ini), pengamat, nama lampiran, dan komentar terakhir. '
    + 'Pakai setelah tugas_saya, atau saat pengguna sedang membuka sebuah tugas. '
    + 'Tugas divisi lain dijawab "tidak ditemukan". Tidak pernah isi file lampiran.',
  inputSchema: {
    type: 'object',
    properties: {
      tugas_id: { type: 'integer', minimum: 1, description: 'Id tugas' },
      jumlah_komentar: { type: 'integer', minimum: 0, maximum: 20, description: 'Komentar terakhir yang dibawa (default 5)' },
    },
    required: ['tugas_id'],
    additionalProperties: false,
  },
  permission: 'task.view',
  privateOnly: true,
  async run(user, input = {}) {
    const taskId = id(input.tugas_id);
    if (!taskId) return { ditemukan: false, catatan: 'Sebutkan id tugas (angka).' };
    let detail;
    try {
      detail = await tasks.getTaskDetail({ taskId, user });
    } catch (error) {
      return notFoundAsNote(error, 'Tugas tidak ditemukan, atau bukan tugas yang boleh Anda lihat.');
    }
    let board = null;
    if (detail.boardId) {
      try { board = await boards.getBoardDetail({ boardId: detail.boardId, user }); } catch { board = null; }
    }
    const column = board?.columns?.find((c) => Number(c.id) === Number(detail.columnId)) || null;
    const keep = Number.isInteger(input.jumlah_komentar) ? Math.min(20, Math.max(0, input.jumlah_komentar)) : 5;
    const comments = detail.comments || [];
    const today = todayWib();
    const due = day(detail.dueDate);
    const linked = (row) => ({ id: Number(row.taskId), judul: row.title, status: row.status, tenggat: day(row.dueDate), rute: `/tasks/${Number(row.taskId)}` });
    return {
      ditemukan: true,
      id: Number(detail.id),
      judul: detail.title,
      deskripsi: detail.description || null,
      status: detail.status,
      prioritas: detail.priority,
      penanggung_jawab: detail.assigneeName || null,
      pelapor: detail.reporterName || null,
      tanggal_mulai: day(detail.startDate),
      tenggat: due,
      terlambat: Boolean(due && due < today && !isFinal(detail.status)),
      progres_persen: Number(detail.progressPercent) || 0,
      selesai_pada: iso(detail.completedAt),
      diselesaikan_oleh: detail.completedByName || null,
      papan: board ? { id: Number(board.id), nama: board.name } : null,
      kolom: column?.name || null,
      dibuat_pada: iso(detail.createdAt),
      checklist: {
        selesai: detail.checklist?.done || 0,
        total: detail.checklist?.total || 0,
        persen: detail.checklist?.percent || 0,
        butir: (detail.checklist?.items || []).map((item) => ({ judul: item.title, selesai: Boolean(item.isDone) })),
      },
      ketergantungan: {
        harus_selesai_dulu: (detail.dependencies?.blockedBy || []).map(linked),
        menunggu_tugas_ini: (detail.dependencies?.blocking || []).map(linked),
        terkait: (detail.dependencies?.related || []).map((row) => {
          const other = Number(row.predecessorTaskId) === taskId
            ? { id: row.successorTaskId, title: row.successorTitle }
            : { id: row.predecessorTaskId, title: row.predecessorTitle };
          return { id: Number(other.id), judul: other.title, rute: `/tasks/${Number(other.id)}` };
        }),
      },
      pengamat: (detail.watchers || []).map((w) => w.userName),
      lampiran: (detail.attachments || []).map((a) => ({ nama: a.name, tautan: a.webViewLink || null })),
      jumlah_komentar: comments.length,
      komentar_terakhir: keep ? comments.slice(-keep).map((c) => ({ oleh: c.userName || null, isi: c.body, waktu: iso(c.createdAt) })) : [],
      rute: `/tasks/${Number(detail.id)}`,
    };
  },
};

const ringkasanPapan = {
  name: 'ringkasan_papan',
  module: ['tasks'],
  label: 'Membaca ringkasan papan tugas',
  description: 'Tanpa papan_id: daftar papan tugas yang boleh dilihat pengguna (id dan nama). '
    + 'Dengan papan_id: ringkasan satu papan — jumlah tugas per kolom (dan batas WIP), jumlah aktif, terlambat, tanpa penanggung jawab, beban per orang, dan daftar tugas yang terlambat. '
    + 'Pakai untuk "bagaimana kondisi papan X", "siapa paling banyak tugas", "tugas mana yang macet". '
    + 'Papan divisi lain dijawab "tidak ditemukan". Tanpa isi komentar atau lampiran; papan Project Tracker dibaca lewat proyek_saya.',
  inputSchema: {
    type: 'object',
    properties: {
      papan_id: { type: 'integer', minimum: 1, description: 'Id papan; kosong = daftar papan' },
    },
    additionalProperties: false,
  },
  permission: 'task.view',
  privateOnly: true,
  async run(user, input = {}) {
    const boardId = id(input.papan_id);
    if (!boardId) {
      const list = (await boards.listBoards({ user })).filter((b) => !b.projectKey);
      return {
        jumlah_papan: list.length,
        papan: list.slice(0, MAX_ROWS).map((b) => ({ id: Number(b.id), nama: b.name, keterangan: b.description || null })),
        rute: '/tasks',
        ...(list.length ? {} : { catatan: 'Belum ada papan tugas yang bisa Anda lihat.' }),
      };
    }
    let board;
    let rows;
    try {
      const raw = await taskAccess.loadBoard(boardId);
      taskAccess.assertBoardAccess({ user, board: raw, action: 'view' });
      if (raw.project_key) {
        return { ditemukan: false, catatan: 'Papan ini adalah Project Tracker; baca lewat daftar proyek (hanya untuk anggota space-nya).' };
      }
      board = await boards.getBoardDetail({ boardId, user });
      rows = await tasks.listTasksByBoard({ boardId, user });
    } catch (error) {
      return notFoundAsNote(error, 'Papan tidak ditemukan, atau bukan papan yang boleh Anda lihat.');
    }
    const today = todayWib();
    const open = rows.filter((r) => !isFinal(r.status));
    const late = open.filter((r) => day(r.dueDate) && day(r.dueDate) < today)
      .sort((a, b) => String(day(a.dueDate)).localeCompare(String(day(b.dueDate))));
    const load = new Map();
    for (const r of open) {
      const name = r.assigneeName || 'Belum ada penanggung jawab';
      const entry = load.get(name) || { nama: name, tugas_aktif: 0, terlambat: 0 };
      entry.tugas_aktif += 1;
      if (day(r.dueDate) && day(r.dueDate) < today) entry.terlambat += 1;
      load.set(name, entry);
    }
    return {
      ditemukan: true,
      papan: { id: Number(board.id), nama: board.name, keterangan: board.description || null, diarsipkan: Boolean(board.isArchived) },
      total_tugas: rows.length,
      aktif: open.length,
      terlambat: late.length,
      tanpa_penanggung_jawab: open.filter((r) => !r.assigneeId).length,
      per_kolom: (board.columns || []).map((c) => ({
        kolom: c.name,
        jumlah: rows.filter((r) => Number(r.columnId) === Number(c.id)).length,
        batas_wip: c.wipLimit ?? null,
      })),
      beban_per_orang: [...load.values()].sort((a, b) => b.tugas_aktif - a.tugas_aktif).slice(0, 25),
      tugas_terlambat: late.slice(0, 25).map((r) => ({
        id: Number(r.id), judul: r.title, tenggat: day(r.dueDate), prioritas: r.priority, penanggung_jawab: r.assigneeName || null, rute: `/tasks/${Number(r.id)}`,
      })),
      rute: '/tasks',
    };
  },
};

// ---------------------------------------------------------------- Project Tracker

const TRACKER_UNAVAILABLE = 'Project Tracker belum bisa dibaca: keanggotaan space Google Chat Anda tidak bisa diperiksa saat ini '
  + '(akun Google belum terhubung atau Google sedang tidak bisa dihubungi). Buka halaman Project Tracker untuk memeriksanya.';

// Google is asked once per call (the membership lookup inside tracker.service).
// Whatever it does — refuses, errors, or never answers — the tool says
// "tidak tersedia" instead of throwing or keeping the answer waiting.
const GOOGLE_WAIT_MS = 12000;
async function orUnavailable(read, waitMs = GOOGLE_WAIT_MS) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false }), waitMs); });
  try {
    return await Promise.race([
      Promise.resolve().then(read).then((value) => ({ ok: true, value }), () => ({ ok: false })),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Projects whose Chat space the user is a member of (tracker.listProjects).
// A Google failure is an honest "tidak tersedia", never a guess.
async function myProjects(user, waitMs) {
  const result = await orUnavailable(() => tracker.listProjects(user), waitMs);
  const projects = result.ok ? result.value?.projects : null;
  return Array.isArray(projects) ? { ok: true, projects } : { ok: false, projects: [] };
}

const routeOf = (project, issueId = null) => `/projects/${project.spaceId}${issueId ? `?issue=${Number(issueId)}` : ''}`;
const sprintOut = (s) => (s ? {
  id: s.id,
  nama: s.name,
  tujuan: s.goal || null,
  status: s.status,
  mulai: s.startDate,
  berakhir: s.endDate,
  jumlah_issue: s.issueCount,
  poin: s.points,
  poin_selesai: s.donePoints,
} : null);

const proyekSaya = {
  name: 'proyek_saya',
  module: ['projects'],
  label: 'Membaca Project Tracker',
  description: 'Project Tracker: proyek yang pengguna menjadi anggota space Google Chat-nya. '
    + 'Tanpa proyek_id: daftar proyek dengan jumlah issue terbuka, dikerjakan, selesai, terlambat, dan sprint aktifnya. '
    + 'Dengan proyek_id: status sprint aktif (tanggal, jumlah issue, poin selesai, sisa poin hari ini), sprint yang belum selesai beserta id-nya (untuk membuka formulir ubah sprint), jumlah issue per status, beban per orang, dan kecepatan sprint terakhir. '
    + 'Pakai untuk "bagaimana sprint proyek X", "proyek apa saja yang saya ikuti". '
    + 'Hanya proyek yang ia anggotanya; proyek lain dijawab "tidak ditemukan". Tidak pernah isi percakapan Google Chat, dan tidak mengirim apa pun ke space.',
  inputSchema: {
    type: 'object',
    properties: {
      proyek_id: { type: 'integer', minimum: 1, description: 'Id proyek; kosong = daftar proyek' },
    },
    additionalProperties: false,
  },
  permission: 'google.chat.use',
  privateOnly: true,
  async run(user, input = {}) {
    const mine = await myProjects(user);
    if (!mine.ok) return { tersedia: false, catatan: TRACKER_UNAVAILABLE };
    const projectId = id(input.proyek_id);
    if (!projectId) {
      return {
        tersedia: true,
        jumlah_proyek: mine.projects.length,
        proyek: mine.projects.slice(0, MAX_ROWS).map((p) => ({
          id: p.id,
          kode: p.key,
          nama: p.name,
          issue_terbuka: p.counts.open,
          issue_dikerjakan: p.counts.inProgress,
          issue_selesai: p.counts.done,
          issue_terlambat: p.counts.overdue,
          sprint_aktif: sprintOut(p.activeSprint),
          rute: routeOf(p),
        })),
        ...(mine.projects.length ? {} : { catatan: 'Anda belum menjadi anggota proyek mana pun di Project Tracker.' }),
      };
    }
    const project = mine.projects.find((p) => Number(p.id) === projectId);
    if (!project) return { tersedia: true, ditemukan: false, catatan: 'Proyek tidak ditemukan, atau Anda bukan anggota space-nya.' };
    let denied = false;
    const read = await orUnavailable(() => trackerReports.getReports(user, projectId, {}).catch((error) => {
      if (error?.status === 403 || error?.status === 404) { denied = true; return null; }
      throw error;
    }));
    if (denied) return { tersedia: true, ditemukan: false, catatan: 'Proyek tidak ditemukan, atau Anda bukan anggota space-nya.' };
    if (!read.ok || !read.value) return { tersedia: false, catatan: TRACKER_UNAVAILABLE };
    const reports = read.value;
    const today = todayWib();
    const burn = (reports.burndown?.days || []).filter((d) => d.remainingPoints !== null && d.date <= today).pop() || null;
    return {
      tersedia: true,
      ditemukan: true,
      proyek: { id: project.id, kode: project.key, nama: project.name, rute: routeOf(project) },
      issue: {
        terbuka: project.counts.open, dikerjakan: project.counts.inProgress, selesai: project.counts.done, terlambat: project.counts.overdue,
      },
      sprint_aktif: project.activeSprint ? {
        ...sprintOut(project.activeSprint),
        ...(burn ? { sisa_poin_per: burn.date, sisa_poin: burn.remainingPoints, sisa_issue: burn.remainingIssues, sisa_poin_ideal: burn.idealPoints } : {}),
      } : null,
      ...(project.activeSprint ? {} : { catatan: 'Proyek ini tidak punya sprint aktif saat ini.' }),
      // Active and planned sprints with their ids: `${rute proyek}?ubah=<id sprint>` opens the sprint's form.
      sprint_belum_selesai: (project.openSprints || []).slice(0, 20).map((s) => ({
        id: s.id, nama: s.name, status: s.status, mulai: s.startDate, berakhir: s.endDate, rute_ubah: `${routeOf(project)}?ubah=${Number(s.id)}`,
      })),
      per_status: (reports.byStatus || []).map((s) => ({ status: ISSUE_STATE_LABEL[s.category] || s.category, jumlah: s.count, poin: s.points })),
      beban_per_orang: (reports.byAssignee || []).slice(0, 25).map((a) => ({ nama: a.name, terbuka: a.open, selesai: a.done, poin: a.points })),
      kecepatan_sprint_terakhir: (reports.velocity || []).map((v) => ({ sprint: v.name, poin_selesai: v.completedPoints })),
    };
  },
};

const issueSaya = {
  name: 'issue_saya',
  module: ['projects'],
  label: 'Membaca issue Project Tracker Anda',
  description: 'Issue Project Tracker yang ditugaskan ke pengguna, di proyek yang ia anggotanya: kode issue, judul, tipe, prioritas, status, tenggat, terlambat atau tidak, poin, dan proyeknya. '
    + 'Bisa dibatasi ke satu proyek, ke sprint aktif saja, atau ke satu status. Pakai untuk "issue saya apa saja", "yang harus saya kerjakan di sprint ini". '
    + 'Tidak pernah issue orang lain, isi komentar, atau percakapan Google Chat.',
  inputSchema: {
    type: 'object',
    properties: {
      proyek_id: { type: 'integer', minimum: 1, description: 'Hanya proyek ini (id dari proyek_saya)' },
      status: { type: 'string', enum: ['belum_selesai', ...Object.keys(ISSUE_STATES)], description: 'Default belum_selesai' },
      sprint_aktif_saja: { type: 'boolean', description: 'true = hanya issue di sprint yang sedang berjalan' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal issue (default 20)' },
    },
    additionalProperties: false,
  },
  permission: 'google.chat.use',
  privateOnly: true,
  async run(user, input = {}) {
    const mine = await myProjects(user);
    if (!mine.ok) return { tersedia: false, catatan: TRACKER_UNAVAILABLE };
    const projectId = id(input.proyek_id);
    const chosen = projectId ? mine.projects.filter((p) => Number(p.id) === projectId) : mine.projects;
    if (projectId && !chosen.length) return { tersedia: true, ditemukan: false, catatan: 'Proyek tidak ditemukan, atau Anda bukan anggota space-nya.' };
    const wanted = input.status && input.status !== 'belum_selesai' ? ISSUE_STATES[input.status] : null;
    const limit = int(input.jumlah, { max: MAX_ROWS, fallback: 20 });
    const today = todayWib();
    const all = [];
    let unread = 0;
    for (const project of chosen.slice(0, MAX_PROJECTS)) {
      const listed = await orUnavailable(() => tracker.listIssues(user, project.id, { assignee: 'me', ...(input.sprint_aktif_saja === true ? { sprint: 'active' } : {}) }));
      if (!listed.ok || !Array.isArray(listed.value?.issues)) {
        unread += 1;
        continue;
      }
      for (const issue of listed.value.issues) {
        if (wanted ? issue.status !== wanted : issue.status === 'done') continue;
        all.push({
          id: issue.id,
          kode: issue.key,
          judul: issue.title,
          tipe: issue.type,
          prioritas: issue.priority,
          status: ISSUE_STATE_LABEL[issue.status] || issue.status,
          kolom: issue.statusName,
          tenggat: issue.dueDate,
          terlambat: Boolean(issue.dueDate && issue.dueDate < today && issue.status !== 'done'),
          poin: issue.storyPoints,
          di_sprint_aktif: Boolean(project.activeSprint && issue.sprintId === project.activeSprint.id),
          proyek: project.name,
          rute: routeOf(project, issue.id),
        });
      }
    }
    all.sort((a, b) => String(a.tenggat || '9999').localeCompare(String(b.tenggat || '9999')));
    const notes = [];
    if (chosen.length > MAX_PROJECTS) notes.push(`Hanya ${MAX_PROJECTS} proyek pertama yang dibaca; sebutkan proyeknya untuk yang lain.`);
    if (unread) notes.push(`${unread} proyek tidak bisa dibaca saat ini.`);
    if (all.length > limit) notes.push(`Hanya ${limit} dari ${all.length} issue ditampilkan.`);
    return {
      tersedia: true,
      proyek_dibaca: Math.min(chosen.length, MAX_PROJECTS) - unread,
      total_cocok: all.length,
      terlambat: all.filter((i) => i.terlambat).length,
      issue: all.slice(0, limit),
      ...(notes.length ? { catatan: notes.join(' ') } : {}),
    };
  },
};

module.exports = [tugasSaya, detailTugas, ringkasanPapan, proyekSaya, issueSaya];
// For tests: the wait before a silent Google counts as unavailable.
module.exports.orUnavailable = orUnavailable;
