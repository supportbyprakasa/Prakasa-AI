import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Chip from '../../components/Chip';
import DataGrid from '../../components/datagrid/DataGrid';
import DateInput from '../../components/DateInput';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FormActions from '../../components/FormActions';
import Icon from '../../components/Icon';
import IconButton from '../../components/IconButton';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import Select from '../../components/Select';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import AnalyticsLineChart from './AnalyticsLineChart';
import {
  RANGE_PRESETS, channelLabel, countryLabel, deviceLabel, formatDay, formatDuration, formatNumber, formatShare,
  isValidCustomRange, kpiTiles, localIsoDate, setupReasonText, setupSteps, withShares,
} from './analyticsModel';
import './analytics.css';

const PROPERTY_KEY = 'pw.analytics.property';
const errorText = (error, fallback) => error?.response?.data?.error?.message || fallback;

function readStored() {
  try { return localStorage.getItem(PROPERTY_KEY) || ''; } catch { return ''; }
}
function store(value) {
  try { localStorage.setItem(PROPERTY_KEY, value); } catch { /* per-viewer convenience only */ }
}

// ---- Setup state ----------------------------------------------------------

const STEP_BADGE = {
  done: { status: 'completed', label: 'Selesai' },
  todo: { status: 'need_follow_up', label: 'Perlu dilakukan' },
  waiting: { status: 'pending', label: 'Menunggu' },
};

function SetupState({ status, onRecheck, checking }) {
  const steps = setupSteps(status.reason);
  const email = status.serviceAccountEmail;
  const copy = async () => {
    try { await navigator.clipboard.writeText(email); toast('Email service account disalin', 'success'); } catch { toast('Email gagal disalin', 'error'); }
  };
  const body = {
    serviceAccount: {
      title: 'Service account Google terpasang di server',
      text: status.serviceAccountConfigured
        ? 'Server sudah memakai service account Google.'
        : 'Isi GOOGLE_SERVICE_ACCOUNT_EMAIL dan GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY di konfigurasi server, lalu jalankan ulang backend.',
    },
    enableApis: {
      title: 'Aktifkan Google Analytics Admin API dan Google Analytics Data API',
      text: 'Di Google Cloud Console, buka project milik service account → APIs & Services → Library, cari kedua API ini lalu pilih Enable.',
      extra: (
        <div className="pw-row">
          <Button variant="text" icon="open_in_new" href="https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com" target="_blank" rel="noopener noreferrer">
            Buka Admin API
          </Button>
          <Button variant="text" icon="open_in_new" href="https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com" target="_blank" rel="noopener noreferrer">
            Buka Data API
          </Button>
        </div>
      ),
    },
    grantAccess: {
      title: 'Tambahkan service account sebagai Viewer di Google Analytics',
      text: 'Di Google Analytics → Admin → Property access management, pilih +, lalu tambahkan email berikut dengan peran Viewer (ulangi untuk setiap properti).',
      extra: email ? (
        <span className="ga-sa-email">
          <code>{email}</code>
          <IconButton label="Salin email service account" size="sm" icon="content_copy" onClick={copy} />
        </span>
      ) : null,
    },
  };

  return (
    <>
      <Banner tone="warning" title="Google Analytics belum terhubung">{setupReasonText(status.reason)}</Banner>
      <Card variant="panel" size="sm" title="Langkah penyiapan (admin)" subtitle="Setelah semua langkah selesai, tunggu 1–2 menit lalu pilih Periksa lagi.">
        <div className="pw-stack">
          <ol className="ga-steps">
            {steps.map((step, index) => (
              <li key={step.key} className={`ga-step is-${step.state}`}>
                <span className="ga-step__number" aria-hidden="true">{index + 1}</span>
                <div className="ga-step__body">
                  <div className="ga-step__head">
                    <span className="ga-step__title">{body[step.key].title}</span>
                    <StatusBadge status={STEP_BADGE[step.state].status} label={STEP_BADGE[step.state].label} />
                  </div>
                  <p>{body[step.key].text}</p>
                  {body[step.key].extra || null}
                </div>
              </li>
            ))}
          </ol>
          <FormActions>
            <Button variant="secondary" icon="refresh" onClick={onRecheck} loading={checking}>Periksa lagi</Button>
          </FormActions>
        </div>
      </Card>
    </>
  );
}

// ---- Report pieces --------------------------------------------------------

const TREND_ICON = { up: 'north_east', down: 'south_east', flat: 'remove' };

