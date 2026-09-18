import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';

export default function Roles() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/roles').then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  }, []);
  return (
    <div>
      <h2>Roles</h2>
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'id', title: 'ID' },
          { key: 'name', title: 'Nama Role' },
          { key: 'entityId', title: 'Entity ID' },
          { key: 'createdAt', title: 'Dibuat' },
        ]}
      />
    </div>
  );
}
