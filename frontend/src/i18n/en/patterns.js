// Hand-written English patterns for generic shapes the extractor cannot name
// one by one. Ordered: the first match wins. They run BEFORE the generated
// templates (en/<chunk>.patterns.json), except those marked `fallback: true`,
// which run last.
//   match: anchored RegExp (^…$) tested on the whitespace-normalised text
//   to:    'English with $1 (verbatim) / $t1 (translated)', or (groups, t) => string
//          (`t.exact(text)` says whether a piece is a known label — in the
//          dictionary or identical in English; `t.known` also accepts a pattern;
//          returning null declines the match, so the next pattern is tried)
//   word:  optional literal word every match contains (skips the regex fast)
//   safe:  a formatted date — also applied to a group that a template inserts
//          verbatim (the backend sends "Okt 2026" inside a longer label)
//   strict: also applies in a sentence zone (data-translate="strict"): a count
//          or a duration, never a phrase a user could have typed. Dates are.
//   split: translates its pieces one by one ("a · b"); in a sentence zone the
//          pieces stay under the strict rules
// Every pattern here has a case in test/i18nTranslate.test.js.
import { templateGroups, templateToRegexSource } from '../translate.js';
import contexts from './contexts.js';

const ID_MONTHS = {
  Jan: 'Jan', Feb: 'Feb', Mar: 'Mar', Apr: 'Apr', Mei: 'May', Jun: 'Jun', Jul: 'Jul', Agu: 'Aug', Sep: 'Sep', Okt: 'Oct', Nov: 'Nov', Des: 'Dec',
  Januari: 'January', Februari: 'February', Maret: 'March', April: 'April', Juni: 'June', Juli: 'July', Agustus: 'August',
  September: 'September', Oktober: 'October', November: 'November', Desember: 'December',
};
const ID_DAYS = {
  Min: 'Sun', Sen: 'Mon', Sel: 'Tue', Rab: 'Wed', Kam: 'Thu', Jum: 'Fri', Sab: 'Sat',
  Minggu: 'Sunday', Senin: 'Monday', Selasa: 'Tuesday', Rabu: 'Wednesday', Kamis: 'Thursday', Jumat: 'Friday', Sabtu: 'Saturday',
};
// The English names map to themselves: a date the frontend already wrote in
// English ("30 Sep 2026, 14:05", "Thursday, 1 Oct 2026") is the same date —
// recognised, so the crawl does not report it as untranslated text.
const identity = (names) => Object.fromEntries(names.map((name) => [name, name]));
const MONTHS = { ...identity(Object.values(ID_MONTHS)), ...ID_MONTHS };
const DAYS = { ...identity(Object.values(ID_DAYS)), ...ID_DAYS };
const MONTH = Object.keys(MONTHS).join('|');
const DAY = Object.keys(DAYS).join('|');
// A number as the app writes it: "5", "1.234", "0,4".
const NUM = '\\d[\\d.,]*';
const one = (n) => n === '1';
const plural = (n, [single, many]) => `${n} ${one(n) ? single : many}`;

// Time units and the nouns the app counts with a unit chosen at run time
// (`${n} ${unit}`: targets, stat cards, import summaries).
const TIME = {
  detik: ['second', 'seconds'], menit: ['minute', 'minutes'], mnt: ['min', 'min'], jam: ['hour', 'hours'], hari: ['day', 'days'],
  minggu: ['week', 'weeks'], bulan: ['month', 'months'], tahun: ['year', 'years'],
};
const COUNTED = {
  barang: ['item', 'items'], item: ['item', 'items'], dokumen: ['document', 'documents'], issue: ['issue', 'issues'],
  poin: ['point', 'points'], orang: ['person', 'people'], baris: ['row', 'rows'], faktur: ['invoice', 'invoices'],
  kamera: ['camera', 'cameras'], perangkat: ['device', 'devices'], divisi: ['division', 'divisions'],
  pelanggan: ['customer', 'customers'], tugas: ['task', 'tasks'], tiket: ['ticket', 'tickets'], produk: ['product', 'products'],
  kunjungan: ['visit', 'visits'], pengguna: ['user', 'users'], lampiran: ['attachment', 'attachments'],
  kolom: ['column', 'columns'], karakter: ['character', 'characters'], akun: ['account', 'accounts'],
  pesanan: ['order', 'orders'], kampanye: ['campaign', 'campaigns'], lokasi: ['location', 'locations'],
};
const TIME_UNIT = Object.keys(TIME).join('|');
const COUNT_UNIT = Object.keys(COUNTED).join('|');

