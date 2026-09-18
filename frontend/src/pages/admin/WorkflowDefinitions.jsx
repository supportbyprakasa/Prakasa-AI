import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import ConfirmDialog from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';

export default function WorkflowDefinitions() {
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [del, setDel] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/workflows')
      .then((r) => setRows(r.data.data || []))
      .catch((e) => toast(e.response?.data?.error?.message || 'Gagal memuat', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const doDelete = async () => {
    try {
      await api.delete(`/workflows/${del.id}`);
      toast('Workflow dihapus', 'success');
      setDel(null); load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal hapus', 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Workflow Definitions</h2>
        <Button onClick={() => nav('/admin/workflows/new')}>
          <Plus size={14} /> Workflow Baru
        </Button>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada workflow"
        columns={[
          { key: 'name', title: 'Nama' },
          { key: 'slug', title: 'Slug', render: (r) => <code style={{ fontSize: 12 }}>{r.slug}</code> },
          { key: 'appliesTo', title: 'Applies To' },
          { key: 'statusCount', title: 'Status' },
          { key: 'transitionCount', title: 'Transisi' },
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
                <Link to={`/admin/workflows/${r.id}`}>
                  <Button variant="secondary"><Pencil size={14} /></Button>
                </Link>
                <Button variant="danger" onClick={() => setDel(r)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={!!del}
        title="Hapus workflow?"
        message={`Workflow "${del?.name}" akan dinonaktifkan dan di-soft-delete.`}
        confirmLabel="Ya, hapus"
        onConfirm={doDelete}
        onClose={() => setDel(null)}
      />
    </div>
  );
}
