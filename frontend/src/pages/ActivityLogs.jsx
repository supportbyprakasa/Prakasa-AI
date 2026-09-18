import { useEffect, useState } from 'react';
import api from '../api/client';
import DataTable from '../components/DataTable';

export default function ActivityLogs() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/activity-logs', { params: { page: 1, limit: 50 } })
      .then((r) => setRows(r.data.data))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div>
      <h2>Activity Log</h2>
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'createdAt', title: 'Waktu' },
          { key: 'userName', title: 'User' },
          { key: 'action', title: 'Action' },
          { key: 'subjectType', title: 'Subject' },
          { key: 'subjectId', title: 'ID' },
        ]}
      />
    </div>
  );
}
