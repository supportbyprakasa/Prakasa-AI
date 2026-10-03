import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useRealtime } from '../../api/realtime';
import ActionMenu from '../../components/ActionMenu';
import Badge from '../../components/Badge';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import Segmented from '../../components/Segmented';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import { toast } from '../../components/Toast';
import { LiveIndicator } from './TrackerBits';
import TrackerFilters from './TrackerFilters';
import TrackerBoard from './TrackerBoard';
import TrackerBacklog from './TrackerBacklog';
import TrackerIssueList from './TrackerIssueList';
import TrackerReports from './TrackerReports';
import IssueDrawer from './IssueDrawer';
import CreateIssueModal from './CreateIssueModal';
import SprintDialog from './SprintDialog';
import DivisionDialog from './DivisionDialog';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import {
  SPACE_ID_RE, VIEWS, allLabels, apiErrorMessage, apiPatch, applyIssuePatch, computeMove, debounce,
  deriveProjectKey, hasActiveFilters, isChatSpace, issueQuery, normalizeKeyInput, readTrackerParams, validateProjectKey,
  writeTrackerParams, unwrap, enableProjectBody, ticketSyncMessage,
} from './trackerModel';
import './tracker.css';

// The page's dialogs. The comment box of the issue drawer is not one of them:
// an unsaved comment does not stop a dialog from opening (useOpenFromUrl keepUnsaved).
const TRACKER_DIALOG_FORMS = ['tracker-issue', 'tracker-sprint', 'tracker-sprint-edit', 'tracker-project-division'];

