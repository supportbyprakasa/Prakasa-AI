import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import { toast } from '../../components/Toast';

export default function FolderMappingRules() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/folder-mapping-rules')
      .then((r) => setRows(r.data.data))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const submit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      entityId: Number(fd.get('entityId')),
      departmentId: fd.get('departmentId') ? Number(fd.get('departmentId')) : null,
      documentType: fd.get('documentType'),
      driveFolderId: fd.get('driveFolderId'),
      priority: Number(fd.get('priority') || 100),
    };
    try {
      await api.post('/folder-mapping-rules', body);
      toast('Rule ditambahkan', 'success');
      setOpen(false); load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Folder Mapping Rules</h2>
        <Button onClick={() => setOpen(true)}>+ Rule</Button>
      </div>
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'entityId', title: 'Entity' },
          { key: 'departmentId', title: 'Department' },
          { key: 'documentType', title: 'Tipe Dokumen' },
          { key: 'driveFolderId', title: 'Drive Folder ID' },
          { key: 'priority', title: 'Prioritas' },
        ]}
      />
      <Modal open={open} onClose={() => setOpen(false)} title="Tambah Rule">
        <form onSubmit={submit}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <Input label="Department ID (opsional)" name="departmentId" type="number" />
          <Input label="Tipe Dokumen" name="documentType" required />
          <Input label="Drive Folder ID" name="driveFolderId" required />
          <Input label="Prioritas (default 100)" name="priority" type="number" defaultValue={100} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
