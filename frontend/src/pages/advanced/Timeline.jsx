import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GanttChart, List } from 'lucide-react';
import api from '../../api/client';
import Card from '../../components/Card';
import Badge from '../../components/Badge';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import GanttChartCore from '../../components/gantt/GanttChart';
import GanttToolbar from '../../components/gantt/GanttToolbar';
import GanttLegend from '../../components/gantt/GanttLegend';
import GanttListView from '../../components/gantt/GanttListView';
import DependencyGraphModal from '../../components/gantt/DependencyGraphModal';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function addDaysIso(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function useBreakpoint() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1280);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return { isMobile: width < 700 };
}

export default function Timeline() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { isMobile } = useBreakpoint();

  const canCrossEntity = (user?.permissions || []).includes('entity.cross_access');
  const canViewTask = (user?.permissions || []).includes('task.view');

  const [tab, setTab] = useState('gantt'); // 'gantt' | 'activity'
  const [zoom, setZoom] = useState('week');
  const [filters, setFilters] = useState({
    from: addDaysIso(todayIso(), -90),
    to: addDaysIso(todayIso(), 90),
    entityId: '',
    departmentId: '',
    boardId: '',
  });

  const [ganttData, setGanttData] = useState(null);
  const [ganttLoading, setGanttLoading] = useState(false);
  const [ganttError, setGanttError] = useState(null);

  const [activityData, setActivityData] = useState(null);
  const [activityMeta, setActivityMeta] = useState(null);
  const [activityLoading, setActivityLoading] = useState(false);

  const [graphTaskId, setGraphTaskId] = useState(null);

  /* ----------------------------------------------------------
     Gantt fetch
     ---------------------------------------------------------- */
  const loadGantt = useCallback(async () => {
    if (!filters.from || !filters.to) {
      setGanttError('Rentang tanggal wajib diisi');
      return;
    }
    if (filters.from > filters.to) {
      setGanttError('Tanggal "dari" harus ≤ "sampai"');
      return;
    }
    setGanttLoading(true);
    setGanttError(null);
    try {
      const params = { from: filters.from, to: filters.to };
      if (filters.entityId) params.entityId = filters.entityId;
      if (filters.departmentId) params.departmentId = filters.departmentId;
      if (filters.boardId) params.boardId = filters.boardId;

      const r = await api.get('/timeline/gantt', { params });
      setGanttData({
        tasks: r.data.data?.tasks || [],
        links: r.data.data?.links || [],
        meta: r.data.meta || {},
      });
    } catch (e) {
      const status = e.response?.status;
      const code = e.response?.data?.error?.code;
      if (status === 403) setGanttError('Anda tidak memiliki akses ke timeline entity ini.');
      else if (code === 'VALIDATION_ERROR') setGanttError(e.response?.data?.error?.message || 'Parameter tidak valid.');
      else setGanttError(e.response?.data?.error?.message || 'Gagal memuat Gantt.');
      setGanttData(null);
    } finally {
      setGanttLoading(false);
    }
  }, [filters]);

  useEffect(() => { if (tab === 'gantt') loadGantt(); /* eslint-disable-next-line */ }, [tab, filters]);

  /* ----------------------------------------------------------
     Activity timeline fetch (legacy Fase 8 view)
     ---------------------------------------------------------- */
  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const params = { from: filters.from, to: filters.to };
      if (filters.entityId) params.entityId = filters.entityId;
      const r = await api.get('/timeline', { params });
      setActivityData(r.data.data);
      setActivityMeta(r.data.meta || null);
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal memuat timeline aktivitas', 'error');
    } finally {
      setActivityLoading(false);
    }
  }, [filters.from, filters.to, filters.entityId]);

  useEffect(() => { if (tab === 'activity') loadActivity(); /* eslint-disable-next-line */ }, [tab]);

  const openTask = (id) => nav(`/tasks/${id}`);

  const filterSummary = useMemo(() => {
    if (!ganttData) return '';
    return `${ganttData.tasks.length} task · ${ganttData.links.length} dependency`;
  }, [ganttData]);

  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8,
      }}>
        <h2 style={{ margin: 0 }}>Timeline & Gantt</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={() => setTab('gantt')}
            style={tabStyle(tab === 'gantt')}
          >
            <GanttChart size={14} /> Gantt
          </button>
          <button
            type="button"
            onClick={() => setTab('activity')}
            style={tabStyle(tab === 'activity')}
          >
            <List size={14} /> Timeline Aktivitas
          </button>
        </div>
      </div>

      {tab === 'gantt' && (
        <>
          <Card noPadding>
            <GanttToolbar
              filters={filters}
              onChange={setFilters}
              onRefresh={loadGantt}
              loading={ganttLoading}
              canCrossEntity={canCrossEntity}
              zoom={zoom}
              onZoomChange={setZoom}
            />

            {ganttError && (
              <div style={{
                padding: 16, fontSize: 13, color: 'var(--color-error)',
                boxShadow: 'inset 0 -1px 0 0 var(--color-border)',
              }}>
                {ganttError}
              </div>
            )}

            {ganttLoading && (
              <div style={{ padding: 16 }}>
                <SkeletonCard lines={6} />
              </div>
            )}

            {!ganttLoading && !ganttError && ganttData && ganttData.tasks.length > 0 && (
              isMobile ? (
                <GanttListView
                  tasks={ganttData.tasks}
                  onTaskClick={openTask}
                  onGraphClick={canViewTask ? setGraphTaskId : undefined}
                />
              ) : (
                <GanttChartCore
                  tasks={ganttData.tasks}
                  links={ganttData.links}
                  range={{ from: filters.from, to: filters.to }}
                  zoom={zoom}
                  onTaskClick={openTask}
                  onGraphClick={canViewTask ? setGraphTaskId : undefined}
                />
              )
            )}

            {!ganttLoading && !ganttError && ganttData && ganttData.tasks.length === 0 && (
              <div style={{
                padding: 40, textAlign: 'center',
                color: 'var(--color-text-muted)', fontSize: 13,
              }}>
                Tidak ada task pada rentang tanggal ini.
                {ganttData.meta?.truncated && (
                  <div style={{ marginTop: 4, fontSize: 11 }}>
                    Hasil dibatasi — perbaiki filter untuk melihat lebih spesifik.
                  </div>
                )}
              </div>
            )}

            {ganttData && ganttData.tasks.length > 0 && <GanttLegend />}
          </Card>

          {filterSummary && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
              {filterSummary}
              {ganttData?.meta?.truncated && <> · <Badge tone="warning">truncated</Badge></>}
            </div>
          )}
        </>
      )}

      {tab === 'activity' && (
        <Card title="Timeline Aktivitas">
          {activityMeta?.truncated && (
            <div style={{
              padding: '8px 12px',
              background: '#fffbeb',
              boxShadow: 'inset 0 -1px 0 0 #fde68a',
              color: '#92400e', fontSize: 12,
            }}>
              Sebagian data terpotong pada modul: {activityMeta.truncatedModules.join(', ')}.
              {' '}Persempit rentang tanggal untuk melihat data lebih spesifik.
            </div>
          )}
          {activityLoading && <div style={{ padding: 16 }}><SkeletonCard lines={5} /></div>}
          {!activityLoading && !activityData?.items?.length && (
            <div style={{
              padding: 24, textAlign: 'center',
              color: 'var(--color-text-muted)', fontSize: 13,
            }}>
              Tidak ada aktivitas pada rentang ini.
            </div>
          )}
          {!activityLoading && activityData?.items?.length > 0 && (
            <div>
              {activityData.items
                .sort((a, b) => new Date(a.date) - new Date(b.date))
                .map((item, i) => (
                  <div key={i} style={{
                    display: 'grid',
                    gridTemplateColumns: '100px 100px 1fr auto',
                    gap: 12, padding: 8, alignItems: 'center',
                    boxShadow: 'inset 0 -1px 0 0 var(--color-border)', fontSize: 13,
                  }}>
                    <div style={{ fontWeight: 600 }}>{String(item.date).slice(0, 10)}</div>
                    <Badge tone={
                      item.type === 'task' ? 'info'
                      : item.type === 'meeting' ? 'warning'
                      : item.type === 'approval' ? 'warning'
                      : item.type === 'finance' ? 'success'
                      : item.type === 'hrga' ? 'info' : 'default'
                    }>{item.type}</Badge>
                    <div>{item.label}</div>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.status}</div>
                  </div>
                ))}
            </div>
          )}
        </Card>
      )}

      {graphTaskId && (
        <DependencyGraphModal
          taskId={graphTaskId}
          onClose={() => setGraphTaskId(null)}
        />
      )}
    </div>
  );
}

function tabStyle(active) {
  return {
    padding: '6px 12px', fontSize: 13,
    boxShadow: `inset 0 0 0 1px ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
    borderRadius: 8,
    background: active ? 'rgba(31,78,216,.08)' : 'transparent',
    color: active ? 'var(--color-primary)' : 'var(--color-text)',
    cursor: 'pointer', font: 'inherit',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  };
}