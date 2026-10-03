import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/Button';
import Card from '../../components/Card';
import DashboardSection from '../../components/DashboardSection';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import Icon from '../../components/Icon';
import Page from '../../components/Page';
import Select from '../../components/Select';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import AnimatedNumber from '../../components/charts/AnimatedNumber';
import BarList from '../../components/charts/BarList';
import MotionChart from '../../components/charts/MotionChart';
import TrendChart from '../../components/charts/TrendChart';
import { formatMetric } from '../../components/charts/chartModel';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDateTime, formatNumber } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import { allowedLink } from '../../components/navigation';
import { attentionItems, headline, kpiGroups, motionSeries, overdueRows, targetProgress, trendCards } from './divisionDashboardModel';
import { NoTranslate, Translate } from '../../i18n/NoTranslate';
import './division-dashboard.css';

const errorMessage = (error, fallback) => error?.response?.data?.error?.message || fallback;

function Delta({ head, unit }) {
  if (head.change === null) return null;
  const tone = head.good === null ? 'flat' : (head.good ? 'good' : 'bad');
  const icon = head.direction === 'up' ? 'trending_up' : (head.direction === 'down' ? 'trending_down' : 'trending_flat');
  return (
    <span className={`div-dash__delta is-${tone}`}>
      <Icon name={icon} size="sm" />
      {`${head.change > 0 ? '+' : ''}${formatMetric(head.change, unit, { compact: true })} dari ${head.prevMonth}`}
    </span>
  );
}

