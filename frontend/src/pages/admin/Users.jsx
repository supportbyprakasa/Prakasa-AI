import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';

export default function Users() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, total: 0 });
  const [loading, setLoading] = useState(true);

  const load = async (page = 1) => {
    setLoading(true);
    try {
      const r = await api.get('/users', { params: { page, limit: 20 } });
      setRows(r.data.data);
      setMeta(r.data.meta);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(1); }, []);

  return (
    <div>
      <h2>Users</h2>
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'id', title: 'ID' },
          { key: 'name', title: 'Nama' },
          { key: 'email', title: 'Email' },
          { key: 'entityId', title: 'Entity' },
          { key: 'departmentId', title: 'Department' },
          { key: 'status', title: 'Status' },
        ]}
      />
      <div style={{ marginTop: 12, color: 'var(--color-text-muted)', fontSize: 13 }}>
        Total: {meta.total}
      </div>
    </div>
  );
}
