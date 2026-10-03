import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import Card from '../../components/Card';
import DashboardSection from '../../components/DashboardSection';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import Page from '../../components/Page';
import Select from '../../components/Select';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import AnimatedNumber from '../../components/charts/AnimatedNumber';
import MotionChart from '../../components/charts/MotionChart';
import BarList from '../../components/charts/BarList';
import TrendChart from '../../components/charts/TrendChart';
import { compactMoney, formatMetric } from '../../components/charts/chartModel';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDateTime, formatNumber, formatQty } from '../../components/format';
import { Mixed, Translate } from '../../i18n/NoTranslate';
import {
  OTHER_PLATFORM, attentionItems, emptyReason, kpiCards, latestValue, monthOptions, motionSeries, platformRows, productChange, productRows,
  receivableBars, receivableStatus, revenueBars, shipmentStatus, trendCards,
} from './retailModel';
import './retail.css';

const errorMessage = (error, fallback) => error?.response?.data?.error?.message || fallback;
const pct = (v) => (v === null || v === undefined ? '—' : `${formatQty(v)}%`);

// A platform's name is record data; "Lainnya" (no platform on the customer) is
// interface text inside those data zones.
const platformColumn = (key) => ({
  key, header: 'Platform',
  render: (r) => (r[key] === OTHER_PLATFORM ? <Translate>{r[key]}</Translate> : r[key]),
  sortValue: (r) => r[key], exportValue: (r) => r[key],
});
// `translate`: an interface label among the record names (charts keep the
// label a string — it is sorted and read out).
const otherLabel = (item) => (item.key === 'other' ? { ...item, translate: true } : item);

const PLATFORM_COLUMNS = [
  platformColumn('label'),
  { key: 'revenue', header: 'Omzet 12 bulan', type: 'money' },
  { key: 'revenueThisMonth', header: 'Omzet bulan ini', type: 'money' },
  { key: 'share', header: 'Porsi', type: 'number', render: (r) => pct(r.share), sortValue: (r) => r.share ?? -1 },
  { key: 'invoices', header: 'Faktur', type: 'number' },
  { key: 'orders', header: 'SO', type: 'number' },
  { key: 'aov', header: 'Rata-rata per faktur', type: 'money' },
  { key: 'returnRate', header: 'Rasio retur', type: 'number', render: (r) => pct(r.returnRate), sortValue: (r) => r.returnRate ?? -1 },
  { key: 'receivable', header: 'Piutang belum cair', type: 'money' },
  { key: 'unshipped', header: 'SO belum dikirim', type: 'number' },
];

const PRODUCT_COLUMNS = [
  { key: 'rank', header: '#', type: 'number' },
  {
    key: 'name', header: 'Produk',
    render: (r) => (
      <span className="pw-cell">
        <span data-no-translate="" className="pw-cell__title">{r.name || r.code}</span>
        <span data-no-translate="" className="pw-cell__meta">{r.code}</span>
      </span>
    ),
    exportValue: (r) => `${r.name || ''} (${r.code})`,
  },
  { key: 'platformText', header: 'Platform', render: (r) => (r.platformParts.length ? <Mixed parts={r.platformParts} separator=", " /> : r.platformText), sortValue: (r) => r.platformText, exportValue: (r) => r.platformText },
  { key: 'qty', header: 'Jumlah', translateContext: 'quantity', nowrap: true },
  // Product value is the invoice-line DPP before returns (revision F11): it is
  // not a slice of the net revenue on the cards above, and says so.
  { key: 'revenue', header: 'Nilai penjualan produk (DPP sebelum retur)', type: 'money' },
  { key: 'share', header: 'Porsi dari total baris faktur', type: 'number', render: (r) => pct(r.share), sortValue: (r) => r.share ?? -1 },
  { key: 'prevRevenue', header: 'Bulan sebelumnya (DPP sebelum retur)', type: 'money' },
  {
    key: 'changePct', header: 'Perubahan', type: 'number', translate: true,
    render: (r) => {
      const c = productChange(r);
      return <span className={`retail__change is-${c.tone}`}>{c.text}</span>;
    },
    exportValue: (r) => productChange(r).text,
    sortValue: (r) => (r.isNew ? Number.MAX_SAFE_INTEGER : (r.changePct ?? -Infinity)),
  },
];

