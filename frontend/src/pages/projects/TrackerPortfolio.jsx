import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { useRealtime } from '../../api/realtime';
import Card from '../../components/Card';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import ProgressBar from '../../components/ProgressBar';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import { LiveIndicator } from './TrackerBits';
import { DivisionBars, IssueDonut, TrendChart } from './PortfolioCharts';
import {
  AGING_ALERT_DAYS, apiErrorMessage, categoryStatus, clampPct, debounce, formatDate, formatDateTime,
  NO_DIVISION_LABEL, normalizePortfolio, unwrap, workloadRows,
} from './trackerModel';
import './tracker.css';
import { NoTranslate, Translate } from '../../i18n/NoTranslate';

function Progress({ pct, label }) {
  const value = clampPct(pct);
  return (
    <span className="tracker-progress-cell">
      <ProgressBar value={value} label={label} className="tracker-progress-cell__bar" />
      <span className="tracker-progress-cell__value">{value}%</span>
    </span>
  );
}

// Management dashboard: "Project Tracker · Live" — read-only portfolio across
// every project in the entity; refetches (debounced 1s) on any tracker event.
export default function TrackerPortfolio() {
  const [state, setState] = useState({ loading: true, error: '', data: normalizePortfolio(null) });

  const load = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = unwrap(await api.get('/management-dashboard/projects'));
      setState({ loading: false, error: '', data: normalizePortfolio(data) });
    } catch (error) {
      if (!silent) setState((s) => ({ ...s, loading: false, error: apiErrorMessage(error, 'Data project tracker gagal dimuat.') }));
    }
  }, []);

  useEffect(() => { load(false); }, [load]);
  const refresh = useMemo(() => debounce(() => load(true), 1000), [load]);
  useEffect(() => () => refresh.cancel(), [refresh]);
  useRealtime('tracker', () => refresh());

  const { totals, projects, workload, recent, byDivision, trend, aging, scope } = state.data;
  const people = useMemo(() => workloadRows(workload, 12), [workload]);

  const columns = useMemo(() => [
    {
      key: 'name', header: 'Project', exportValue: (r) => `${r.name} (${r.key})`,
      render: (r) => <span className="pw-cell"><span data-no-translate="" className="pw-cell__title">{r.name}</span><span className="pw-cell__meta">{r.key}</span></span>,
    },
    {
      key: 'departmentName', header: 'Divisi', translate: true,
      sortValue: (r) => r.departmentName || NO_DIVISION_LABEL,
      exportValue: (r) => r.departmentName || NO_DIVISION_LABEL,
      render: (r) => (r.departmentName ? r.departmentName : <span className="pw-muted">{NO_DIVISION_LABEL}</span>),
    },
    { key: 'open', header: 'Belum selesai', align: 'end' },
    { key: 'inProgress', header: 'Dikerjakan', align: 'end' },
    { key: 'done', header: 'Selesai', align: 'end' },
    { key: 'overdue', header: 'Terlambat', align: 'end', render: (r) => (r.overdue ? <span className="tracker-overdue-num">{r.overdue}</span> : '0') },
    {
      key: 'activeSprint', header: 'Sprint aktif', sortValue: (r) => r.activeSprint?.progressPct ?? -1,
      exportValue: (r) => (r.activeSprint ? `${r.activeSprint.name} ${clampPct(r.activeSprint.progressPct)}%` : ''),
      render: (r) => (r.activeSprint ? (
        <span className="tracker-sprint-cell">
          <span className="pw-cell__meta">{r.activeSprint.name}{r.activeSprint.endDate ? <>{' · '}<Translate>{`s.d. ${formatDate(r.activeSprint.endDate)}`}</Translate></> : ''}</span>
          <Progress pct={r.activeSprint.progressPct} label={`Progres ${r.activeSprint.name}`} />
        </span>
      ) : null),
    },
    { key: 'updatedAt', header: 'Diperbarui', type: 'datetime', sortValue: (r) => r.updatedAt || '' },
  ], []);

  const divisionColumns = useMemo(() => [
    { key: 'departmentName', header: 'Divisi', translate: true },
    { key: 'projects', header: 'Project', align: 'end' },
    { key: 'open', header: 'Belum selesai', align: 'end' },
    { key: 'inProgress', header: 'Dikerjakan', align: 'end' },
    { key: 'done', header: 'Selesai', align: 'end' },
    { key: 'overdue', header: 'Terlambat', align: 'end', render: (r) => (r.overdue ? <span className="tracker-overdue-num">{r.overdue}</span> : '0') },
  ], []);

  const kpis = [
    { label: 'Project', value: totals.projects },
    { label: 'Belum selesai', value: totals.openIssues },
    { label: 'Dikerjakan', value: totals.inProgress },
    { label: 'Selesai minggu ini', value: totals.doneThisWeek },
    { label: 'Terlambat', value: totals.overdue, alert: totals.overdue > 0, note: totals.overdue > 0 ? 'Lewat jatuh tempo' : null },
  ];

  return (
    <section className="tracker-portfolio" aria-labelledby="tracker-portfolio-title">
      <div className="pw-row pw-row--between">
        <h2 id="tracker-portfolio-title" className="pw-title-section">Portofolio project</h2>
        <LiveIndicator />
      </div>
      {!state.loading && !state.error && !scope.entityWide ? (
        <Banner tone="info">
          {scope.departmentName ? `Hanya divisi ${scope.departmentName}` : 'Tampilan dibatasi pada divisi Anda.'}
        </Banner>
      ) : null}
      {state.loading ? <LoadingState label="Memuat project tracker…" compact /> : null}
      {!state.loading && state.error ? (
        <EmptyState tone="error" title="Project tracker gagal dimuat" description={state.error} action={<Button variant="secondary" onClick={() => load(false)}>Coba lagi</Button>} />
      ) : null}
      {!state.loading && !state.error ? (
        <>
          <div className="tracker-stats">
            {kpis.map((k) => <StatCard key={k.label} label={k.label} value={k.value ?? 0} alert={k.alert} note={k.note} />)}
          </div>
          {/* Shape before detail: the composition and the division comparison sit
              directly under the KPI strip, the tables below keep the exact figures. */}
          <div className="pw-cols-2 tracker-cards">
            <Card title="Komposisi issue" variant="chart" className="tracker-chart-card">
              <IssueDonut totals={totals} projects={projects} />
            </Card>
            <Card title="Perbandingan divisi" variant="chart" className="tracker-chart-card">
              <DivisionBars rows={byDivision} />
            </Card>
          </div>
          <DataGrid title="Project" columns={columns} rows={projects} idKey="projectId" empty="Belum ada project tracker." searchable={projects.length > 8} exportName="project-tracker" pageSize={10} />
          <div className="pw-cols-2 tracker-cards">
            <Card title="Beban kerja per orang">
              {people.length ? (
                <>
                  {/* Stacked: the overdue part of the same workload, never a second
                      row. Both numbers are printed, so the colours only confirm. */}
                  <ul className="tracker-share" aria-label="Issue terbuka per orang">
                    {people.map((w) => (
                      <li key={w.key} className="tracker-share__row">
                        <span data-no-translate="" className="tracker-share__label">{w.name}</span>
                        <ProgressBar
                          value={w.onTimePct + w.overduePct}
                          tone={w.overdue ? 'error' : 'default'}
                          label={`${w.name}: ${w.open} terbuka${w.overdue ? `, ${w.overdue} terlambat` : ''}`}
                          className="tracker-share__bar"
                        />
                        <span className="tracker-share__value">
                          {w.open} terbuka{w.overdue ? <span className="tracker-overdue-num"> · {w.overdue} terlambat</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="pw-text-helper">Batang merah: orang itu punya issue yang terlambat.</p>
                </>
              ) : <EmptyState compact icon="group" description="Belum ada issue yang ditugaskan." />}
            </Card>
            <Card title="Pembaruan terbaru">
              {recent.length ? (
                <ul className="tracker-recent">
                  {recent.slice(0, 10).map((r) => (
                    <li key={`${r.issueKey}-${r.updatedAt}`}>
                      <div className="tracker-recent__main">
                        <span className="tracker-key" data-no-translate="">{r.issueKey}</span>
                        <span data-no-translate="" className="tracker-recent__title">{r.title}</span>
                      </div>
                      <div className="tracker-recent__meta">
                        <StatusBadge status={categoryStatus(r.category)} label={r.statusName ? <NoTranslate>{r.statusName}</NoTranslate> : undefined} />
                        <span data-no-translate="">{r.projectName}</span>
                        {r.assigneeName ? <span data-no-translate="">· {r.assigneeName}</span> : null}
                        <span>· {formatDateTime(r.updatedAt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState compact icon="history" description="Belum ada aktivitas." />}
            </Card>
          </div>
          {/* Six numeric columns do not fit a half-width card — at 1440px the
              "Terlambat" column fell behind a horizontal scroll, which is the
              one figure management looks for. Give the table the full row. */}
          <DataGrid
            title="Per divisi"
            columns={divisionColumns}
            rows={byDivision}
            idKey="departmentId"
            empty="Belum ada project per divisi."
            searchable={false}
            exportName="project-tracker-divisi"
            pageSize={10}
          />
          <Card title="Tren 8 minggu" variant="chart" className="tracker-chart-card">
            <TrendChart weeks={trend} />
          </Card>
          <Card title="Paling lama tidak tersentuh">
            {aging.length ? (
              <ul className="tracker-recent">
                {aging.slice(0, 10).map((a) => (
                  <li key={a.issueId}>
                    <div className="tracker-recent__main">
                      <span className="tracker-key" data-no-translate="">{a.issueKey}</span>
                      <span data-no-translate="" className="tracker-recent__title">{a.title}</span>
                    </div>
                    <div className="tracker-recent__meta">
                      <StatusBadge status={categoryStatus(a.category)} label={a.statusName ? <NoTranslate>{a.statusName}</NoTranslate> : undefined} />
                      <span data-no-translate="">{a.projectName}</span>
                      <span>· <span data-no-translate={a.assigneeName ? '' : undefined}>{a.assigneeName || 'Belum ditugaskan'}</span></span>
                      <span className={a.daysSinceUpdate >= AGING_ALERT_DAYS ? 'tracker-overdue-num' : undefined}>
                        · {a.daysSinceUpdate} hari
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="task_alt" description="Semua issue tersentuh dalam waktu dekat." />}
          </Card>
        </>
      ) : null}
    </section>
  );
}