function EnableTracker({ spaceId, spaceName, onEnabled }) {
  const [key, setKey] = useState(() => deriveProjectKey(spaceName));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [postUpdates, setPostUpdates] = useState(true);
  useEffect(() => { setKey(deriveProjectKey(spaceName)); }, [spaceName]);
  const submit = async (event) => {
    event.preventDefault();
    const problem = validateProjectKey(key);
    setError(problem);
    if (problem) return;
    setSaving(true);
    try {
      const data = unwrap(await api.post(`/tracker/spaces/${spaceId}/project`, enableProjectBody(key, postUpdates)));
      toast('Project tracker aktif', 'success');
      onEnabled(data.project);
    } catch (err) {
      setError(apiErrorMessage(err, 'Project tracker gagal diaktifkan.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <EmptyState
      icon="view_kanban"
      title="Project tracker belum aktif"
      description={`Kelola tugas ${spaceName ? `“${spaceName}”` : 'space ini'} ala Jira: board, backlog, sprint, dan laporan. Hanya anggota space yang bisa melihatnya.`}
      action={(
        <form className="tracker-enable" onSubmit={submit} noValidate>
          <Input
            label="Kunci project"
            value={key}
            onChange={(e) => { setKey(normalizeKeyInput(e.target.value)); setError(''); }}
            hint="2–10 huruf kapital/angka. Dipakai sebagai awalan issue, mis. KEY-12."
            error={error}
            maxLength={10}
            required
          />
          <Checkbox
            checked={postUpdates}
            onChange={(e) => setPostUpdates(e.target.checked)}
            label={(
              <span className="pw-cell">
                <span>Kirim update ke space</span>
                <span className="pw-cell__meta">Issue baru, penugasan, dan perubahan status diumumkan di chat space.</span>
              </span>
            )}
          />
          <Button type="submit" loading={saving}>Aktifkan project tracker</Button>
        </form>
      )}
    />
  );
}

/**
 * Jira-like tracker for one Google Chat space.
 * embedded=true: rendered inside Chat's "Tugas" tab (compact header, prefixed URL params).
 * onLoaded({ name, key, enabled }) lets a host page title itself.
 */
export default function ProjectTracker({ spaceId, spaceDisplayName, embedded = false, onLoaded }) {
  const { user } = useAuth();
  const me = useMemo(() => (user ? { email: user.email, name: user.name, userId: user.id } : null), [user]);
  const [searchParams, setSearchParams] = useSearchParams();
  const { view, issue: openIssueId, filters } = useMemo(() => readTrackerParams(searchParams, embedded), [searchParams, embedded]);
  const filtersKey = JSON.stringify(filters);
  const validSpace = SPACE_ID_RE.test(spaceId || '');

  const [projState, setProjState] = useState({ loading: true, error: '', enabled: false, project: null, space: null });
  const [issuesState, setIssuesState] = useState({ loading: true, error: '', issues: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const [createDefaults, setCreateDefaults] = useState(null);
  const [sprintDialog, setSprintDialog] = useState(null);
  const [divisionOpen, setDivisionOpen] = useState(false);
  const project = projState.project;
  const projectId = project?.id || null;
  const issues = issuesState.issues;
  const issueSeq = useRef(0);

  const updateParams = useCallback((patch) => {
    setSearchParams((current) => writeTrackerParams(current, patch, embedded), { replace: true });
  }, [setSearchParams, embedded]);
  const issueSearch = useCallback((id) => `?${writeTrackerParams(searchParams, { issue: id }, embedded).toString()}`, [searchParams, embedded]);
  const openIssue = useCallback((id) => updateParams({ issue: id }), [updateParams]);
  const closeIssue = useCallback(() => updateParams({ issue: null }), [updateParams]);

  // Dialogs that open by URL on the project's own page (a link, or Prakasa
  // AI's buka_halaman): ?baru=1 a new issue, ?baru=sprint a new sprint,
  // ?ubah=<id sprint> a planned or active sprint, ?form=divisi the division.
  const urlOpens = Boolean(project) && !embedded;
  useOpenFromUrl('baru', (kind) => {
    if (kind === 'sprint') setSprintDialog({ mode: 'create' });
    else setCreateDefaults({});
  }, { enabled: urlOpens, keepUnsaved: TRACKER_DIALOG_FORMS });
  useOpenFromUrl('ubah', (id) => {
    const sprint = (project?.sprints || []).find((item) => String(item.id) === String(id) && item.status !== 'completed');
    if (sprint) setSprintDialog({ mode: 'edit', sprint });
  }, { enabled: urlOpens, keepUnsaved: TRACKER_DIALOG_FORMS });
  useOpenFromUrl('form', (name) => { if (name === 'divisi') setDivisionOpen(true); }, { enabled: urlOpens, keepUnsaved: TRACKER_DIALOG_FORMS });

  const loadProject = useCallback(async (silent = false) => {
    if (!validSpace) return;
    if (!silent) setProjState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = unwrap(await api.get(`/tracker/spaces/${spaceId}/project`));
      setProjState({ loading: false, error: '', enabled: Boolean(data.enabled), project: data.enabled ? data.project : null, space: data.space || null });
    } catch (error) {
      if (silent) return;
      const status = error?.response?.status;
      const message = status === 403
        ? 'Anda bukan anggota space ini, jadi project-nya tidak bisa dibuka.'
        : status === 404 ? 'Space tidak ditemukan.' : apiErrorMessage(error, 'Project gagal dimuat.');
      setProjState({ loading: false, error: message, enabled: false, project: null, space: null });
    }
  }, [spaceId, validSpace]);

  const loadIssues = useCallback(async (silent = false) => {
    if (!projectId) return;
    const seq = ++issueSeq.current;
    if (!silent) setIssuesState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = unwrap(await api.get(`/tracker/projects/${projectId}/issues`, { params: issueQuery(JSON.parse(filtersKey), 'all') }));
      if (seq === issueSeq.current) setIssuesState({ loading: false, error: '', issues: data.issues || [] });
    } catch (error) {
      if (seq !== issueSeq.current || silent) return;
      setIssuesState({ loading: false, error: apiErrorMessage(error, 'Issue gagal dimuat.'), issues: [] });
    }
  }, [projectId, filtersKey]);

  useEffect(() => { loadProject(false); }, [loadProject]);
  useEffect(() => { loadIssues(false); }, [loadIssues]);

  useEffect(() => {
    if (projState.loading) return;
    onLoaded?.({
      enabled: projState.enabled,
      name: project?.name || projState.space?.displayName || spaceDisplayName || '',
      key: project?.key || '',
    });
  }, [projState.loading, projState.enabled, project?.name, project?.key, projState.space?.displayName, spaceDisplayName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: anyone's change to this project → refetch what we show (debounced 300ms).
  const refreshRef = useRef(() => {});
  refreshRef.current = () => { loadProject(true); loadIssues(true); setReloadKey((k) => k + 1); };
  const scheduleRefresh = useMemo(() => debounce(() => refreshRef.current(), 300), []);
  useEffect(() => () => scheduleRefresh.cancel(), [scheduleRefresh]);
  useRealtime('tracker', (data, meta) => {
    if (!projectId) return;
    if (meta?.resync || Number(data?.projectId) === projectId) scheduleRefresh();
  });

  const patchIssue = useCallback(async (issue, patch) => {
    setIssuesState((s) => {
      let next = applyIssuePatch(s.issues, issue.id, patch, project?.columns);
      if (patch.position !== undefined && patch.columnId !== undefined) {
        // Re-number the target column locally so the card lands where it was dropped.
        const column = next.filter((i) => i.columnId === patch.columnId && i.id !== issue.id).sort((a, b) => a.position - b.position || a.id - b.id);
        const beforeId = column[patch.position]?.id ?? null;
        const { order } = computeMove([...column, next.find((i) => i.id === issue.id)], issue.id, beforeId);
        const rank = new Map(order.map((id, index) => [id, index]));
        next = next.map((i) => (rank.has(i.id) ? { ...i, position: rank.get(i.id) } : i));
      }
      return { ...s, issues: next };
    });
    try {
      const data = unwrap(await api.patch(`/tracker/issues/${issue.id}`, apiPatch(patch)));
      if (data?.issue) setIssuesState((s) => ({ ...s, issues: s.issues.map((i) => (i.id === issue.id ? { ...i, ...data.issue } : i)) }));
      const sync = ticketSyncMessage(data?.ticketSync);
      if (sync) toast(sync.text, sync.tone);
      scheduleRefresh();
      return data?.issue || { ...issue, ...patch };
    } catch (error) {
      toast(apiErrorMessage(error, 'Perubahan gagal disimpan.'), 'error');
      loadIssues(true);
      return null;
    }
  }, [project?.columns, scheduleRefresh, loadIssues]);

  const moveToSprint = useCallback((issue, sprintId) => {
    patchIssue(issue, { sprintId }).then((ok) => { if (ok) toast(`${issue.key} dipindahkan`, 'success'); });
  }, [patchIssue]);

  const togglePostUpdates = async () => {
    const next = !project.postUpdatesToSpace;
    try {
      const data = unwrap(await api.patch(`/tracker/projects/${project.id}`, { postUpdatesToSpace: next }));
      setProjState((s) => ({ ...s, project: { ...s.project, ...(data.project || { postUpdatesToSpace: next }) } }));
      toast(next ? 'Update issue akan dikirim ke space' : 'Update issue tidak dikirim ke space', 'success');
    } catch (error) {
      toast(apiErrorMessage(error, 'Pengaturan gagal disimpan.'), 'error');
    }
  };

  const labels = useMemo(() => allLabels(issues), [issues]);
  const filtered = hasActiveFilters(filters);

  if (!validSpace) return <EmptyState tone="error" title="Space tidak valid" description="Alamat project tidak dikenali." />;
  if (projState.loading) return <LoadingState label="Memuat project…" />;
  if (projState.error) {
    return <EmptyState tone="error" title="Project tidak bisa dibuka" description={projState.error} action={<Button variant="secondary" onClick={() => loadProject(false)}>Coba lagi</Button>} />;
  }
  if (!projState.enabled && !isChatSpace(projState.space)) {
    return (
      <div className={`tracker${embedded ? ' tracker--embedded' : ''}`}>
        <EmptyState
          icon="view_kanban"
          title="Project tracker hanya untuk space"
          description="Chat langsung dan grup chat tidak bisa punya project. Buat atau buka sebuah space untuk mengelola tugas tim."
        />
      </div>
    );
  }
  if (!projState.enabled || !project) {
    return (
      <div className={`tracker${embedded ? ' tracker--embedded' : ''}`}>
        <EnableTracker
          spaceId={spaceId}
          spaceName={projState.space?.displayName || spaceDisplayName || ''}
          onEnabled={(p) => setProjState({ loading: false, error: '', enabled: true, project: p, space: null })}
        />
      </div>
    );
  }

  const menuItems = [
    { label: 'Buat sprint', icon: 'view_kanban', onClick: () => setSprintDialog({ mode: 'create' }) },
    { label: 'Divisi project', icon: 'domain', onClick: () => setDivisionOpen(true) },
    project.postUpdatesToSpace
      ? { label: 'Jangan kirim update ke space', icon: 'notifications_off', onClick: togglePostUpdates }
      : { label: 'Kirim update ke space', icon: 'notifications', onClick: togglePostUpdates },
  ];

  let body;
  if (issuesState.error) {
    body = <EmptyState tone="error" title="Issue gagal dimuat" description={issuesState.error} action={<Button variant="secondary" onClick={() => loadIssues(false)}>Coba lagi</Button>} />;
  } else if (view === 'reports') {
    body = <TrackerReports projectId={project.id} reloadKey={reloadKey} />;
  } else if (view === 'list') {
    body = <TrackerIssueList project={project} issues={issues} loading={issuesState.loading} onOpen={openIssue} projectKey={project.key} />;
  } else if (issuesState.loading && !issues.length) {
    body = <LoadingState label="Memuat issue…" />;
  } else if (view === 'backlog') {
    body = (
      <TrackerBacklog
        project={project}
        issues={issues}
        issueSearch={issueSearch}
        onOpen={openIssue}
        onMoveSprint={moveToSprint}
        onCreate={(defaults) => setCreateDefaults(defaults)}
        onSprintAction={(mode, sprint) => setSprintDialog({ mode, sprint })}
      />
    );
  } else {
    body = (
      <TrackerBoard
        project={project}
        issues={issues}
        issueSearch={issueSearch}
        filtered={filtered}
        onOpen={openIssue}
        onMove={(issue, patch) => patchIssue(issue, patch)}
        onCreate={(defaults) => setCreateDefaults(defaults)}
        onPlanSprint={() => updateParams({ view: 'backlog' })}
      />
    );
  }

  return (
    <div className={`tracker${embedded ? ' tracker--embedded' : ''}`}>
      <div className="tracker-bar">
        {embedded ? (
          <div className="tracker-bar__title">
            <span data-no-translate="" className="tracker-bar__name">{project.name}</span>
            <Badge><span data-no-translate="">{project.key}</span></Badge>
          </div>
        ) : null}
        <Segmented
          label="Tampilan"
          className="tracker-views"
          value={view}
          options={VIEWS.map((v) => ({ value: v.value, label: v.label }))}
          onChange={(value) => updateParams({ view: value })}
        />
        <span className="pw-grow" />
        <LiveIndicator />
        <Button icon="add" onClick={() => setCreateDefaults({})}>Buat issue</Button>
        <ActionMenu label="Pengaturan project" items={menuItems} />
        {embedded ? (
          <IconButton label="Buka layar penuh" icon="open_in_full" to={`/projects/${spaceId}`} />
        ) : null}
      </div>

      {view !== 'reports' ? (
        <TrackerFilters filters={filters} members={project.membersAvailable === false ? [] : project.members} labels={labels} onChange={updateParams} compact={embedded} />
      ) : null}
      {project.membersAvailable === false ? (
        <Banner tone="warning">Daftar anggota space tidak bisa dimuat saat ini, jadi issue hanya bisa ditugaskan ke Anda sendiri.</Banner>
      ) : null}

      <div className="tracker-body">{body}</div>

      <IssueDrawer
        open={Boolean(openIssueId)}
        issueId={openIssueId}
        project={project}
        issues={issues}
        spaceId={spaceId}
        reloadKey={reloadKey}
        issueSearch={issueSearch}
        onClose={closeIssue}
        me={me}
        onPatch={patchIssue}
        onDeleted={(id) => {
          setIssuesState((s) => ({ ...s, issues: s.issues.filter((i) => i.id !== id) }));
          closeIssue();
          scheduleRefresh();
        }}
        onCreateChild={(parent) => setCreateDefaults({ parentId: String(parent.id), type: parent.type === 'epic' ? 'story' : 'subtask', sprintId: parent.sprintId ? String(parent.sprintId) : '' })}
      />

      <CreateIssueModal
        open={createDefaults !== null}
        onClose={() => setCreateDefaults(null)}
        project={project}
        issues={issues}
        me={me}
        defaults={createDefaults}
        onCreated={(issue) => {
          if (issue) setIssuesState((s) => ({ ...s, issues: [...s.issues.filter((i) => i.id !== issue.id), issue] }));
          scheduleRefresh();
        }}
      />
      <SprintDialog
        open={Boolean(sprintDialog)}
        mode={sprintDialog?.mode || 'create'}
        sprint={sprintDialog?.sprint || null}
        project={project}
        issues={issues}
        onClose={() => setSprintDialog(null)}
        onSaved={() => { loadProject(true); loadIssues(true); setReloadKey((k) => k + 1); }}
      />
      <DivisionDialog
        open={divisionOpen}
        project={project}
        onClose={() => setDivisionOpen(false)}
        onSaved={(updated) => setProjState((st) => ({ ...st, project: { ...st.project, ...updated } }))}
      />
    </div>
  );
}
