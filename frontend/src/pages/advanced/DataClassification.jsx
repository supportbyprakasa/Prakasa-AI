import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import { toast } from '../../components/Toast';

const toneFor = (c) =>
  ({
    public: 'success',
    internal: 'info',
    confidential: 'warning',
    restricted: 'error',
  }[c] || 'default');

export default function DataClassification() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get('/data-classification')
      .then((r) => setRows(r.data.data))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post('/data-classification', {
        entityId: Number(fd.get('entityId')),
        subjectType: fd.get('subjectType'),
        subjectId: Number(fd.get('subjectId')),
        classification: fd.get('classification'),
        tags: (fd.get('tags') || '').toString().split(',').map((s) => s.trim()).filter(Boolean),
        notes: fd.get('notes') || null,
      });
      toast('Klasifikasi disimpan', 'success');
      setOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2>Data Classification</h2>
        <Button onClick={() => setOpen(true)}>+ Klasifikasi</Button>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada klasifikasi"
        columns={[
          { key: 'subjectType', title: 'Subjek' },
          { key: 'subjectId', title: 'ID' },
          {
            key: 'classification',
            title: 'Klasifikasi',
            render: (r) => <Badge tone={toneFor(r.classification)}>{r.classification}</Badge>,
          },
          {
            key: 'tags',
            title: 'Tags',
            render: (r) => {
              const tags = typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags || [];
              return tags.length
                ? tags.map((t) => (
                    <Badge key={t} tone="info" style={{ marginRight: 4 }}>
                      {t}
                    </Badge>
                  ))
                : '—';
            },
          },
          {
            key: 'classifiedAt',
            title: 'Kapan',
            render: (r) => (r.classifiedAt ? new Date(r.classifiedAt).toLocaleString('id-ID') : '—'),
          },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Klasifikasi Data">
        <form onSubmit={create}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <Input
            label="Subject Type"
            name="subjectType"
            placeholder="document/customer/finance_workflow/hrga_workflow"
            required
          />
          <Input label="Subject ID" name="subjectId" type="number" required />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Klasifikasi</label>
            <select name="classification" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
              <option value="public">Public</option>
              <option value="internal">Internal</option>
              <option value="confidential">Confidential</option>
              <option value="restricted">Restricted</option>
            </select>
          </div>
          <Input label="Tags (pisah dengan koma)" name="tags" placeholder="pii,financial,legal" />
          <Input label="Catatan" name="notes" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