function KpiTile({ tile }) {
  // Arrow follows the direction of change; colour (is-good/is-bad) follows whether that is good.
  const direction = tile.trend === 'flat' ? 'flat' : tile.delta > 0 ? 'up' : tile.delta < 0 ? 'down' : 'flat';
  return (
    <StatCard
      label={tile.label}
      value={tile.value}
      note={(
        <span className="ga-kpi__meta">
          <span className={`ga-kpi__delta is-${tile.trend}`}>
            <Icon name={TREND_ICON[direction]} size="sm" /> {tile.deltaLabel}
          </span>
          <span>vs {tile.previous}</span>
        </span>
      )}
    />
  );
}

// A label the model translated to Indonesian (a channel, a device type,
// "Tidak diketahui") is interface text; one Google Analytics sent as is (a
// country, an unknown channel) equals its key and is record data.
function BarList({ rows, empty }) {
  if (!rows.length) return <EmptyState compact title={empty} />;
  return (
    <ul className="ga-bars">
      {rows.map((row) => (
        <li key={row.key} className="ga-bars__item">
          <div className="ga-bars__head">
            <span className="ga-bars__label" data-no-translate={row.label === row.key ? '' : undefined}>{row.label}</span>
            <span className="ga-bars__value">
              {formatNumber(row.value)}
              <span className="ga-bars__share"> · {formatShare(row.share)}</span>
            </span>
          </div>
          <svg className="ga-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
            <rect className="ga-bar__fill" width={row.bar} height="6" />
          </svg>
        </li>
      ))}
    </ul>
  );
}

const PAGE_COLUMNS = [
  {
    key: 'title',
    header: 'Halaman',
    sortValue: (row) => `${row.title || ''} ${row.path}`,
    exportValue: (row) => `${row.title || ''} (${row.path})`,
    render: (row) => (
      <span className="pw-cell">
        <span className="pw-cell__title">{row.title || row.path}</span>
        <span className="pw-cell__meta">{row.path}</span>
      </span>
    ),
  },
  { key: 'views', header: 'Tampilan', align: 'right', render: (row) => formatNumber(row.views) },
  { key: 'users', header: 'Pengguna', align: 'right', render: (row) => formatNumber(row.users) },
  {
    key: 'avgEngagementTime',
    header: 'Rata-rata engagement',
    align: 'right',
    translate: true,
    sortValue: (row) => row.avgEngagementTime,
    exportValue: (row) => Math.round(row.avgEngagementTime),
    render: (row) => formatDuration(row.avgEngagementTime),
  },
];

