import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import AiAssistantPanel from '../../components/AiAssistantPanel';
import { toast } from '../../components/Toast';

export default function DocumentCenter() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState({ documentType: '', status: '', q: '' });

  const load = async (page = 1) => {
    setLoading(true);
    try {
      const r = await api.get('/documents', {
        params: { page, limit: 20, ...Object.fromEntries(Object.entries(filter).filter(([, v]) => v)) },
      });
      setRows(r.data.data);
      setMeta(r.data.meta);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(1); /* eslint-disable-next-line */ }, []);

  const onUpload = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post('/documents/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast('Dokumen diunggah', 'success');
      setUploadOpen(false);
      load(1);
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal unggah', 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Document Center</h2>
        <Button onClick={() => setUploadOpen(true)}>+ Unggah Dokumen</Button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Input name="q" placeholder="Cari judul…" value={filter.q}
          onChange={(e) => setFilter({ ...filter, q: e.target.value })} style={{ margin: 0 }} />
        <Input name="documentType" placeholder="Tipe (proposal/quotation/…)" value={filter.documentType}
          onChange={(e) => setFilter({ ...filter, documentType: e.target.value })} style={{ margin: 0 }} />
        <Button variant="secondary" onClick={() => load(1)}>Filter</Button>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'title', title: 'Judul' },
          { key: 'documentType', title: 'Tipe' },
          { key: 'status', title: 'Status' },
          { key: 'createdAt', title: 'Dibuat' },
          {
            key: 'actions', title: 'Aksi',
            render: (r) => (
              <div style={{ display: 'flex', gap: 6 }}>
                <Button variant="secondary" onClick={() => setSelected(r)}>Detail</Button>
                {r.webViewLink && (
                  <a href={r.webViewLink} target="_blank" rel="noreferrer">
                    <Button variant="secondary">Buka di Google</Button>
                  </a>
                )}
              </div>
            ),
          },
        ]}
      />
      <div style={{ marginTop: 12, fontSize: 13, color: 'var(--color-text-muted)' }}>
        Total: {meta.total}
      </div>

      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Unggah Dokumen">
        <form onSubmit={onUpload}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <Input label="Department ID (opsional)" name="departmentId" type="number" />
          <Input label="Judul" name="title" required />
          <Input label="Tipe Dokumen" name="documentType" placeholder="proposal / quotation / sop" required />
          <Input label="File" name="file" type="file" required />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setUploadOpen(false)}>Batal</Button>
            <Button type="submit">Unggah</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.title || ''}>
        {selected && (
          <>
            <div style={{ fontSize: 14, marginBottom: 12 }}>
              Tipe: <b>{selected.documentType}</b> · Status: <b>{selected.status}</b>
            </div>
            <AiAssistantPanel documentId={selected.id} />
          </>
        )}
      </Modal>
    </div>
  );
}
