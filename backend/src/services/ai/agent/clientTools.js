const bridge = require('./clientBridge');
const formCatalog = require('./formCatalog');
const { fieldClass, wordsOf, identifierLike } = require('./fieldPolicy');

// The server side of the page tools (tools/page.js; Wave C,
// docs/prakasa-ai-rencana.md §9.8). The browser does the work; this file
// decides what it may be asked, and what of its answer reaches the model:
//
//   buka_halaman   an in-app route this user may open — never a URL. Outside
//                  the side panel nothing is opened: the result is a link.
//   baca_formulir  the forms the page registered. Secret fields never pass;
//                  fields only the user may fill come without their value.
//   isi_form       field values for ONE registered form. The form's own
//                  permission (declared by the page, and by the catalog for the
//                  forms listed there; a list means "any of") is re-checked
//                  against the user as loaded for this call. Fields that are never the agent's to fill are
//                  refused here, before the browser is asked — and so is every
//                  field the catalog's policy (forms/<module>.js `fields.ai`)
//                  does not name, including a column inside a rows field.
//                  A form no catalog file lists cannot be filled at all.
//
// Nothing here saves, submits, approves, deletes or sends, and no request to
// the browser can: the only operations are navigate / readForms / fillForm.
// What the browser answers is untrusted and is rebuilt field by field.