const ago = (id) => ({ strict: true, match: new RegExp(`^(${NUM}) ${id} (?:yang )?lalu$`), word: id, to: ([n]) => `${plural(n, TIME[id])} ago` });
const left = (id) => ({ strict: true, match: new RegExp(`^(${NUM}) ${id} lagi$`), word: id, to: ([n]) => `in ${plural(n, TIME[id])}` });

// A generated template whose English must translate a group the translators
// kept verbatim: the group holds text the app itself builds (a duration, a
// list of field labels), not record data. Same $n / $tn notation as
// en/<chunk>.patterns.json; it runs first because it is hand-written.
const retemplate = (template, to, { strict = false } = {}) => {
  const order = templateGroups(template);
  return {
    // A whole sentence of the app: it also applies in a sentence zone.
    strict,
    match: new RegExp(templateToRegexSource(template)),
    word: (template.replace(/\$\d+/g, ' ').match(/\p{L}{2,}/gu) || []).reduce((best, w) => (w.length > best.length ? w : best), '') || undefined,
    // " · " joins independent fragments: a template without one never
    // matches across it (the fragments are translated one by one).
    to: (groups, t) => (!template.includes('·') && groups.some((group) => /(^|\s)·(\s|$)/.test(group)) ? null : to.replace(/\$(t?)(\d+)/g, (whole, flag, digits) => {
      const index = order.indexOf(Number(digits));
      if (index < 0) return whole;
      return flag === 't' ? t(groups[index]) : groups[index];
    })),
  };
};

// "Aktif 3": a label and its count, as written inside a list.
const LABEL_COUNT = new RegExp(`^(\\p{L}[\\p{L} ./&-]*?) (${NUM})$`, 'u');
const SEPARATORS = { ', dan ': ', and ', ', atau ': ', or ', ' dan ': ' and ', ' atau ': ' or ' };
const STARTS_WITH_NUMBER = /^[±><≥≤~]? ?\d/;
// One item of a list: translated, or null when it is not interface text. An
// item is a label the dictionary knows, a count or duration ("3 baru",
// "2 hari") or a label with its count ("Aktif 3") — never a phrase that only
// a template with a free group would match.
function listItem(item, t) {
  if (t.exact(item)) return t(item);
  if (STARTS_WITH_NUMBER.test(item) && t.known(item)) return t(item);
  const pair = LABEL_COUNT.exec(item);
  if (pair && t.exact(pair[1])) return `${t(pair[1])} ${pair[2]}`;
  // "Selesai 3 (60%)": a label, its count and its share.
  const share = /^(.+) (\(\d[\d.,]*%\))$/.exec(item);
  if (share) { const head = listItem(share[1], t); return head === null ? null : `${head} ${share[2]}`; }
  return null;
}

