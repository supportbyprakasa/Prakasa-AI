import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import Page from '../../components/Page';
import Select from '../../components/Select';
import StatCard from '../../components/StatCard';
import TabBar from '../../components/TabBar';
import AnimatedNumber from '../../components/charts/AnimatedNumber';
import MotionChart from '../../components/charts/MotionChart';
import BarList from '../../components/charts/BarList';
import TrendChart from '../../components/charts/TrendChart';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDate, formatNumber } from '../../components/format';
import { Mixed, Translate } from '../../i18n/NoTranslate';
import {
  NO_AREA_LABEL, NO_CHANNEL, channelRows, channelShareItems, formatMonth, kpiCards, leadRows, monthOptions, motionSeries, moverItems, nooTable,
  pctText, productRows, totalSeries,
} from './marketingModel';
import './marketing.css';

const errorMessage = (error, fallback) => error?.response?.data?.error?.message || fallback;
const TABS = [
  { k: 'channels', l: 'Channel' },
  { k: 'products', l: 'Produk' },
  { k: 'customers', l: 'Pelanggan & leads' },
];
const tabFrom = (value) => (TABS.some((t) => t.k === value) ? value : 'channels');
const pctColumn = (key, header) => ({
  key, header, align: 'end', nowrap: true,
  render: (r) => pctText(r[key]) || '—',
  sortValue: (r) => r[key] ?? -Infinity,
  exportValue: (r) => r[key] ?? '',
});

// Channel and area names are record data; "Tanpa channel" / "Tanpa area" (no
// channel or area on the record) are interface text inside those data zones.
const channelColumn = {
  key: 'channel', header: 'Channel',
  // "Ekspor" is the app's own label for the Export channel.
  render: (r) => (r.id === NO_CHANNEL || r.id === 'Export' ? <Translate>{r.channel}</Translate> : r.channel),
  sortValue: (r) => r.channel, exportValue: (r) => r.channel,
};
// `translate`: an interface label among the record names (charts keep the
// label a string — it is sorted and read out).
const fallbackLabel = (item) => (item.key === NO_CHANNEL ? { ...item, translate: true } : item);

const CHANNEL_COLUMNS = [
  channelColumn,
  { key: 'revenue', header: 'Omzet (DPP)', type: 'money' },
  pctColumn('changePct', 'vs bulan lalu'),
  { key: 'qtyText', header: 'Jumlah terjual', translateContext: 'quantity', nowrap: true },
  { key: 'noo', header: 'Pelanggan baru', type: 'number' },
  { key: 'revenue12', header: 'Omzet 12 bulan', type: 'money' },
];
const PRODUCT_COLUMNS = [
  { key: 'rank', header: '#', type: 'number' },
  { key: 'itemName', header: 'Produk', render: (r) => <span className="pw-cell">{r.itemName}<span data-no-translate="" className="pw-cell__meta">{r.itemCode}</span></span>, sortValue: (r) => r.itemName, exportValue: (r) => r.itemName },
  { key: 'revenue', header: 'Omzet (DPP)', type: 'money' },
  { key: 'prevRevenue', header: 'Bulan lalu', type: 'money' },
  pctColumn('changePct', 'Perubahan'),
  { key: 'qtyText', header: 'Jumlah', translateContext: 'quantity', nowrap: true },
  { key: 'channelsText', header: 'Channel', render: (r) => <Mixed parts={r.channelParts} separator=", " />, sortValue: (r) => r.channelsText, exportValue: (r) => r.channelsText },
];
const LEAD_COLUMNS = [
  { key: 'area', header: 'Area', render: (r) => (r.area === NO_AREA_LABEL ? <Translate>{r.area}</Translate> : r.area), sortValue: (r) => r.area, exportValue: (r) => r.area },
  { key: 'total', header: 'Leads', type: 'number' },
  { key: 'newInMonth', header: 'Baru bulan ini', type: 'number' },
  { key: 'open', header: 'Terbuka', type: 'number' },
  { key: 'visited', header: 'Sudah dikunjungi', type: 'number' },
  { key: 'converted', header: 'Jadi pelanggan', type: 'number' },
  pctColumn('conversion', 'Konversi'),
];

