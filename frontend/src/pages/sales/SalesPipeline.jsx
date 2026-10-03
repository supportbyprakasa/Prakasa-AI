import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Chip from '../../components/Chip';
import IconButton from '../../components/IconButton';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import AnimatedNumber from '../../components/charts/AnimatedNumber';
import BarList from '../../components/charts/BarList';
import DataGrid from '../../components/datagrid/DataGrid';
import { useAuth } from '../../context/AuthContext';
import {
  apiError, daysAgoText, formatCount, formatRupiahShort, monthBars, salesScopeText, soldQty, todayIso,
} from './salesModel';
import SalesScopeBanner, { AccurateHoldBanner, useTransactionsReliable } from './SalesScopeBanner';
import SalesTodo from './SalesTodo';
import SalesTargets from './SalesTargets';
import './sales.css';
import { Translate } from '../../i18n/NoTranslate';

// The pipeline is derived, never dragged: a visited outlet is a prospect, its
// first order makes it a new customer, and the days since its last order move
// it to Aktif, Dormant or Lost. Each stage pages on the server.
const DEFAULT_STAGE = 'dormant';
const PAGE_SIZE = 25;

// Omzet per bulan as the shared bar list, so the bars grow the way every
// dashboard's bars do (BarList); the newest month is at the bottom.
function RevenueBars({ months, unitShort }) {
  const items = useMemo(() => monthBars(months, { count: 9 }).map((r) => ({
    key: r.month,
    label: r.label,
    value: r.revenue,
    display: r.revenue ? formatRupiahShort(r.revenue) : '—',
    note: `${formatCount(r.orders)} ${unitShort} · ${formatCount(r.newCustomers)} NOO`,
  })), [months, unitShort]);
  return <BarList items={items} label="Omzet per bulan, sebelum PPN" />;
}

const TOP_PRODUCT_COLUMNS = [
  {
    key: 'name', header: 'Produk',
    render: (r) => <span className="pw-cell"><span data-no-translate="" className="pw-cell__title">{r.name}</span><span data-no-translate="" className="pw-cell__meta">{r.code}</span></span>,
    exportValue: (r) => r.name,
  },
  {
    key: 'qty', header: 'Terjual', align: 'end',
    render: (r) => { const s = soldQty(r); return s.detail ? <span className="pw-cell"><span className="pw-cell__title pw-nowrap">{s.main}</span><span className="pw-cell__meta">{s.detail}</span></span> : s.main; },
    exportValue: (r) => soldQty(r).main,
  },
  { key: 'revenue', header: 'Omzet', type: 'money' },
];

// Orders without a salesperson are the imported e-Commerce marketplace orders.
// Counted in SOs (recap) or invoices (Tahap B, approved Accurate data).
const peopleColumns = (unitShort) => [
  { key: 'name', header: 'Sales', render: (r) => r.name || <Translate className="pw-muted">Tanpa nama (e-Commerce)</Translate>, exportValue: (r) => r.name || 'Tanpa nama' },
  { key: 'monthOrders', header: `${unitShort} bulan ini`, type: 'number' },
  { key: 'monthRevenue', header: 'Omzet bulan ini (sebelum PPN)', type: 'money' },
  { key: 'yearOrders', header: `${unitShort} tahun ini`, type: 'number' },
  { key: 'yearRevenue', header: 'Omzet tahun ini (sebelum PPN)', type: 'money' },
  { key: 'customers', header: 'Pelanggan', type: 'number' },
];

function stageColumns(stage) {
  const name = {
    key: 'name',
    header: stage === 'prospek' ? 'Outlet' : 'Pelanggan',
    render: (r) => (
      <span className="pw-cell">
        <span data-no-translate="" className="pw-cell__title">{r.name}</span>
        {r.code ? <span data-no-translate="" className="pw-cell__meta">{r.code}</span> : null}
      </span>
    ),
    exportValue: (r) => r.name,
  };
  const sales = { key: 'salesPersonName', header: 'Sales' };
  if (stage === 'prospek') {
    return [
      name,
      { key: 'channel', header: 'Area' },
      sales,
      { key: 'lastVisitDate', header: 'Kunjungan terakhir', type: 'date' },
      { key: 'daysSinceVisit', header: 'Sejak kunjungan', align: 'end', translate: true, render: (r) => (r.lastVisitDate ? daysAgoText(r.daysSinceVisit) : 'Belum dikunjungi') },
    ];
  }
  return [
    name,
    { key: 'channel', header: 'Channel' },
    sales,
    { key: 'nooDate', header: 'Order pertama', type: 'date' },
    { key: 'lastOrderDate', header: 'Order terakhir', type: 'date' },
    { key: 'daysSinceOrder', header: 'Sejak order', align: 'end', translate: true, render: (r) => daysAgoText(r.daysSinceOrder) },
  ];
}

