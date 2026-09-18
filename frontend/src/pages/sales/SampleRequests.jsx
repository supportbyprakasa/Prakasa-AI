import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import FilterBar from '../../components/FilterBar';
import { toast } from '../../components/Toast';

export default function SampleRequests() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '' });
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [reject, setReject] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = async (page = 1) => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (filters.status) params.status = filters.status;
      const r = await api.get('/sales/sample-requests', { params });
      setRows(r.data.data);
      setMeta(r.data.meta || { page, total: r.data.data.length });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [filters.status]);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const r = await api.post('/sales/sample-requests', {
        entityId: Number(fd.get('entityId')),
        customerId: Number(fd.get('customerId')),
        pipelineId: fd.get('pipelineId') ? Number(fd.get('pipelineId')) : null,
        productName: fd.get('productName'),
        quantity: Number(fd.get('quantity')),
        unit: fd.get('unit') || 'pcs',
        purpose: fd.get('purpose') || null,
        deliveryAddress: fd.get('deliveryAddress') || null,
        requestedDeliveryDate: fd.get('requestedDeliveryDate') || null,
        priority: fd.get('priority') || 'normal',
      });
      toast(`Sample request dibuat · Warehouse task #${r.data.data.warehouseTaskId}`, 'success');
      setOpen(false);
      load(1);
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const decide = async (id, action, reason) => {
    try {
      await api.patch(`/sales/sample-requests/${id}`, { action, reason: reason || null });
      toast(`Sample ${action === 'approve' ? 'disetujui' : 'ditolak'}`, 'success');
      setReject(null);
      setRejectReason('');
      setDetail(null);
      load(1);
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2>Sample Requests</h2>
        <Button onClick={() => setOpen(true)}>+ Sample Request</Button>
      </div>

      <FilterBar
        filters={[
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { value: 'requested', label: 'Requested' },
              { value: 'approved', label: 'Approved' },
              { value: 'preparing', label: 'Preparing' },
              { value: 'ready', label: 'Ready' },
              { value: 'delivered', label: 'Delivered' },
              { value: 'rejected', label: 'Rejected' },
            ],
          },
        ]}
        values={filters}
        onChange={setFilters}
        onReset={() => setFilters({ status: '' })}
      />

      <DataTable
        loading={loading}
        rows={rows}
        meta={meta}
        onPageChange={load}
        empty="Belum ada sample request"
        columns={[
          { key: 'id', title: 'ID', render: (r) => `#${r.id}` },
          { key: 'customerName', title: 'Customer' },
          { key: 'productName', title: 'Produk' },
          { key: 'quantity', title: 'Qty', render: (r) => `${r.quantity} ${r.unit || ''}` },
          {
            key: 'priority',
            title: 'Prioritas',
            render: (r) => (
              <Badge tone={r.priority === 'urgent' ? 'error' : r.priority === 'high' ? 'warning' : 'default'}>
                {r.priority}
              </Badge>
            ),
          },
          {
            key: 'status',
            title: 'Status',
            render: (r) => (
              <Badge tone={r.status === 'delivered' ? 'success' : r.status === 'rejected' ? 'error' : 'info'}>
                {r.status}
              </Badge>
            ),
          },
          {
            key: 'warehouseStatus',
            title: 'Warehouse',
            render: (r) =>
              r.warehouseStatus ? (
                <Badge tone="info">{r.warehouseStatus}</Badge>
              ) : (
                <span style={{ color: 'var(--color-text-muted)' }}>—</span>
              ),
          },
          {
            key: 'actions',
            title: 'Aksi',
            render: (r) => (
              <div style={{ display: 'flex', gap: 4 }}>
                <Button variant="secondary" onClick={() => setDetail(r)}>
                  Detail
                </Button>
                {r.status === 'requested' && (
                  <>
                    <Button onClick={() => decide(r.id, 'approve')}>Setujui</Button>
                    <Button variant="danger" onClick={() => setReject(r)}>
                      Tolak
                    </Button>
                  </>
                )}
              </div>
            ),
          },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Buat Sample Request">
        <form onSubmit={create}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <Input label="Customer ID" name="customerId" type="number" required />
          <Input label="Pipeline ID (opsional)" name="pipelineId" type="number" />
          <Input label="Nama Produk" name="productName" required />
          <Input label="Quantity" name="quantity" type="number" required defaultValue={1} />
          <Input label="Unit" name="unit" defaultValue="pcs" />
          <Input label="Tujuan" name="purpose" />
          <Input label="Alamat Pengiriman" name="deliveryAddress" />
          <Input label="Target Kirim" name="requestedDeliveryDate" type="date" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Prioritas</label>
            <select name="priority" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
              {['low', 'normal', 'high', 'urgent'].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit">Kirim</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Sample #${detail?.id || ''}`}>
        {detail && (
          <div style={{ fontSize: 14, lineHeight: 1.8 }}>
            <div>Customer: <b>{detail.customerName}</b></div>
            <div>Produk: <b>{detail.productName}</b> × {detail.quantity} {detail.unit}</div>
            <div>Prioritas: {detail.priority}</div>
            <div>Status: <Badge>{detail.status}</Badge></div>
            <div>Warehouse: {detail.warehouseStatus || '—'}</div>
            <div>Alamat: {detail.deliveryAddress || '—'}</div>
            <div>Target kirim: {detail.requestedDeliveryDate || '—'}</div>
            <div>Tujuan: {detail.purpose || '—'}</div>
          </div>
        )}
      </Modal>

      <Modal open={!!reject} onClose={() => setReject(null)} title="Tolak Sample Request">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          <label style={{ fontSize: 13 }}>Alasan Penolakan</label>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
            style={{ padding: 10, borderRadius: 8, border: '1px solid var(--color-border)' }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" onClick={() => setReject(null)}>
            Batal
          </Button>
          <Button variant="danger" onClick={() => decide(reject.id, 'reject', rejectReason)}>
            Tolak
          </Button>
        </div>
      </Modal>
    </div>
  );
}