// Marketing → Produk & channel (migration 119): what sells, where, and who is
// new — aggregates from the approved Accurate data (omzet = DPP) and the Sales
// app's leads. Never an invoice or a customer's figures: Marketing sees totals.
export default function MarketingInsights() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('month') || 'latest';
  const tab = tabFrom(params.get('tab'));
  const [data, setData] = useState(null);
  const [web, setWeb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const r = await api.get('/marketing/insights', { params: { month: requested } });
      setData(r.data.data);
    } catch (error) {
      setData(null);
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, [requested]);
  useEffect(() => { load(); }, [load]);

  // Google Analytics sessions: a card of its own that simply stays hidden when GA is not set up.
  const month = data?.month;
  useEffect(() => {
    if (!month) return undefined;
    let alive = true;
    setWeb(null);
    api.get('/marketing/web-sessions', { params: { month } })
      .then((r) => { if (alive) setWeb(r.data.data); })
      .catch(() => { if (alive) setWeb(null); });
    return () => { alive = false; };
  }, [month]);

  const setParam = (changes) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    return next;
  }, { replace: true });

  const title = 'Produk & channel';
  const description = 'Apa yang laku, di channel mana, dan siapa yang baru — dari data Accurate yang sudah disetujui (omzet DPP) dan leads tim Sales.';
  if (loading && !data) return <Page title={title} description={description}><LoadingState label="Menyiapkan insight Marketing" /></Page>;
  if (loadError && !data) {
    return (
      <Page title={title} description={description}>
        <EmptyState tone="error" title="Insight belum bisa dimuat" description={loadError} action={<Button variant="secondary" onClick={load}>Coba lagi</Button>} />
      </Page>
    );
  }

  const index = data.months.length - 1;
  const cards = kpiCards(data, web);
  const race = motionSeries(data.channels).map(fallbackLabel);
  const totals = totalSeries(data.channels, 'revenue', data.months.length);
  const shares = channelShareItems(data.channels, index).map(fallbackLabel);
  const channelTable = channelRows(data.channels, index);
  const noo = nooTable(data.channels, data.months);
  const nooColumns = [
    channelColumn,
    ...noo.months.map((m) => ({ key: m.key, header: m.label, type: 'number' })),
    { key: 'total', header: '12 bulan', type: 'number' },
  ];
  const products = productRows(data.topProducts);
  const rising = moverItems(data.movers.rising);
  const falling = moverItems(data.movers.falling);
  const leads = leadRows(data.leads.byArea);
  const behind = data.accurate && data.dataThrough && data.dataThrough.slice(0, 7) < data.month;

  return (
    <Page
      title={title}
      description={description}
      actions={(
        <div className="mkt__actions">
          <Select
            label="Bulan"
            dense
            value={data.month}
            options={monthOptions(data.currentMonth)}
            onChange={(e) => setParam({ month: e.target.value })}
          />
          <Button variant="secondary" icon="refresh" loading={loading} onClick={load}>Muat ulang</Button>
        </div>
      )}
    >
      {!data.accurate ? (
        <Banner tone="info" title="Angka penjualan belum tersambung">
          Omzet, produk, dan customer baru muncul setelah divisi Sales menyetujui batch data Accurate pertama. Leads sudah bisa dilihat.
        </Banner>
      ) : null}
      {behind ? (
        <Banner
          tone="info"
          action={<Button variant="text" onClick={() => setParam({ month: data.dataThrough.slice(0, 7) })}>{`Lihat ${formatMonth(data.dataThrough.slice(0, 7))}`}</Button>}
        >
          {`Data Accurate yang sudah disetujui baru sampai ${formatDate(data.dataThrough)}. Angka ${data.monthLabel} masih kosong.`}
        </Banner>
      ) : null}

      <section className="mkt__kpis" aria-label={`Angka utama ${data.monthLabel}`}>
        {cards.map((c) => (
          <StatCard
            key={c.key}
            label={`${c.label} · ${data.monthLabel}`}
            value={c.value === null ? null : <AnimatedNumber value={c.value} unit={c.unit} compact={c.unit === 'rupiah'} />}
            note={c.noteParts ? <Mixed parts={c.noteParts} /> : c.note}
            empty={c.value === null}
          />
        ))}
      </section>

      <TabBar tabs={TABS} value={tab} onChange={(k) => setParam({ tab: k === 'channels' ? '' : k })} label="Insight Marketing" idPrefix="mkt-tab" panelId="mkt-panel" />
      <div id="mkt-panel" role="tabpanel" aria-labelledby={`mkt-tab-${tab}`} className="pw-stack pw-stack--lg">
        {tab === 'channels' ? (
          data.accurate ? (
            <>
              <div className="mkt__grid">
                <Card title="Omzet 12 bulan" subtitle={`${data.months[0].label} – ${data.monthLabel}, semua channel (DPP, setelah retur)`}>
                  <TrendChart months={data.months} values={totals} unit="rupiah" label="Omzet semua channel" />
                </Card>
                <Card title={`Porsi channel ${data.monthLabel}`} subtitle="Omzet tiap channel bulan ini">
                  {shares.length ? <BarList dataLabels items={shares} label={`Porsi omzet per channel ${data.monthLabel}`} /> : <EmptyState compact icon="donut_large" title="Belum ada omzet bulan ini" />}
                </Card>
              </div>
              <Card title="Channel berlomba" subtitle="Panjang batang = omzet channel bulan itu dibanding bulan terbaiknya (100) dalam 12 bulan. Putar untuk melihat channel mana yang sedang naik.">
                {race.length >= 2 ? (
                  <MotionChart dataLabels months={data.months} series={race} title="Omzet per channel" />
                ) : (
                  <EmptyState compact icon="animation" title="Butuh minimal dua channel yang terjual" />
                )}
              </Card>
              <DataGrid
                title={`Channel ${data.monthLabel}`}
                rows={channelTable}
                columns={CHANNEL_COLUMNS}
                searchable={false}
                exportName={`marketing-channel-${data.month}`}
                empty="Belum ada penjualan per channel"
              />
              <p className="pw-text-helper">
                {data.qtyMixedUnits
                  ? 'Jumlah terjual ditulis per satuan; satuan berbeda tidak dijumlahkan. Sebagian baris memakai satuan faktur karena rasio satuan Accurate belum tersedia.'
                  : 'Jumlah terjual ditulis per satuan dasar Accurate; satuan berbeda tidak dijumlahkan.'}
              </p>
            </>
          ) : <EmptyState icon="storefront" title="Menunggu data Accurate" description="Omzet per channel muncul setelah batch Accurate pertama disetujui divisi Sales." />
        ) : null}

        {tab === 'products' ? (
          data.accurate ? (
            <>
              <DataGrid
                title={`20 produk terlaris ${data.monthLabel}`}
                rows={products}
                columns={PRODUCT_COLUMNS}
                searchPlaceholder="Cari produk atau kode"
                exportName={`marketing-produk-${data.month}`}
                exportNote="20 produk terlaris"
                empty="Belum ada produk terjual bulan ini"
              />
              <div className="mkt__grid">
                <Card title="Naik paling tinggi" subtitle={`Kenaikan omzet dibanding ${data.prevMonthLabel}`}>
                  {rising.length ? <BarList dataLabels items={rising} label="Produk dengan kenaikan omzet terbesar" /> : <EmptyState compact icon="trending_up" title="Tidak ada produk yang naik" />}
                </Card>
                <Card title="Turun paling dalam" subtitle={`Penurunan omzet dibanding ${data.prevMonthLabel}`}>
                  {falling.length ? <BarList dataLabels items={falling} label="Produk dengan penurunan omzet terbesar" /> : <EmptyState compact icon="trending_down" title="Tidak ada produk yang turun" />}
                </Card>
              </div>
              <p className="pw-text-helper">Omzet produk = porsi DPP tiap baris faktur: voucher dan diskon faktur dialokasikan proporsional terhadap nilai baris, sebelum retur.</p>
            </>
          ) : <EmptyState icon="inventory_2" title="Menunggu data Accurate" description="Produk terlaris muncul setelah batch Accurate pertama disetujui divisi Sales." />
        ) : null}

        {tab === 'customers' ? (
          <>
            {data.accurate ? (
              <DataGrid
                title="Pelanggan baru (NOO) per channel"
                rows={noo.rows}
                columns={nooColumns}
                searchable={false}
                exportName={`marketing-noo-${data.month}`}
                empty="Belum ada pelanggan baru dalam 12 bulan"
              />
            ) : null}
            <DataGrid
              title="Leads per area"
              rows={leads}
              columns={LEAD_COLUMNS}
              searchPlaceholder="Cari area"
              exportName={`marketing-leads-${data.month}`}
              empty="Belum ada leads"
            />
            <p className="pw-text-helper">
              {`Leads dari kunjungan tim Sales. Baru bulan ini = kunjungan pertama di ${data.monthLabel}. Total leads baru: ${formatNumber(data.leads.newThisMonth)}.`}
            </p>
          </>
        ) : null}
      </div>
    </Page>
  );
}
