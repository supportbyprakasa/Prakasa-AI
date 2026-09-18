import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import { toast } from '../../components/Toast';

export default function SampleRequests() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/sales/sample-requests').then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
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
    };
    try {
      const r = await api.post('/sales/sample-requests', body);
      toast(`Sample request dibuat. Warehouse task #${r.data.data.warehouseTaskId}`, 'success');
      setOpen(false); load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Sample Requests</h2>
        <Button onClick={() => setOpen(true)}>+ Sample Request</Button>
      </div>
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'id', title: 'ID' },
          { key: 'customerName', title: 'Customer' },
          { key: 'productName', title: 'Produk' },
          { key: 'quantity', title: 'Qty' },
          { key: 'status', title: 'Status' },
          { key: 'warehouseStatus', title: 'WH Status' },
          { key: 'priority', title: 'Prioritas' },
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
          <Input label="Target Kirim (YYYY-MM-DD)" name="requestedDeliveryDate" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Prioritas</label>
            <select name="priority" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit">Kirim Request</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
