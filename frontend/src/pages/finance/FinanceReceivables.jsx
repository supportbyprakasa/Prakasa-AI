import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Chip from '../../components/Chip';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import Icon from '../../components/Icon';
import Page from '../../components/Page';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import TabBar from '../../components/TabBar';
import AnimatedNumber from '../../components/charts/AnimatedNumber';
import BarList from '../../components/charts/BarList';
import TrendChart from '../../components/charts/TrendChart';
import { compactMoney, formatMetric } from '../../components/charts/chartModel';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDateTime, formatNumber } from '../../components/format';
import { allowedLink } from '../../components/navigation';
import { useAuth } from '../../context/AuthContext';
import {
  RECEIVABLE_TABS, agingBars, bucketsFor, channelOptions, dueBadge, exclusionsText, lastFullMonth, lateBadge,
  overdueSentence, receivableCards, tabFrom, trendSeries,
} from './financeReportsModel';
import './finance-reports.css';

const errorMessage = (error, fallback) => error?.response?.data?.error?.message || fallback;

/** Headline figures that count up. */
export function ReportCards({ cards, label }) {
  return (
    <section className="fin-reports__kpis" aria-label={label}>
      {cards.map((c) => (
        <StatCard
          key={c.key}
          label={c.label}
          value={c.value === null || c.value === undefined ? null : <AnimatedNumber value={c.value} unit={c.unit} compact={c.unit === 'rupiah'} />}
          note={c.note}
          alert={Boolean(c.alert)}
          empty={c.value === null || c.value === undefined}
        />
      ))}
    </section>
  );
}

/** 12 months of money in or out: the last full month, its change, and the trend. */
export function MonthlyTrendCard({ title, rows, label, upIsGood = true }) {
  const series = trendSeries(rows);
  const head = lastFullMonth(rows);
  const tone = !head || head.direction === 'flat' || !upIsGood ? 'flat' : head.direction;
  const icon = head?.direction === 'up' ? 'trending_up' : (head?.direction === 'down' ? 'trending_down' : 'trending_flat');
  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  return (
    <Card title={title} subtitle={`12 bulan terakhir: ${compactMoney(total)}`} className="fin-reports__card">
      {head ? (
        <>
          <div className="fin-reports__trend-value">
            <AnimatedNumber value={head.value} unit="rupiah" compact />
            <span className={`fin-reports__delta is-${tone}`}>
              <Icon name={icon} size="sm" />
              {`${head.change > 0 ? '+' : ''}${formatMetric(head.change, 'rupiah', { compact: true })} dari bulan sebelumnya`}
            </span>
          </div>
          <p className="fin-reports__meta">{`${head.month} (bulan penuh terakhir)`}</p>
        </>
      ) : null}
      {total > 0 ? (
        <TrendChart months={series.months} values={series.values} unit="rupiah" label={label} />
      ) : (
        <EmptyState compact icon="monitoring" title="Belum ada transaksi 12 bulan terakhir" />
      )}
    </Card>
  );
}

