import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { useRealtime } from '../../api/realtime';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Page from '../../components/Page';
import Segmented from '../../components/Segmented';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import GanttChart from '../../components/gantt/GanttChart';
import GanttLegend from '../../components/gantt/GanttLegend';
import GanttListView from '../../components/gantt/GanttListView';
import GanttToolbar from '../../components/gantt/GanttToolbar';
import { apiErrorMessage, debounce, unwrap } from '../projects/trackerModel';
import {
  divisionLabel, divisionSummary, groupByDivision, initialView, normalizeRoadmap, readRoadmapParams,
  readStoredView, roadmapQuery, taskTarget, toGanttTasks, writeRoadmapParams, writeStoredView,
} from './roadmapModel';
import './roadmap.css';

const VIEW_OPTIONS = [
  { value: 'timeline', label: 'Linimasa', icon: 'view_timeline' },
  { value: 'list', label: 'Daftar', icon: 'view_list' },
];

// The phone breakpoint of docs/ui-guideline.md §1.9.
const PHONE_QUERY = '(max-width: 600px)';

function isPhone() {
  try {
    return Boolean(globalThis.matchMedia?.(PHONE_QUERY)?.matches);
  } catch {
    return false;
  }
}

const storage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

// Every division's Project Tracker work on one shared time axis, so management can
// see what runs when, what overlaps and what has slipped without opening each
// project. GanttChart takes a flat task list, so the divisions are separated into
// one labelled section each — every section draws the SAME range and zoom, which
// keeps the axis (and the "today" marker) in the same place in all of them.
export default function Roadmap() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { from, to, zoom } = readRoadmapParams(params);

  const [state, setState] = useState({ loading: true, error: '', code: '', data: normalizeRoadmap(null) });
  const [view, setView] = useState(() => initialView({ stored: readStoredView(storage()), isPhone: isPhone() }));

  const load = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true, error: '', code: '' }));
    try {
      const data = unwrap(await api.get('/management-dashboard/roadmap', { params: roadmapQuery({ from, to }) }));
      setState({ loading: false, error: '', code: '', data: normalizeRoadmap(data) });
    } catch (error) {
      // A background refetch that fails keeps the last good roadmap on screen —
      // only an explicit load reports the failure.
      if (silent) return;
      setState((s) => ({
        ...s,
        loading: false,
        code: error?.response?.data?.error?.code || '',
        error: apiErrorMessage(error, 'Peta program gagal dimuat.'),
      }));
    }
  }, [from, to]);

  useEffect(() => { load(false); }, [load]);
  const refresh = useMemo(() => debounce(() => load(true), 1000), [load]);
  useEffect(() => () => refresh.cancel(), [refresh]);
  useRealtime('tracker', () => refresh());

  const { scope, items, links } = state.data;
  // Without both params the server picks the window and echoes it back, so the
  // range drawn is always the one the data was built for.
  const range = from && to ? { from, to } : state.data.range;

  // The date fields are edited freely, and only a complete, ordered window reaches
  // the URL — otherwise setting "Dari" past the current "Sampai" would snap back
  // before the user could fix the other end.
  const [dateWindow, setDateWindow] = useState(range);
  useEffect(() => { setDateWindow({ from: range.from, to: range.to }); }, [range.from, range.to]);

  const onFilterChange = (next) => {
    setDateWindow({ from: next.from, to: next.to });
    setParams(writeRoadmapParams(params, { from: next.from, to: next.to }), { replace: true });
  };
  const onZoomChange = (value) => setParams(writeRoadmapParams(params, { zoom: value }), { replace: true });

  const chooseView = (value) => {
    setView(value);
    writeStoredView(storage(), value);
  };

  const groups = useMemo(
    () => groupByDivision(items).map((group) => ({ ...group, tasks: toGanttTasks(group.items) })),
    [items],
  );
  // A sprint has no page of its own, so its row opens the project that owns it;
  // a row whose project has no Chat Space simply does not navigate.
  const openTask = useCallback((id) => {
    const target = taskTarget(items, id);
    if (target) navigate(target);
  }, [items, navigate]);
  const canOpenTask = useCallback((id) => Boolean(taskTarget(items, id)), [items]);

  const noDepartment = state.code === 'NO_DEPARTMENT';
  // The controls stay mounted while a refetch runs — the date fields are how the
  // user asked for that refetch, and pulling them out from under a half-typed
  // window would lose the edit.
  const showControls = !noDepartment && !state.error;
  const ready = showControls && !state.loading;

  return (
    <Page
      title="Peta program"
      description="Semua project Project Tracker dari setiap divisi dalam satu linimasa — supaya terlihat apa yang sedang berjalan, mana yang jadwalnya bertabrakan, dan mana yang sudah lewat tenggat."
      actions={(
        <Button variant="secondary" type="button" icon="refresh" onClick={() => load(false)} loading={state.loading}>
          Muat ulang
        </Button>
      )}
    >
      {noDepartment ? (
        // A 403 NO_DEPARTMENT is an account-setup problem, not a transient failure:
        // "Coba lagi" would never help, so it gets an explanation instead.
        <EmptyState
          icon="domain"
          title="Akun Anda belum terhubung ke divisi"
          description="Peta Program menampilkan project per divisi, jadi akun Anda perlu terdaftar pada salah satu divisi. Hubungi admin untuk menautkannya."
        />
      ) : null}

      {!noDepartment && state.error ? (
        <EmptyState
          tone="error"
          title="Peta program gagal dimuat"
          description={state.error}
          action={<Button variant="secondary" type="button" onClick={() => load(false)}>Coba lagi</Button>}
        />
      ) : null}

      {!noDepartment && !state.error && !scope.entityWide ? (
        <Banner tone="info">
          {scope.departmentName ? `Hanya divisi ${scope.departmentName}` : 'Tampilan dibatasi pada divisi Anda.'}
        </Banner>
      ) : null}

      {showControls ? (
        <div className="pw-stack">
          <GanttToolbar
            filters={{ from: dateWindow.from, to: dateWindow.to }}
            onChange={onFilterChange}
            loading={state.loading}
            zoom={zoom}
            onZoomChange={view === 'timeline' ? onZoomChange : undefined}
          >
            <Segmented options={VIEW_OPTIONS} value={view} onChange={chooseView} label="Tampilan peta" />
          </GanttToolbar>
          <div className="pw-stack pw-stack--sm">
            {view === 'timeline' ? (
              <GanttLegend statuses={['open', 'in_progress', 'done']} showLinks={links.length > 0} />
            ) : null}
            <p className="pw-text-helper roadmap-note">
              Bar bertanda estimasi memakai tanggal yang disimpulkan dari issue di dalamnya — bukan tanggal yang direncanakan.
            </p>
          </div>
        </div>
      ) : null}

      {state.loading ? <LoadingState label="Memuat peta program…" /> : null}

      {ready ? (
        <>
          {groups.length === 0 ? (
            <EmptyState
              icon="date_range"
              title="Belum ada project untuk dipetakan"
              description="Belum ada project atau sprint dengan tanggal pada rentang ini. Ubah rentang tanggalnya, atau mulai dari Project Tracker."
              action={<Button variant="secondary" to="/projects">Buka project tracker</Button>}
            />
          ) : null}

          {groups.map((group) => (
            <Card
              key={group.key}
              variant="panel"
              size="sm"
              title={divisionLabel(group)}
              actions={<span className="pw-text-helper">{divisionSummary(group)}</span>}
              noPadding
            >
              {view === 'timeline' ? (
                <GanttChart
                  tasks={group.tasks}
                  links={links}
                  range={range}
                  zoom={zoom}
                  onTaskClick={openTask}
                  canOpenTask={canOpenTask}
                  sideLabel="Program"
                />
              ) : (
                <GanttListView tasks={group.tasks} onTaskClick={openTask} canOpenTask={canOpenTask} />
              )}
            </Card>
          ))}
        </>
      ) : null}
    </Page>
  );
}
