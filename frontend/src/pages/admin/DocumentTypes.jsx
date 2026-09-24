import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Badge from '../../components/Badge';
import ConfirmDialog from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';

export default function DocumentTypes() {
  const [rows, setRows] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [del, setDel] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/document-types'),
      api.get('/workflows', { params: { activeOnly: '1' } }).catch(() => ({ data: { data: [] } })),
    ])
      .then(([r1, r2]) => {
        setRows(r1.data.data || []);
        setWorkflows(r2.data.data || []);
      })
      .catch((e) => toast(e.response?.data?.error?.message || 'Gagal memuat', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      code: fd.get('code'),
      name: fd.get('name'),
      category: fd.get('category') || null,
      defaultWorkflowId: fd.get('defaultWorkflowId') ? Number(fd.get('defaultWorkflowId')) : null,
      defaultFolderId: fd.get('defaultFolderId') || null,
      requiresSignature: fd.get('requiresSignature') === 'on',
      requiresAiPrecheck: fd.get('requiresAiPrecheck') === 'on',
      isActive: fd.get('isActive') === 'on',
    };

    try {
      if (editing) {
        const { code, ...patch } = payload;
        await api.patch(`/document-types/${editing.id}`, patch);
        toast('Document type diperbarui', 'success');
      } else {
        await api.post('/document-types', payload);
        toast('Document type dibuat', 'success');
      }
      setOpen(false); load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menyimpan', 'error');
    }
  };

  const doDelete = async () => {
    try {
      await api.delete(`/document-types/${del.id}`);
      toast('Dinonaktifkan', 'success');
      setDel(null); load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Document Types</h2>
        <Button onClick={openCreate}><Plus size={14} /> Baru</Button>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada document type"
        columns={[
          { key: 'code', title: 'Code', render: (r) => <code>{r.code}</code> },
          { key: 'name', title: 'Nama' },
          { key: 'category', title: 'Kategori' },
          { key: 'defaultWorkflowName', title: 'Workflow' },
          {
            key: 'requiresSignature', title: 'Signature',
            render: (r) => r.requiresSignature ? <Badge tone="warning">Perlu</Badge> : '—',
          },
          {
            key: 'requiresAiPrecheck', title: 'AI Precheck',
            render: (r) => r.requiresAiPrecheck ? <Badge tone="info">Ya</Badge> : '—',
          },
          {
            key: 'isActive', title: 'Status',
            render: (r) => r.isActive
              ? <Badge tone="success">Aktif</Badge>
              : <Badge>Nonaktif</Badge>,
          },
          {
            key: 'actions', title: 'Aksi',
            render: (r) => (
              <div style={{ display: 'flex', gap: 4 }}>
                <Button variant="secondary" onClick={() => openEdit(r)}>
                  <Pencil size={14} />
                </Button>
                <Button variant="danger" onClick={() => setDel(r)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            ),
          },
        ]}
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit: ${editing.name}` : 'Document Type Baru'}
      >
        <form onSubmit={submit}>
          <Input label="Code *" name="code" defaultValue={editing?.code || ''}
            required disabled={!!editing}
            placeholder="sop / proposal / invoice" />
          <Input label="Nama *" name="name" defaultValue={editing?.name || ''} required />
          <Input label="Kategori" name="category" defaultValue={editing?.category || ''} />
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Default Workflow</label>
            <select
              name="defaultWorkflowId"
              defaultValue={editing?.defaultWorkflowId || ''}
              style={{ width: '100%', padding: 8, borderRadius: 8, boxShadow: 'inset 0 0 0 1px var(--color-border)' }}
            >
              <option value="">Tidak ada</option>
              {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <Input label="Default Drive Folder ID" name="defaultFolderId"
            defaultValue={editing?.defaultFolderId || ''} />
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" name="isActive"
                defaultChecked={editing ? !!editing.isActive : true} />
              Aktif
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" name="requiresSignature"
                defaultChecked={!!editing?.requiresSignature} />
              Butuh signature
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" name="requiresAiPrecheck"
                defaultChecked={!!editing?.requiresAiPrecheck} />
              Butuh AI precheck
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!del}
        title="Nonaktifkan document type?"
        message={`"${del?.name}" akan dinonaktifkan.`}
        confirmLabel="Ya, nonaktifkan"
        onConfirm={doDelete}
        onClose={() => setDel(null)}
      />
    </div>
  );
}
