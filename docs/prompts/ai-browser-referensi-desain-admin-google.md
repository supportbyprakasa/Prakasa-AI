# Prompt untuk Claude di Chrome — ambil referensi desain dari admin.google.com (baca-saja)

Tempel seluruh teks di bawah ke Claude di Chrome saat Anda sudah login di https://admin.google.com.

---

Tugasmu: kumpulkan spesifikasi desain yang PERSIS dari Google Admin console (admin.google.com) sebagai referensi untuk aplikasi internal kami. Ini murni pengamatan.

ATURAN KERAS:
- HANYA MEMBACA. Jangan klik tombol simpan, tambah, hapus, ubah, undang, nonaktifkan, reset, atau apa pun yang mengubah pengaturan/pengguna. Boleh membuka halaman, membuka menu, mengarahkan kursor (hover), membuka dialog lalu menutupnya dengan "Batal"/X, dan membuka DevTools.
- Jangan salin data pribadi (nama, email, nomor) ke laporan; ganti dengan "X". Yang dibutuhkan hanya ukuran, warna, font, jarak, dan perilaku.

Halaman yang diamati (buka satu per satu):
1. Beranda (Home) — kartu-kartu ringkasan.
2. Direktori → Pengguna (Users) — tabel/daftar, filter, pencarian, kotak centang, paginasi.
3. Satu halaman detail pengguna (klik satu pengguna) — header profil, bagian/kartu, tombol aksi di atas.
4. Satu halaman pengaturan (mis. Apps → Google Workspace → Gmail) — daftar pengaturan yang bisa dibuka-tutup.
5. Laporan (Reporting) — grafik/kartu.
6. Satu dialog (mis. tombol "Tambah pengguna baru" lalu segera Batal) — ukuran dialog, judul, field, tombol.
7. Menu samping (navigation drawer) — terbuka dan tertutup (tombol ☰), item aktif, item bersarang.
8. Bilah atas — logo area, kotak pencarian, ikon kanan, avatar.
9. Satu snackbar/toast bila terlihat, dan satu tooltip (hover ikon).

Untuk SETIAP elemen di bawah, gunakan DevTools (Inspect → tab Computed) dan catat nilai persisnya:
- Bilah atas: tinggi, warna latar, bayangan/garis bawah, ukuran & warna kotak pencarian (tinggi, radius, latar, font).
- Menu samping: lebar terbuka/tertutup, tinggi item, padding kiri, radius item aktif, warna latar item aktif & teksnya, warna hover, ukuran ikon, font item (family, size, weight, letter-spacing), judul grup.
- Latar halaman dan permukaan kartu: warna, radius, border (warna/tebal), bayangan (box-shadow), padding kartu.
- Judul halaman (H1), subjudul, teks isi, teks kecil/keterangan: font-family, font-size, line-height, font-weight, warna.
- Tombol: primer (terisi), sekunder/outlined, teks, ikon — tinggi, padding, radius, font, warna normal/hover/aktif/fokus/disabled, efek ripple (ada/tidak, warna, durasi), transition (durasi & easing).
- Field input/select: tinggi, border normal/hover/fokus, label (melayang atau di atas), warna, radius, pesan error.
- Tabel: tinggi header & baris, font header (size/weight/warna), garis pemisah, warna hover baris, baris terpilih, kotak centang, padding sel, paginasi (bentuk & posisi), baris kosong.
- Chip/filter: tinggi, radius, border, warna terpilih/tidak.
- Tab: tinggi, indikator aktif (tebal, warna, lebar), font.
- Dialog: lebar, radius, padding, bayangan, warna scrim, posisi tombol.
- Snackbar, tooltip, badge status (warna tiap status).
- Fokus keyboard (tekan Tab): bentuk & warna focus ring.
- Animasi: buka/tutup menu samping, buka dialog, hover — durasi dan easing (lihat properti transition).
- Breakpoint: perilaku saat jendela dipersempit ke ±1000 px dan ±400 px (menu samping jadi apa, tabel jadi apa).

Keluarkan hasil sebagai SATU laporan Markdown terstruktur dengan judul bagian persis seperti daftar di atas, nilai-nilai dalam angka/hex (bukan kira-kira), plus 1–2 kalimat perilaku untuk efek. Sertakan juga daftar font yang dipakai (nama persis dari Computed → font-family dan "Rendered Fonts").
