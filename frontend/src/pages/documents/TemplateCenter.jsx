import { useEffect, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import FormActions from '../../components/FormActions';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import { toast } from '../../components/Toast';
import DataGrid from '../../components/datagrid/DataGrid';

const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

// /templates is a closed route (decision K11): restyled only through the
// shared components.
export default function TemplateCenter() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError('');
    api.get('/document-templates')
      .then((r) => setRows(r.data.data || []))
      .catch((error) => setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.')))
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
    setSaving(true);
    try {
      const r = await api.post(`/document-templates/${selected.id}/use`, body);
      toast('Dokumen dibuat dari template', 'success');
      window.open(r.data.data.webViewLink, '_blank');
      setSelected(null);
      load();
    } catch (err) {
      toast(errorMessage(err, 'Dokumen gagal dibuat'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page title="Template dokumen">
      <DataGrid
        title="Template dokumen"
        showTitle={false}
        loading={loading}
        error={loadError}
        onRetry={load}
        rows={rows}
        columns={[
          { key: 'name', header: 'Nama template' },
          { key: 'documentType', header: 'Tipe', translate: true },
          { key: 'description', header: 'Deskripsi' },
        ]}
        empty="Belum ada template dokumen"
        rowActions={(r) => (
          <IconButton label="Pakai template" icon="note_add" size="sm" onClick={() => setSelected(r)} />
        )}
      />

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Pakai template ${selected?.name || ''}`}>
        <form onSubmit={useTemplate} className="pw-stack">
          <Input label="Judul dokumen baru" name="title" required defaultValue={selected?.name} />
          <div className="pw-form-grid">
            <Input label="ID entitas" name="entityId" type="number" required hint="Nomor ID entitas pemilik dokumen." />
            <Input label="ID divisi" name="departmentId" type="number" hint="Opsional. Nomor ID divisi." />
          </div>
          <FormActions>
            <Button variant="text" type="button" onClick={() => setSelected(null)}>Batal</Button>
            <Button type="submit" loading={saving}>Buat dokumen</Button>
          </FormActions>
        </form>
      </Modal>
    </Page>
  );
}
