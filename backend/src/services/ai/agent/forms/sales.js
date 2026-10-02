// Sales forms Prakasa AI may fill (contract: ../formCatalog.js; how to add one:
// docs/prakasa-ai-rencana.md §9.9). Customer and product names are Accurate
// data: a lookup sets one only when the page's own search finds exactly one
// match. Prices, discounts, PPN, ongkos kirim, payments and phone numbers are
// never in `ai`.
const CUSTOMER_AI = ['name', 'channel', 'legalForm', 'ownerUserId', 'contactPerson', 'email', 'address', 'city', 'notes'];
const CUSTOMER_NOTE = 'Handphone dan telp. bisnis diisi pengguna. ID pelanggan dibuat otomatis dari bentuk usaha, channel, dan kode kota.';
const ORDER_AI = ['orderDate', 'deliveryDate', 'channel', 'ownerUserId', 'notes', 'lines', 'lines.product', 'lines.qty'];
const ORDER_NOTE = 'Pelanggan dan produk dipilih lewat pencarian halaman: bila hasilnya tidak tepat satu, tanyakan ke pengguna. '
  + 'Harga, PPN, ongkos kirim, dan No. SO diisi pengguna: baris yang ditambahkan AI belum punya harga. Baris yang diketik pengguna tidak diubah.';
const EXCHANGE_AI = ['exchangedOn', 'receiptNo', 'promisedPayDate', 'note'];

