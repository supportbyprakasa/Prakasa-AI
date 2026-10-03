# Navigasi divisi: Warehouse, Procurement, Retail Commerce sebagai grup halaman (3 Oktober 2026)

Keputusan owner: setiap divisi diperlakukan sama seperti Sales. Fitur yang tadinya tab di satu halaman divisi menjadi entri menu sendiri di bawah nama divisinya; tidak ada lagi entri tunggal bernama divisi.

## Menu baru

| Grup | Entri | Rute | Izin (sama dengan tab lamanya) |
|---|---|---|---|
| Warehouse | Hari ini | `/warehouse` | `warehouse.stock.view` (pembaca pergerakan saja diarahkan ke Pergerakan barang) |
| | Pergerakan barang (tab Barang masuk, Barang keluar, Approval Supervisor, Riwayat transaksi) | `/warehouse/movements` | `warehouse.movement.view`; tab Approval `warehouse.movement.approve` |
| | Stok (tab Stok, Dokumen Accurate, Cocokkan Accurate) | `/warehouse/stock` | `warehouse.stock.view` / `warehouse.recon.view` |
| | Jadwal kirim | `/warehouse/shipping` | `warehouse.stock.view` |
| | Checklist & insiden (tab Checklist, Insiden) | `/warehouse/operations` | `warehouse.checklist.view` / `warehouse.incident.view` |
| Procurement | Hari ini | `/procurement` | `procurement.view` |
| | Purchase order | `/procurement/orders` | `procurement.view` |
| | Pemasok (tab Pemasok, Harga beli) | `/procurement/vendors` | `procurement.view`; tab Harga beli `procurement.price.view` |
| | Saran pesan ulang | `/procurement/reorder` | `procurement.reorder.view` |
| Retail Commerce | Kinerja marketplace | `/retail-commerce` | `retail.insight.view` |
| | Pesanan & piutang (tab SO belum dikirim, Faktur belum cair) | `/retail-commerce/pending` | `retail.insight.view` |
| Manajemen | Data Accurate | `/data-accurate` | `accurate.batch.view`, `sales.master.manage`, `warehouse.accurate.sync`, `procurement.accurate.sync`, `accurate.write.request` |

Tab "Data Accurate" di halaman Warehouse dan Procurement dihapus: satu halaman Data Accurate untuk semua, dan tombol "Tarik sekarang" di sana mengikuti scope yang boleh ditarik pengguna (Sales, Warehouse, atau Procurement). Pengguna yang hanya mengajukan data ke Accurate (anggota Sales, Retail Commerce, Procurement) melihat Data Accurate sebagai satu item polos.

## Tautan lama

Semua alamat lama `/warehouse?tab=…` dan `/procurement?tab=…` (notifikasi, eskalasi, panduan, bookmark, Prakasa AI) dialihkan oleh shell ke halaman barunya dengan parameter lain tetap dibawa (`LEGACY_TABS` dan `legacyRedirect` di `frontend/src/components/navigation.js`, dipakai `Layout.jsx`). Pengalihan terjadi sebelum pemeriksaan akses, sehingga pembaca pergerakan saja yang membuka `/warehouse?tab=inbound` tetap sampai ke Pergerakan barang. Semua penghasil tautan di kode (provider manajemen, alur & margin, form Prakasa AI, halaman Hari ini) sudah memakai rute baru.

## Kode

- Navigasi: `frontend/src/components/navigation.js` (NAV, ROLE_FOCUS, `divisions`, `LEGACY_TABS`, `legacyRedirect`, kolom `access` untuk `/warehouse`).
- Halaman: `pages/warehouse/WarehousePages.jsx` (Hari ini, Pergerakan barang, Stok, Jadwal kirim; `useInnerTabs` dipakai bersama), `pages/warehouse/WarehouseOperations.jsx` (Checklist & insiden, dulu `WarehouseDashboard.jsx`), `pages/procurement/ProcurementPages.jsx` (dulu `ProcurementDashboard.jsx`), `pages/retail/RetailPending.jsx` dan `retailColumns.jsx`.
- Backend: rute alat Prakasa AI (`aiToolRegistry.service.js`), `navPaths` provider manajemen, tautan di provider dan alur & margin.
- Panduan: bab Warehouse, Procurement, Retail Commerce, Data Accurate.
- Tes: `frontend/test/navigationLegacy.test.js` (pengalihan dan akses), tes navigasi dan panduan yang ada, tes backend provider dan registri.