// Dates written by the backend (the frontend's own dates already follow the
// language): "Okt 2026", "5 Okt 2026", "Sen, 5 Okt", "5 Okt 2026, 14.05",
// "Oktober 2026", "5–11 Okt 2026", "Kamis, 1 Okt pukul 14.05 WIB",
// "Kamis, 1 Okt 14.00 WIB", "1 Okt 2026, 14.00–15.30".
const DATE_RULES = [
  { match: new RegExp(`^(${MONTH}) (\\d{4})$`), safe: true, to: ([m, y]) => `${MONTHS[m]} ${y}` },
  {
    match: new RegExp(`^(?:(${DAY}), )?(\\d{1,2}(?: ?[–-] ?\\d{1,2})?) (${MONTH})( \\d{4})?(?:(,? | pukul )(\\d{1,2})[.:](\\d{2})(?:([–-])(\\d{1,2})[.:](\\d{2}))?( WIB)?)?$`),
    safe: true,
    to: ([day, date, month, year, gap, hour, minute, dash, hour2, minute2, zone]) => `${day ? `${DAYS[day]}, ` : ''}${date} ${MONTHS[month]}${year}${hour ? `${gap === ' pukul ' ? ', ' : gap}${hour}:${minute}${dash ? `${dash}${hour2}:${minute2}` : ''}${zone}` : ''}`,
  },
  // "Okt–Des", "Jan – Mar 2026": a month range.
  {
    match: new RegExp(`^(${MONTH})( ?[–-] ?)(${MONTH})( \\d{4})?$`),
    safe: true,
    to: ([from, dash, until, year]) => `${MONTHS[from]}${dash}${MONTHS[until]}${year}`,
  },
  // "Kuartal 4 2026 (Okt–Des)": a quarter label of the targets.
  {
    match: new RegExp(`^Kuartal (\\d) (\\d{4})(?: \\((${MONTH})[–-](${MONTH})\\))?$`),
    word: 'Kuartal',
    safe: true,
    to: ([q, year, from, until]) => `Q${q} ${year}${from ? ` (${MONTHS[from]}–${MONTHS[until]})` : ''}`,
  },
];
// Labels the backend puts before a document number in a title.
const TITLE_LABELS = {
  Listrik: 'Electricity', Air: 'Water', Gas: 'Gas', Lainnya: 'Other', Utilitas: 'Utilities',
  'Barang Masuk': 'Inbound goods', 'Barang Keluar': 'Outbound goods', 'Barang masuk': 'Inbound goods', 'Barang keluar': 'Outbound goods',
  Pergerakan: 'Movement', Penerimaan: 'Receipt', 'Surat jalan': 'Delivery note',
};
// The English of a text that is a date and nothing else, or null.
function asDate(text) {
  for (const rule of DATE_RULES) {
    const match = rule.match.exec(text);
    if (match) return rule.to(match.slice(1).map((group) => group ?? ''));
  }
  return null;
}