// Piutang (Finance, migration 117): what customers still owe, from approved
// Accurate invoices and receipts (the Sales mirror) — company-wide. Read only.
export default function FinanceReceivables() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const [params, setParams] = useSearchParams();
  const tab = tabFrom(params.get('tab'), RECEIVABLE_TABS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [channel, setChannel] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const r = await api.get('/finance/reports/receivables');
      setData(r.data.data);
    } catch (error) {
      setData(null);
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <Page title="Piutang"><LoadingState label="Menyiapkan laporan piutang" /></Page>;
  if (loadError && !data) {
    return (
      <Page title="Piutang">
        <EmptyState tone="error" title="Laporan piutang belum bisa dimuat" description={loadError} action={<Button variant="secondary" onClick={load}>Coba lagi</Button>} />
      </Page>
    );
  }
  if (!data?.ready) {
    return (
      <Page title="Piutang">
        <EmptyState icon="hourglass_top" title="Data piutang belum tersedia" description={data?.reason} action={<Button variant="secondary" icon="refresh" onClick={load}>Muat ulang</Button>} />
      </Page>
    );
  }

  const { summary, aging } = data;
  const exclusions = exclusionsText(summary);
  const customerLink = (r) => (r.customerId ? allowedLink(`/sales/customers/${r.customerId}`, permissions) : null);
  const customerCell = (r) => {
    const link = customerLink(r);
    const name = r.customerName || r.customerCode;
    return (
      <span className="pw-cell">
        {link ? <Link to={link}>{name}</Link> : name}
        <span className="pw-cell__meta">{[r.customerCode, r.salesPersonName].filter(Boolean).join(' · ')}</span>
      </span>
    );
  };

  const columns = tab === 'customers' ? [
    { key: 'customerName', header: 'Pelanggan', render: customerCell, sortValue: (r) => r.customerName || '', exportValue: (r) => r.customerName || '' },
    { key: 'channel', header: 'Channel' },
    { key: 'overdueInvoices', header: 'Faktur terlambat', type: 'number' },
    { key: 'overdueAmount', header: 'Lewat jatuh tempo', type: 'money' },
    { key: 'outstanding', header: 'Total piutang', type: 'money' },
    { key: 'oldestDue', header: 'Jatuh tempo tertua', type: 'date' },
    {
      key: 'oldestDays', header: 'Terlama', nowrap: true,
      render: (r) => { const b = lateBadge(r.oldestDays); return <StatusBadge status={b.status} label={b.label} />; },
      sortValue: (r) => r.oldestDays, exportValue: (r) => r.oldestDays,
    },
  ] : [
    { key: 'invoiceNumber', header: 'Faktur' },
    { key: 'customerName', header: 'Pelanggan', render: customerCell, sortValue: (r) => r.customerName || '', exportValue: (r) => r.customerName || '' },
    { key: 'channel', header: 'Channel' },
    { key: 'dueDate', header: 'Jatuh tempo', type: 'date' },
    { key: 'outstanding', header: 'Sisa tagihan', type: 'money' },
    { key: 'total', header: 'Nilai faktur', type: 'money' },
    {
      key: 'daysLeft', header: 'Sisa waktu', nowrap: true,
      render: (r) => { const b = dueBadge(r.daysLeft); return <StatusBadge status={b.status} label={b.label} />; },
      sortValue: (r) => r.daysLeft, exportValue: (r) => r.daysLeft,
    },
  ];
  const rows = tab === 'customers' ? data.customers : data.dueSoon;
  const tabs = RECEIVABLE_TABS.map((t) => ({ ...t, count: t.k === 'customers' ? data.customers.length : data.dueSoon.length }));

  return (
    <Page
      title="Piutang"
      description={`Tagihan pelanggan seluruh divisi dari faktur Accurate yang sudah disetujui. Data per ${formatDateTime(data.asOf)}.`}
      actions={<Button variant="secondary" icon="refresh" loading={loading} onClick={load}>Muat ulang</Button>}
    >
      {loadError ? <Banner tone="error" action={<Button variant="text" onClick={load}>Coba lagi</Button>}>{loadError}</Banner> : null}
      {exclusions ? <Banner tone="info">{exclusions}</Banner> : null}

      <ReportCards cards={receivableCards(summary)} label="Ringkasan piutang" />

      <div className="fin-reports__cols">
        <Card title="Umur piutang" subtitle={overdueSentence(summary)} className="fin-reports__card">
          <div className="fin-reports__chips" role="group" aria-label="Pilih channel">
            {channelOptions(aging.channels).map((c) => (
              <Chip key={c.key || 'all'} selected={channel === c.key} onClick={() => setChannel(c.key)}>
                {/* "Lainnya" is the server's name for invoices without a channel. */}
                {c.key ? <><span data-no-translate={c.label === 'Lainnya' ? undefined : ''}>{c.label}</span>{' ('}<span>{compactMoney(c.amount)}</span>{')'}</> : c.label}
              </Chip>
            ))}
          </div>
          <BarList items={agingBars(bucketsFor(aging, channel))} label={`Umur piutang${channel ? ` ${channel}` : ''}`} />
        </Card>
        <MonthlyTrendCard title="Penerimaan pembayaran" rows={data.collections} label="Penerimaan pembayaran pelanggan" />
      </div>

      <div className="fin-reports__panel">
        <TabBar
          tabs={tabs}
          value={tab}
          onChange={(k) => setParams((p) => { const n = new URLSearchParams(p); if (k === RECEIVABLE_TABS[0].k) n.delete('tab'); else n.set('tab', k); return n; }, { replace: true })}
          label="Daftar piutang"
          idPrefix="fin-ar-tab"
          panelId="fin-ar-panel"
        />
        <div id="fin-ar-panel" role="tabpanel" aria-labelledby={`fin-ar-tab-${tab}`}>
          <DataGrid
            key={tab}
            title={RECEIVABLE_TABS.find((t) => t.k === tab)?.l}
            showTitle={false}
            rows={rows}
            idKey={tab === 'customers' ? 'customerCode' : 'id'}
            exportName={tab === 'customers' ? 'piutang-pelanggan-terlambat' : 'piutang-jatuh-tempo'}
            searchPlaceholder={tab === 'customers' ? 'Cari pelanggan atau channel' : 'Cari faktur atau pelanggan'}
            empty={tab === 'customers' ? 'Tidak ada pelanggan yang terlambat bayar' : `Tidak ada faktur jatuh tempo ${formatNumber(summary.dueSoon.days)} hari ke depan`}
            columns={columns}
          />
        </div>
      </div>
    </Page>
  );
}
