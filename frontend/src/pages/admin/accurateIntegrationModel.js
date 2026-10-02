import { dateLocale } from '../../i18n/language.js';
// Pure helpers for the "Integrasi Accurate" admin page. The connection is
// read-only: the app never writes to Accurate.

// Short codes the backend puts in ?reason= after the Accurate sign-in.
export const RETURN_REASONS = Object.freeze({
  not_configured: 'Integrasi Accurate belum dikonfigurasi di server.',
  db_name_trial: 'Nama database yang dikonfigurasi adalah database Trial. Integrasi hanya boleh ke database produksi.',
  state_invalid: 'Tautan penyambungan tidak dikenal. Ulangi dari tombol "Sambungkan Accurate".',
  state_expired: 'Tautan penyambungan kedaluwarsa (lebih dari 10 menit). Ulangi dari tombol "Sambungkan Accurate".',
  state_used: 'Tautan penyambungan sudah pernah dipakai. Ulangi dari tombol "Sambungkan Accurate".',
  denied: 'Akses ditolak di halaman Accurate. Tidak ada yang disimpan.',
  code_missing: 'Accurate tidak mengirim kode otorisasi. Ulangi penyambungan.',
  token_failed: 'Accurate menolak penukaran token. Periksa ID klien, rahasia klien dan URL callback OAuth.',
  scope_not_readonly: 'Accurate memberi izin selain "lihat". Token ditolak dan tidak disimpan — aplikasi hanya boleh membaca.',
  db_list_failed: 'Gagal membaca daftar database Accurate.',
  db_not_found: 'Database produksi tidak ditemukan di akun Accurate ini.',
  db_trial_only: 'Akun Accurate ini hanya punya database Trial. Integrasi hanya boleh ke database produksi.',
  internal: 'Terjadi kesalahan saat menyambungkan Accurate. Coba lagi.',
});

// Banner to show after returning from Accurate, or null. Reads only the two
// parameters the backend sets; anything unknown falls back to a generic text.
export function returnNotice(search) {
  const params = new URLSearchParams(search || '');
  const result = params.get('accurate');
  if (result === 'connected') {
    return { tone: 'success', title: 'Accurate tersambung', message: 'Token disimpan terenkripsi. Aplikasi hanya membaca data Accurate.' };
  }
  if (result === 'error') {
    const reason = params.get('reason') || 'internal';
    return { tone: 'error', title: 'Gagal menyambungkan Accurate', message: RETURN_REASONS[reason] || RETURN_REASONS.internal };
  }
  return null;
}

// Search string with the Accurate return parameters removed.
export function stripReturnParams(search) {
  const params = new URLSearchParams(search || '');
  params.delete('accurate');
  params.delete('reason');
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

const SCOPE_LABELS = {
  // Sales & Retail Commerce
  customer_view: 'Pelanggan', customer_category_view: 'Kategori pelanggan', customer_claim_view: 'Klaim pelanggan',
  sales_quotation_view: 'Penawaran penjualan', sales_order_view: 'Pesanan penjualan', delivery_order_view: 'Pengiriman pesanan',
  sales_invoice_view: 'Faktur penjualan', sales_receipt_view: 'Penerimaan penjualan', sales_return_view: 'Retur penjualan',
  exchange_invoice_view: 'Tukar faktur', sellingprice_adjustment_view: 'Penyesuaian harga/diskon', price_category_view: 'Kategori harga',
  payment_term_view: 'Syarat pembayaran', shipment_view: 'Jasa pengiriman', roll_over_view: 'Penyelesaian pesanan',
  employee_view: 'Karyawan (salesman)',
  // Barang & Warehouse
  item_view: 'Barang & stok', stock_mutation_history_view: 'Mutasi stok', item_category_view: 'Kategori barang', item_brand_view: 'Merek barang',
  unit_view: 'Satuan', warehouse_view: 'Gudang', item_transfer_view: 'Pemindahan barang', item_adjustment_view: 'Penyesuaian persediaan',
  stock_opname_order_view: 'Perintah stok opname', stock_opname_result_view: 'Hasil stok opname', receive_item_view: 'Penerimaan barang',
  // Procurement
  vendor_view: 'Pemasok', vendor_category_view: 'Kategori pemasok', vendor_price_view: 'Harga pemasok', vendor_claim_view: 'Klaim pemasok',
  purchase_requisition_view: 'Permintaan barang', purchase_order_view: 'Pesanan pembelian', purchase_invoice_view: 'Faktur pembelian',
  purchase_return_view: 'Retur pembelian', purchase_payment_view: 'Pembayaran pembelian',
  // Finance
  glaccount_view: 'Akun perkiraan & saldo', journal_voucher_view: 'Jurnal umum', other_deposit_view: 'Penerimaan lain',
  other_payment_view: 'Pembayaran lain', bank_transfer_view: 'Transfer bank', expense_accrual_view: 'Pencatatan beban',
  fixed_asset_view: 'Aset tetap', account_budget_target_view: 'Anggaran akun', data_classification_view: 'Kategori keuangan',
  currency_view: 'Mata uang & kurs', tax_view: 'Pajak',
  // Organisasi
  branch_view: 'Cabang', department_view: 'Departemen', project_view: 'Proyek',
};

export function scopeLabel(scope) {
  return SCOPE_LABELS[scope] ? `${SCOPE_LABELS[scope]} (lihat)` : scope;
}

// Days until the access token expires; `soon` within 2 days (the backend
// refreshes automatically from then on).
export function tokenExpiry(expiresAt, now = new Date()) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (Number.isNaN(ms)) return null;
  const days = Math.floor(ms / 86400000);
  return { expired: ms <= 0, soon: ms < 2 * 86400000, days: Math.max(0, days) };
}

export function formatDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}
