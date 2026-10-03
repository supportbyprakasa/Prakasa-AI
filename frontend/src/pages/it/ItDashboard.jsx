import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/Button';
import Card from '../../components/Card';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import Page from '../../components/Page';
import StatCard from '../../components/StatCard';
import AnimatedNumber from '../../components/charts/AnimatedNumber';
import BarList from '../../components/charts/BarList';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatNumber } from '../../components/format';
import { unreviewedNote } from '../people/directoryModel';
import { dashboardBars } from './itDashboardModel';
import { infraCards } from './infraModel';
import { DEVICE_TYPE_LABELS, INVOICE_STATUS_LABELS, labelFor } from './itModel';
import './it-tickets.css';
import './it-assets.css';

const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;
const count = (value) => Number(value) || 0;

// A bar list for the dashboard (per status / type / location): the shared
// BarList, so the bars grow the way every dashboard's bars do; each label
// links to the device list with that filter.
function DeviceBars({ title, rows, empty }) {
  const items = rows.map((row) => ({
    key: row.key,
    label: <Link to={row.to}>{row.label}</Link>,
    value: row.value,
    display: formatNumber(row.value),
    note: row.note || undefined,
    translate: !row.data,
  }));
  return (
    <Card variant="chart" title={title}>
      {rows.length ? <BarList items={items} label={title} dataLabels /> : <EmptyState compact title={empty} />}
    </Card>
  );
}

