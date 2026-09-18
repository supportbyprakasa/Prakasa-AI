import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, Plus } from 'lucide-react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import FilterBar from '../../components/FilterBar';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';

const statusTone = (s) => ({
  draft: 'default',
  submitted: 'info',
  under_review: 'warning',
  approved: 'success',
  rejected: 'error',
  revision_requested: 'warning',
  completed: 'success',
  cancelled: 'default',
}[s] || 'default');

export default function MySubmissions() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', formId: '' });

  const load = async (page = 1) => {
    setLoading(true);
    try {
      const params = { page, limit: 20, submittedBy: user?.id };
      if (filters.status) params.status = filters.status;
      if (filters.formId) params.formId = filters.formId;
      const r = await api.get('/forms/submissions/list', { params });
      setRows(r.data.data || []);
      setMeta(r.data.meta || { page, total: r.data.data?.length || 0 });
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal memuat', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [filters.status]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Submission Saya</h2>
        <Button onClick={() => nav('/forms')}>
          <Plus size={14} /> Formulir Baru
        </Button>
      </div>

      <FilterBar
        filters={[
          {
            name: 'status', label: 'Status', type: 'select',
            options: [
              'draft','submitted','under_review','approved','rejected',
              'revision_requested','completed','cancelled',
            ].map((s) => ({ value: s, label: s })),
          },
        ]}
        values={filters}
        onChange={setFilters}
        onReset={() => setFilters({ status: '', formId: '' })}
      />

      <DataTable
        loading={loading}
        rows={rows}
        meta={meta}
        onPageChange={load}
        empty="Belum ada submission"
        columns={[
          {
            key: 'submissionNumber', title: 'Nomor',
            render: (r) => (
              <Link to={`/forms/submissions/${r.id}`}>
                <b>{r.submissionNumber}</b>
              </Link>
            ),
          },
          { key: 'formName', title: 'Formulir' },
          { key: 'title', title: 'Judul' },
          {
            key: 'status', title: 'Status',
            render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
          },
          {
            key: 'submittedAt', title: 'Tanggal Kirim',
            render: (r) => r.submittedAt
              ? new Date(r.submittedAt).toLocaleString('id-ID')
              : '—',
          },
        ]}
      />
    </div>
  );
}
