// "Bagaimana cara …?" answered from the in-app handbook (Panduan), cut to the
// asking user's role exactly like the page (services/handbookAccess.js).
const handbook = require('../../../handbookAccess');
const registry = require('../../../aiToolRegistry.service');
const { text, int, userRoles } = require('./_shared');

const MAX_SECTIONS = 5;
// One section's text budget: the answer needs the steps, not a whole chapter.
const MAX_SECTION_CHARS = 3500;

// A block as plain, labelled data.
function blockOut(block) {
  switch (block.type) {
    case 'p': return { jenis: 'paragraf', teks: block.text };
    case 'note': return { jenis: 'catatan', teks: block.text };
    case 'warning': return { jenis: 'perhatian', teks: block.text };
    case 'steps': return { jenis: 'langkah', ...(block.title ? { judul: block.title } : {}), butir: block.items };
    case 'tips': return { jenis: 'tips', ...(block.title ? { judul: block.title } : {}), butir: block.items };
    case 'list': return { jenis: 'daftar', ...(block.title ? { judul: block.title } : {}), butir: block.items };
    case 'table': return { jenis: 'tabel', ...(block.title ? { judul: block.title } : {}), kolom: block.columns, baris: block.rows };
    case 'faq': return { jenis: 'tanya_jawab', butir: block.items.map((item) => ({ tanya: item.q, jawab: item.a })) };
    default: return null;
  }
}

function bodyOut(body) {
  const out = [];
  let used = 0;
  let cut = false;
  for (const block of body || []) {
    const mapped = blockOut(block);
    if (!mapped) continue;
    const size = JSON.stringify(mapped).length;
    if (out.length && used + size > MAX_SECTION_CHARS) { cut = true; break; }
    out.push(mapped);
    used += size;
  }
  return { isi: out, ...(cut ? { terpotong: true } : {}) };
}

// "Buka menu …": the page the text is about, by its menu name.
function openHint(route) {
  if (!route) return null;
  const path = String(route).split(/[?#]/)[0];
  const title = registry.resolveTool(path)?.tool?.title || null;
  return { rute: route, buka: title ? `Buka menu "${title}"` : `Buka halaman ${path}` };
}

const chapterIndex = (chapters) => chapters.map((chapter) => ({ bab: chapter.id, judul: chapter.title }));

module.exports = [
  {
    name: 'panduan_aplikasi',
    module: ['handbook', 'general'],
    label: 'Membaca Panduan aplikasi',
    description: 'Panduan Prakasa Workspace (menu "Panduan"): cara memakai aplikasi langkah demi langkah — menu, tombol, alur pengajuan dan persetujuan, aturan tiap modul. '
      + 'Pakai untuk pertanyaan "bagaimana cara …", "di mana …", "apa arti …". Isi pertanyaan dengan kata kunci; isi bab untuk membatasi ke satu bab. '
      + 'Hasil: bagian Panduan yang paling cocok dengan judul bab dan bagian, langkah, dan menu yang perlu dibuka. '
      + 'Hanya bagian yang boleh dibaca peran pengguna ini. Tidak pernah data transaksi, angka, atau isi record: ini teks panduan, bukan data.',
    inputSchema: {
      type: 'object',
      properties: {
        pertanyaan: { type: 'string', minLength: 2, maxLength: 300, description: 'Pertanyaan atau kata kunci, mis. "mengajukan pembayaran"' },
        bab: { type: 'string', maxLength: 60, description: 'Id bab untuk membatasi pencarian (lihat bab_tersedia), mis. "finance"' },
        jumlah: { type: 'integer', minimum: 1, maximum: MAX_SECTIONS, description: 'Maksimal bagian yang dikembalikan (default 3)' },
      },
      required: ['pertanyaan'],
      additionalProperties: false,
    },
    permission: null,
    public: true,
    async run(user, input = {}) {
      const roles = await userRoles(user);
      const reader = { permissions: user.permissions || [], roles };
      const visible = handbook.visibleChapters(reader);
      const question = text(input.pertanyaan, 300);
      const wanted = text(input.bab, 60).toLowerCase();
      const scoped = wanted ? visible.filter((chapter) => chapter.id === wanted) : visible;
      if (wanted && !scoped.length) {
        return { ditemukan: false, catatan: 'Bab itu tidak ada, atau tidak termasuk Panduan untuk peran pengguna ini.', bab_tersedia: chapterIndex(visible) };
      }
      const hits = handbook.search(scoped, question, { limit: int(input.jumlah, { min: 1, max: MAX_SECTIONS, fallback: 3 }) });
      if (!hits.length) {
        return {
          ditemukan: false,
          catatan: 'Tidak ada bagian Panduan yang cocok untuk peran pengguna ini. Coba kata kunci lain atau pilih bab.',
          bab_tersedia: chapterIndex(scoped),
        };
      }
      return {
        sumber: 'Panduan Prakasa Workspace (menu "Panduan"), sesuai peran pengguna',
        ditemukan: true,
        bagian: hits.map(({ chapter, section }) => ({
          bab: chapter.id,
          judul_bab: chapter.title,
          judul_bagian: section.title,
          ...(handbook.levelNote(section.audience) ? { untuk: handbook.levelNote(section.audience) } : {}),
          ...bodyOut(section.body),
          ...(openHint(section.route || chapter.route) || {}),
          baca_di_panduan: `/panduan#${chapter.id}-${section.id}`,
        })),
      };
    },
  },
];
