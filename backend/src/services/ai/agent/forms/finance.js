// Finance forms Prakasa AI may fill (contract: ../formCatalog.js; how to add
// one: docs/prakasa-ai-rencana.md §9.9).
module.exports = [
  {
    id: 'payment-request', title: 'Pengajuan pembayaran / reimbursement', route: '/finance/payment-requests?baru=1', permission: 'finance.request',
    file: 'pages/finance/PaymentRequestForm.jsx',
    fields: {
      ai: ['workflowType', 'title', 'category', 'description', 'payeeName', 'amount', 'taxAmount', 'requestedPaymentDate', 'dueDate', 'notes'],
      userOnly: ['payeeBank', 'payeeAccountNumber', 'payeeAccountName', 'totalAmount'],
    },
    // The user's own request amount (formCatalog.js MONEY_FORMS).
    money: ['amount', 'taxAmount'],
    note: 'Bank, nomor rekening, dan nama pemilik rekening penerima hanya diisi pengguna. Total dihitung formulir (subtotal + pajak).',
  },
];