export default [
  // The step Prakasa AI shows while it fills a form (backend clientTools.js
  // describeStep): the title is ONE form ("Pelanggan baru" = New customer here,
  // contexts.js `form`). Declines for a title that is not interface text.
  {
    match: new RegExp(`^Mengisi (${NUM}) kolom di formulir (.+)$`),
    word: 'formulir',
    to: ([n, title], t) => {
      const form = contexts.form[title] || (t.known(title) ? t(title) : null);
      return form === null ? null : `Filling ${plural(n, ['field', 'fields'])} in the ${form} form`;
    },
  },
  // ------------------------------------------------------------------ dates
  ...DATE_RULES,
  // "1 Agu 2026 – 1 Okt 2026", "Nov 2025 – Okt 2026": from one date to another.
  {
    match: /^(\S.*?) ([–-]) (\S.*)$/,
    safe: true,
    to: ([from, dash, until]) => {
      const a = asDate(from);
      const b = asDate(until);
      return a === null || b === null ? null : `${a} ${dash} ${b}`;
    },
  },
  // "<label>, Okt 2026": something the app names, then a month or a date.
  {
    match: /^(.+), ([^,]*\d{4})$/,
    to: ([head, tail], t) => { const date = asDate(tail); return date !== null && t.covers(head) ? `${t(head)}, ${date}` : null; },
  },
  // A lone month or weekday label (chart ticks, calendar heads).
  { match: new RegExp(`^(${MONTH})$`), to: ([m]) => MONTHS[m] },
  { match: new RegExp(`^(${DAY})$`), to: ([d]) => DAYS[d] },
  // Money as the app writes it in both languages: "Rp 1.234.567", "-Rp 5.000".
  { match: /^([-+]?Rp ?-?\d[\d.,]*)$/, to: ([money]) => money },

  // ------------------------------------------------- time, with plurals
  ago('detik'), ago('menit'), ago('jam'), ago('hari'), ago('minggu'), ago('bulan'), ago('tahun'),
  left('menit'), left('jam'), left('hari'), left('minggu'), left('bulan'),
  // A duration: "3 hari", "1 jam", "0,4 hari", "± 3 hari", "> 90 hari".
  {
    strict: true,
    match: new RegExp(`^([±><≥≤~] ?)?(${NUM}) (${TIME_UNIT})$`),
    to: ([sign, n, unit]) => `${sign}${plural(n, TIME[unit])}`,
  },
  // "2 jam 05 mnt" (Google Analytics session length).
  { match: new RegExp(`^(${NUM}) jam (\\d{1,2}) mnt$`), word: 'mnt', to: ([h, m]) => `${h} h ${m} min` },
  // Past a date: "lewat 5 hari", "Terlambat 1 hari", "Terlambat bayar 3 hari".
  {
    match: new RegExp(`^([Ll]ewat|[Tt]erlambat|Terlambat bayar) (${NUM}) hari$`),
    word: 'hari',
    to: ([word, n]) => `${plural(n, TIME.hari)} ${{ lewat: 'overdue', terlambat: 'late', 'terlambat bayar': 'late paying' }[word.toLowerCase()]}`,
  },
  // A ceiling: "maks. 1 hari", "maks. 6 issue".
  { match: /^maks\. (.+)$/, word: 'maks', to: ([value], t) => `max. ${t(value)}` },

  // ------------------------------------------------------ counted nouns
  // `${n} ${unit}` with a unit picked at run time: "12 barang", "1 dokumen",
  // "6 issue", "3 poin".
  { strict: true, match: new RegExp(`^(${NUM}) (${COUNT_UNIT})$`), to: ([n, unit]) => plural(n, COUNTED[unit]) },

  // App launcher: "Hapus Gmail dari favorit" / "Tambahkan Gmail ke favorit".
  { match: /^(Hapus|Tambahkan) (.+) (?:dari|ke) favorit$/, word: 'favorit', to: ([verb, app]) => (verb === 'Hapus' ? `Remove ${app} from favorites` : `Add ${app} to favorites`) },

  // --------------------------------------------- text the app builds itself
  // (a group the generated template keeps verbatim, but which is a duration,
  // a unit or a list of interface labels — never record data)
  // Management flow: "median 1 hari · rata-rata 0,4 · p90 3 · 97 SO".
  retemplate('median $1 · rata-rata $2 · p90 $3 · $4 $5', 'median $t1 · average $2 · p90 $3 · $4 $t5'),
  // Targets export: "12 hari / target maks. 10 hari (Tertinggal)".
  retemplate('$1 / target $2 ($3)', '$t1 / target $t2 ($t3)'),
  // Accurate sync panel (SalesAccurateBatch.jsx): "Terakhir: 30 Sep 2026,
  // 08.33 oleh IT Admin, Sales order: 566 baru, 58 berubah · Faktur: 3 baru."
  // The date holds a comma and the name is a person's: no template can cut it.
  {
    word: 'Terakhir',
    match: /^Terakhir: (\d{1,2} \p{L}+ \d{4}, \d{1,2}[.:]\d{2})(?: oleh (.+?))?, (\p{L}.*)\.$/u,
    to: ([date, by, outcome], t) => `Last: ${asDate(date) ?? date}${by ? ` by ${by}` : ''}, ${t(outcome)}.`,
  },
  // Tracker charts, one row of the screen-reader summary: "Tanpa divisi 1
  // belum selesai, 0 dikerjakan, 0 selesai, 0 terlambat" (a division or
  // "Tanpa divisi" translates, a project's or a person's name stays).
  {
    word: 'dikerjakan',
    match: new RegExp(`^(.+) (${NUM}) belum selesai, (${NUM}) dikerjakan, (${NUM}) selesai, (${NUM}) terlambat$`),
    to: ([label, open, doing, done, late], t) => `${t(label)} ${open} not done, ${doing} in progress, ${done} done, ${late} late`,
  },
  // …and the whole summary: "Perbandingan 2 divisi: <row>; <row>." (before
  // the row's own template would read the head as a row label).
  {
    word: 'Perbandingan',
    match: new RegExp(`^Perbandingan (${NUM}) divisi: (.+)\\.$`),
    to: ([count, rows], t) => `Comparison of ${plural(count, ['division', 'divisions'])}: ${rows.split('; ').map((row) => t(row)).join('; ')}.`,
  },
  // Task activity: "Diubah: judul, jatuh tempo".
  retemplate('Diubah: $1', 'Changed: $t1'),
  // Targets: "<metric labels> tidak ditampilkan untuk akun Anda. <reason>."
  retemplate('$1 tidak ditampilkan untuk akun Anda. $2.', '$t1 is not shown for your account. $t2.'),
  // Management flow: "Data Accurate Sales dan Warehouse masih menunggu persetujuan — …".
  retemplate('Data Accurate $1 masih menunggu persetujuan — angka di sini belum memuatnya.', 'Accurate data for $t1 is still awaiting approval — the figures here do not include it yet.'),
  // Payment requests: lists of attachment type labels.
  retemplate('Lampirkan dulu: $1', 'Attach first: $t1'),
  retemplate('Wajib dilampirkan sebelum diajukan: $1.', 'Must be attached before submitting: $t1.'),
  // Receivables / payables: "3 faktur uang muka dan 1 faktur mata uang asing belum lunas …".
  retemplate('$1 belum lunas tidak dihitung dalam angka di halaman ini.', '$t1 not yet paid are not counted in the figures on this page.'),
  // Escalations: "Resign tanpa offboarding — masih terbuka: akun aplikasi aktif, 2 lisensi".
  retemplate('Resign tanpa offboarding — masih terbuka: $1', 'Resigned without offboarding — still open: $t1'),
  // Onboarding: "People & Culture, aktif; Sales, resign. Tautkan bila …" (division names and a status).
  retemplate('$1. Tautkan bila orangnya sama (misalnya bekerja lagi), supaya direktori tidak ganda.', '$t1. Link if it is the same person (for example, working here again), so the directory has no duplicates.'),
  // GA notification title: "Permintaan GA sedang diproses".
  retemplate('Permintaan GA $1', 'GA request $t1'),
  // Document numbers from Accurate, cut short: "DO-1, DO-2 +3 lainnya".
  retemplate('$1 baris tanpa kode barang — belum bisa dicocokkan dengan $2', '$1 lines without an item code — cannot be matched with $t2 yet', { strict: true }),
  retemplate('$1 barang beda jumlah dengan $2 (satuan dasar)', '$1 items differ in quantity from $t2 (base unit)', { strict: true }),
  { match: /^([^·]+) \+(\d+) lainnya$/, word: 'lainnya', to: ([shown, more], t) => `${t(shown)} +${more} more` },
  // ------------------------------- escalation context lines (Pusat Eskalasi)
  // Composed by the management providers (backend/src/management/providers/)
  // from the app's own labels and counts, and shown in a sentence zone.
  // IT ticket (it.js): "Jaringan · prioritas Tinggi". The category may be a
  // code of an older ticket: it stays, the rest translates.
  {
    strict: true,
    word: 'prioritas',
    match: /^([^·]+) · prioritas (\p{L}[\p{L} ]*)$/u,
    to: ([category, priority], t) => (t.exact(priority) && t(priority) !== priority ? `${t.exact(category) ? t(category) : category} · ${t(priority)} priority` : null),
  },
  // Warehouse incident (warehouse.js): "Investigasi · tingkat Tinggi".
  {
    strict: true,
    word: 'tingkat',
    match: /^([^·]+) · tingkat (\p{L}[\p{L} ]*)$/u,
    to: ([status, severity], t) => (t.exact(severity) && t(severity) !== severity ? `${t.exact(status) ? t(status) : status} · ${t(severity)} severity` : null),
  },
  // Late sales order (warehouse.js): "62.5% terkirim · janji kirim 2026-09-22
  // (standar 2×24 jam dari tanggal SO, digeser ke Senin)".
  {
    strict: true,
    word: 'terkirim',
    match: new RegExp(`^(${NUM})% terkirim · janji kirim (\\S+) \\((Tgl kirim SO|standar (\\d+)×24 jam dari tanggal SO(, digeser ke Senin)?)\\)$`),
    to: ([percent, date, basis, days, moved]) => `${percent}% shipped · promised ${asDate(date) ?? date} (${basis === 'Tgl kirim SO' ? 'SO delivery date' : `standard ${days}×24 hours from the SO date${moved ? ', moved to Monday' : ''}`})`,
  },
  // Items about to run out (procurement.js): "6 barang habis sebelum barang
  // datang, belum ada PO baru · paling cepat habis ± 4 hari · waktu datang 7
  // hari (perkiraan) · 2 dengan PO lama belum ditutup · 1 stok minus di Accurate".
  {
    strict: true,
    word: 'habis',
    match: /^(\d+) barang habis sebelum barang datang, belum ada PO baru · paling cepat habis ± (\d+) hari · waktu datang (\d+) hari( \(perkiraan\))?(?: · (\d+) dengan PO lama belum ditutup)?(?: · (\d+) stok minus di Accurate)?$/,
    to: ([items, cover, lead, estimate, legacy, negative]) => `${one(items) ? '1 item runs' : `${items} items run`} out before incoming goods arrive, no new PO yet · earliest in ± ${plural(cover, TIME.hari)}`
      + ` · lead time ${plural(lead, TIME.hari)}${estimate ? ' (estimate)' : ''}${legacy ? ` · ${legacy} with old POs not closed yet` : ''}${negative ? ` · ${negative} with negative stock in Accurate` : ''}`,
  },

  // Campaign figures: "30 hari sebelumnya: Rp 1,2 jt".
  { match: new RegExp(`^(${NUM}) hari sebelumnya: (.+)$`), word: 'sebelumnya', to: ([n, value], t) => `Previous ${plural(n, TIME.hari)}: ${t(value)}` },

  // A filter chip with its count: "Aktif (12)", "Lewat jatuh tempo (2)".
  {
    match: /^(\p{L}[^()]*) \((\d[\d.]*)\)$/u,
    to: ([label, count], t) => (t.exact(label) ? `${t(label)} (${count})` : null),
  },
  // "Pelanggan: 3 baru, 2 berubah": a known label, then counts. Before the
  // templates, because "$1 baru" would take "Pelanggan: 3" for its number.
  {
    match: /^(\p{L}[^:·]{1,40}): ([±><≥≤~]? ?\d.*)$/u,
    // Only when the counts translate as a whole: a longer sentence that
    // happens to start with "Label: 3 …" has its own template.
    to: ([label, value], t) => (t.exact(label) && t.covers(value) ? `${t(label)}: ${t(value)}` : null),
  },

  // ------------------------------------------------------------------ lists
  // "a, b dan c" / "a; b": a list is translated only when EVERY item
  // is interface text (a label, a duration, "Aktif 3"). One unknown item — a
  // name, something a user typed — and the match is declined, so the text
  // goes on to the generated templates untouched by this rule. It runs before
  // them because a generic template ("$1 dan $2", "$1 baris") would otherwise
  // swallow the whole list into one verbatim group.
  {
    match: /^(.+(?:, |; | dan | atau ).+)$/,
    to: ([whole], t) => {
      if (whole.includes(' · ')) return null;
      const tail = whole.endsWith('.') ? '.' : '';
      const parts = (tail ? whole.slice(0, -1) : whole).split(/(, dan |, atau |, |; | dan | atau )/);
      const out = [];
      for (let i = 0; i < parts.length; i += 1) {
        if (i % 2) { out.push(SEPARATORS[parts[i]] || parts[i]); continue; }
        const item = parts[i].trim() ? listItem(parts[i], t) : null;
        if (item === null) return null;
        out.push(item);
      }
      return out.join('') + tail;
    },
  },

  // GA request titles, composed and stored by the backend
  // (gaRequests.service.js): "ATK: Kertas HVS (+3 barang lain)", "Perbaikan: Lobi".
  {
    strict: true,
    word: 'ATK',
    match: /^ATK: (.+?)(?: \(\+(\d+) barang lain\))?$/,
    to: ([item, more]) => `Office supplies: ${item}${more ? ` (+${more} more)` : ''}`,
  },
  { strict: true, word: 'Perbaikan', match: /^Perbaikan: (.+)$/, to: ([area]) => `Repair: ${area}` },
  // Titles the backend composes for approvals, escalations and the home
  // cards: a label and a document number ("Barang Masuk SJ-001",
  // "Penerimaan RI-1, RI-2 +3 lainnya", "Listrik 2026-09").
  {
    strict: true,
    match: new RegExp(`^(${Object.keys(TITLE_LABELS).join('|')}) (\\S*[\\d#]\\S*(?:, \\S+)*(?: \\+\\d+ lainnya)?)$`),
    to: ([label, code]) => `${TITLE_LABELS[label]} ${code.replace(/ \+(\d+) lainnya$/, ' +$1 more')}`,
  },
  // "Dokumen #12", "Task #7": a known label and a record id.
  {
    strict: true,
    match: /^(\p{Lu}[\p{L} ]*?) #(\d+)$/u,
    to: ([label, id], t) => (t.exact(label) ? `${t(label)} #${id}` : null),
  },
  // Finance approval title (financeRequests.service.js):
  // "Pengajuan pembayaran Rp 1.500.000 ke PT Maju".
  {
    strict: true,
    match: /^(Reimbursement|Pengajuan pembayaran) ((?:Rp|[A-Z]{3}) ?[\d.,]+)(?: ke (.+))?$/,
    to: ([kind, money, payee]) => `${kind === 'Reimbursement' ? 'Reimbursement' : 'Payment request'} ${money}${payee ? ` to ${payee}` : ''}`,
  },
  // Onboarding approval subtitle (hrgaWorkflow.service.js): "Onboarding mulai 5 Okt 2026".
  {
    strict: true,
    match: /^(Onboarding|Offboarding) (mulai|hari terakhir) (.+)$/,
    to: ([type, word, date]) => `${type} ${word === 'mulai' ? 'starts' : 'last day'} ${asDate(date) ?? date}`,
  },
  // A list of names cut short (salesReminders.service.js): "A, B, dan 3 lainnya".
  { strict: true, word: 'lainnya', match: /^(.+), dan (\d+) lainnya$/, to: ([names, more]) => `${names}, and ${more} more` },

  // ------------------------------------------------------------ fallbacks
  // "23 Sep 2026 (terlambat)", "Budi (nonaktif)": a suffix in brackets the
  // app adds to a date or a name. Only a suffix the dictionary knows.
  {
    match: /^(.+?) (\([^()]+\))$/,
    fallback: true,
    to: ([head, suffix], t) => {
      if (t.known(suffix) && t(suffix) !== suffix) return `${t(head)} ${t(suffix)}`;
      // "Budi (terjadwal)": the word in the brackets is a label on its own.
      const inner = suffix.slice(1, -1);
      return /^\p{Ll}/u.test(inner) && t.exact(inner) && t(inner) !== inner ? `${t(head)} (${t(inner)})` : null;
    },
  },
  // "Dikerjakan → Selesai": a change from one label to another.
  { match: /^(.+?) → (.+)$/, to: ([from, to], t) => `${t(from)} → ${t(to)}`, fallback: true },
  // "Pelanggan: 3 baru, 2 berubah": a label the app knows, then its value.
  {
    match: /^(\p{L}[^:]{1,40}): (.+)$/u,
    fallback: true,
    to: ([label, value], t) => {
      if (label.includes(' · ')) return null;
      // "Agu 2026: Rp 431,4 jt (+24,1%)": the label is a month.
      const date = asDate(label);
      if (date !== null) return `${date}: ${t(value)}`;
      return t.exact(label) ? `${t(label)}: ${t(value)}` : null;
    },
  },
  // A figure and its change: "Rp 431,4 jt (+24,1%)", "131 (-6,1%)".
  { match: /^(.+) \(([+-]?\d[\d.,]*%)\)$/, fallback: true, to: ([value, change], t) => `${t(value)} (${change})` },
  // "a · b · c": each part is translated on its own when it is interface
  // text (a status, a label, a duration) and kept when it is not. A template
  // that names the whole line wins; one that does not contain " · " never
  // matches across it (translate.js). Record-data zones are skipped before
  // this ever runs.
  // "Perangkat:" — a label that stands alone before a record's name.
  { match: /^(\p{L}[^:·]{1,40}):$/u, fallback: true, to: ([label], t) => (t.exact(label) ? `${t(label)}:` : null) },
  // Two sentences the app joins ("<reason>. Batch #18 (514 perubahan) sudah
  // menunggu keputusan."): only when both are sentences of the app.
  {
    match: /^(.+?\.) (\p{Lu}.+\.)$/u,
    fallback: true,
    to: ([first, second], t) => {
      const bare = first.slice(0, -1);
      const head = t.covers(first) ? t(first) : (t.covers(bare) ? `${t(bare)}.` : null);
      return head !== null && t.covers(second) ? `${head} ${t(second)}` : null;
    },
  },
  // A sentence built from such parts ends with one full stop: the last part
  // is looked up without it.
  {
    match: /^(.+ · .+)$/,
    fallback: true,
    split: true,
    to: ([whole], t) => {
      const parts = whole.split(' · ');
      const last = parts.length - 1;
      return parts.map((part, index) => {
        if (index === last && part.endsWith('.') && !t.covers(part) && t.covers(part.slice(0, -1))) return `${t(part.slice(0, -1))}.`;
        return t(part);
      }).join(' · ');
    },
  },
];