// Dashboard IT (rule 22): numbers labelled so they reconcile with the owner's
// IT report — Karyawan (direktori) with the accounts People & Culture has not
// reviewed, devices per status / type / location, Bermasalah = Rusak + Tidak
// aktif, tanpa nomor aset, garansi ≤ 60 hari, di tangan karyawan resign.
export default function ItDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [aiReport, setAiReport] = useState(null);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const r = await api.get('/it/dashboard/summary');
      setData(r.data.data || {});
    } catch (error) {
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const runAi = async () => {
    setRunning(true); setAiReport(null);
    try {
      const r = await api.post('/it/dashboard/ai-report');
      setAiReport(r.data.data.content);
    } catch (e) {
      toast(errorMessage(e, 'Laporan AI gagal dibuat'), 'error');
    } finally { setRunning(false); }
  };

  const devices = data?.devices || {};
  const people = data?.people || {};
  const subscriptions = data?.subscriptions || {};
  const byStatus = devices.byStatus || {};
  const expiring = count(subscriptions.expiring);
  const windowDays = count(devices.warrantyWindowDays) || 60;
  const bars = dashboardBars(data);
  const drill = (query) => <Button variant="text" to={`/it/devices?${query}`}>Lihat perangkat</Button>;

  let content;
  if (loadError) {
    content = (
      <EmptyState
        tone="error"
        title="Dashboard IT gagal dimuat"
        description={loadError}
        action={<Button variant="secondary" onClick={load}>Coba lagi</Button>}
      />
    );
  } else if (loading || !data) {
    content = <LoadingState label="Memuat dashboard IT" />;
  } else {
    const problematic = count(devices.problematic);
    // "Infrastruktur" (wave 2, row 2.3): a card per register that has rows.
    const infra = infraCards(data.infrastructure);
    const resignedHolder = count(devices.resignedHolder);
    content = (
      <>
        <div className="pw-cols-4 it-dashboard__stats">
          <StatCard
            label="Karyawan (direktori)"
            value={<AnimatedNumber value={count(people.headcount)} />}
            note={unreviewedNote(people.unreviewedAccounts) || 'Semua akun sudah ditinjau People & Culture'}
            action={<Button variant="text" to="/people/directory">Buka direktori</Button>}
          />
          <StatCard
            label="Total perangkat"
            value={<AnimatedNumber value={count(devices.total)} />}
            note={`${formatNumber(count(byStatus.available ?? devices.available))} cadangan`}
            action={drill('')}
          />
          <StatCard label="Aktif" value={<AnimatedNumber value={count(devices.active ?? devices.assigned)} />} action={drill('status=assigned')} />
          <StatCard
            label="Bermasalah (Rusak + Tidak aktif)"
            value={<AnimatedNumber value={problematic} />}
            note={`Rusak ${formatNumber(count(byStatus.damaged))} · Tidak aktif ${formatNumber(count(byStatus.retired ?? devices.retired))}`}
            alert={problematic > 0}
            action={drill('problematic=1')}
          />
        </div>
        <div className="pw-cols-4 it-dashboard__stats">
          <StatCard label="Tanpa nomor aset" value={<AnimatedNumber value={count(devices.withoutAssetCode)} />} action={drill('noAssetCode=1')} />
          <StatCard label={`Garansi ≤ ${windowDays} hari`} value={<AnimatedNumber value={count(devices.warrantyEnding)} />} action={drill(`warrantyDays=${windowDays}`)} />
          <StatCard
            label="Di tangan karyawan resign"
            value={<AnimatedNumber value={resignedHolder} />}
            note={resignedHolder ? 'Kembalikan atau serahkan ke orang lain' : null}
            alert={resignedHolder > 0}
            action={drill('resignedHolder=1')}
          />
          <StatCard
            label="Langganan software"
            value={<AnimatedNumber value={count(subscriptions.total)} />}
            note={`${formatNumber(expiring)} segera berakhir`}
            alert={expiring > 0}
            action={<Button variant="text" to="/it/subscriptions">Lihat langganan</Button>}
          />
        </div>

        <div className="pw-cols-3 it-dashboard__grid">
          <DeviceBars title="Perangkat per status" rows={bars.byStatus} empty="Belum ada perangkat" />
          <DeviceBars title="Perangkat per tipe" rows={bars.byType} empty="Belum ada perangkat" />
          <DeviceBars title="Perangkat per lokasi" rows={bars.byLocation} empty="Belum ada perangkat" />
        </div>

        {infra.length ? (
          <section className="pw-stack" aria-label="Infrastruktur">
            <h2 className="pw-title-section">Infrastruktur</h2>
            <div className="pw-cols-4 it-dashboard__stats">
              {infra.map((card) => (
                <StatCard
                  key={card.key}
                  label={card.label}
                  value={card.value}
                  note={card.note}
                  alert={card.alert}
                  action={<Button variant="text" to={card.to}>Buka register</Button>}
                />
              ))}
            </div>
          </section>
        ) : null}

        <DataGrid
          title={`Garansi berakhir dalam ${windowDays} hari`}
          searchable={false}
          rows={data.warrantyDue || []}
          empty={`Tidak ada garansi yang berakhir dalam ${windowDays} hari`}
          onRowClick={(row) => navigate(`/it/devices/${row.id}`)}
          columns={[
            { key: 'deviceType', header: 'Tipe', translate: true, render: (row) => labelFor(DEVICE_TYPE_LABELS, row.deviceType), exportValue: (row) => labelFor(DEVICE_TYPE_LABELS, row.deviceType) },
            { key: 'assetCode', header: 'No. aset' },
            { key: 'warrantyEnd', header: 'Berakhir', type: 'date' },
            { key: 'daysLeft', header: 'Sisa hari', type: 'number' },
          ]}
        />

        <DataGrid
          title="Perpanjangan langganan dalam 30 hari"
          searchable={false}
          onRowClick={(row) => navigate(`/it/subscriptions/${row.id}`)}
          rows={data.renewalsDue || []}
          empty="Tidak ada langganan yang diperpanjang dalam 30 hari"
          columns={[
            { key: 'productName', header: 'Produk' },
            { key: 'renewalDate', header: 'Perpanjangan', type: 'date' },
            { key: 'daysLeft', header: 'Sisa hari', type: 'number' },
            { key: 'totalSeats', header: 'Seat', type: 'number' },
          ]}
        />

        <DataGrid
          title="Invoice menunggu"
          searchable={false}
          onRowClick={(row) => navigate(`/it/subscriptions/${row.subscriptionId}`)}
          rows={data.pendingInvoices || []}
          empty="Tidak ada invoice yang menunggu"
          columns={[
            { key: 'invoiceNumber', header: 'Nomor' },
            { key: 'productName', header: 'Produk' },
            {
              key: 'status',
              header: 'Status',
              exportValue: (row) => INVOICE_STATUS_LABELS[row.status] || row.status,
              render: (row) => <StatusBadge status={row.status} label={INVOICE_STATUS_LABELS[row.status]} />,
            },
            { key: 'invoiceDate', header: 'Tanggal', type: 'date' },
          ]}
        />

        {aiReport ? (
          <Card title="Laporan aset IT dari AI">
            <p className="it-report">{aiReport}</p>
          </Card>
        ) : null}
      </>
    );
  }

  return (
    <Page
      title="Dashboard IT"
      description="Ringkasan direktori, perangkat, garansi, dan langganan software — angka yang sama dengan laporan perangkat IT."
      actions={data && !loadError ? (
        <Button variant="secondary" icon="auto_awesome" onClick={runAi} loading={running}>Buat laporan aset AI</Button>
      ) : null}
    >
      {content}
    </Page>
  );
}