module.exports = [
  {
    id: 'sales-lead', title: 'Lead', route: '/sales/leads?baru=1', permission: 'sales.customer.manage',
    file: 'pages/sales/SalesLeads.jsx',
    fields: { ai: ['name', 'area', 'address', 'ownerUserId', 'latitude', 'longitude', 'notes'], userOnly: [] },
    note: 'Outlet baru yang belum menjadi pelanggan.',
  },
  {
    id: 'sales-lead-edit', title: 'Ubah lead', route: '/sales/leads?lead=<id lead>&form=ubah', permission: 'sales.customer.manage',
    file: 'pages/sales/SalesLeads.jsx', mode: 'edit', record: 'sales_lead',
    fields: { ai: ['name', 'area', 'address', 'ownerUserId', 'latitude', 'longitude'], userOnly: [] },
    note: 'Butuh id lead. Status lead (tidak berminat / buka lagi) diputuskan pengguna lewat menu halaman.',
  },
  {
    id: 'sales-lead-link', title: 'Hubungkan lead ke pelanggan', route: '/sales/leads?lead=<id lead>', permission: 'sales.customer.manage',
    file: 'pages/sales/SalesLeads.jsx', mode: 'edit', record: 'sales_lead',
    fields: { ai: ['customerId'], userOnly: [] },
    note: 'Hanya ada di halaman lead yang belum menjadi pelanggan. Pelanggan dipilih lewat pencarian halaman: bila hasilnya tidak tepat satu, tanyakan ke pengguna. Pengguna yang menekan Hubungkan ke pelanggan.',
  },
  {
    id: 'sales-visit', title: 'Catatan kunjungan lead', route: '/sales/leads?lead=<id lead>&kunjungan=1', permission: 'sales.customer.manage',
    file: 'pages/sales/SalesLeads.jsx',
    fields: { ai: ['visitDate', 'isPlanned', 'checkIn', 'checkOut', 'summary'], userOnly: [] },
    note: 'Butuh id lead: dari halaman lead yang sedang terbuka atau dari data lead.',
  },
  {
    id: 'sales-customer', title: 'Pelanggan baru', route: '/sales/customers?baru=1', permission: 'sales.customer.manage',
    file: 'pages/sales/SalesForms.jsx',
    fields: { ai: [...CUSTOMER_AI, 'cityCode'], userOnly: ['phone', 'businessPhone'] },
    note: CUSTOMER_NOTE,
  },
  {
    id: 'sales-customer-convert', title: 'Jadikan pelanggan', route: '/sales/leads?lead=<id lead>&form=pelanggan', permission: 'sales.customer.manage',
    file: 'pages/sales/SalesForms.jsx',
    fields: { ai: [...CUSTOMER_AI, 'cityCode'], userOnly: ['phone', 'businessPhone'] },
    note: `Butuh id lead yang belum menjadi pelanggan; nama dan alamat terisi awal dari lead. ${CUSTOMER_NOTE}`,
  },
  {
    id: 'sales-customer-edit', title: 'Ubah pelanggan', route: '/sales/customers/<id pelanggan>?ubah=1', permission: 'sales.customer.manage',
    file: 'pages/sales/SalesForms.jsx', mode: 'edit', record: 'sales_customer',
    fields: { ai: CUSTOMER_AI, userOnly: ['phone', 'businessPhone', 'customerCode'] },
    note: 'Handphone dan telp. bisnis diisi pengguna. ID pelanggan tidak bisa diubah.',
  },
  {
    id: 'sales-order', title: 'Sales order', route: '/sales/orders/new', permission: 'sales.order.manage',
    file: 'pages/sales/SalesOrderForm.jsx',
    fields: { ai: ['customer', ...ORDER_AI], userOnly: ['orderNumber', 'deliveryFee', 'lines.unitPrice', 'lines.taxable'] },
    note: `Hanya bila sales order dicatat di aplikasi ini (bukan di sistem pembukuan). ${ORDER_NOTE}`,
  },
  {
    id: 'sales-order-edit', title: 'Ubah sales order', route: '/sales/orders/<id SO>/edit', permission: 'sales.order.manage',
    file: 'pages/sales/SalesOrderForm.jsx', mode: 'edit', record: 'sales_order',
    fields: { ai: ORDER_AI, userOnly: ['customer', 'orderNumber', 'deliveryFee', 'lines.unitPrice', 'lines.taxable'] },
    note: `Hanya sales order yang belum ditagih. Pelanggan dan No. SO tidak bisa diubah. ${ORDER_NOTE}`,
  },
  {
    id: 'sales-order-delivery', title: 'Surat jalan', route: '/sales/orders/<id SO>?aksi=surat-jalan', permission: 'sales.order.manage',
    file: 'pages/sales/SalesOrderDetail.jsx', mode: 'edit', record: 'sales_order',
    fields: { ai: ['number', 'date'], userOnly: [] },
    note: 'Nomor dan tanggal surat jalan untuk satu sales order. Nomor sudah terisi saran; ubah hanya bila pengguna menyebut nomornya.',
  },
  {
    id: 'sales-order-invoice', title: 'Invoice', route: '/sales/orders/<id SO>?aksi=invoice', permission: 'sales.order.manage',
    file: 'pages/sales/SalesOrderDetail.jsx', mode: 'edit', record: 'sales_order',
    fields: { ai: ['number', 'date', 'dueDate'], userOnly: [] },
    note: 'Nomor, tanggal, dan jatuh tempo invoice untuk satu sales order; nilainya dari sales order. Nomor sudah terisi saran; ubah hanya bila pengguna menyebut nomornya. Pembayaran dicatat pengguna.',
  },
  {
    id: 'sales-product', title: 'Produk baru', route: '/sales/orders?tab=products&baru=1', permission: 'sales.master.manage',
    file: 'pages/sales/SalesOrders.jsx',
    fields: { ai: ['skuCode', 'name', 'category', 'unit'], userOnly: ['price', 'costPrice'] },
    note: 'Hanya bila master produk dikelola di aplikasi ini (bukan di sistem pembukuan). Harga jual dan harga pokok diisi pengguna.',
  },
  {
    id: 'sales-product-edit', title: 'Ubah produk', route: '/sales/orders?tab=products&q=<SKU produk>&ubah=<id produk>', permission: 'sales.master.manage',
    file: 'pages/sales/SalesOrders.jsx', mode: 'edit', record: 'sales_product',
    fields: { ai: ['name', 'category', 'unit'], userOnly: ['skuCode', 'price', 'costPrice', 'isActive'] },
    note: 'Butuh SKU dan id produk. SKU tidak bisa diubah; harga jual, harga pokok, dan status diisi pengguna.',
  },
  {
    id: 'sales-document-settings', title: 'Pengaturan dokumen sales', route: '/sales/orders?form=pengaturan-dokumen', permission: 'sales.master.manage',
    file: 'pages/sales/SalesOrders.jsx', mode: 'edit', record: 'sales_document_settings',
    fields: { ai: ['companyName', 'email', 'address', 'paymentTermsDays', 'invoiceNote', 'deliveryNote'], userOnly: ['npwp', 'phone', 'bankAccounts'] },
    note: 'Rekening pembayaran, NPWP, dan telepon diisi pengguna.',
  },
  {
    id: 'sales-exchange', title: 'Tukar faktur', route: '/sales/orders?tab=exchange&baru=<nomor faktur>', permission: 'sales.order.manage',
    file: 'pages/sales/SalesExchanges.jsx',
    fields: { ai: EXCHANGE_AI, userOnly: [] },
    note: 'Butuh nomor faktur kredit yang belum ditukar (dari data faktur, jangan dikarang). Membatalkan tukar faktur diputuskan pengguna.',
  },
  {
    id: 'sales-exchange-edit', title: 'Ubah tukar faktur', route: '/sales/orders?tab=exchange&ubah=<nomor faktur>', permission: 'sales.order.manage',
    file: 'pages/sales/SalesExchanges.jsx', mode: 'edit', record: 'sales_invoice_exchange',
    fields: { ai: EXCHANGE_AI, userOnly: [] },
    note: 'Butuh nomor faktur yang sudah punya catatan tukar faktur. Membatalkan tukar faktur diputuskan pengguna.',
  },
];
