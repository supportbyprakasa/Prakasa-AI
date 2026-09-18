import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';

export default function Departments() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/departments').then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  }, []);
  return (
    <div>
      <h2>Departments</h2>
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'id', title: 'ID' },
          { key: 'name', title: 'Nama' },
          { key: 'entityName', title: 'Entity' },
          { key: 'createdAt', title: 'Dibuat' },
        ]}
      />
    </div>
  );
}
