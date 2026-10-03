# Integrasi Modul Divisi ke Manajemen

**Aturan:** setiap modul divisi — yang sudah ada maupun yang akan dibangun — wajib terhubung ke lapisan manajemen. Tunggakannya muncul di **Pusat Eskalasi**, hasilnya bisa diberi target di **Target & realisasi**, dan angka kuncinya tampil di **Management Dashboard**. Semuanya **dibatasi per divisi**: Head divisi hanya melihat divisinya sendiri, sedangkan Management Office melihat seluruh perusahaan.

Aturan ini **ditegakkan oleh tes**, bukan hanya oleh dokumen ini. `backend/test/managementIntegration.test.js` gagal jika ada rute modul divisi di menu samping yang belum diwakili provider.

---

## 1. Cara kerjanya

Halaman manajemen **tidak mengenal tabel modul mana pun**. Setiap modul menyerahkan satu **provider**: satu file di `backend/src/management/providers/` yang menjelaskan apa yang perlu dilihat manajemen dari modul itu.

`backend/src/management/registry.js` menemukan file-file itu secara otomatis. Tidak ada daftar yang perlu diedit. Begitu file ada, modulnya langsung muncul di ketiga halaman manajemen, lengkap dengan label dan filternya. **Frontend manajemen tidak perlu diubah.**

```
modul divisi ──► provider (1 file) ──► registry ──┬─► Pusat Eskalasi
                                                  ├─► Target & realisasi
                                                  └─► Management Dashboard
```

## 2. Kerangka provider

```js
// backend/src/management/providers/warehouse.js
const pool = require('../../db/pool');
const { scope, escalationItem, byDepartment, int } = require('../helpers');

module.exports = {
  key: 'warehouse',                 // snake_case, unik
  label: 'Warehouse',               // bahasa Indonesia, tampil di halaman manajemen
  navPaths: ['/warehouse'],         // rute menu yang diwakili provider ini

  escalations: [ /* hal yang lewat tenggat — lihat §3 */ ],
  metrics:     [ /* hasil yang bisa diberi target — lihat §4 */ ],
  kpis:        [ /* angka kunci di dashboard — lihat §5 */ ],
};
```

Paling tidak satu dari `escalations`, `metrics`, atau `kpis` wajib diisi. Kalau sebuah modul memang tidak punya apa pun untuk dilaporkan (misalnya halaman pengaturan), tulis `optOut: 'alasannya'`. Kontrak menolak provider kosong tanpa alasan.

## 3. Eskalasi

```js
{
  key: 'movement_waiting',                 // unik di seluruh sistem
  label: 'Barang tertahan approval',
  async list(entityId, { departmentId }) { // → array escalationItem(...)
    const s = scope(departmentId, 'm.department_id');
    const [rows] = await pool.query(`SELECT … WHERE m.entity_id = ?${s.sql} …`, [entityId, ...s.args]);
    return rows.map((r) => escalationItem({
      sourceId: r.id, title: r.reference_no, context: 'Menunggu approval',
      departmentId: r.department_id, departmentName: r.department_name,
      ownerName: r.owner_name, daysLate: r.days_late, since: r.submitted_at,
      link: `/warehouse/movements/outbound/${r.id}`,   // hanya rute di dalam aplikasi
    }));
  },
  async locate(id) {                       // → { entityId, departmentId } | null
    const [[r]] = await pool.query('SELECT entity_id, department_id FROM … WHERE id = ?', [id]);
    return r ? { entityId: r.entity_id, departmentId: r.department_id } : null;
  },
}
```

- `list` hanya mengembalikan hal yang **benar-benar lewat batas waktu**. Batas waktunya ditulis sebagai konstanta bernama di provider, disertai alasannya.
- `locate` dipakai saat seseorang menulis tindak lanjut, supaya penulisan dibatasi divisi **sama persis** dengan pembacaan. Tanpa ini, Head divisi bisa menandai selesai eskalasi divisi lain.
- `key` eskalasi paling panjang **32 karakter**, karena disimpan di kolom `escalation_followups.source`. Kontrak menolak kunci yang lebih panjang.
- Satu kejadian = satu `sourceId`. Kalau kejadian yang sama bisa terulang setelah diselesaikan (misalnya pengiriman kedua dari PO yang sama), `sourceId` memuat nomor episode (`id × 100000 + hari`) supaya kejadian baru muncul lagi sebagai terbuka.

## 4. Metrik target

```js
{
  key: 'movements_approved', label: 'Pergerakan disetujui',
  unit: 'item',          // issue | poin | % | hari | item | rupiah
  better: 'higher',      // 'lower' untuk hal yang makin kecil makin baik (keterlambatan, durasi)
  cumulative: true,      // jumlah yang bertambah sepanjang periode → dinilai berdasarkan laju
  emptyIsZero: true,     // tidak ada baris = 0 (hitungan). Untuk rata-rata/persentase: biarkan false → "Belum ada data"
  async actuals(entityId, period, { departmentId }) {   // → Map(departmentId → angka|null)
    // period = { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', … }
    return byDepartment(rows, (r) => int(r.total));
  },
}
```

