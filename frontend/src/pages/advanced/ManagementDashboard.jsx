import { useEffect, useState } from 'react';
import api from '../../api/client';
import Card from '../../components/Card';
import DataTable from '../../components/DataTable';
import Badge from '../../components/Badge';

export default function ManagementDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/management-dashboard/summary')
      .then((r) => setData(r.data.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Memuat…</div>;
  if (!data) return <div>Tidak ada data.</div>;

  const kpi = (label, value, sub, tone = 'info') => (
    <Card key={label}>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{sub}</div>}
    </Card>
  );

  return (
    <div>
      <h2>Management Dashboard</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {kpi('Task Aktif', data.tasks.active || 0, `${data.tasks.overdue || 0} overdue`)}
        {kpi('Approval Pending', data.approvals.pending || 0, `${data.approvals.aged || 0} > 3 hari`)}
        {kpi('Sales Aktif', data.sales.active || 0,
             `${data.sales.wonThisMonth || 0} won bulan ini`)}
        {kpi('Finance Pending', data.finance.pending || 0,
             `Total: ${Number(data.finance.totalPendingAmount || 0).toLocaleString('id-ID')} IDR`)}
        {kpi('Onboarding Aktif', data.hrga.onboardingActive || 0)}
        {kpi('Offboarding Aktif', data.hrga.offboardingActive || 0)}
        {kpi('Device In Service', data.it.devicesInService || 0)}
        {kpi('Subs Expiring', data.it.subsExpiring || 0)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Card title="Top 5 Task Overdue">
          <DataTable
            loading={false}
            rows={data.overdueTasks}
            empty="Tidak ada task overdue"
            columns={[
              { key: 'title', title: 'Task' },
              { key: 'dueDate', title: 'Due' },
              { key: 'daysOverdue', title: 'Overdue (hari)' },
            ]}
          />
        </Card>
        <Card title="Approval Aging">
          <DataTable
            loading={false}
            rows={data.agedApprovals}
            empty="Tidak ada approval aging"
            columns={[
              { key: 'title', title: 'Approval' },
              { key: 'daysPending', title: 'Hari' },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
