import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import { toast } from '../../components/Toast';

export default function OnboardingBoard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/hrga/workflows', { params: { workflowType: 'onboarding' } })
      .then((r) => setRows(r.data.data))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      entityId: Number(fd.get('entityId')),
      workflowType: 'onboarding',
      employeeFullName: fd.get('employeeFullName'),
      employeeEmail: fd.get('employeeEmail') || null,
      employeePhone: fd.get('employeePhone') || null,
      employeePosition: fd.get('employeePosition') || null,
      employeeDivision: fd.get('employeeDivision') || null,
      joinDate: fd.get('joinDate') || null,
      effectiveDate: fd.get('effectiveDate'),
      autoCreateLinkedTasks: true,
    };
    try {
      const r = await api.post('/hrga/workflows', body);
      toast(`Onboarding ${r.data.data.workflowNumber} dibuat (${r.data.data.tasksCreated} task)`, 'success');
      setOpen(false); load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Onboarding</h2>
        <Button onClick={() => setOpen(true)}>+ Onboarding Baru</Button>
      </div>
      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada onboarding"
        columns={[
          { key: 'workflowNumber', title: 'Nomor',
            render: (r) => <Link to={`/hrga/workflows/${r.id}`}>{r.workflowNumber}</Link> },
          { key: 'employeeFullName', title: 'Karyawan' },
          { key: 'employeePosition', title: 'Posisi' },
          { key: 'effectiveDate', title: 'Efektif' },
          { key: 'status', title: 'Status' },
          { key: 'totalTasks', title: 'Task',
            render: (r) => `${r.completedTasks}/${r.totalTasks}` },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Onboarding Baru">
        <form onSubmit={create}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <Input label="Nama Lengkap" name="employeeFullName" required />
          <Input label="Email" name="employeeEmail" type="email" />
          <Input label="Telepon" name="employeePhone" />
          <Input label="Posisi" name="employeePosition" />
          <Input label="Divisi" name="employeeDivision" />
          <Input label="Tanggal Join" name="joinDate" type="date" />
          <Input label="Tanggal Efektif" name="effectiveDate" type="date" required />
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Sistem akan otomatis membuat checklist (Google Workspace access, Shared Drive,
            device handover, software license) yang terhubung ke modul Task & IT.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit">Buat Onboarding</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
