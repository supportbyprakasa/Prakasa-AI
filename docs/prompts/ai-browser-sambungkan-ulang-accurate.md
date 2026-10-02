# Tugas: sambungkan ulang Accurate dengan izin lihat tambahan

Kamu membantu owner PT Prakasa Foods Nusantara memperluas izin **lihat saja** aplikasi "Prakasa Workspace" di Accurate Online. Aplikasi ini sudah tersambung dengan 8 izin lihat untuk Sales. Sekarang ia juga membaca data Warehouse, Procurement, dan Finance, sehingga butuh total **50 izin, semuanya berakhiran `_view`**. Aplikasi tidak pernah menulis ke Accurate.

## Sebelum mulai
- Buka http://localhost:5173/admin/accurate di Chrome. Yang login harus Super Admin **Wahyudi Local** (`mwahyudi@prakasagroup.com`, inisial "WL" di pojok kanan atas).
- Akun Accurate `finance@prakasafoods.com` harus sudah login di Chrome yang sama.
- Kalau salah satu belum terpenuhi, berhenti dan minta owner melengkapinya.

## ATURAN MUTLAK
1. **Jangan menyentuh data atau pengaturan Accurate.** Tidak membuat, mengubah, menghapus, atau memposting apa pun, dan tidak membuka Preferensi atau pengaturan aplikasi developer.
2. **Nilai izin dari parameter `scope=` di URL halaman persetujuan**, bukan dari kalimat Accurate. Kalimat "Mengakses/merubah data pada data usaha Anda" selalu muncul, bahkan untuk izin lihat. Tekan "Beri Akses" **hanya bila semua scope di URL berakhiran `_view`**. Kalau ada satu saja `_save`, `_delete`, atau scope lain, tekan **Tolak**, lalu berhenti dan laporkan.
3. **Di halaman persetujuan, jangan mengklik apa pun selain tombol keputusan**, termasuk tautan yang tampak informatif. Pengalaman sebelumnya: tautan "Lihat detail akses perubahan data" langsung memberi akses.
4. **Database:** kalau diminta memilih, pilih **"PT. PRAKASA FOODS NUSANTARA"**. Jangan pernah memilih "prakasa food ( Trial )".
5. **Jangan login atau logout, dan jangan mengetik password atau OTP.** Kalau diminta login, berhenti dan minta owner login sendiri.
6. **Jangan menyisipkan script atau elemen apa pun ke halaman**, jangan menyalin rahasia atau token, dan jangan mengambil screenshot yang memperlihatkan rahasia.
7. Kalau ragu, berhenti dan tanya owner.

## Langkah
1. Di halaman http://localhost:5173/admin/accurate harus ada banner kuning "**… izin lihat baru belum diberikan Accurate**". Catat angkanya (seharusnya 42).
2. Tekan **Sambungkan ulang**. Browser pindah ke halaman persetujuan Accurate.
3. **Sebelum mengklik apa pun**, baca URL di address bar dan salin nilai parameter `scope` ke catatan kerjamu. Hitung jumlahnya (harus 50), dan periksa bahwa semuanya berakhiran `_view`. Terapkan aturan no. 2.
4. Tekan **Beri Akses**, dan pilih database sesuai aturan no. 4 bila diminta.
5. Setelah kembali ke Prakasa Workspace:
   - catat isi kartu **Status koneksi** (status, database, token berlaku sampai);
   - hitung badge di kartu **Izin yang diberikan Accurate**;
   - pastikan banner kuning "izin lihat baru" **sudah hilang**.

## Laporan
Tutup pekerjaanmu dengan laporan persis seperti di bawah ini. Owner akan menempelkannya ke Claude Code.

```
LAPORAN SAMBUNG ULANG ACCURATE — [tanggal]
1. Banner sebelum sambung ulang: [.. izin lihat baru]
2. Scope di URL persetujuan: jumlah [..], semua berakhiran _view: [ya/tidak]
   Daftar persis: [salin nilai scope]
3. Tindakan: [Beri Akses / Tolak] — database: [..]
4. Status koneksi: status [..], database [..], token berlaku sampai [..]
5. Jumlah izin di kartu "Izin yang diberikan Accurate": [..]
6. Banner "izin lihat baru" masih ada: [ya/tidak]
7. Konfirmasi: tidak menyentuh data/pengaturan Accurate [ya]; tidak mengklik apa pun selain tombol keputusan [ya]; tidak menyalin rahasia [ya]
8. Hal yang membuat saya berhenti atau ragu: [.. / tidak ada]
```
