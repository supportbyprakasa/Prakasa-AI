import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import { toast } from '../../components/Toast';

export default function OffboardingBoard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/hrga/workflows', { params: { workflowType: 'offboarding' } })
      .then((r) => setRows(r.data.data))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      entityId: Number(fd.get('entityId')),
      workflowType: 'offboarding',
      employeeUserId: fd.get('employeeUserId') ? Number(fd.get('employeeUserId')) : null,
      employeeFullName: fd.get('employeeFullName'),
      employeeEmail: fd.get('employeeEmail') || null,
      employeePosition: fd.get('employeePosition') || null,
      lastWorkingDate: fd.get('lastWorkingDate') || null,
      effectiveDate: fd.get('effectiveDate'),
      reason: fd.get('reason') || null,
      autoCreateLinkedTasks: true,
    };
    try {
      const r = await api.post('/hrga/workflows', body);
      toast(`Offboarding ${r.data.data.workflowNumber} dibuat`, 'success');
      setOpen(false); load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Offboarding</h2>
        <Button onClick={() => setOpen(true)}>+ Offboarding Baru</Button>
      </div>
      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada offboarding"
        columns={[
          { key: 'workflowNumber', title: 'Nomor',
            render: (r) => <Link to={`/hrga/workflows/${r.id}`}>{r.workflowNumber}</Link> },
          { key: 'employeeFullName', title: 'Karyawan' },
          { key: 'effectiveDate', title: 'Efektif' },
          { key: 'status', title: 'Status' },
          { key: 'totalTasks', title: 'Task',
            render: (r) => `${r.completedTasks}/${r.totalTasks}` },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Offboarding Baru">
        <form onSubmit={create}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <Input label="User ID (kalau sudah terdaftar)" name="employeeUserId" type="number" />
          <Input label="Nama Lengkap" name="employeeFullName" required />
          <Input label="Email" name="employeeEmail" type="email" />
          <Input label="Posisi" name="employeePosition" />
          <Input label="Tanggal Terakhir Kerja" name="lastWorkingDate" type="date" />
          <Input label="Tanggal Efektif" name="effectiveDate" type="date" required />
          <Input label="Alasan" name="reason" />
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Sistem akan membuat checklist offboarding (nonaktifkan akun, serah terima dokumen,
            pengembalian device, cabut license) yang terhubung ke modul Task & IT.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit">Buat Offboarding</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
