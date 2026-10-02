# Prompt untuk Claude di browser — Petakan dokumentasi API Accurate (HANYA MEMBACA)

Buka https://account.accurate.id/developer/api-docs.do di Chrome. Akun developer "Prakasa Workspace" (finance@prakasafoods.com) harus sudah login. Salin teks di antara dua garis ke Claude di browser, lalu tempelkan **laporannya** ke sesi Claude Code.

---

Kamu membantu owner PT Prakasa Foods Nusantara memetakan **seluruh data yang bisa dibaca** lewat API Accurate Online. Aplikasi internal "Prakasa Workspace" akan memakainya untuk divisi Sales, Retail Commerce, Warehouse, Procurement, Finance, Management Office, Marketing, People & Culture, dan Operations. Aplikasi itu **hanya membaca** Accurate.

## ATURAN MUTLAK
1. **Hanya membaca halaman dokumentasi.** Jangan mengubah pengaturan aplikasi developer, jangan membuat aplikasi baru, jangan membuat atau mencabut token, jangan menekan "Try it"/"Test"/"Kirim" pada contoh API, dan jangan membuka database Accurate.
2. **Jangan menyalin rahasia** (Client Secret, token) ke laporan, dan jangan mengambil screenshot yang memperlihatkannya.
3. **Jangan menyisipkan script atau elemen apa pun ke halaman.** Hanya klik navigasi dan gulir.
4. Kalau diminta login, **berhenti** dan minta owner login sendiri.
5. Kalau ragu, berhenti dan tanya owner.

## Yang dicari
Untuk **setiap modul/endpoint API** di dokumentasi, catat:
- nama resource di URL (mis. `sales-invoice`, `purchase-order`, `item-transfer`);
- endpoint baca yang tersedia (mis. `list.do`, `detail.do`, dan endpoint baca lain seperti stok atau laporan);
- **nama scope persis** untuk membaca (yang berakhiran `_view`) dan, kalau ada, scope tulisnya (hanya dicatat; aplikasi tidak akan memintanya);
- satu baris tentang isinya (mis. "stok per gudang", "umur piutang").

Perhatikan khususnya:
- **Stok:** endpoint stok per barang/per gudang, gudang (warehouse), pindah barang, penyesuaian persediaan, stok opname;
- **Pembelian:** pemasok (vendor), permintaan barang, pesanan pembelian, penerimaan barang, faktur pembelian, pembayaran pembelian, retur pembelian;
- **Keuangan:** akun perkiraan (GL account), jurnal umum, penerimaan/pembayaran lain, transfer bank, kas/bank, aset tetap, **laporan umur piutang/utang** (bila ada endpoint laporan);
- **Penjualan:** penawaran, uang muka, klaim, penyesuaian harga/diskon, retur;
- **Lainnya:** karyawan, gaji, departemen, proyek, cabang, mata uang, pajak, kategori barang/pelanggan/pemasok, produksi/manufaktur (bila ada).

## Format laporan — WAJIB persis seperti ini

```
LAPORAN DOKUMENTASI API ACCURATE — [tanggal]

A. Daftar resource (satu baris per resource)
resource | endpoint baca | scope baca | scope tulis (catat saja) | isi singkat
...

B. Endpoint khusus yang relevan
B1. Stok per barang / per gudang: [endpoint + scope / tidak ada]
B2. Umur piutang / utang: [endpoint + scope / tidak ada]
B3. Laporan lain yang bisa dibaca lewat API: [daftar / tidak ada]

C. Batasan API yang tertulis di dokumentasi
C1. Batas jumlah permintaan (rate limit): [..]
C2. Ukuran halaman maksimum (sp.pageSize): [..]
C3. Filter tanggal/terakhir diubah yang didukung: [..]

D. Konfirmasi keamanan
D1. Hanya membaca dokumentasi, tidak mengubah apa pun: [ya]
D2. Tidak menyalin rahasia: [ya]
D3. Hal yang membuat saya berhenti atau ragu: [.. / tidak ada]
```