function Report({ properties }) {
  const [property, setProperty] = useState(() => {
    const stored = readStored();
    return properties.some((item) => item.id === stored) ? stored : properties[0].id;
  });
  const today = localIsoDate();
  const [range, setRange] = useState('28d');
  const [custom, setCustom] = useState({ start: localIsoDate(new Date(), -28), end: localIsoDate(new Date(), -1) });
  const [appliedCustom, setAppliedCustom] = useState(null); // the range last applied with "Terapkan"
  const [reload, setReload] = useState(0);
  const [state, setState] = useState({ loading: true, error: '', data: null });

  const customValid = isValidCustomRange(custom.start, custom.end, today);
  // A custom range loads only when applied with "Terapkan": picking "Kustom"
  // or changing a date alone sends no request.
  const query = useMemo(() => {
    if (range !== 'custom') return { property, range };
    return appliedCustom ? { property, range, ...appliedCustom } : null;
  }, [property, range, appliedCustom]);

  useEffect(() => {
    if (!query) return undefined;
    let active = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    api.get('/google-analytics/report', { params: query })
      .then((response) => { if (active) setState({ loading: false, error: '', data: response.data.data }); })
      .catch((error) => { if (active) setState({ loading: false, error: errorText(error, 'Laporan gagal dimuat.'), data: null }); });
    return () => { active = false; };
  }, [query, reload]);

  const data = state.data;
  const tiles = useMemo(() => kpiTiles(data?.kpis), [data]);
  const channels = useMemo(() => withShares(data?.channels, channelLabel), [data]);
  const devices = useMemo(() => withShares(data?.devices, deviceLabel), [data]);
  const countries = useMemo(() => withShares(data?.countries, countryLabel), [data]);

  const onProperty = (event) => { setProperty(event.target.value); store(event.target.value); };

  let body;
  if (!query) {
    body = <EmptyState icon="date_range" title="Pilih rentang tanggal" description="Isi tanggal mulai dan akhir, lalu pilih Terapkan." />;
  } else if (state.error) {
    body = (
      <EmptyState
        tone="error"
        title="Laporan gagal dimuat"
        description={state.error}
        action={<Button variant="text" onClick={() => setReload((n) => n + 1)}>Coba lagi</Button>}
      />
    );
  } else if (!data) {
    body = <LoadingState label="Memuat laporan…" />;
  } else {
    body = (
      <>
        <div className="ga-kpis">
          {tiles.map((tile) => <KpiTile key={tile.key} tile={tile} />)}
        </div>
        <Card variant="chart" title="Pengguna aktif & sesi per hari">
          <AnalyticsLineChart points={data.series || []} />
        </Card>
        <div className="ga-lists">
          <Card variant="chart" title="Sumber trafik"><BarList rows={channels} empty="Belum ada data sumber trafik." /></Card>
          <Card variant="chart" title="Perangkat"><BarList rows={devices} empty="Belum ada data perangkat." /></Card>
          <Card variant="chart" title="Negara"><BarList rows={countries} empty="Belum ada data negara." /></Card>
        </div>
        <DataGrid
          title="Halaman teratas"
          exportName="halaman-teratas"
          columns={PAGE_COLUMNS}
          rows={data.topPages || []}
          idKey="path"
          pageSize={10}
          empty="Belum ada data halaman."
        />
      </>
    );
  }

  return (
    <div className="pw-stack pw-stack--lg" aria-busy={state.loading || undefined}>
      <section className="ga-filters" aria-label="Filter laporan">
        <Select
          label="Properti"
          value={property}
          onChange={onProperty}
          options={properties.map((item) => ({ value: item.id, label: item.account ? `${item.name} · ${item.account}` : item.name }))}
          dataOptions
          fieldClassName="ga-filters__property"
        />
        <div className="ga-filters__range" role="group" aria-label="Rentang tanggal">
          {RANGE_PRESETS.map((preset) => (
            <Chip key={preset.key} selected={range === preset.key} onClick={() => setRange(preset.key)}>{preset.label}</Chip>
          ))}
        </div>
        {range === 'custom' ? (
          <form
            className="ga-custom"
            noValidate
            onSubmit={(event) => { event.preventDefault(); if (customValid) setAppliedCustom({ start: custom.start, end: custom.end }); }}
          >
            <DateInput label="Dari" value={custom.start} max={today} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))} />
            <DateInput
              label="Sampai"
              value={custom.end}
              max={today}
              onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
              error={custom.start && custom.end && !customValid ? 'Rentang tidak valid' : undefined}
            />
            <Button type="submit" variant="secondary" disabled={!customValid}>Terapkan</Button>
          </form>
        ) : null}
        {query && data?.range ? (
          <p className="ga-range-note">
            {formatDay(data.range.start, true)} – {formatDay(data.range.end, true)}
            <span className="pw-text-meta"> · dibandingkan {formatDay(data.range.previousStart, true)} – {formatDay(data.range.previousEnd, true)}</span>
          </p>
        ) : null}
      </section>
      {body}
    </div>
  );
}

// ---- Page -----------------------------------------------------------------

export default function Analytics() {
  const [status, setStatus] = useState({ loading: true, error: '', data: null });
  const [reload, setReload] = useState(0);

  const load = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setStatus((current) => ({ ...current, loading: true, error: '' }));
    api.get('/google-analytics/status')
      .then((response) => { if (active) setStatus({ loading: false, error: '', data: response.data.data }); })
      .catch((error) => { if (active) setStatus({ loading: false, error: errorText(error, 'Status Google Analytics gagal dimuat.'), data: null }); });
    return () => { active = false; };
  }, [reload]);

  const data = status.data;

  return (
    <Page className="ga">
      <PageHeader
        title="Google Analytics"
        description="Pengunjung, halaman teratas, dan sumber trafik situs perusahaan."
      />
      {status.error ? (
        <EmptyState
          tone="error"
          title="Google Analytics gagal dimuat"
          description={status.error}
          action={<Button variant="text" onClick={load}>Coba lagi</Button>}
        />
      ) : !data ? (
        <LoadingState label="Memeriksa koneksi Google Analytics…" />
      ) : !data.ready ? (
        <SetupState status={data} onRecheck={load} checking={status.loading} />
      ) : (
        <Report properties={data.properties} />
      )}
    </Page>
  );
}
