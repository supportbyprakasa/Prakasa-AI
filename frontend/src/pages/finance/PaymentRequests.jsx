import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import { toast } from '../../components/Toast';

const statusTone = (s) => ({
  draft: 'default', pending_document_check: 'info', pending_approval: 'warning',
  approved: 'success', rejected: 'error', revision_requested: 'warning',
  processing: 'info', paid: 'success', cancelled: 'error',
}[s] || 'default');

export default function PaymentRequests() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0 });
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [open, setOpen] = useState(false);

  const load = async (page = 1) => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (filterType) params.workflowType = filterType;
      if (filterStatus) params.status = filterStatus;
      const r = await api.get('/finance/payment-requests', { params });
      setRows(r.data.data); setMeta(r.data.meta);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [filterType, filterStatus]);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
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
    };
    try {
      const r = await api.post('/finance/payment-requests', body);
      toast(`Dibuat: ${r.data.data.requestNumber}`, 'success');
      setOpen(false); load(1);
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Finance Workflow</h2>
        <Button onClick={() => setOpen(true)}>+ Payment / Reimbursement</Button>
      </div>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
          <option value="">Semua tipe</option>
          <option value="payment_request">Payment Request</option>
          <option value="reimbursement">Reimbursement</option>
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
          <option value="">Semua status</option>
          {['draft','pending_approval','approved','rejected','revision_requested','processing','paid','cancelled']
            .map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada pengajuan"
        columns={[
          { key: 'requestNumber', title: 'Nomor',
            render: (r) => <Link to={`/finance/payment-requests/${r.id}`}>{r.requestNumber}</Link> },
          { key: 'workflowType', title: 'Tipe' },
          { key: 'title', title: 'Judul' },
          { key: 'payeeName', title: 'Penerima' },
          { key: 'totalAmount', title: 'Total',
            render: (r) => `${r.currency} ${Number(r.totalAmount).toLocaleString('id-ID')}` },
          { key: 'status', title: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
          { key: 'documentCheckStatus', title: 'Doc Check',
            render: (r) => <Badge tone={
              r.documentCheckStatus === 'passed' ? 'success' :
              r.documentCheckStatus === 'warning' ? 'warning' :
              r.documentCheckStatus === 'failed' ? 'error' : 'default'
            }>{r.documentCheckStatus}</Badge> },
          { key: 'requesterName', title: 'Requester' },
        ]}
      />
      <div style={{ marginTop: 12, fontSize: 13, color: 'var(--color-text-muted)' }}>Total: {meta.total}</div>

      <Modal open={open} onClose={() => setOpen(false)} title="Buat Pengajuan Finance">
        <form onSubmit={create}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Tipe</label>
            <select name="workflowType" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
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
          <Input label="Tanggal Pengajuan" name="requestDate" type="date" required />
          <Input label="Jatuh Tempo (opsional)" name="dueDate" type="date" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit">Simpan Draft</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