const SHIPMENT_COLUMNS = [
  { key: 'number', header: 'No. SO', nowrap: true },
  platformColumn('platform'),
  { key: 'date', header: 'Tanggal SO', type: 'date' },
  { key: 'promisedDate', header: 'Janji kirim', type: 'date' },
  { key: 'daysOpen', header: 'Umur (hari)', type: 'number' },
  { key: 'percentShipped', header: 'Terkirim', type: 'number', render: (r) => pct(r.percentShipped) },
  { key: 'amount', header: 'Nilai (sebelum PPN)', type: 'money' },
  {
    key: 'status', header: 'Status', nowrap: true,
    render: (r) => { const s = shipmentStatus(r); return <StatusBadge status={s.status} label={s.label} />; },
    exportValue: (r) => shipmentStatus(r).label,
    sortValue: (r) => r.daysLate,
  },
];

const RECEIVABLE_COLUMNS = [
  { key: 'number', header: 'No. faktur', nowrap: true },
  platformColumn('platform'),
  { key: 'date', header: 'Tanggal', type: 'date' },
  { key: 'dueDate', header: 'Jatuh tempo', type: 'date' },
  { key: 'total', header: 'Nilai faktur', type: 'money' },
  { key: 'outstanding', header: 'Belum cair', type: 'money' },
  {
    key: 'status', header: 'Status', nowrap: true,
    render: (r) => { const s = receivableStatus(r); return <StatusBadge status={s.status} label={s.label} />; },
    exportValue: (r) => receivableStatus(r).label,
    sortValue: (r) => r.daysOverdue,
  },
];

