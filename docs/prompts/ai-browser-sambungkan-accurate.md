# Prompt untuk Claude di browser — Daftarkan aplikasi Accurate & sambungkan ke Prakasa Workspace

> Sudah dijalankan 29 September 2026. Hasilnya: tersambung ke PT. PRAKASA FOODS NUSANTARA dengan 8 scope `_view`. Aplikasi developer terdaftar di akun Accurate finance@prakasafoods.com. Pakai prompt ini lagi untuk menyambungkan ulang, atau untuk merotasi Client Secret.

Siapkan dua tab di Chrome, lalu salin semua teks di antara dua garis di bawah ke Claude di browser:

1. **Accurate:** https://account.accurate.id/developer, sudah login.
2. **Prakasa Workspace (lokal):** http://localhost:5173/admin/accurate, login sebagai Super Admin **Wahyudi Local** (`mwahyudi@prakasagroup.com`).

Setelah selesai, tempelkan **laporannya** ke sesi Claude Code proyek Prakasa Workspace.

---

Kamu membantu owner PT Prakasa Foods Nusantara menyambungkan **Accurate Online** ke aplikasi internal **Prakasa Workspace** dalam mode **baca-saja**. Owner hanya memberi instruksi; kamu yang mengerjakan langkah di browser.

Tugasnya tiga:

- **(1)** Daftarkan aplikasi developer "Prakasa Workspace" di Accurate.
- **(2)** Pindahkan Client ID dan Client Secret-nya langsung ke form di Prakasa Workspace.
- **(3)** Tekan "Sambungkan Accurate" dan setujui izin **hanya bila semuanya izin lihat**.

## ATURAN MUTLAK

1. **Jangan menyentuh data Accurate.** Jangan membuka, mengubah, menyimpan, menghapus, atau memposting transaksi maupun data master. Jangan mengubah Preferensi atau pengaturan database. Satu-satunya yang boleh kamu buat di Accurate adalah **satu aplikasi developer bernama "Prakasa Workspace"** di halaman developer.
2. **Jangan memasang (Install) aplikasi di "Aplikasi Saya" dan jangan membuat API Token.** Jalur yang dipakai adalah OAuth, jadi keduanya tidak diperlukan.
3. **Rahasia:** Client Secret (dan token apa pun) **hanya boleh berpindah dari halaman Accurate langsung ke kolom "Client Secret" di Prakasa Workspace.**
   - Jangan menuliskannya di chat, laporan, catatan, atau file.
   - Jangan mengambil screenshot yang memperlihatkannya.
   - Jangan membacakannya ke owner.
   - Di laporan cukup tulis "sudah dipindahkan".
4. **Persetujuan hukum:** jika Accurate meminta menyetujui **Syarat & Ketentuan Pengembang**, jangan langsung menekan Setuju. Tulis ringkasan singkatnya ke owner, lalu **tunggu owner menjawab "ya"** di chat.
5. **Izin (scope):** nilailah dari parameter `scope=` di URL halaman persetujuan, bukan dari kalimat Accurate. Accurate selalu menampilkan kalimat umum "Mengakses/merubah data pada data usaha Anda", bahkan untuk izin lihat. Tekan "Beri Akses" **hanya bila setiap scope berakhiran `_view`**. Kalau ada `_save`, `_delete`, atau scope lain, tekan **Tolak**, lalu berhenti dan laporkan.
   - **Di halaman persetujuan, jangan mengklik apa pun selain tombol keputusan.** Ini termasuk tautan yang tampak informatif. Pengalaman 29 Sep 2026: tautan "Lihat detail akses perubahan data" ternyata langsung memberi akses.
6. **Database:** kalau diminta memilih database, pilih **"PT. PRAKASA FOODS NUSANTARA"**. Jangan pernah memilih "prakasa food ( Trial )".
7. **Jangan login atau logout, dan jangan mengetik password atau OTP.** Kalau diminta login, berhenti dan minta owner login sendiri.
8. **Kalau ragu apakah sebuah klik mengubah sesuatu, berhenti dan tanya owner.**
9. **Jangan menyisipkan script, tombol, atau elemen apa pun ke halaman web.** Bekerjalah hanya dengan klik dan ketik biasa.
10. **Halaman yang menampilkan rahasia tanpa sensor** (mis. Client Secret di halaman OAuth Accurate): buka sesingkat mungkin, dan jangan mengambil screenshot saat nilainya terlihat.

## Langkah