// Dashboard divisi (migration 116): the one dashboard template, filled from the
// management providers for whichever division is shown. Every division gets
// the same six sections in the same order, with the same chart motion; a
// section without data keeps its place with its empty state:
//   1 Angka utama · 2 Perlu perhatian · 3 Grafik capaian bulanan ·
//   4 Tren 12 bulan · 5 Capaian terhadap target · 6 Pekerjaan lewat tenggat.
// Supervisor/Head see their division; management picks any or the company.
export default function DivisionDashboard() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const [params, setParams] = useSearchParams();
  const requested = params.get('division') || '';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const r = await api.get('/management-dashboard/division', { params: requested ? { division: requested } : {} });
      setData(r.data.data);
    } catch (error) {
      setData(null);
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, [requested]);
  useEffect(() => { load(); }, [load]);

  const picker = data?.divisions?.length ? (
    <Select
      label="Divisi"
      dense
      value={requested || String(data.division.id ?? 'all')}
      options={data.divisions.map((d) => ({ value: String(d.id), label: d.name }))}
      onChange={(e) => setParams((p) => { const n = new URLSearchParams(p); n.set('division', e.target.value); return n; }, { replace: true })}
    />
  ) : null;

  if (loading && !data) return <Page title="Dashboard divisi"><LoadingState label="Menyiapkan dashboard divisi" skeleton="dashboard" /></Page>;
  if (loadError && !data) {
    return (
      <Page title="Dashboard divisi">
        <EmptyState tone="error" title="Dashboard belum bisa dimuat" description={loadError} action={<Button variant="secondary" onClick={load}>Coba lagi</Button>} />
      </Page>
    );
  }

  const groups = kpiGroups(data.kpis);
  const attention = attentionItems(data.escalations);
  const race = motionSeries(data.metrics);
  const trends = trendCards(data.metrics);
  const progress = targetProgress(data.metrics, data.months);
  const rows = overdueRows(data.escalations);
  const esc = data.escalations;
  const range = `${data.months[0].label} – ${data.months[data.months.length - 1].label}`;
  const escalationsLink = allowedLink('/escalations', permissions);
  const targetsLink = allowedLink('/targets', permissions);

  const overdueColumns = [
    {
      key: 'title', header: 'Pekerjaan',
      render: (r) => {
        const link = allowedLink(r.link, permissions);
        const title = <span className="pw-cell__title" data-no-translate="">{r.title}</span>;
        return (
          <span className="pw-cell">
            {link ? <Link to={link}>{title}</Link> : title}
            {r.context ? <span className="pw-cell__meta"><Translate strict>{r.context}</Translate></span> : null}
          </span>
        );
      },
      exportValue: (r) => r.title,
    },
    { key: 'sourceLabel', header: 'Sumber', translate: true },
    { key: 'reference', header: 'Referensi', render: (r) => (r.reference ? <NoTranslate>{r.reference}</NoTranslate> : '—'), exportValue: (r) => r.reference || '' },
    {
      key: 'daysLate', header: 'Terlambat', type: 'number',
      render: (r) => <StatusBadge status={r.severity === 'high' ? 'overdue' : 'pending'} label={`${formatNumber(r.daysLate)} hari`} />,
      exportValue: (r) => r.daysLate,
    },
  ];

  return (
    <Page
      title={`Dashboard ${data.division.name}`}
      description={`Angka utama, pekerjaan yang perlu perhatian, perjalanan 12 bulan, capaian terhadap target, dan daftar kerja. Diperbarui ${formatDateTime(data.generatedAt)}.`}
      actions={(
        <div className="div-dash__actions">
          {picker}
          <Button variant="secondary" icon="refresh" loading={loading} onClick={load}>Muat ulang</Button>
        </div>
      )}
    >
      <DashboardSection title="Angka utama" subtitle="Posisi hari ini per modul divisi">
        {groups.length ? groups.map((g) => (
          <div key={g.provider} className="pw-dash-section">
            {groups.length > 1 ? <h3 className="pw-dash-section__group">{g.label}</h3> : null}
            <div className="pw-dash-section__kpis">
              {g.kpis.map((k) => (
                <StatCard
                  key={`${k.provider}.${k.key}`}
                  label={k.label}
                  value={k.value === null ? null : <AnimatedNumber value={k.value} unit={k.unit} compact={k.unit === 'rupiah'} />}
                  note={k.restricted ? k.sub : (k.error ? 'Belum bisa dihitung' : k.sub)}
                  alert={k.alert}
                  empty={k.value === null}
                />
              ))}
            </div>
          </div>
        )) : <EmptyState compact icon="monitoring" title="Belum ada angka utama" description="Modul divisi ini belum melaporkan angka ke dashboard." />}
      </DashboardSection>

      <DashboardSection
        title="Perlu perhatian"
        subtitle={esc.total ? `${formatNumber(esc.total)} pekerjaan lewat tenggat, per sumber` : 'Tidak ada pekerjaan yang lewat tenggat'}
        actions={escalationsLink && esc.total ? <Button variant="text" to={escalationsLink} icon="arrow_forward">Buka Pusat eskalasi</Button> : null}
      >
        <Card>
          {attention.length
            ? <BarList items={attention} label="Pekerjaan lewat tenggat per sumber" />
            : <EmptyState compact icon="task_alt" title="Semua beres" description="Tidak ada pekerjaan divisi yang lewat tenggat." />}
        </Card>
      </DashboardSection>

      <DashboardSection title="Grafik capaian bulanan" subtitle={`Perjalanan capaian ${range}`}>
        <Card variant="chart">
          {race.length >= 2 ? (
            <MotionChart months={data.months} series={race} title={`Grafik capaian bulanan ${data.division.name}`} />
          ) : (
            <EmptyState
              compact
              icon="animation"
              title="Grafik capaian bulanan menunggu data"
              description="Grafik bergerak ini mulai berjalan setelah modul divisi mencatat pekerjaan minimal 3 bulan, misalnya tiket IT selesai, permintaan GA selesai, atau onboarding selesai."
            />
          )}
        </Card>
      </DashboardSection>

      <DashboardSection title="Tren 12 bulan" subtitle="Satu kartu per ukuran, dengan garis target bila ada">
        {trends.length ? (
          <div className="pw-dash-section__trends">
            {trends.map((m) => {
              const head = headline(m, data.months);
              return (
                <Card key={`${m.provider}.${m.key}`} className="div-dash__trend">
                  <div className="div-dash__trend-head">
                    <span className="div-dash__trend-label">{m.label}{m.averaged ? ' · rata-rata antar divisi' : ''}{m.billedMonthly ? ' · ditagih bulanan' : ''}</span>
                    <span className="div-dash__trend-source">{m.providerLabel}</span>
                  </div>
                  <div className="div-dash__trend-value">
                    <AnimatedNumber value={head.value} unit={m.unit} compact={m.unit === 'rupiah'} />
                    <Delta head={head} unit={m.unit} />
                  </div>
                  <div className="div-dash__trend-meta">
                    {[head.month, head.running !== null ? `${head.runningMonth} berjalan: ${formatMetric(head.running, m.unit, { compact: true })}` : null].filter(Boolean).join(' · ')}
                  </div>
                  <TrendChart months={data.months} values={m.values} targets={m.targets} unit={m.unit} label={m.label} />
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <EmptyState compact icon="monitoring" title="Belum ada tren bulanan" description="Tren 12 bulan muncul setelah modul divisi ini mencatat pekerjaan. Ukuran yang selama ini masih nol tidak ditampilkan." />
          </Card>
        )}
      </DashboardSection>

      <DashboardSection
        title="Capaian terhadap target"
        subtitle={progress.items.length ? `Bulan ${progress.month}, bulan lengkap terakhir` : 'Belum ada target bulanan untuk divisi ini'}
        actions={targetsLink ? <Button variant="text" to={targetsLink} icon="arrow_forward">Buka Target</Button> : null}
      >
        <Card>
          {progress.items.length
            ? <BarList items={progress.items} label={`Capaian terhadap target ${progress.month}`} max={100} />
            : <EmptyState compact icon="flag" title="Belum ada target bulanan" description="Setelah target bulanan diisi di menu Target, capaian tiap ukuran tampil di sini sebagai persentase." />}
        </Card>
      </DashboardSection>

      <DashboardSection title="Pekerjaan lewat tenggat" subtitle={esc.total ? `${formatNumber(rows.length)} paling lama dari ${formatNumber(esc.total)}` : 'Daftar kerja divisi'}>
        <DataGrid
          title="Pekerjaan lewat tenggat"
          showTitle={false}
          searchable={false}
          columns={overdueColumns}
          rows={rows}
          exportName={`lewat-tenggat-${String(data.division.code || data.division.id || 'divisi')}`}
          exportNote={esc.total > rows.length ? `${formatNumber(rows.length)} paling lama dari ${formatNumber(esc.total)}` : ''}
          empty="Tidak ada pekerjaan yang lewat tenggat"
        />
      </DashboardSection>
    </Page>
  );
}