const MAX_ROUTE = 300;
const MAX_FORMS = 6;
const MAX_PAGE_FORMS = 30;
const MAX_FIELDS = 40;
const MAX_OPTIONS = 60;
const MAX_FILL = 40;
const MAX_VALUE = 4000;
// Rows (Wave C2a, §9.11): at most this many rows per rows field in one call,
// this many columns per row, and this many values in one call altogether.
const MAX_ROWS = 20;
const MAX_ROW_COLUMNS = 12;
const MAX_CELL = 1000;
const MAX_VALUES_PER_CALL = 240;
const MAX_CANDIDATES = 5;
const FIELD_TYPES = new Set(['text', 'textarea', 'number', 'date', 'time', 'datetime', 'month', 'select', 'multiselect', 'checkbox', 'radio', 'lookup', 'person', 'rows']);
const LOOKUP_TYPES = new Set(['lookup', 'person']);
const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,59}$/;
const PERMISSION = /^[a-z_]+(\.[a-z_]+)+$/;
const RECORD_TYPE = /^[a-z][a-z0-9_]{0,39}$/;
// Up to 100 characters: a recurring Google Calendar event id is longer than 40.
const MAX_RECORD_ID = 100;
const RECORD_ID = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_RECORD_ID}}$`);
// "items[2]" or "items[2].qty": a row, or a cell, of a rows field.
const ROW_REF = /^([A-Za-z][A-Za-z0-9_.-]{0,59})\[(\d{1,2})\](?:\.([A-Za-z][A-Za-z0-9_.-]{0,59}))?$/;
const SAVE_NOTE = 'Isian ini BELUM tersimpan. Pengguna yang memeriksa lalu menekan tombol simpan sendiri.';
const USER_ONLY = 'Kolom ini hanya diisi pengguna.';
const UNKNOWN = 'Kolom ini tidak ada di formulir.';
// An answer that works from an attached document (§9.15): a personal identifier
// or a bank account number is not copied into ANY field, free text included.
const IDENTIFIER = 'Isian memuat nomor pengenal pribadi atau nomor rekening. Nomor seperti itu tidak disalin dari dokumen: pengguna menuliskannya sendiri bila perlu. Isi ulang kolom ini tanpa nomor itu.';

// Routes the menu hides and the app refuses (frontend components/navigation.js
// BLOCKED_ROUTES); the browser checks again with hasRouteAccess.
const BLOCKED_ROUTES = Object.freeze(['/approvals', '/admin/approval-delegations', '/documents', '/templates', '/coming-soon/operations']);
const ROUTE = /^\/[A-Za-z0-9\-._~/%]*(\?[A-Za-z0-9\-._~%=&+]*)?$/;

// Field names that are never the agent's: fieldPolicy.js (the same rule as the
// browser's components/ai/aiFormModel.js; test/aiClientTools.test.js keeps them equal).

const text = (value, max = 200) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const holds = (user, code) => (user?.permissions || []).includes(code);
const holdsAny = (user, codes) => [].concat(codes || []).some((code) => holds(user, code));
const fail = (alasan, extra = {}) => ({ berhasil: false, alasan, ...extra });

// "/it/tickets/new", "/finance/payment-requests?baru=1" — never a URL, never
// another origin, never a path that climbs.
function parseRoute(value) {
  const route = typeof value === 'string' ? value.trim() : '';
  if (!route || route.length > MAX_ROUTE || !ROUTE.test(route)) return null;
  if (route.startsWith('//') || route.includes('..') || route.includes('//')) return null;
  const [pathname, search = ''] = route.split('?');
  return { route, pathname: pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname, search };
}

// The page a route belongs to, if this user may open it. Loaded on first use:
// the registry reads the agent tools while it loads.
function pageFor(user, pathname) {
  // eslint-disable-next-line global-require
  const registry = require('../../aiToolRegistry.service');
  if (BLOCKED_ROUTES.some((to) => pathname === to || pathname.startsWith(`${to}/`))) return null;
  const resolved = registry.resolveTool(pathname);
  if (!resolved || !registry.canRead(user, resolved.tool)) return null;
  return resolved.tool;
}

function cleanFormList(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_FORMS)
    .map((form) => ({ id: text(form?.id, 60), judul: text(form?.judul, 120) }))
    .filter((form) => NAME.test(form.id));
}

async function openPage({ user, input, ctx }) {
  const parsed = parseRoute(input?.rute);
  if (!parsed) return { result: fail('Rute tidak valid. Hanya rute dalam aplikasi yang diawali "/" (bukan alamat web).'), audit: { route: null } };
  const page = pageFor(user, parsed.pathname);
  if (!page) return { result: fail('Halaman itu tidak ada atau pengguna tidak punya akses ke sana.'), audit: { route: parsed.pathname } };
  const audit = { route: parsed.pathname };
  if (ctx.surface !== 'panel') {
    return {
      audit,
      result: {
        dibuka: false, tautan: parsed.route, judul: page.title,
        catatan: `Percakapan ini berjalan di Pusat perintah AI, jadi halaman tidak dibuka. Beri pengguna tautan "Buka: ${page.title}" ke rute itu. Formulir hanya bisa diisi dari panel Prakasa AI di halamannya.`,
      },
    };
  }
  // The browser waits for the form when the route is one a listed form opens on.
  const expectsForm = formCatalog.opensForm(parsed);
  const answer = await bridge.request({ answerId: ctx.answerId, tool: 'buka_halaman', op: 'navigate', input: { rute: parsed.route, ...(expectsForm ? { harap_formulir: true } : {}) } });
  if (!answer.ok) return { audit, ok: false, result: fail(answer.error) };
  const got = answer.result || {};
  if (got.dibuka !== true) return { audit, ok: false, result: { dibuka: false, alasan: text(got.alasan, 300) || 'Halaman tidak dibuka.' } };
  const channel = bridge.channelOf(ctx.answerId);
  if (channel) { channel.route = parsed.pathname; channel.expectsForm = expectsForm; }
  const unsaved = cleanFormList(got.belum_disimpan);
  return {
    audit,
    result: {
      dibuka: true, rute: parsed.route, judul: page.title, formulir_terbuka: cleanFormList(got.formulir),
      ...(unsaved.length ? {
        formulir_belum_disimpan: unsaved,
        catatan: 'Ada formulir dengan isian yang belum disimpan di halaman ini. Halaman tidak mengganti formulir itu dengan formulir lain: bila formulir yang diminta tidak ada di formulir_terbuka, minta pengguna menyimpan atau menutup formulir yang belum disimpan itu dulu, lalu coba lagi.',
      } : {}),
    },
  };
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const shownValue = (now, max = 2000) => (typeof now === 'boolean' ? (now ? 'ya' : 'tidak') : String(now ?? '').slice(0, max));

// One field (or one column of a rows field) as the browser described it → what
// the model may see and what the server remembers of it. `allowed(name)` is the
// catalog's policy for this form.
function cleanField(field, allowed, { inRow = false } = {}) {
  const nama = text(field?.nama, 60);
  const jenis = text(field?.jenis, 20);
  if (!NAME.test(nama) || !FIELD_TYPES.has(jenis) || (inRow && jenis === 'rows')) return null;
  const kind = fieldClass(nama);
  if (kind === 'secret') return null;
  const readOnly = kind === 'open' && field?.hanya_baca === true;
  const fillable = kind === 'open' && field?.bisa_diisi !== false && !readOnly && allowed(nama, jenis);
  const known = { fillable, type: jenis };
  const out = { nama, label: text(field?.label, 120) || nama, jenis, wajib: field?.wajib === true, bisa_diisi: fillable };
  if (Array.isArray(field?.pilihan)) out.pilihan = field.pilihan.slice(0, MAX_OPTIONS).map((option) => text(String(option ?? ''), 120)).filter(Boolean);
  if (Number.isInteger(field?.maks) && field.maks > 0) out.maks_karakter = field.maks;
  if (text(field?.petunjuk, 200)) out.petunjuk = text(field.petunjuk, 200);
  if (jenis === 'number') {
    if (finite(field?.min) !== null) out.min = field.min;
    if (finite(field?.maks_angka) !== null) out.maks_angka = field.maks_angka;
    if (finite(field?.kelipatan) !== null) out.kelipatan = field.kelipatan;
    if (field?.mata_uang === 'rupiah') out.mata_uang = 'rupiah';
  }
  if (LOOKUP_TYPES.has(jenis) && fillable) {
    out.cara_isi = jenis === 'person'
      ? 'Tulis nama orangnya; halaman mencarinya di direktori. Bila hasilnya tidak tepat satu, kolom tidak diisi dan kandidatnya dikembalikan: tanyakan ke pengguna.'
      : 'Tulis nama atau kode yang dicari; halaman mencarinya. Bila hasilnya tidak tepat satu, kolom tidak diisi dan kandidatnya dikembalikan: tanyakan ke pengguna.';
  }
  if (!fillable) out.catatan = readOnly ? 'Tidak bisa diubah.' : 'Hanya diisi pengguna.';
  return { nama, known, out, readOnly, kind };
}

// One form as the browser described it → what the model may see, plus the
// permission the page declared (kept on the answer's channel, never shown).
function cleanForm(raw, user) {
  const id = text(raw?.id, 60);
  if (!NAME.test(id)) return null;
  const listed = formCatalog.byId.get(id) || null;
  // The permission the page declared: one code, or a list ("any of").
  const declared = (Array.isArray(raw?.izin) ? raw.izin : [raw?.izin]).slice(0, 4).map((code) => text(code, 80));
  const permission = declared.length && declared.every((code) => PERMISSION.test(code)) ? declared : null;
  const judul = text(raw?.judul, 120) || listed?.title || id;
  const allowed = Boolean(listed) && Boolean(permission) && holdsAny(user, permission) && formCatalog.mayFill(user, listed);
  const known = { id, title: judul, permission, catalogPermission: listed?.permissions || null, listed: Boolean(listed), usable: false, fields: new Map(), record: null };
  const refuse = (alasan) => ({ known, out: { id, judul, bisa_diisi: false, alasan } });
  if (!listed) return refuse('Formulir ini belum terdaftar di katalog formulir Prakasa AI, jadi tidak bisa diisi AI.');
  if (!allowed) return refuse(permission ? 'Pengguna tidak punya izin untuk formulir ini.' : 'Formulir ini tidak mendaftarkan izinnya.');
  // An edit form says which record it changes (the audit names it; never a value).
  if (listed.mode === 'edit') {
    const type = text(raw?.rekaman?.jenis, 40);
    // One character more than allowed is kept, so an id that is too long is refused — never cut to a valid one.
    const recordId = text(String(raw?.rekaman?.id ?? ''), MAX_RECORD_ID + 1);
    if (raw?.mode !== 'ubah' || type !== listed.record || !RECORD_TYPE.test(type) || !RECORD_ID.test(recordId)) return refuse('Formulir ubah ini tidak menyebut data yang diubah.');
    known.record = { type, id: recordId };
  } else if (raw?.mode === 'ubah') {
    return refuse('Formulir ini terdaftar sebagai formulir buat-baru, bukan ubah data.');
  }
  known.usable = true;
  const kolom = [];
  for (const field of (Array.isArray(raw?.kolom) ? raw.kolom : []).slice(0, MAX_FIELDS)) {
    const cleaned = cleanField(field, (name, type) => formCatalog.allows(listed, name, type));
    if (!cleaned) continue;
    const { nama, known: fieldKnown, out } = cleaned;
    if (out.jenis === 'rows') {
      fieldKnown.columns = new Map();
      out.kolom_baris = [];
      for (const column of (Array.isArray(field?.kolom_baris) ? field.kolom_baris : []).slice(0, MAX_ROW_COLUMNS)) {
        const cell = cleanField(column, (name) => listed.fillable.has(`${nama}.${name}`), { inRow: true });
        if (!cell) continue;
        fieldKnown.columns.set(cell.nama, { ...cell.known, readOnly: cell.readOnly });
        out.kolom_baris.push(cell.out);
      }
      if (fieldKnown.fillable && ![...fieldKnown.columns.values()].some((column) => column.fillable)) {
        fieldKnown.fillable = false;
        out.bisa_diisi = false;
        out.catatan = 'Hanya diisi pengguna.';
      }
      if (fieldKnown.fillable) {
        out.maks_baris = Number.isInteger(field?.maks_baris) && field.maks_baris > 0 ? Math.min(field.maks_baris, 50) : MAX_ROWS;
        out.boleh_tambah = field?.boleh_tambah !== false;
        // The rows as they are now — only the columns the AI may fill or read.
        out.baris = [];
        for (const row of (Array.isArray(field?.baris) ? field.baris : []).slice(0, MAX_ROWS)) {
          const isi = {};
          for (const [name, column] of fieldKnown.columns) {
            if ((column.fillable || column.readOnly) && row?.isi && Object.prototype.hasOwnProperty.call(row.isi, name)) isi[name] = shownValue(row.isi[name], 500);
          }
          out.baris.push({ no: Number.isInteger(row?.no) ? row.no : out.baris.length + 1, isi, ...(row?.diisi_ai === true ? { diisi_ai: true } : { diisi_pengguna: true }) });
        }
        out.cara_isi = 'Isi dengan "baris": daftar objek { nama_kolom: isi } memakai nama di kolom_baris. Baris yang diisi pengguna tidak pernah diubah atau dihapus; baris baru ditambahkan (cara "ganti" hanya mengganti baris yang sebelumnya diisi AI).';
      }
    } else if (fieldKnown.fillable || cleaned.readOnly) {
      // What is in the field now, so the agent does not ask for it again.
      out.isi = shownValue(field?.isi);
      if (fieldKnown.fillable && field?.diisi_ai === true) out.diisi_ai = true;
      if (fieldKnown.fillable && field?.diisi_pengguna === true) out.diisi_pengguna = true;
    }
    known.fields.set(nama, fieldKnown);
    kolom.push(out);
  }
  return {
    known,
    out: {
      id, judul, bisa_diisi: true,
      ...(known.record ? { mode: 'ubah', catatan_mode: 'Formulir ini mengubah data yang sudah ada. Kolom yang sudah diubah pengguna di sesi ini tidak ditimpa.' } : {}),
      belum_disimpan: raw?.belum_disimpan === true, kolom,
    },
  };
}

async function readForms({ user, ctx }) {
  // After a route that opens a form, the browser waits a moment for the form
  // to register (its lookups may still be loading).
  const expects = bridge.channelOf(ctx.answerId)?.expectsForm === true;
  const answer = await bridge.request({ answerId: ctx.answerId, tool: 'baca_formulir', op: 'readForms', input: expects ? { harap_formulir: true } : {} });
  const channel = bridge.channelOf(ctx.answerId);
  const audit = { route: channel?.route || ctx.route || null };
  if (!answer.ok) return { audit, ok: false, result: fail(answer.error) };
  const got = answer.result || {};
  const forms = [];
  if (channel) channel.forms.clear();
  for (const raw of (Array.isArray(got.formulir) ? got.formulir : []).slice(0, MAX_FORMS)) {
    const cleaned = cleanForm(raw, user);
    if (!cleaned) continue;
    if (channel) channel.forms.set(cleaned.known.id, cleaned.known);
    forms.push(cleaned.out);
  }
  const route = parseRoute(got.rute);
  if (route && channel) channel.route = route.pathname;
  audit.route = route?.pathname || audit.route;
  audit.forms = forms.map((form) => form.id);
  if (!forms.length) {
    return {
      audit,
      result: {
        rute: route?.route || null, formulir: [],
        catatan: 'Tidak ada formulir terbuka di halaman ini. Buka salah satu dengan buka_halaman, lalu baca lagi. Formulir halaman lain: daftar_formulir.',
        formulir_di_halaman_ini: audit.route ? formCatalog.formsFor(user, { page: audit.route }).slice(0, MAX_PAGE_FORMS) : [],
      },
    };
  }
  return { audit, result: { rute: route?.route || null, formulir: forms, catatan: 'Isi kolom dengan isi_form memakai nama kolom di atas. Kolom wajib yang belum ada datanya: tanyakan dulu ke pengguna.' } };
}

const scalar = (value) => ['string', 'number', 'boolean'].includes(typeof value);

// isian as the model sent it → { kolom, isi } for a field, { kolom, baris, cara }
// for a rows field. Capped: fields per call, rows per field, columns per row,
// and values per call altogether (`dropped` names what did not fit).
function cleanFill(input) {
  const formId = text(input?.formulir, 60);
  const entries = [];
  const dropped = [];
  const seen = new Set();
  let values = 0;
  for (const item of (Array.isArray(input?.isian) ? input.isian : []).slice(0, MAX_FILL)) {
    const kolom = text(item?.kolom, 60);
    if (!NAME.test(kolom) || seen.has(kolom)) continue;
    if (Array.isArray(item?.baris)) {
      seen.add(kolom);
      const baris = [];
      for (const raw of item.baris.slice(0, MAX_ROWS)) {
        const cells = {};
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          for (const [name, value] of Object.entries(raw).slice(0, MAX_ROW_COLUMNS)) {
            if (NAME.test(name) && scalar(value)) cells[name] = String(value).slice(0, MAX_CELL);
          }
        }
        if (values + Object.keys(cells).length > MAX_VALUES_PER_CALL) { dropped.push(kolom); break; }
        values += Object.keys(cells).length;
        baris.push(cells); // an empty row keeps its place: row numbers stay the model's
      }
      if (item.baris.length > MAX_ROWS && !dropped.includes(kolom)) dropped.push(kolom);
      entries.push({ kolom, baris, cara: item?.cara === 'ganti' ? 'ganti' : 'tambah' });
      continue;
    }
    const raw = item?.isi;
    if (!scalar(raw)) continue;
    seen.add(kolom);
    if (values >= MAX_VALUES_PER_CALL) { dropped.push(kolom); continue; }
    values += 1;
    entries.push({ kolom, isi: String(raw).slice(0, MAX_VALUE) });
  }
  return { formId, entries, dropped };
}

async function fillForm({ user, input, ctx }) {
  const { formId, entries, dropped } = cleanFill(input);
  const audit = { route: bridge.channelOf(ctx.answerId)?.route || ctx.route || null, formId: NAME.test(formId) ? formId : null, fields: entries.map((entry) => entry.kolom) };
  if (!NAME.test(formId)) return { audit, ok: false, result: fail('Sebut id formulir dari baca_formulir.') };
  if (!entries.length) return { audit, ok: false, result: fail('Tidak ada kolom yang diisi.') };

  // The form's permission comes from the page: read the page first when this
  // answer has not seen the form yet.
  let channel = bridge.channelOf(ctx.answerId);
  if (!channel?.forms.has(formId)) {
    const read = await readForms({ user, ctx });
    if (read.ok === false) return { audit, ok: false, result: read.result };
    channel = bridge.channelOf(ctx.answerId);
  }
  const known = channel?.forms.get(formId);
  if (!known) return { audit, ok: false, result: fail('Formulir itu tidak terbuka di halaman pengguna. Buka dulu dengan buka_halaman, lalu baca_formulir.') };
  if (!known.listed) return { audit, ok: false, result: fail('Formulir ini belum terdaftar di katalog formulir Prakasa AI, jadi tidak bisa diisi AI.') };
  // Re-checked on every fill against the catalog itself (any of `permission` and all of `requires`).
  const cataloged = formCatalog.byId.get(formId);
  if (!known.permission || !holdsAny(user, known.permission) || !known.catalogPermission || !cataloged || !formCatalog.mayFill(user, cataloged)) {
    return { audit, ok: false, denied: true, result: fail('Pengguna tidak punya izin untuk formulir ini.') };
  }
  if (!known.usable) return { audit, ok: false, result: fail('Formulir ubah ini tidak menyebut data yang diubah.') };
  if (known.record) { audit.mode = 'edit'; audit.recordType = known.record.type; audit.recordId = known.record.id; }

  // Never the agent's to fill, whatever the page or the model says.
  const guarded = channel?.fromDocument === true;
  const refused = dropped.map((kolom) => ({ kolom, alasan: `Terlalu banyak isian dalam satu panggilan (paling banyak ${MAX_ROWS} baris per daftar dan ${MAX_VALUES_PER_CALL} isian). Kirim sisanya di panggilan berikutnya.` }));
  const allowed = [];
  for (const entry of entries) {
    const kind = fieldClass(entry.kolom);
    const field = known.fields.get(entry.kolom);
    if (kind !== 'open') { refused.push({ kolom: entry.kolom, alasan: USER_ONLY }); continue; }
    if (!field) { refused.push({ kolom: entry.kolom, alasan: UNKNOWN }); continue; }
    if (!field.fillable) { refused.push({ kolom: entry.kolom, alasan: USER_ONLY }); continue; }
    if (!entry.baris) {
      if (field.type === 'rows') refused.push({ kolom: entry.kolom, alasan: 'Kolom ini daftar baris. Isi dengan "baris".' });
      else if (guarded && identifierLike(entry.isi)) refused.push({ kolom: entry.kolom, alasan: IDENTIFIER });
      else allowed.push(entry);
      continue;
    }
    if (field.type !== 'rows') { refused.push({ kolom: entry.kolom, alasan: 'Kolom ini bukan daftar baris. Isi dengan "isi".' }); continue; }
    // Every cell passes the same rules as a field: by its name, then by the form's policy.
    const baris = entry.baris.map((row, index) => {
      const cells = {};
      for (const [name, value] of Object.entries(row)) {
        const column = field.columns.get(name);
        const ref = `${entry.kolom}[${index + 1}].${name}`;
        if (fieldClass(name) !== 'open') refused.push({ kolom: ref, alasan: USER_ONLY });
        else if (!column) refused.push({ kolom: ref, alasan: UNKNOWN });
        else if (!column.fillable) refused.push({ kolom: ref, alasan: USER_ONLY });
        else if (guarded && identifierLike(value)) refused.push({ kolom: ref, alasan: IDENTIFIER });
        else cells[name] = value;
      }
      return cells;
    });
    if (baris.some((row) => Object.keys(row).length)) allowed.push({ kolom: entry.kolom, baris, cara: entry.cara });
  }
  if (!allowed.length) return { audit, ok: false, result: { formulir: formId, judul: known.title, diisi: [], ditolak: refused, catatan: SAVE_NOTE } };

  const answer = await bridge.request({ answerId: ctx.answerId, tool: 'isi_form', op: 'fillForm', input: { formulir: formId, isian: allowed } });
  if (!answer.ok) return { audit, ok: false, result: fail(answer.error) };
  const got = answer.result || {};
  const asked = new Set(allowed.map((entry) => entry.kolom));
  const askedRows = new Map(allowed.filter((entry) => entry.baris).map((entry) => [entry.kolom, entry.baris.length]));
  const filled = (Array.isArray(got.diisi) ? got.diisi : []).map((name) => text(String(name), 60)).filter((name) => asked.has(name));
  // What the browser refused: a field that was asked, or a row / cell of a rows
  // field that was asked. Candidates only for a lookup the form really has.
  const refusal = (item) => {
    const kolom = text(item?.nama ?? item?.kolom, 130);
    const alasan = text(item?.alasan, 200) || 'Ditolak formulir.';
    const ref = ROW_REF.exec(kolom);
    let field = null;
    if (ref) {
      if (!askedRows.has(ref[1]) || Number(ref[2]) < 1 || Number(ref[2]) > askedRows.get(ref[1])) return null;
      field = ref[3] ? known.fields.get(ref[1])?.columns?.get(ref[3]) : null;
      if (ref[3] && (!field || fieldClass(ref[3]) !== 'open')) return null;
    } else {
      if (!NAME.test(kolom) || !asked.has(kolom)) return null;
      field = known.fields.get(kolom);
    }
    const out = { kolom, alasan };
    if (field && LOOKUP_TYPES.has(field.type) && Array.isArray(item?.kandidat)) {
      const kandidat = item.kandidat.slice(0, MAX_CANDIDATES).map((label) => text(String(label ?? ''), 160)).filter(Boolean);
      if (kandidat.length) out.kandidat = kandidat;
    }
    return out;
  };
  const rowsAdded = {};
  for (const [name, count] of Object.entries(got.baris && typeof got.baris === 'object' ? got.baris : {})) {
    if (askedRows.has(name) && filled.includes(name) && Number.isInteger(count) && count > 0) rowsAdded[name] = Math.min(count, askedRows.get(name));
  }
  const pairs = (list) => (Array.isArray(list) ? list : []).slice(0, MAX_FIELDS)
    .map((item) => ({ kolom: text(item?.nama ?? item?.kolom, 60), alasan: text(item?.alasan, 200) || 'Ditolak formulir.' }))
    .filter((item) => NAME.test(item.kolom));
  audit.filled = filled;
  if (Object.keys(rowsAdded).length) audit.rows = rowsAdded;
  return {
    audit,
    result: {
      formulir: formId,
      judul: known.title,
      diisi: filled,
      ...(Object.keys(rowsAdded).length ? { baris_ditambahkan: rowsAdded } : {}),
      ditolak: [...refused, ...(Array.isArray(got.ditolak) ? got.ditolak : []).slice(0, MAX_VALUES_PER_CALL).map(refusal).filter(Boolean)],
      masih_perlu: pairs(got.masih_perlu).filter((item) => known.fields.has(item.kolom)),
      catatan: SAVE_NOTE,
    },
  };
}

const RUNNERS = Object.freeze({ navigate: openPage, readForms, fillForm });

// Runs one page tool for an agent answer. Resolves with
// { result, audit, ok } — `result` goes to the model, `audit` (route, form id,
// field NAMES — never values) to activity_logs.
async function run({ tool, user, input, ctx }) {
  const runner = RUNNERS[tool.clientOp];
  if (!runner) throw Object.assign(new Error('Alat halaman tidak dikenal'), { status: 400, code: 'CLIENT_TOOL' });
  const clean = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const outcome = await runner({ user, input: clean, ctx });
  return { ok: outcome.ok !== false, denied: outcome.denied === true, result: outcome.result, audit: outcome.audit || {} };
}

// The step as the conversation shows it: "Membuka halaman Tiket IT",
// "Mengisi 4 kolom di formulir Tiket IT". `event.detail` (route, form id,
// field count — never values) comes from the CLI stream.
function describeStep(event, { answerId = null } = {}) {
  if (event?.type !== 'step' || !event.detail) return event;
  const { detail, ...rest } = event;
  if (event.tool === 'buka_halaman') {
    const parsed = parseRoute(detail.rute);
    let title = null;
    if (parsed) {
      // eslint-disable-next-line global-require
      title = require('../../aiToolRegistry.service').resolveTool(parsed.pathname)?.tool.title || null;
    }
    return title ? { ...rest, label: `Membuka halaman ${title}`, target: null } : { ...rest, target: null };
  }
  if (event.tool === 'isi_form') {
    const id = text(detail.formulir, 60);
    const title = bridge.channelOf(answerId)?.forms.get(id)?.title || formCatalog.byId.get(id)?.title || null;
    const count = Number.isInteger(detail.kolom) && detail.kolom > 0 ? detail.kolom : null;
    if (title && count) return { ...rest, label: `Mengisi ${count} kolom di formulir ${title}`, target: null };
    return { ...rest, target: null };
  }
  return rest;
}

module.exports = {
  BLOCKED_ROUTES, FIELD_TYPES, SAVE_NOTE, IDENTIFIER, fieldClass, wordsOf, parseRoute, pageFor, cleanForm, cleanFill, run, describeStep,
};
