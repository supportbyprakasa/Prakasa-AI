import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';

export default function Permissions() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/permissions').then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  }, []);
  return (
    <div>
      <h2>Permissions</h2>
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'id', title: 'ID' },
          { key: 'code', title: 'Code' },
          { key: 'description', title: 'Deskripsi' },
        ]}
      />
    </div>
  );
}
