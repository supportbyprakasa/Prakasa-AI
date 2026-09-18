import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import { toast } from '../../components/Toast';

export default function TemplateCenter() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/document-templates')
      .then((r) => setRows(r.data.data))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const useTemplate = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      title: fd.get('title'),
      entityId: Number(fd.get('entityId')),
      departmentId: fd.get('departmentId') ? Number(fd.get('departmentId')) : null,
    };
    try {
      const r = await api.post(`/document-templates/${selected.id}/use`, body);
      toast('Dokumen dibuat dari template', 'success');
      window.open(r.data.data.webViewLink, '_blank');
      setSelected(null);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <div>
      <h2>Template Center</h2>
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'name', title: 'Nama Template' },
          { key: 'documentType', title: 'Tipe' },
          { key: 'description', title: 'Deskripsi' },
          {
            key: 'actions', title: 'Aksi',
            render: (r) => <Button onClick={() => setSelected(r)}>Gunakan Template</Button>,
          },
        ]}
      />

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Gunakan: ${selected?.name || ''}`}>
        <form onSubmit={useTemplate}>
          <Input label="Judul Dokumen Baru" name="title" required defaultValue={selected?.name} />
          <Input label="Entity ID" name="entityId" type="number" required />
          <Input label="Department ID (opsional)" name="departmentId" type="number" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setSelected(null)}>Batal</Button>
            <Button type="submit">Generate</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
