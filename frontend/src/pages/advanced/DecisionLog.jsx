import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import { toast } from '../../components/Toast';

export default function DecisionLog() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/decision-log').then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      entityId: Number(fd.get('entityId')),
      title: fd.get('title'),
      decision: fd.get('decision'),
      rationale: fd.get('rationale') || null,
      impact: fd.get('impact') || null,
      category: fd.get('category') || null,
      status: fd.get('status') || 'proposed',
    };
    try {
      await api.post('/decision-log', body);
      toast('Decision dicatat', 'success');
      setOpen(false); load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Decision Log</h2>
        <Button onClick={() => setOpen(true)}>+ Decision</Button>
      </div>
      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada decision"
        columns={[
          { key: 'title', title: 'Judul' },
          { key: 'category', title: 'Kategori' },
          { key: 'status', title: 'Status',
            render: (r) => <Badge tone={
              r.status === 'approved' ? 'success' :
              r.status === 'rejected' ? 'error' : 'info'
            }>{r.status}</Badge> },
          { key: 'decidedByName', title: 'Decided By' },
          { key: 'decidedAt', title: 'Kapan',
            render: (r) => r.decidedAt ? new Date(r.decidedAt).toLocaleDateString('id-ID') : '—' },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Catat Decision">
        <form onSubmit={create}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <Input label="Judul" name="title" required />
          <Input label="Kategori" name="category" placeholder="operational/finance/hr/it/sales/strategy" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Keputusan</label>
            <textarea name="decision" rows={3} required style={{
              padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Alasan</label>
            <textarea name="rationale" rows={2} style={{
              padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Dampak</label>
            <textarea name="impact" rows={2} style={{
              padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Status</label>
            <select name="status" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
              <option value="proposed">Proposed</option>
              <option value="approved">Approved</option>
              <option value="implemented">Implemented</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
