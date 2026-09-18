import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import { toast } from '../../components/Toast';

export default function WarehouseDashboard() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/warehouse/sample-tasks').then((r) => setTasks(r.data.data)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const update = async (id, status) => {
    try {
      await api.patch(`/warehouse/sample-tasks/${id}/status`, { status });
      toast(`Status → ${status}`, 'success');
      load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  return (
    <div>
      <h2>Warehouse Dashboard</h2>
      <h3>Sample Task Queue</h3>
      <DataTable
        loading={loading}
        rows={tasks}
        columns={[
          { key: 'id', title: 'ID' },
          { key: 'customerName', title: 'Customer' },
          { key: 'productName', title: 'Produk' },
          { key: 'quantity', title: 'Qty' },
          { key: 'priority', title: 'Prioritas' },
          { key: 'status', title: 'Status' },
          {
            key: 'actions', title: 'Aksi',
            render: (r) => (
              <div style={{ display: 'flex', gap: 4 }}>
                {r.status === 'queued' && <Button onClick={() => update(r.id, 'preparing')}>Prepare</Button>}
                {r.status === 'preparing' && <Button onClick={() => update(r.id, 'ready')}>Ready</Button>}
                {r.status === 'ready' && <Button onClick={() => update(r.id, 'delivered')}>Delivered</Button>}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