// English singular for the counts the generated templates write with a
// plural ("$1 days ago", "$1 rows", "$1 overdue invoices"): "1 days ago" →
// "1 day ago", "1 foreign currency invoices" → "1 foreign currency invoice".
// Applied to every pattern result (createTranslator's `finish`) — never to a
// record-data zone, which is not translated at all.
// The nouns are the ones the dictionary counts (en/*.patterns.json); a noun
// that is not listed keeps its plural, and so does the first half of a pair
// ("1 images/scans").
const SINGULAR = Object.fromEntries([...Object.values(TIME), ...Object.values(COUNTED), ['draft', 'drafts'], ['guest', 'guests'], ['license', 'licenses'],
  ['field', 'fields'], ['lead', 'leads'], ['line', 'lines'], ['file', 'files'], ['message', 'messages'], ['member', 'members'],
  ['warehouse', 'warehouses'], ['supplier', 'suppliers'], ['batch', 'batches'], ['event', 'events'], ['cell', 'cells'],
  ['change', 'changes'], ['role', 'roles'], ['movement', 'movements'], ['difference', 'differences'], ['sprint', 'sprints'], ['target', 'targets'],
  ['system', 'systems'], ['answer', 'answers'], ['step', 'steps'], ['link', 'links'], ['level', 'levels'], ['reaction', 'reactions'],
  ['reply', 'replies'], ['conversation', 'conversations'], ['receipt', 'receipts'], ['payment', 'payments'], ['program', 'programs'],
  ['contract', 'contracts'], ['number', 'numbers'], ['result', 'results'], ['outlet', 'outlets'], ['thing', 'things'], ['position', 'positions'],
  ['notification', 'notifications'], ['booking', 'bookings'], ['section', 'sections'], ['permission', 'permissions'], ['template', 'templates'],
  ['bill', 'bills'], ['PO', 'POs'], ['SO', 'SOs'],
].filter(([single, many]) => single !== many).map(([single, many]) => [many, single]));
// Words that end the noun phrase: after one of them the plural belongs to
// something else ("1 day until orders close", "1 of 3 items").
const NOT_IN_A_NOUN_PHRASE = new Set(('a an the of to in on at for from by with without until and or per is are was were has have had not no than before after since over '
  + 'under between into out as that which when while if but ago late left need needs used uses still already yet only each every all these those this its '
  + 'their your will can must should be been being does do did vs').split(' '));
// The verb right after the noun follows it: "1 items have" → "1 item has".
const VERB_FOR_ONE = { have: 'has', are: 'is', were: 'was', need: 'needs', contain: 'contains', differ: 'differs', do: 'does', match: 'matches' };
// "1 <up to three words> <plural noun>". Not after a digit or a separator of
// a number ("11 days", "0,1 days", "1–1 rows") and not after "#": "Batch #1
// rows" names a batch, it does not count rows.
const ONE_OF_MANY = new RegExp(`(^|[^\\d.,/–#-])1 ((?:[A-Za-z][A-Za-z/&-]* ){0,3}?)(${Object.keys(SINGULAR).join('|')})\\b(?![/-])(?: (${Object.keys(VERB_FOR_ONE).join('|')})\\b)?`, 'g');
export const finish = (english) => (english.includes('1 ') ? english.replace(ONE_OF_MANY, (whole, before, between, many, verb) => {
  if (between && between.trim().split(' ').some((word) => NOT_IN_A_NOUN_PHRASE.has(word.toLowerCase()))) return whole;
  return `${before}1 ${between}${SINGULAR[many]}${verb ? ` ${VERB_FOR_ONE[verb]}` : ''}`;
}) : english);
