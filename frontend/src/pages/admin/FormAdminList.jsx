import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Eye } from 'lucide-react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import ConfirmDialog from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';

export default function FormAdminList() {
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/forms')
      .then((r) => setRows(r.data.data || []))
      .catch((e) => toast(e.response?.data?.error?.message || 'Gagal memuat', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const doDelete = async () => {
    try {
      await api.delete(`/forms/${deleteTarget.id}`);
      toast('Form dihapus', 'success');
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal hapus', 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Kelola Formulir</h2>
        <Button onClick={() => nav('/admin/forms/new')}>
          <Plus size={14} /> Form Baru
        </Button>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada form"
        columns={[
          { key: 'name', title: 'Nama' },
          {
            key: 'slug', title: 'Slug',
            render: (r) => <code style={{ fontSize: 12 }}>{r.slug}</code>,
          },
          { key: 'category', title: 'Kategori' },
          { key: 'fieldCount', title: 'Field' },
          { key: 'submissionCount', title: 'Submission' },
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
                <Link to={`/forms/${r.slug}`}>
                  <Button variant="secondary"><Eye size={14} /></Button>
                </Link>
                <Link to={`/admin/forms/${r.id}`}>
                  <Button variant="secondary"><Pencil size={14} /></Button>
                </Link>
                <Button variant="danger" onClick={() => setDeleteTarget(r)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus formulir?"
        message={`Form "${deleteTarget?.name}" akan dihapus (soft delete). Submission lama tetap tersimpan.`}
        confirmLabel="Ya, hapus"
        onConfirm={doDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