// Retail Commerce (migration 120): how the marketplaces sell — revenue on DPP
// net of returns, orders, returns, money the marketplaces still owe and SOs
// waiting to ship, per platform, from the approved Accurate mirror. Read-only:
// the numbers are recorded in Accurate. Needs retail.insight.view.
export default function RetailCommerce() {
  const [overview, setOverview] = useState(null);
  const [shipments, setShipments] = useState(null);
  const [receivables, setReceivables] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [month, setMonth] = useState('');
  const [products, setProducts] = useState(null);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const [o, s, r] = await Promise.all([
        api.get('/retail-commerce/overview', { params: { months: 12 } }),
        api.get('/retail-commerce/pending-shipments'),
        api.get('/retail-commerce/receivables'),
      ]);
      setOverview(o.data.data);
      setShipments(s.data.data);
      setReceivables(r.data.data);
    } catch (error) {
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadProducts = useCallback(async () => {
    setProductsLoading(true); setProductsError('');
    try {
      const r = await api.get('/retail-commerce/top-products', { params: month ? { month } : {} });
      setProducts(r.data.data);
    } catch (error) {
      setProductsError(errorMessage(error, 'Produk terlaris belum bisa dimuat.'));
    } finally {
      setProductsLoading(false);
    }
  }, [month]);
  useEffect(() => { loadProducts(); }, [loadProducts]);

  const description = 'Kinerja penjualan marketplace dari data Accurate yang sudah disetujui. Omzet dihitung sebelum PPN dan bersih retur.';
  const actions = <Button variant="secondary" icon="refresh" loading={loading} onClick={() => { load(); loadProducts(); }}>Muat ulang</Button>;

  if (loading && !overview) return <Page title="Retail Commerce" description={description}><LoadingState label="Menyiapkan kinerja marketplace" /></Page>;
  if (loadError && !overview) {
    return (
      <Page title="Retail Commerce" description={description}>
        <EmptyState tone="error" title="Data marketplace belum bisa dimuat" description={loadError} action={<Button variant="secondary" onClick={load}>Coba lagi</Button>} />
      </Page>
    );
  }
  if (!overview.connected) {
    const why = emptyReason(overview.reason);
    return (
      <Page title="Retail Commerce" description={description} actions={actions}>
        <EmptyState icon="storefront" title={why.title} description={why.description} />
      </Page>
    );
  }

  const cards = kpiCards(overview);
  const platforms = overview.platforms;
  const bars = revenueBars(platforms).map(otherLabel);
  const debts = receivableBars(platforms).map(otherLabel);
  const race = motionSeries(overview);
  const trends = trendCards(overview);
  const attention = attentionItems(overview, shipments, receivables);
  const months = overview.months;
  const range = `${months[0].label} – ${months[months.length - 1].label}`;
  const productMonth = products?.month?.key || '';

  return (
    <Page
      title="Retail Commerce"
      description={`${description} Diperbarui ${formatDateTime(overview.generatedAt)}.`}
      actions={actions}
    >
      <DashboardSection title="Angka utama" subtitle={overview.latestMonth ? `Marketplace ditagih dengan satu faktur rekap per platform setiap bulan. Faktur terakhir: ${overview.latestMonth.label}.` : 'Dari faktur rekap marketplace yang sudah disetujui'}>
        <div className="pw-dash-section__kpis">
          {cards.map((k) => (
            <StatCard
              key={k.key}
              label={k.label}
              value={k.value === null ? null : <AnimatedNumber value={k.value} unit={k.unit} compact={k.unit === 'rupiah'} />}
              note={k.note}
              alert={k.alert}
              empty={k.empty}
            />
          ))}
        </div>
      </DashboardSection>

      <DashboardSection title="Perlu perhatian" subtitle={attention.length ? 'Pesanan dan faktur marketplace yang masih menunggu' : 'Tidak ada pesanan atau faktur yang menunggu'}>
        <Card>
          {attention.length
            ? <BarList items={attention} label="Pesanan dan faktur marketplace yang menunggu" />
            : <EmptyState compact icon="task_alt" title="Semua beres" description="Semua SO marketplace terkirim dan semua faktur sudah cair." />}
        </Card>
      </DashboardSection>

      <DashboardSection title="Grafik capaian bulanan" subtitle={`Perjalanan omzet tiap platform dan jumlah pesanan, ${range}. Panjang batang dibanding bulan terbaik masing-masing.`}>
        <Card variant="chart">
          {race.length >= 2 ? (
            <MotionChart months={months} series={race} title="Grafik capaian bulanan Retail Commerce" />
          ) : (
            <EmptyState compact icon="animation" title="Grafik capaian bulanan menunggu data" description="Grafik bergerak ini berjalan setelah minimal dua platform atau ukuran punya angka." />
          )}
        </Card>
      </DashboardSection>

      <DashboardSection title="Tren 12 bulan" subtitle="Satu kartu per ukuran marketplace">
        {trends.length ? (
          <div className="pw-dash-section__trends">
            {trends.map((m) => {
              const head = latestValue(m.values, months);
              return (
                <Card key={m.key} className="retail__trend">
                  <div className="retail__trend-label">{m.label}</div>
                  <div className="retail__trend-value">
                    <AnimatedNumber value={head.value} unit={m.unit} compact={m.unit === 'rupiah'} />
                    {head.month ? <span className="retail__trend-month">{head.month}</span> : null}
                  </div>
                  <TrendChart months={months} values={m.values} unit={m.unit} label={m.label} />
                </Card>
              );
            })}
          </div>
        ) : (
          <Card><EmptyState compact icon="monitoring" title="Belum ada tren bulanan" description="Tren 12 bulan muncul setelah ada dua bulan faktur marketplace." /></Card>
        )}
      </DashboardSection>

      <DashboardSection title="Komposisi per platform" subtitle={`${range} · total ${compactMoney(overview.windowRevenue)}`}>
        {platforms.length ? (
          <div className="pw-dash-section__split">
            <Card title="Porsi omzet per platform">
              {bars.length ? <BarList dataLabels items={bars} label="Porsi omzet per platform" max={overview.windowRevenue} /> : <EmptyState compact icon="bar_chart" title="Belum ada omzet di periode ini" />}
            </Card>
            <Card title="Piutang marketplace" subtitle={debts.length ? `Belum cair ${compactMoney(overview.kpis.receivable.amount)} · nilai faktur termasuk PPN` : 'Tidak ada faktur yang belum cair'}>
              {debts.length ? <BarList dataLabels items={debts} label="Piutang marketplace per platform" /> : <EmptyState compact icon="task_alt" title="Semua sudah cair" />}
            </Card>
          </div>
        ) : (
          <Card><EmptyState compact icon="storefront" title="Belum ada penjualan marketplace" description={`Tidak ada faktur, SO, atau piutang marketplace di ${range}.`} /></Card>
        )}
      </DashboardSection>

      <DashboardSection title="Tabel kerja" subtitle="Platform, produk terlaris, SO yang belum dikirim, dan faktur yang belum cair">
        <DataGrid
          title="Perbandingan platform"
          columns={PLATFORM_COLUMNS}
          rows={platformRows(platforms)}
          searchable={false}
          exportName="retail-commerce-platform"
          pageSize={10}
          empty="Belum ada data platform"
        />

        <Card
          title={products?.month ? `Produk terlaris ${products.month.label}` : 'Produk terlaris'}
          subtitle={products?.month
            ? `${formatNumber(products.products)} produk terjual, total baris faktur ${formatMetric(products.monthRevenue, 'rupiah', { compact: true })} (DPP sebelum retur), dibanding ${products.prevMonth.label}. Angka ini sebelum retur, jadi bisa lebih besar dari omzet bersih retur di atas; retur tidak dialokasikan ke produk.${products.fallback ? ' Bulan ini belum ada faktur, jadi yang tampil bulan terakhir yang sudah ditagih.' : ''}`
            : 'Nilai per baris faktur Accurate (DPP sebelum retur), dibanding bulan sebelumnya.'}
          actions={overview.months.length ? (
            <Select
              label="Bulan"
              dense
              value={month || productMonth}
              options={monthOptions(overview.months)}
              onChange={(e) => setMonth(e.target.value)}
            />
          ) : null}
          noPadding
        >
          <DataGrid
            title="Produk terlaris"
            showTitle={false}
            flush
            columns={PRODUCT_COLUMNS}
            rows={productRows(products?.rows)}
            loading={productsLoading}
            error={productsError}
            onRetry={loadProducts}
            idKey="code"
            searchable={false}
            exportName={`retail-commerce-produk-${productMonth}`}
            exportNote="15 produk terlaris"
            pageSize={15}
            empty="Belum ada produk terjual di bulan ini"
          />
        </Card>

        <DataGrid
          title={`SO belum dikirim${shipments?.total ? ` (${formatNumber(shipments.total)})` : ''}`}
          columns={SHIPMENT_COLUMNS}
          rows={shipments?.rows || []}
          loading={loading && !shipments}
          searchPlaceholder="Cari nomor SO"
          exportName="retail-commerce-so-belum-dikirim"
          exportNote={shipments?.total > shipments?.rows?.length ? `${formatNumber(shipments.rows.length)} SO tertua dari ${formatNumber(shipments.total)}` : ''}
          empty="Semua SO marketplace sudah terkirim"
        />
        {shipments?.total > shipments?.rows?.length ? (
          <p className="pw-text-helper">{`Menampilkan ${formatNumber(shipments.rows.length)} SO tertua dari ${formatNumber(shipments.total)}.`}</p>
        ) : null}

        <DataGrid
          title="Faktur marketplace belum cair"
          columns={RECEIVABLE_COLUMNS}
          rows={receivables?.rows || []}
          loading={loading && !receivables}
          searchPlaceholder="Cari nomor faktur"
          exportName="retail-commerce-piutang"
          exportNote={receivables?.total > receivables?.rows?.length ? `${formatNumber(receivables.rows.length)} faktur terlama dari ${formatNumber(receivables.total)}` : ''}
          empty="Tidak ada faktur marketplace yang belum cair"
        />
        {receivables?.total > receivables?.rows?.length ? (
          <p className="pw-text-helper">{`Menampilkan ${formatNumber(receivables.rows.length)} faktur dengan jatuh tempo terlama dari ${formatNumber(receivables.total)}.`}</p>
        ) : null}
      </DashboardSection>
    </Page>
  );
}
