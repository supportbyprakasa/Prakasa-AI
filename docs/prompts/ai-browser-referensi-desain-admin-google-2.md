# Prompt untuk Claude di Chrome — referensi desain admin.google.com, putaran 2 (baca-saja)

Tempel seluruh teks di bawah ke Claude di Chrome saat Anda sudah login di https://admin.google.com. Putaran ini hanya mengisi nilai yang belum teramati di putaran 1 ([referensi-desain-admin-console.md](../referensi-desain-admin-console.md)).

---

Tugasmu: lengkapi spesifikasi desain Google Admin console (admin.google.com) untuk aplikasi internal kami. Putaran pertama sudah mengukur bilah atas, menu samping, tipografi, tombol pill, field, tabel, chip, tab, dialog "Add new user", tooltip, animasi, dan breakpoint. Sekarang ukur **hanya** hal-hal di bawah.

ATURAN KERAS:
- HANYA MEMBACA. Jangan menyimpan, menambah, menghapus, mengubah, mengundang, menonaktifkan, mereset, mengekspor, atau mengunduh apa pun.
- Yang boleh: membuka halaman, membuka menu, hover, menekan Tab, membuka dialog lalu menutupnya dengan "Cancel"/X (bila muncul pertanyaan "buang perubahan?", pilih buang), mengetik di kolom filter/pencarian, dan mengubah ukuran jendela.
- Bila sebuah langkah hanya bisa dilakukan dengan mengubah data, lewati dan tulis "tidak teramati".
- Jangan salin data pribadi (nama, email, nomor); ganti dengan "X".
- Ambil angka dari `getComputedStyle()` dan `getBoundingClientRect()` pada DOM live, bukan dari tampilan. Untuk hover, fokus, dan tekan, lakukan interaksinya lalu baca nilainya. Viewport utama 1440 px (bila tidak bisa, sebutkan lebarnya).

Yang diukur:

1. **Halaman Directory → Users, tata letak:** posisi x dan lebar area konten dan panel tabel; padding kiri, kanan, atas konten; apakah menu samping menciut otomatis di halaman ini; breadcrumb atau judul halaman (font, ukuran, tebal, warna, posisi) dan jaraknya ke panel.
2. **Menu samping, anatomi baris:** posisi x ikon panah buka/tutup (chevron), ikon item, dan awal label untuk level 1, 2, dan 3. Apakah item level 1 punya ikon. Judul grup atau pemisah (bila ada). Animasi buka/tutup grup (durasi, easing, rotasi chevron). Hover dan aktif untuk item bersarang. Perilaku scroll.
3. **Menu ⋮ (More options) pada satu baris tabel:** radius, bayangan, latar, padding atas/bawah, tinggi item, padding kiri item, font item, warna teks, warna hover, lebar minimum dan maksimum, jarak dari tombol pemicu, pemisah, dan animasi buka/tutup. Tutup menu tanpa memilih apa pun.
4. **Dialog kecil:** buka dialog yang tidak mengubah data, misalnya pengaturan kolom tabel (Manage columns / ikon pengaturan tabel) atau "Rename user", lalu Cancel. Ukur lebar, radius, padding, bayangan, warna dan opacity scrim, font dan warna judul, isi, posisi dan gaya tombol (teks/terisi, UPPERCASE atau tidak), serta animasi buka/tutup.
5. **Pesan error field:** di dialog "Add new user", ketik isian yang salah (misalnya spasi di kolom email) lalu pindah fokus tanpa menyimpan. Ukur warna dan tebal garis bawah, warna label, font, ukuran, dan warna teks error, serta ikon error bila ada. Lalu Cancel dan buang perubahan.
6. **Snackbar:** hanya bila ada aksi yang benar-benar tidak mengubah apa pun, misalnya ikon "salin" (copy to clipboard) pada halaman detail pengguna. Ukur posisi, lebar, tinggi, radius, latar, font, warna, tombol aksi, durasi tampil, dan animasi. Bila tidak ada aksi aman, tulis "tidak teramati".
7. **Hover dan tekan:** untuk tombol ikon (bilah atas dan toolbar tabel), tombol teks, tombol pill terisi (saat ditekan), chip filter, dan baris tabel, catat warna/opacity latar atau state layer, bentuk dan ukuran lingkaran hover, serta ukuran ikon aksi yang muncul di baris saat hover.
8. **Kotak pencarian global saat fokus:** latar, border, bayangan, lebar, dan radius. Dropdown saran: radius, bayangan, tinggi item, font, dan hover.
9. **Bayangan bilah atas saat halaman di-scroll:** nilai `box-shadow` persis.
10. **Indikator memuat:** progress bar linear atau spinner yang muncul saat pindah halaman atau memuat tabel (tinggi, warna, posisi, animasi), serta skeleton bila ada.
11. **Keadaan kosong:** ketik teks acak (misalnya "zzqx") di filter tabel Users sampai tidak ada hasil. Ukur tata letak, ilustrasi/ikon, font, dan warna pesannya.
12. **Tooltip:** durasi dan easing muncul/hilang (fade), delay hilang, dan lebar maksimum.
13. **Dropdown select** (misalnya "Rows per page"): radius daftar, bayangan, tinggi item, padding, font, hover, dan tanda item terpilih. Tutup tanpa mengubah (tekan Escape).
14. **Switch/toggle** di halaman pengaturan (Apps → Google Workspace → salah satu layanan): ukuran track dan thumb, warna on/off, serta animasi. Jangan mengubah posisinya.
15. **Tautan di dalam teks:** warna, garis bawah (normal/hover), dan tebal.
16. **Halaman detail pengguna:** tata letak kolom (lebar), permukaan kartu/bagian (latar, radius, border, bayangan, padding), judul bagian, baris label–nilai (font, warna, tinggi baris), dan pemisah.
17. **Akordeon pengaturan:** tinggi baris tertutup, chevron, animasi buka/tutup (durasi, easing), dan padding isi saat terbuka.
18. **Beranda:** grid kartu (jumlah kolom pada 1440, 1024, dan 600 px), isi kartu (baris daftar di dalam kartu, pemisah, tinggi baris), dan tombol/tautan di kaki kartu.
19. **Warna status:** di Security → Alert center (atau halaman lain yang menampilkan status/tingkat keparahan), ukur tampilan tiap status/tingkat (pil berwarna atau titik + teks: latar, warna teks, radius, tinggi, font).
20. **Banner peringatan/error** bila ada di salah satu halaman: latar, border, ikon, warna teks, dan radius.

Keluarkan hasil sebagai SATU laporan Markdown dengan judul bagian bernomor sama seperti daftar di atas. Tulis nilai dalam angka/hex/rgba persis, ditambah 1–2 kalimat perilaku untuk efek. Tandai "tidak teramati" untuk yang tidak bisa diukur tanpa mengubah data. Di akhir, sebutkan interaksi apa saja yang dilakukan dan pastikan tidak ada yang berubah.
