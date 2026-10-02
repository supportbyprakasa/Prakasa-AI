import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import Page from '../../components/Page';
import StatusBadge from '../../components/StatusBadge';
import TabBar from '../../components/TabBar';
import BarList from '../../components/charts/BarList';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDateTime, formatNumber } from '../../components/format';
import { allowedLink } from '../../components/navigation';
import { useAuth } from '../../context/AuthContext';
import { MonthlyTrendCard, ReportCards } from './FinanceReceivables';
import {
  PAYABLE_TABS, agingBars, approvedBy, dueBadge, exclusionsText, lateBadge, overdueSentence, payableCards, payableWaiting, tabFrom,
} from './financeReportsModel';
import './finance-reports.css';

const errorMessage = (error, fallback) => error?.response?.data?.error?.message || fallback;

const invoiceColumns = (badge, header) => [
  { key: 'invoiceNumber', header: 'Faktur pembelian' },
  {
    key: 'vendorName', header: 'Pemasok',
    render: (r) => <span className="pw-cell">{r.vendorName}<span className="pw-cell__meta">{[r.vendorNo, r.term].filter(Boolean).join(' · ')}</span></span>,
    sortValue: (r) => r.vendorName || '', exportValue: (r) => r.vendorName || '',
  },
  { key: 'date', header: 'Tanggal faktur', type: 'date' },
  { key: 'dueDate', header: 'Jatuh tempo', type: 'date' },
  { key: 'outstanding', header: 'Sisa utang', type: 'money' },
  { key: 'total', header: 'Nilai faktur', type: 'money' },
  {
    key: 'days', header, nowrap: true,
    render: (r) => { const b = badge(r.days); return <StatusBadge status={b.status} label={b.label} />; },
    sortValue: (r) => r.days, exportValue: (r) => r.days,
  },
];
const COLUMNS = {
  due: invoiceColumns(dueBadge, 'Sisa waktu'),
  overdue: invoiceColumns(lateBadge, 'Terlambat'),
  vendors: [
    { key: 'vendorName', header: 'Pemasok', render: (r) => <span className="pw-cell">{r.vendorName}<span data-no-translate="" className="pw-cell__meta">{r.vendorNo}</span></span>, sortValue: (r) => r.vendorName || '', exportValue: (r) => r.vendorName || '' },
    { key: 'invoices', header: 'Faktur belum lunas', type: 'number' },
    { key: 'outstanding', header: 'Total utang', type: 'money' },
    { key: 'overdueAmount', header: 'Lewat jatuh tempo', type: 'money' },
    { key: 'nextDue', header: 'Jatuh tempo berikutnya', type: 'date' },
    {
      key: 'oldestDays', header: 'Terlama terlambat', nowrap: true,
      render: (r) => (r.oldestDays == null ? null : (() => { const b = lateBadge(r.oldestDays); return <StatusBadge status={b.status} label={b.label} />; })()),
      sortValue: (r) => r.oldestDays ?? -1, exportValue: (r) => r.oldestDays ?? '',
    },
  ],
};
const ROWS = { due: 'dueSoon', overdue: 'overdue', vendors: 'vendors' };
const EMPTY = {
  due: 'Tidak ada faktur pembelian jatuh tempo 14 hari ke depan',
  overdue: 'Tidak ada faktur pembelian yang lewat jatuh tempo',
  vendors: 'Tidak ada utang ke pemasok',
};

// Utang (Finance, migration 117): what the company owes vendors, from purchase
// invoices and payments pulled read-only from Accurate and approved by the
// Finance Supervisor/Head. Until the first batch is approved it says so.
export default function FinancePayables() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const [params, setParams] = useSearchParams();
  const tab = tabFrom(params.get('tab'), PAYABLE_TABS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const r = await api.get('/finance/reports/payables');
      setData(r.data.data);
    } catch (error) {
      setData(null);
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <Page title="Utang"><LoadingState label="Menyiapkan laporan utang" /></Page>;
  if (loadError && !data) {
    return (
      <Page title="Utang">
        <EmptyState tone="error" title="Laporan utang belum bisa dimuat" description={loadError} action={<Button variant="secondary" onClick={load}>Coba lagi</Button>} />
      </Page>
    );
  }
  if (!data?.ready) {
    const waiting = payableWaiting(data);
    const batch = waiting.batchLink ? allowedLink(waiting.batchLink, permissions) : null;
    return (
      <Page title="Utang" description="Utang ke pemasok dari faktur dan pembayaran pembelian di Accurate.">
        <EmptyState
          icon="hourglass_top"
          title={waiting.title}
          description={waiting.description}
          action={batch ? <Button to={batch} icon="fact_check">Buka batch</Button> : <Button variant="secondary" icon="refresh" onClick={load}>Muat ulang</Button>}
        />
      </Page>
    );
  }

  const { summary } = data;
  const exclusions = exclusionsText(summary);
  const tabs = PAYABLE_TABS.map((t) => ({ ...t, count: (data[ROWS[t.k]] || []).length }));
  const asOf = data.asOf || {};

  return (
    <Page
      title="Utang"
      description={`Utang ke pemasok dari faktur dan pembayaran pembelian Accurate, ${approvedBy(asOf)} ${formatDateTime(asOf.approvedAt)}.`}
      actions={<Button variant="secondary" icon="refresh" loading={loading} onClick={load}>Muat ulang</Button>}
    >
      {loadError ? <Banner tone="error" action={<Button variant="text" onClick={load}>Coba lagi</Button>}>{loadError}</Banner> : null}
      {exclusions ? <Banner tone="info">{exclusions}</Banner> : null}

      <ReportCards cards={payableCards(summary)} label="Ringkasan utang" />

      <div className="fin-reports__cols">
        <Card title="Umur utang" subtitle={overdueSentence(summary)} className="fin-reports__card">
          <BarList items={agingBars(data.aging.buckets)} label="Umur utang" />
        </Card>
        <MonthlyTrendCard title="Pembayaran ke pemasok" rows={data.payments} label="Pembayaran pembelian" upIsGood={false} />
      </div>

      <div className="fin-reports__panel">
        <TabBar
          tabs={tabs}
          value={tab}
          onChange={(k) => setParams((p) => { const n = new URLSearchParams(p); if (k === PAYABLE_TABS[0].k) n.delete('tab'); else n.set('tab', k); return n; }, { replace: true })}
          label="Daftar utang"
          idPrefix="fin-ap-tab"
          panelId="fin-ap-panel"
        />
        <div id="fin-ap-panel" role="tabpanel" aria-labelledby={`fin-ap-tab-${tab}`}>
          <DataGrid
            key={tab}
            title={PAYABLE_TABS.find((t) => t.k === tab)?.l}
            showTitle={false}
            rows={data[ROWS[tab]] || []}
            idKey={tab === 'vendors' ? 'vendorNo' : 'id'}
            exportName={`utang-${tab}`}
            searchPlaceholder={tab === 'vendors' ? 'Cari pemasok' : 'Cari faktur atau pemasok'}
            empty={tab === 'due' ? `Tidak ada faktur pembelian jatuh tempo ${formatNumber(summary.dueSoon.days)} hari ke depan` : EMPTY[tab]}
            columns={COLUMNS[tab]}
          />
        </div>
      </div>
    </Page>
  );
}
