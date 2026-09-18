import { useEffect, useState } from 'react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import DataTable from '../../components/DataTable';
import { toast } from '../../components/Toast';

export default function ItDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiReport, setAiReport] = useState(null);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/it/dashboard/summary');
      setData(r.data.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const runAi = async () => {
    setRunning(true); setAiReport(null);
    try {
      const r = await api.post('/it/dashboard/ai-report');
      setAiReport(r.data.data.content);
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    } finally { setRunning(false); }
  };

  return (
    <div>
      <h2>IT Dashboard</h2>
      {loading && <div style={{ color: 'var(--color-text-muted)' }}>Memuat…</div>}
      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            <Card title="Total Device">
              <div style={{ fontSize: 24, fontWeight: 700 }}>{data.devices.total || 0}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {data.devices.assigned || 0} assigned · {data.devices.available || 0} available
              </div>
            </Card>
            <Card title="Repair / Maintenance">
              <div style={{ fontSize: 24, fontWeight: 700 }}>
                {(data.devices.repair || 0) + (data.devices.maintenance || 0)}
              </div>
            </Card>
            <Card title="Subscriptions">
              <div style={{ fontSize: 24, fontWeight: 700 }}>{data.subscriptions.total || 0}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {data.subscriptions.expiring || 0} expiring
              </div>
            </Card>
            <Card title="Idle License">
              <div style={{ fontSize: 24, fontWeight: 700 }}>{data.idleLicenses.total || 0}</div>
            </Card>
          </div>

          <Card title="Warranty akan berakhir (60 hari)">
            <DataTable
              loading={false}
              rows={data.warrantyDue}
              empty="Tidak ada warranty yang akan berakhir"
              columns={[
                { key: 'assetCode', title: 'Kode' },
                { key: 'deviceType', title: 'Tipe' },
                { key: 'warrantyEnd', title: 'Berakhir' },
                { key: 'daysLeft', title: 'Sisa Hari' },
              ]}
            />
          </Card>

          <div style={{ marginTop: 16 }}>
            <Card title="Subscription renewal due (30 hari)">
              <DataTable
                loading={false}
                rows={data.renewalsDue}
                empty="Tidak ada renewal dalam 30 hari"
                columns={[
                  { key: 'productName', title: 'Produk' },
                  { key: 'renewalDate', title: 'Renewal' },
                  { key: 'daysLeft', title: 'Sisa Hari' },
                  { key: 'totalSeats', title: 'Seats' },
                ]}
              />
            </Card>
          </div>

          <div style={{ marginTop: 16 }}>
            <Card title="Invoice pending" actions={<Button onClick={runAi} disabled={running}>{running ? 'Menjalankan AI…' : 'AI Asset Report'}</Button>}>
              <DataTable
                loading={false}
                rows={data.pendingInvoices}
                empty="Tidak ada invoice pending"
                columns={[
                  { key: 'invoiceNumber', title: 'Nomor' },
                  { key: 'productName', title: 'Produk' },
                  { key: 'status', title: 'Status' },
                  { key: 'invoiceDate', title: 'Tanggal' },
                ]}
              />
            </Card>
          </div>

          {aiReport && (
            <Card title="AI IT Asset Report" >
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, margin: 0 }}>{aiReport}</pre>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
