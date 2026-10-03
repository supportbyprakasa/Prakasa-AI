# Dashboard divisi: satu template untuk semua divisi (3 Oktober 2026)

Setiap divisi membaca dashboard dengan susunan, urutan, dan gerakan chart yang sama. Isinya saja yang berbeda per divisi.

## Keputusan

| Pertanyaan | Keputusan | Alasan |
|---|---|---|
| Bentuk | Satu halaman bersama, **Dashboard divisi** (`/division-dashboard`), menjadi template. Halaman operasional tiap modul (Pipeline, Warehouse "Hari ini", dst.) tidak diubah bentuknya. | Halaman operasional adalah halaman kerja, bukan dashboard; memaksanya jadi grafik mengganggu tim. Dashboard divisi sudah ada di menu setiap divisi. |
| Urutan | 1 Angka utama · 2 Perlu perhatian · 3 Grafik capaian bulanan · 4 Tren 12 bulan · 5 Capaian terhadap target (komposisi) · 6 Tabel kerja | Dari yang paling cepat dibaca ke yang paling rinci. |
| Bagian tanpa data | Tetap tampil di posisinya dengan keterangan "menunggu data". | Kalau disembunyikan, urutan terasa berbeda antar divisi. |
| Gerakan | Hanya komponen bersama: `AnimatedNumber` (angka naik), `BarList` (bar tumbuh), `MotionChart` (bar race), `TrendChart` (garis tergambar). Chart lokal dihapus. | Satu sumber gerakan, satu durasi (`--pw-dur-chart`), hormat pada `prefers-reduced-motion`. |

## Yang berubah

- `frontend/src/components/DashboardSection.jsx` + `dashboard-section.css`: judul bagian yang dipakai setiap dashboard, dengan grid KPI/tren/split bersama.
- **Dashboard divisi** (`pages/management/DivisionDashboard.jsx`, `divisionDashboardModel.js`): disusun ulang ke enam bagian. Baru: "Perlu perhatian" (jumlah eskalasi per sumber sebagai `BarList`), "Capaian terhadap target" (`targetProgress`: persen capaian bulan lengkap terakhir terhadap target bulanan; ukuran "makin rendah makin baik" tercapai bila di bawah target), "Pekerjaan lewat tenggat" (`DataGrid`, bisa diekspor). Bar eskalasi buatan sendiri (CSS `div-dash__esc`) dihapus.
- **Retail Commerce**: urutan disamakan; "Perlu perhatian" dari SO belum dikirim dan faktur belum cair (`retailModel.attentionItems`); kartu Porsi omzet dan Piutang menjadi bagian "Komposisi per platform"; keempat tabel menjadi "Tabel kerja".
- **Pipeline sales**: bar "Omzet per bulan" buatan sendiri diganti `BarList`; angka utama memakai `AnimatedNumber`.
- **Dashboard IT**: bar per status/tipe/lokasi buatan sendiri diganti `BarList` (label tetap tautan ke daftar perangkat); angka utama memakai `AnimatedNumber`.
- Panduan (`handbookContent.js`, bab "Dashboard divisi") menjelaskan keenam bagian; turunan diregenerasi; ID/EN lengkap.
- Backend tidak berubah: `/management-dashboard/division` sudah menyuplai angka, deret 12 bulan, target bulanan, dan eskalasi per divisi.

Tidak diubah: Warehouse dan Procurement "Hari ini", Marketing Insights, Finance Piutang/Utang (halaman laporan dan kerja; dashboard divisinya ada di menu masing-masing).

## Pengujian

- Frontend: 831 test lulus (baru: `divisionDashboardModel.test.js` untuk keenam bagian, `attentionItems` Retail), `vite build` berhasil, katalog i18n lengkap.
- Backend: `divisionDashboard.test.js` lulus (tidak berubah).
- Di layar (Chromium, data sintetis di MySQL sandbox: 64 tiket IT selama 12 bulan, 3 tiket lewat SLA, target bulanan): Dashboard divisi People & Culture menampilkan keenam bagian berurutan; "Perlu perhatian" 3 tiket lewat SLA; tren 3 kartu; "Capaian terhadap target" 25% (merah) dan 100% (hijau); tabel 3 baris. Dashboard divisi Sales (manajemen) urutan sama dengan bagian kosong di tempatnya. Pipeline sales dan Dashboard IT tanpa galat dengan `BarList` bersama. Retail Commerce tanpa batch Accurate menampilkan alasan kosongnya. Tidak ada galat JavaScript.
- Grafik capaian bulanan di sandbox masih "menunggu data" karena hanya satu ukuran yang bergerak (butuh dua); di produksi divisi dengan beberapa ukuran berjalan akan menampilkannya.

## Simulasi desain

Mockup interaktif yang disetujui sebelum pengerjaan: https://claude.ai/artifact/Qmxu4X6qAthoGTeBxZePdw (privat; bukan bagian aplikasi).
