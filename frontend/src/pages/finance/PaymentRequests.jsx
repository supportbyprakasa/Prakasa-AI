import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import FilterBar from '../../components/FilterBar';
import { toast } from '../../components/Toast';

const statusTone = (s) =>
  ({
    draft: 'default',
    pending_document_check: 'info',
    pending_approval: 'warning',
    approved: 'success',
    rejected: 'error',
    revision_requested: 'warning',
    processing: 'info',
    paid: 'success',
    cancelled: 'error',
  }[s] || 'default');

export default function PaymentRequests() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ workflowType: '', status: '', q: '' });
  const [open, setOpen] = useState(false);

  const load = async (page = 1) => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      Object.entries(filters).forEach(([k, v]) => {
        if (v) params[k] = v;
      });
      const r = await api.get('/finance/payment-requests', { params });
      setRows(r.data.data);
      setMeta(r.data.meta || { page, total: r.data.data.length });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [filters.workflowType, filters.status]);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const r = await api.post('/finance/payment-requests', {
        entityId: Number(fd.get('entityId')),
        workflowType: fd.get('workflowType'),
        title: fd.get('title'),
        description: fd.get('description') || null,
        category: fd.get('category') || null,
        payeeName: fd.get('payeeName') || null,
        payeeBank: fd.get('payeeBank') || null,
        payeeAccountNumber: fd.get('payeeAccountNumber') || null,
        payeeAccountName: fd.get('payeeAccountName') || null,
        amount: Number(fd.get('amount')),
        taxAmount: Number(fd.get('taxAmount') || 0),
        totalAmount: Number(fd.get('totalAmount')),
        requestDate: fd.get('requestDate'),
        dueDate: fd.get('dueDate') || null,
      });
      toast(`Draft dibuat: ${r.data.data.requestNumber}`, 'success');
      setOpen(false);
      load(1);
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2>Payment Requests</h2>
        <Button onClick={() => setOpen(true)}>+ Payment / Reimbursement</Button>
      </div>

      <FilterBar
        filters={[
          {
            name: 'workflowType',
            label: 'Tipe',
            type: 'select',
            options: [
              { value: 'payment_request', label: 'Payment Request' },
              { value: 'reimbursement', label: 'Reimbursement' },
            ],
          },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: [
              'draft',
              'pending_approval',
              'approved',
              'rejected',
              'revision_requested',
              'processing',
              'paid',
              'cancelled',
            ].map((s) => ({ value: s, label: s })),
          },
          { name: 'q', label: 'Cari', type: 'text', placeholder: 'nomor / judul / penerima' },
        ]}
        values={filters}
        onChange={setFilters}
        onReset={() => setFilters({ workflowType: '', status: '', q: '' })}
      >
        <Button variant="secondary" onClick={() => load(1)}>
          Terapkan
        </Button>
      </FilterBar>

      <DataTable
        loading={loading}
        rows={rows}
        meta={meta}
        onPageChange={load}
        empty="Belum ada pengajuan"
        columns={[
          {
            key: 'requestNumber',
            title: 'Nomor',
            render: (r) => <Link to={`/finance/payment-requests/${r.id}`}>{r.requestNumber}</Link>,
          },
          {
            key: 'workflowType',
            title: 'Tipe',
            render: (r) => (
              <Badge tone={r.workflowType === 'reimbursement' ? 'info' : 'default'}>
                {r.workflowType}
              </Badge>
            ),
          },
          { key: 'title', title: 'Judul' },
          { key: 'payeeName', title: 'Penerima' },
          {
            key: 'totalAmount',
            title: 'Total',
            render: (r) => `${r.currency || 'IDR'} ${Number(r.totalAmount).toLocaleString('id-ID')}`,
          },
          { key: 'status', title: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
          {
            key: 'documentCheckStatus',
            title: 'Doc Check',
            render: (r) => (
              <Badge
                tone={
                  r.documentCheckStatus === 'passed'
                    ? 'success'
                    : r.documentCheckStatus === 'warning'
                    ? 'warning'
                    : r.documentCheckStatus === 'failed'
                    ? 'error'
                    : 'default'
                }
              >
                {r.documentCheckStatus}
              </Badge>
            ),
          },
          { key: 'requesterName', title: 'Requester' },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Buat Pengajuan Finance">
        <form onSubmit={create}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Tipe</label>
            <select name="workflowType" style={{ padding: 8, borderRadius: 8, boxShadow: 'inset 0 0 0 1px var(--color-border)' }}>
              <option value="payment_request">Payment Request</option>
              <option value="reimbursement">Reimbursement</option>
            </select>
          </div>
          <Input label="Judul" name="title" required />
          <Input label="Deskripsi" name="description" />
          <Input label="Kategori" name="category" placeholder="operational/vendor/travel/medical" />
          <Input label="Nama Penerima" name="payeeName" />
          <Input label="Bank" name="payeeBank" />
          <Input label="No. Rekening" name="payeeAccountNumber" />
          <Input label="Atas Nama" name="payeeAccountName" />
          <Input label="Subtotal" name="amount" type="number" required />
          <Input label="Pajak" name="taxAmount" type="number" defaultValue={0} />
          <Input label="Total" name="totalAmount" type="number" required />
          <Input
            label="Tanggal Pengajuan"
            name="requestDate"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
          <Input label="Jatuh Tempo" name="dueDate" type="date" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit">Simpan Draft</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