**A. Siapkan Prakasa Workspace (tab 2)**
1. Buka http://localhost:5173/admin/accurate. Pastikan nama di pojok kanan atas adalah akun Super Admin (inisial "WL", Wahyudi Local). Kalau halaman tidak bisa dibuka atau akunnya lain, berhenti dan minta owner login sebagai Super Admin.
2. Di kartu **"Kredensial aplikasi Accurate"**, salin **persis** nilai kolom **URL OAuth Callback**, mis. `http://127.0.0.1:3001/api/v1/integrations/accurate/callback`.

**B. Daftarkan aplikasi di Accurate (tab 1)**
1. Di https://account.accurate.id/developer, lakukan aturan no. 4 kalau diminta menyetujui syarat pengembang.
2. Buka menu **Aplikasi**, lalu buat aplikasi baru:
   - **Nama:** `Prakasa Workspace`
   - **Platform:** Website (Authorization Code)
   - **URL OAuth Callback:** tempel nilai dari langkah A.2, **sama persis**
   - Kolom lain seperti deskripsi atau website, bila wajib: "Aplikasi internal PT Prakasa Foods Nusantara — baca data penjualan (read-only)"
3. **Kalau Accurate menolak URL callback** (mis. harus https atau tidak boleh IP):
   - Coba ganti `127.0.0.1` dengan `localhost`. Kalau diterima, samakan juga kolom URL OAuth Callback di Prakasa Workspace.
   - Kalau tetap ditolak karena harus https, **berhenti** dan catat pesan persisnya di laporan. Jangan memakai URL lain.
4. Simpan aplikasinya. Catat **nama aplikasi** dan apakah statusnya aktif. Jangan mencatat Client ID dan Secret.

**C. Pindahkan kredensial (tab 1 → tab 2)**
1. Salin **Client ID** dari halaman aplikasi di Accurate, lalu tempel ke kolom **Client ID** di Prakasa Workspace.
2. Salin **Client Secret**, lalu tempel ke kolom **Client Secret** di Prakasa Workspace. Ingat aturan no. 3.
3. Pastikan kolom **URL OAuth Callback** di Prakasa Workspace sama persis dengan yang tersimpan di Accurate, lalu tekan **Simpan kredensial**. Harus muncul pesan "Kredensial Accurate disimpan (terenkripsi)", dan tombol **Sambungkan Accurate** menjadi aktif.

**D. Sambungkan (tab 2 → Accurate → kembali)**
1. Tekan **Sambungkan Accurate**. Browser pindah ke halaman persetujuan Accurate.
2. Periksa daftar izin, lalu terapkan aturan no. 5.
3. Kalau diminta memilih database, terapkan aturan no. 6.
4. Setelah Izinkan, browser kembali ke Prakasa Workspace. Catat isi kartu **Status koneksi** (status, Database Accurate, Token berlaku sampai) dan kartu **Izin yang diberikan Accurate**.
5. Kalau muncul banner merah, catat judul dan isinya persis.

## Format laporan — WAJIB persis seperti ini

```
LAPORAN SAMBUNGKAN ACCURATE — [tanggal]

A. Prakasa Workspace
A1. Login sebagai Super Admin (Wahyudi Local): [ya/tidak]
A2. URL OAuth Callback yang dipakai: [nilai persis]

B. Aplikasi developer Accurate
B1. Syarat pengembang: [tidak diminta / disetujui setelah owner menjawab ya / ditolak]
B2. Aplikasi dibuat: nama [..], platform [..], status [..]
B3. URL callback diterima Accurate: [ya / ditolak — pesan persis: ..]

C. Kredensial
C1. Client ID & Client Secret dipindahkan langsung ke Prakasa Workspace: [ya/tidak]
C2. Pesan setelah Simpan kredensial: [..]

D. Penyambungan
D1. Izin yang tercantum di halaman persetujuan Accurate: [daftar persis]
D2. Semua izin hanya "lihat": [ya/tidak] — tindakan: [Izinkan / Tolak]
D3. Database yang dipilih: [..]
D4. Status koneksi di Prakasa Workspace: status [..], database [..], token berlaku sampai [..]
D5. Izin yang diberikan (kartu Prakasa): [daftar]
D6. Pesan error, bila ada: [..]

E. Konfirmasi keamanan
E1. Tidak mengubah data/pengaturan Accurate selain membuat aplikasi developer "Prakasa Workspace": [ya]
E2. Tidak memasang aplikasi di "Aplikasi Saya" dan tidak membuat API Token: [ya]
E3. Client Secret/token tidak ditulis di chat, laporan, catatan, atau screenshot: [ya]
E4. Hal yang membuat saya berhenti atau ragu: [.. / tidak ada]
```