const EMPTY_META = { page: 1, limit: PAGE_SIZE, total: 0 };

export default function SalesPipeline() {
  const { user } = useAuth();
  const canSeeOrders = (user?.permissions || []).includes('sales.order.view');
  const reliable = useTransactionsReliable();
  const [params, setParams] = useSearchParams();
  const stageParam = params.get('tahap') || DEFAULT_STAGE;
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [overview, setOverview] = useState({ loading: true, error: '', data: null });
  const [state, setState] = useState({ loading: true, error: '', stages: [], stage: stageParam, items: [], meta: EMPTY_META });

  useEffect(() => { setPage(1); }, [stageParam, q]);

  const loadOverview = useCallback(() => {
    setOverview((o) => ({ ...o, loading: true, error: '' }));
    api.get('/sales/overview')
      .then((r) => setOverview({ loading: false, error: '', data: r.data.data?.customers ? r.data.data : null }))
      .catch((err) => setOverview({ loading: false, error: apiError(err), data: null }));
  }, []);
  const loadStage = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get('/sales/funnel', { params: { stage: stageParam, q: q || undefined, page, limit: PAGE_SIZE } });
      const d = r.data.data || {};
      setState({
        loading: false, error: '', stages: d.stages || [], stage: d.stage || stageParam, items: d.items || [], meta: r.data.meta || EMPTY_META,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: apiError(err) }));
    }
  }, [stageParam, q, page]);
  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { loadStage(); }, [loadStage]);

  const stage = state.stages.find((s) => s.key === state.stage);
  const pickStage = (key) => setParams((p) => { const next = new URLSearchParams(p); next.set('tahap', key); return next; }, { replace: true });

  const ov = overview.data;
  const thisMonth = ov?.sales?.months?.at(-1);
  const currentMonth = todayIso().slice(0, 7);
  const unitShort = ov?.sales?.unit === 'faktur' ? 'faktur' : 'SO';

  return (
    <Page>
      <PageHeader
        title="Pipeline sales"
        description={`Otomatis dari kunjungan dan sales order; tidak ada kartu yang perlu digeser manual. ${salesScopeText(ov?.scope)}`}
        actions={<Button variant="secondary" icon="refresh" onClick={() => { loadOverview(); loadStage(); }} disabled={state.loading}>Muat ulang</Button>}
      />

      <SalesScopeBanner />
      <AccurateHoldBanner />
      {overview.error ? (
        <Banner tone="error" title="Ringkasan pipeline belum bisa dimuat" action={<Button variant="text" onClick={loadOverview}>Coba lagi</Button>}>
          {overview.error}
        </Banner>
      ) : null}

      {ov ? (
        <div className="pw-cols-4">
          <StatCard label="Pelanggan aktif" value={<AnimatedNumber value={ov.customers.aktif} />} note={`Order < ${ov.rules.activeDays} hari`} />
          <StatCard
            label="Dormant"
            value={<AnimatedNumber value={ov.customers.dormant} />}
            note={`Hubungi sebelum ${ov.rules.lostDays} hari (Lost)`}
            alert={reliable && ov.customers.dormant > 0}
          />
          <StatCard label="Lost" value={<AnimatedNumber value={ov.customers.lost} />} note={`${formatCount(ov.customers.neverOrdered)} belum pernah order`} />
          {ov.sales ? (
            <StatCard
              label="Omzet bulan ini (sebelum PPN)"
              value={<AnimatedNumber value={thisMonth?.month === currentMonth ? thisMonth.revenue : 0} unit="rupiah" compact />}
              note={thisMonth?.month === currentMonth ? `${formatCount(thisMonth.orders)} ${ov.sales.unit || 'sales order'} · ${formatCount(thisMonth.newCustomers)} pelanggan baru` : 'Belum ada order bulan ini'}
            />
          ) : (
            <StatCard label="Prospek belum order" value={<AnimatedNumber value={ov.leads.open} />} note={`${formatCount(ov.leads.needsVisit)} perlu dikunjungi ulang`} />
          )}
        </div>
      ) : null}

      <SalesTodo />
      <SalesTargets />

      <div className="pw-stack">
        <DataGrid
          key={state.stage}
          title={stage ? `Tahap ${stage.label}` : 'Tahap pelanggan'}
          columns={stageColumns(state.stage)}
          rows={state.items}
          loading={state.loading}
          error={state.error}
          onRetry={loadStage}
          meta={state.meta}
          onPageChange={setPage}
          search={q}
          onSearchChange={setQ}
          searchPlaceholder="Cari nama, kode, atau sales di tahap ini"
          filters={state.stages.length ? state.stages.map((s) => (
            <Chip key={s.key} selected={s.key === state.stage} onClick={() => pickStage(s.key)} tooltip={s.hint}>
              {s.label} ({formatCount(s.count)})
            </Chip>
          )) : null}
          exportName={`sales-pipeline-${state.stage}`}
          rowActions={(r) => (
            <>
              <IconButton size="sm" icon="visibility" label="Lihat detail" to={r.kind === 'lead' ? `/sales/leads?lead=${r.id}` : `/sales/customers/${r.id}`} />
              {r.kind === 'customer' && r.lastOrderDate && canSeeOrders ? (
                <IconButton size="sm" icon="receipt_long" label="Lihat order" to={`/sales/customers/${r.id}?tab=orders`} />
              ) : null}
            </>
          )}
          empty={stage ? `Tidak ada di tahap "${stage.label}"` : 'Tidak ada data'}
        />
        {stage?.hint ? <p className="pw-text-helper">{stage.label}: {stage.hint}</p> : null}
      </div>

      {ov?.bySalesperson?.length ? (
        <DataGrid
          title="Omzet per sales (sebelum PPN)"
          columns={peopleColumns(ov.sales?.unit === 'faktur' ? 'Faktur' : 'SO')}
          rows={ov.bySalesperson.map((r) => ({ ...r, id: r.name || '-' }))}
          exportName="omzet-per-sales"
          searchable={false}
        />
      ) : null}

      {ov?.sales?.topProducts?.length ? (
        <DataGrid
          title="Produk terlaris bulan ini (sebelum PPN)"
          columns={TOP_PRODUCT_COLUMNS}
          rows={ov.sales.topProducts.map((r) => ({ ...r, id: r.code || r.name }))}
          exportName="produk-terlaris"
          searchable={false}
        />
      ) : null}

      {ov?.sales ? (
        <Card title="Omzet per bulan (sebelum PPN)" variant="chart">
          <div className="pw-stack sales-chart">
            <RevenueBars months={ov.sales.months} unitShort={unitShort} />
            <p className="pw-text-helper">
              Omzet dihitung dari DPP (sebelum PPN), sama seperti laporan Penjualan per Pelanggan di Accurate; ongkir tidak termasuk.
              {' '}
              {ov.sales.unit === 'faktur'
                ? `Dari faktur Accurate yang sudah disetujui, menurut tanggal faktur. ${salesScopeText(ov?.scope)} Marketplace (Retail Commerce) ditagih bulanan, satu faktur rekap per akhir bulan. Saldo awal Accurate (faktur 31 Des 2025 tanpa baris barang) bukan penjualan: tetap di piutang, tidak dihitung sebagai omzet maupun NOO. NOO = pelanggan Accurate (per nomor pelanggan) yang pertama kali difakturkan di bulan itu.`
                : 'Tanggal transaksi mengikuti tanggal kirim (ETD), atau tanggal order bila belum ada. NOO = pelanggan yang order pertama kali di bulan itu.'}
            </p>
          </div>
        </Card>
      ) : null}
    </Page>
  );
}
