import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import { toast } from '../../components/Toast';

export default function SoftwareSubscriptions() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/it/subscriptions').then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      entityId: Number(fd.get('entityId')),
      productName: fd.get('productName'),
      planName: fd.get('planName') || null,
      totalSeats: Number(fd.get('totalSeats') || 1),
      unitPrice: fd.get('unitPrice') ? Number(fd.get('unitPrice')) : null,
      billingCycle: fd.get('billingCycle') || 'monthly',
      renewalDate: fd.get('renewalDate'),
      startDate: fd.get('startDate') || null,
      generateLicenses: true,
    };
    try {
      await api.post('/it/subscriptions', body);
      toast('Subscription dibuat', 'success');
      setOpen(false); load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  const uploadInvoice = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post(`/it/subscriptions/${invoiceOpen.id}/invoices`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast('Invoice diunggah', 'success');
      setInvoiceOpen(null); load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Software Subscriptions</h2>
        <Button onClick={() => setOpen(true)}>+ Subscription</Button>
      </div>
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          {
            key: 'productName',
            title: 'Produk',
            render: (r) => <Link to={`/it/subscriptions/${r.id}`}>{r.productName || r.product_name}</Link>,
          },
          { key: 'planName', title: 'Plan' },
          { key: 'totalSeats', title: 'Seats' },
          { key: 'assignedSeats', title: 'Terpakai' },
          { key: 'idleSeats', title: 'Idle' },
          { key: 'renewalDate', title: 'Renewal' },
          { key: 'status', title: 'Status' },
          {
            key: 'actions', title: 'Aksi',
            render: (r) => <Button variant="secondary" onClick={() => setInvoiceOpen(r)}>+ Invoice</Button>,
          },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Tambah Subscription">
        <form onSubmit={create}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <Input label="Produk" name="productName" required />
          <Input label="Plan" name="planName" />
          <Input label="Total Seats" name="totalSeats" type="number" defaultValue={1} />
          <Input label="Harga per Seat" name="unitPrice" type="number" />
          <Input label="Start Date (YYYY-MM-DD)" name="startDate" />
          <Input label="Renewal Date (YYYY-MM-DD)" name="renewalDate" required />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Billing Cycle</label>
            <select name="billingCycle" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
              <option value="multi_year">Multi Year</option>
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!invoiceOpen} onClose={() => setInvoiceOpen(null)}
        title={`Unggah Invoice - ${invoiceOpen?.productName || ''}`}>
        <form onSubmit={uploadInvoice}>
          <Input label="Nomor Invoice" name="invoiceNumber" required />
          <Input label="Tanggal Invoice" name="invoiceDate" type="date" required />
          <Input label="Subtotal" name="amount" type="number" required />
          <Input label="Pajak" name="taxAmount" type="number" defaultValue={0} />
          <Input label="Total" name="totalAmount" type="number" required />
          <Input label="Referensi Jurnal.id" name="jurnalReferenceId" />
          <Input label="File Invoice (PDF)" name="file" type="file" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setInvoiceOpen(null)}>Batal</Button>
            <Button type="submit">Unggah</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
