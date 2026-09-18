import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import { toast } from '../../components/Toast';

export default function SalesCustomers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/sales/customers').then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      entityId: Number(fd.get('entityId')),
      name: fd.get('name'),
      contactPerson: fd.get('contactPerson') || null,
      phone: fd.get('phone') || null,
      email: fd.get('email') || null,
      city: fd.get('city') || null,
      segment: fd.get('segment') || null,
    };
    try {
      await api.post('/sales/customers', body);
      toast('Customer dibuat', 'success');
      setOpen(false); load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  const createPipeline = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      entityId: pipelineOpen.entityId,
      departmentId: pipelineOpen.departmentId,
      customerId: pipelineOpen.id,
      dealTitle: fd.get('dealTitle'),
      estimatedValue: fd.get('estimatedValue') ? Number(fd.get('estimatedValue')) : null,
      expectedCloseDate: fd.get('expectedCloseDate') || null,
      stage: 'new_inquiry',
    };
    try {
      await api.post('/sales/pipeline', body);
      toast('Pipeline dibuat', 'success');
      setPipelineOpen(null);
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Sales Customers</h2>
        <Button onClick={() => setOpen(true)}>+ Customer</Button>
      </div>
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          {
            key: 'name',
            title: 'Nama',
            render: (r) => <Link to={`/sales/customers/${r.id}`}>{r.name}</Link>,
          },
          { key: 'contactPerson', title: 'Kontak' },
          { key: 'phone', title: 'Telepon' },
          { key: 'city', title: 'Kota' },
          { key: 'segment', title: 'Segmen' },
          { key: 'ownerName', title: 'PIC Sales' },
          {
            key: 'actions', title: 'Aksi',
            render: (r) => <Button variant="secondary" onClick={() => setPipelineOpen(r)}>+ Pipeline</Button>,
          },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Tambah Customer">
        <form onSubmit={create}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <Input label="Nama" name="name" required />
          <Input label="Kontak" name="contactPerson" />
          <Input label="Telepon" name="phone" />
          <Input label="Email" name="email" type="email" />
          <Input label="Kota" name="city" />
          <Input label="Segmen" name="segment" placeholder="retail/horeca/distributor" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!pipelineOpen} onClose={() => setPipelineOpen(null)}
        title={`Pipeline untuk ${pipelineOpen?.name || ''}`}>
        <form onSubmit={createPipeline}>
          <Input label="Judul Deal" name="dealTitle" required />
          <Input label="Estimasi Nilai (IDR)" name="estimatedValue" type="number" />
          <Input label="Estimasi Closing (YYYY-MM-DD)" name="expectedCloseDate" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setPipelineOpen(null)}>Batal</Button>
            <Button type="submit">Buat Pipeline</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
