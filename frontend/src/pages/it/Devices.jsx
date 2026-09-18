import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import { toast } from '../../components/Toast';

const DEVICE_TYPES = [
  'laptop','pc','macbook','smartphone','tablet','printer',
  'router','switch','access_point','cctv_nvr','monitor',
  'external_hdd','peripheral','other',
];

export default function Devices() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0 });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(null);

  const load = async (page = 1) => {
    setLoading(true);
    try {
      const r = await api.get('/it/devices', { params: { page, limit: 20 } });
      setRows(r.data.data); setMeta(r.data.meta);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(1); }, []);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      entityId: Number(fd.get('entityId')),
      assetCode: fd.get('assetCode'),
      deviceType: fd.get('deviceType'),
      brand: fd.get('brand') || null,
      model: fd.get('model') || null,
      serialNumber: fd.get('serialNumber') || null,
      purchaseDate: fd.get('purchaseDate') || null,
      purchasePrice: fd.get('purchasePrice') ? Number(fd.get('purchasePrice')) : null,
      supplier: fd.get('supplier') || null,
      warrantyStart: fd.get('warrantyStart') || null,
      warrantyEnd: fd.get('warrantyEnd') || null,
      warrantyType: fd.get('warrantyType') || 'manufacturer',
      conditionState: fd.get('conditionState') || 'good',
      currentLocation: fd.get('currentLocation') || null,
    };
    try {
      await api.post('/it/devices', body);
      toast('Device dibuat', 'success');
      setOpen(false); load(1);
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  const assign = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post('/it/assignments', {
        entityId: assignOpen.entityId,
        departmentId: assignOpen.departmentId,
        deviceId: assignOpen.id,
        assignedTo: Number(fd.get('assignedTo')),
        expectedReturnDate: fd.get('expectedReturnDate') || null,
        location: fd.get('location') || null,
        purpose: fd.get('purpose') || null,
      });
      toast('Device di-assign', 'success');
      setAssignOpen(null); load(1);
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>IT Devices</h2>
        <Button onClick={() => setOpen(true)}>+ Device</Button>
      </div>
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'assetCode', title: 'Kode' },
          { key: 'deviceType', title: 'Tipe' },
          { key: 'brand', title: 'Brand' },
          { key: 'model', title: 'Model' },
          { key: 'status', title: 'Status' },
          { key: 'assigneeName', title: 'PIC' },
          { key: 'warrantyEnd', title: 'Warranty' },
          {
            key: 'actions', title: 'Aksi',
            render: (r) => r.status === 'available'
              ? <Button variant="secondary" onClick={() => setAssignOpen(r)}>Assign</Button>
              : <span style={{ color: 'var(--color-text-muted)' }}>—</span>,
          },
        ]}
      />
      <div style={{ marginTop: 12, fontSize: 13, color: 'var(--color-text-muted)' }}>Total: {meta.total}</div>

      <Modal open={open} onClose={() => setOpen(false)} title="Tambah Device">
        <form onSubmit={create}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <Input label="Asset Code" name="assetCode" required />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Tipe</label>
            <select name="deviceType" required style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
              {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <Input label="Brand" name="brand" />
          <Input label="Model" name="model" />
          <Input label="Serial Number" name="serialNumber" />
          <Input label="Tanggal Beli (YYYY-MM-DD)" name="purchaseDate" />
          <Input label="Harga Beli" name="purchasePrice" type="number" />
          <Input label="Supplier" name="supplier" />
          <Input label="Warranty Mulai" name="warrantyStart" />
          <Input label="Warranty Selesai" name="warrantyEnd" />
          <Input label="Lokasi" name="currentLocation" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!assignOpen} onClose={() => setAssignOpen(null)}
        title={`Assign ${assignOpen?.assetCode || ''}`}>
        <form onSubmit={assign}>
          <Input label="User ID" name="assignedTo" type="number" required />
          <Input label="Batas Kembali (YYYY-MM-DD)" name="expectedReturnDate" />
          <Input label="Lokasi" name="location" />
          <Input label="Tujuan" name="purpose" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setAssignOpen(null)}>Batal</Button>
            <Button type="submit">Assign</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
