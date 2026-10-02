import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useRealtime } from '../../api/realtime';
import Page from '../../components/Page';
import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';
import ProgressBar from '../../components/ProgressBar';
import DataGrid from '../../components/datagrid/DataGrid';
import { LiveIndicator } from './TrackerBits';
import { activeSprintOf, apiErrorMessage, debounce, spaceIdFromName, sprintProgressPct, unwrap } from './trackerModel';
import './tracker.css';
import { Translate } from '../../i18n/NoTranslate';

const projectPath = (project) => `/projects/${project.spaceId || spaceIdFromName(project.spaceName)}`;
const countOf = (project, key) => project.counts?.[key] ?? 0;

// /projects — every tracker the user can see (spaces they're a member of), as
// one list; a row opens that space's tracker.
export default function Projects() {
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: '', projects: [] });

  const load = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = unwrap(await api.get('/tracker/projects'));
      setState({ loading: false, error: '', projects: data.projects || [] });
    } catch (error) {
      if (!silent) setState({ loading: false, error: apiErrorMessage(error, 'Daftar project gagal dimuat.'), projects: [] });
    }
  }, []);

  useEffect(() => { load(false); }, [load]);
  const refresh = useMemo(() => debounce(() => load(true), 1000), [load]);
  useEffect(() => () => refresh.cancel(), [refresh]);
  useRealtime('tracker', () => refresh());

  const projects = useMemo(() => [...state.projects].sort((a, b) => String(a.name).localeCompare(String(b.name))), [state.projects]);

  const columns = useMemo(() => [
    {
      key: 'name', header: 'Project', exportValue: (p) => `${p.name} (${p.key})`,
      render: (p) => <span className="pw-cell"><span className="pw-cell__title"><Link className="pw-link" to={projectPath(p)}>{p.name}</Link></span><span className="pw-cell__meta">{p.key}{' · '}<Translate>Space Chat</Translate></span></span>,
    },
    { key: 'open', header: 'Belum selesai', type: 'number', sortValue: (p) => countOf(p, 'open'), exportValue: (p) => countOf(p, 'open'), render: (p) => countOf(p, 'open') },
    { key: 'inProgress', header: 'Dikerjakan', type: 'number', sortValue: (p) => countOf(p, 'inProgress'), exportValue: (p) => countOf(p, 'inProgress'), render: (p) => countOf(p, 'inProgress') },
    { key: 'done', header: 'Selesai', type: 'number', sortValue: (p) => countOf(p, 'done'), exportValue: (p) => countOf(p, 'done'), render: (p) => countOf(p, 'done') },
    {
      key: 'overdue', header: 'Terlambat', type: 'number', sortValue: (p) => countOf(p, 'overdue'), exportValue: (p) => countOf(p, 'overdue'),
      render: (p) => (countOf(p, 'overdue') ? <span className="tracker-overdue-num">{countOf(p, 'overdue')}</span> : 0),
    },
    {
      key: 'sprint', header: 'Sprint aktif',
      sortValue: (p) => (activeSprintOf(p) ? sprintProgressPct(activeSprintOf(p)) : -1),
      exportValue: (p) => (activeSprintOf(p) ? `${activeSprintOf(p).name} ${sprintProgressPct(activeSprintOf(p))}%` : ''),
      render: (p) => {
        const sprint = activeSprintOf(p);
        if (!sprint) return <Translate className="pw-muted">Tidak ada sprint aktif</Translate>;
        const pct = sprintProgressPct(sprint);
        return (
          <span className="tracker-sprint-cell">
            <span className="pw-cell__meta">{sprint.name}</span>
            <span className="tracker-progress-cell">
              <ProgressBar value={pct} label={`Progres ${sprint.name}`} className="tracker-progress-cell__bar" />
              <span className="tracker-progress-cell__value">{pct}%</span>
            </span>
          </span>
        );
      },
    },
  ], []);

  return (
    <Page
      title="Project Tracker"
      description="Setiap space Google Chat bisa punya project sendiri: board, backlog, sprint, dan laporan."
      actions={<LiveIndicator />}
    >
      <DataGrid
        title="Project"
        columns={columns}
        rows={projects}
        loading={state.loading}
        error={state.error}
        onRetry={() => load(false)}
        exportName="project-tracker"
        searchable={projects.length > 8}
        onRowClick={(project) => navigate(projectPath(project))}
        empty={(
          <EmptyState
            icon="view_kanban"
            title="Belum ada project"
            description="Project tinggal di dalam space Google Chat. Buka sebuah space, pilih tab “Tugas”, lalu aktifkan project tracker."
            action={<Button icon="chat" to="/chat">Buka Chat</Button>}
          />
        )}
      />
    </Page>
  );
}
