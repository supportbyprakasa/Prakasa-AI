import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';

export default function Entities() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/entities').then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  }, []);
  return (
    <div>
      <h2>Entities</h2>
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'id', title: 'ID' },
          { key: 'name', title: 'Nama' },
          { key: 'brandCode', title: 'Brand Code' },
          { key: 'createdAt', title: 'Dibuat' },
        ]}
      />
    </div>
  );
}