Realisasi **tidak pernah disimpan**. Nilainya selalu dihitung dari data nyata pada periode yang diminta.

- `key` metrik paling panjang **40 karakter** (kolom `division_targets.metric_key`).
- Untuk `better: 'lower'` yang kumulatif (misalnya anggaran), laju dinilai terbalik: realisasi di bawah bagian target yang seharusnya terpakai saat ini = sesuai jalur; di atasnya = tertinggal.
- Opsional `entityActuals(entityId, period)` → angka atau `null`: nilai **seluruh perusahaan** yang tepat untuk persentase/rata-rata (dihitung dari semua baris sekaligus). Tanpa ini, dashboard seluruh perusahaan memakai rata-rata antar divisi dan menandainya "rata-rata antar divisi". Gunakan helper `grouping(kolom, whole)` dari `helpers.js` supaya kueri per divisi dan seluruh perusahaan tetap satu.
- Opsional `billedMonthly`: `true`, atau daftar kode divisi (misalnya `['retail_commerce']`), untuk angka yang ditagih sekali sebulan (faktur rekap marketplace di akhir bulan). Selama periode berjalan, Target & realisasi memberi status "Ditagih bulanan" (tanpa laju), dan dashboard divisi mengosongkan bulan berjalan.

## 5. KPI dashboard

```js
{
  key: 'waiting', label: 'Pergerakan menunggu approval', unit: 'item',
  async value(entityId, { departmentId }) {
    return { value: 3, sub: '1 lebih dari 8 jam', alert: true };  // alert → ditandai merah
  },
}
```

Kalau satu KPI gagal, hanya kartunya yang kosong. Dashboard tidak ikut gagal.

- Kalau belum ada angka, kembalikan `value: null` beserta `sub` yang menjelaskan alasannya (misalnya "Belum ada SO lunas 90 hari terakhir"). Kartu menampilkan penjelasan itu, dan `alert` tetap ditandai merah bila diisi.

### Angka yang butuh izin khusus (KPI dan metrik)

KPI dan metrik yang menampilkan angka rahasia, misalnya nilai rupiah pembelian, wajib menyatakan izinnya:

```js
{
  key: 'procurement_po_value_month', label: 'Nilai PO bulan ini', unit: 'rupiah',
  permission: 'procurement.price.view',                       // satu kode atau daftar; cukup punya salah satu
  restrictedText: 'Hanya untuk yang berwenang melihat harga beli',
  async value(entityId, { departmentId }) { … },
}
```

- Pemanggil tanpa izin itu tidak pernah memicu `value()` atau `actuals()`. Dashboard mengirim kartu dengan `value: null`, `sub` berisi `restrictedText`, dan `restricted: true`.
- Di Target & realisasi, metrik itu tidak dikirim sama sekali (katalog, realisasi, sel, dan target yang tersimpan). Namanya dicantumkan di daftar `restricted`, dan halaman menampilkan satu catatan. Menyimpan target untuk metrik itu ditolak (403).
- `permission` hanya untuk KPI dan metrik. Eskalasi tidak menerimanya, karena akses eskalasi diatur per divisi.
- Tes menjaga aturan ini: KPI atau metrik yang membaca view harga beli (`pc_po_price*`) wajib menyatakan `procurement.price.view`.

## 6. Pembatasan divisi — wajib

- Selalu saring divisi **di SQL** dengan `scope(departmentId, '<kolom department_id>')`. Jangan mengambil data seluruh perusahaan lalu memangkasnya di JavaScript.
- `departmentId` berasal dari akun pemanggil, bukan dari request. `null` berarti tampilan seluruh perusahaan.
- Data yang tidak punya divisi (`department_id` kosong) memang tidak tampil di tampilan per divisi. Itu disengaja.

## 7. Daftar periksa modul baru

1. Buat provider di `backend/src/management/providers/<modul>.js`.
2. Isi `navPaths` dengan rute menu modul tersebut.
3. Tulis tes di `backend/test/` untuk provider itu. Minimal: bentuk hasilnya, pembatasan divisi terbukti ada di SQL (entitas diikat lebih dulu, lalu divisi, dalam satu query per kemampuan), dan `locate` untuk setiap sumber eskalasi.
4. Jalankan `node --test test/`. `managementIntegration.test.js` harus lulus.
5. Buka Pusat Eskalasi, Target & realisasi, dan Management Dashboard. Modul baru harus muncul **tanpa mengubah satu baris pun kode frontend manajemen**.
