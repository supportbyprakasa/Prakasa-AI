import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/Button';
import Card from '../../components/Card';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import Icon from '../../components/Icon';
import Page from '../../components/Page';
import Select from '../../components/Select';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import AnimatedNumber from '../../components/charts/AnimatedNumber';
import MotionChart from '../../components/charts/MotionChart';
import TrendChart from '../../components/charts/TrendChart';
import { formatMetric } from '../../components/charts/chartModel';
import { formatDateTime, formatNumber } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import { allowedLink } from '../../components/navigation';
import { headline, kpiGroups, motionSeries, trendCards } from './divisionDashboardModel';
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

// Dashboard divisi (migration 116): one page per division from the management
// providers — headline figures that count up, a motion chart of the last 12
// months, a trend chart per measure (with the monthly target), and the
// division's open escalations. Supervisor/Head see their division; management
// picks any division or the whole company.
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
  const trends = trendCards(data.metrics);
  const race = motionSeries(data.metrics);
  const esc = data.escalations;

  return (
    <Page
      title={`Dashboard ${data.division.name}`}
      description={`Angka utama, perjalanan 12 bulan, dan pekerjaan yang lewat tenggat. Diperbarui ${formatDateTime(data.generatedAt)}.`}
      actions={(
        <div className="div-dash__actions">
          {picker}
          <Button variant="secondary" icon="refresh" loading={loading} onClick={load}>Muat ulang</Button>
        </div>
      )}
    >
      {groups.map((g) => (
        <section key={g.provider} className="div-dash__section" aria-label={g.label}>
          <h2 className="pw-title-section">{g.label}</h2>
          <div className="div-dash__kpis">
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
        </section>
      ))}

      <Card title="Grafik capaian bulanan" subtitle={`Perjalanan capaian ${data.months[0].label} – ${data.months[data.months.length - 1].label}`}>
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

      {trends.length ? (
        <section className="div-dash__section" aria-label="Tren 12 bulan">
          <h2 className="pw-title-section">Tren 12 bulan</h2>
          <div className="div-dash__trends">
            {trends.map((m) => (
              <Card key={`${m.provider}.${m.key}`} className="div-dash__trend">
                <div className="div-dash__trend-head">
                  <span className="div-dash__trend-label">{m.label}{m.averaged ? ' · rata-rata antar divisi' : ''}{m.billedMonthly ? ' · ditagih bulanan' : ''}</span>
                  <span className="div-dash__trend-source">{m.providerLabel}</span>
                </div>
                {(() => {
                  const head = headline(m, data.months);
                  return (
                    <>
                      <div className="div-dash__trend-value">
                        <AnimatedNumber value={head.value} unit={m.unit} compact={m.unit === 'rupiah'} />
                        <Delta head={head} unit={m.unit} />
                      </div>
                      <div className="div-dash__trend-meta">
                        {[head.month, head.running !== null ? `${head.runningMonth} berjalan: ${formatMetric(head.running, m.unit, { compact: true })}` : null].filter(Boolean).join(' · ')}
                      </div>
                    </>
                  );
                })()}
                <TrendChart months={data.months} values={m.values} targets={m.targets} unit={m.unit} label={m.label} />
              </Card>
            ))}
          </div>
        </section>
      ) : (
        <EmptyState icon="monitoring" title="Belum ada tren bulanan" description="Tren 12 bulan muncul setelah modul divisi ini mencatat pekerjaan. Ukuran yang selama ini masih nol tidak ditampilkan." />
      )}

      <Card title="Lewat tenggat" subtitle={esc.total ? `${formatNumber(esc.total)} pekerjaan menunggu tindak lanjut` : 'Tidak ada yang lewat tenggat'}>
        {esc.total ? (
          <div className="div-dash__esc">
            <ul className="div-dash__esc-sources">
              {esc.bySource.map((s) => (
                <li key={s.key}>
                  <span className="div-dash__esc-label">{s.label}</span>
                  <span className="div-dash__esc-track"><span className="div-dash__esc-fill" style={{ '--share': `${(s.count / esc.bySource[0].count) * 100}%` }} /></span>
                  <span className="div-dash__esc-count">{formatNumber(s.count)}</span>
                </li>
              ))}
            </ul>
            <ul className="div-dash__esc-items">
              {esc.top.map((i) => {
                const link = allowedLink(i.link, permissions);
                const title = <span className="div-dash__esc-title" data-no-translate="">{i.title}</span>;
                return (
                  <li key={`${i.source}-${i.title}-${i.daysLate}`} className="div-dash__esc-item">
                    <span className="pw-cell">
                      {link ? <Link to={link}>{title}</Link> : title}
                      <span className="pw-cell__meta">
                        {[
                          i.sourceLabel ? <span key="source">{i.sourceLabel}</span> : null,
                          i.reference ? (i.referenceLabel ? <Translate key="reference">{i.reference}</Translate> : <NoTranslate key="reference">{i.reference}</NoTranslate>) : null,
                          i.context ? <Translate key="context" strict>{i.context}</Translate> : null,
                        ].filter(Boolean).flatMap((node, n) => (n ? [' · ', node] : [node]))}
                      </span>
                    </span>
                    <StatusBadge status={i.severity === 'high' ? 'overdue' : 'pending'} label={`${formatNumber(i.daysLate)} hari`} />
                  </li>
                );
              })}
            </ul>
            {allowedLink('/escalations', permissions) ? <Button variant="text" to="/escalations" icon="arrow_forward">Buka Pusat eskalasi</Button> : null}
          </div>
        ) : <EmptyState compact icon="task_alt" title="Semua beres" />}
      </Card>
    </Page>
  );
}
