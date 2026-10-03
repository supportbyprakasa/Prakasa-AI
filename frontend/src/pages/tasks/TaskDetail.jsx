import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Badge from '../../components/Badge';
import Card from '../../components/Card';
import Button from '../../components/Button';
import DateInput from '../../components/DateInput';
import Input from '../../components/Input';
import Page from '../../components/Page';
import Select from '../../components/Select';
import Textarea from '../../components/Textarea';
import StatusBadge from '../../components/StatusBadge';
import KeyValue from '../../components/KeyValue';
import { Translate } from '../../i18n/NoTranslate';
import FormActions from '../../components/FormActions';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import ConfirmDialog from '../../components/ConfirmDialog';
import { formatDateTime } from '../../components/format';
import TaskProgress from '../../components/tasks/TaskProgress';
import TaskChecklist from '../../components/tasks/TaskChecklist';
import TaskWatchers from '../../components/tasks/TaskWatchers';
import TaskDependencies from '../../components/tasks/TaskDependencies';
import TaskActivityTimeline from '../../components/tasks/TaskActivityTimeline';
import {
  DONE_STATUSES, TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS, isOverdue, taskDate, taskStatusLabel, validateTaskForm,
} from '../../components/tasks/taskModel';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import './tasks.css';

// Where a task came from — a category, shown as a neutral label.
const SOURCE_LABELS = { ai_action: 'Prakasa AI', chat: 'Google Chat' };

// Prakasa AI may change the descriptive fields of a task; the user reviews
// them and presses "Simpan perubahan" (docs/prakasa-ai-rencana.md §9.9). The
// status is a decision and the assignee is an account ID with no people
// picker: both stay with the user.
const AI_TASK_EDIT = defineAIForm({
  id: 'task-edit',
  title: 'Detail tugas',
  permission: 'task.update',
  submitLabel: 'Simpan perubahan',
  mode: 'edit',
  fields: ({ done }) => [
    f.text('title', 'Judul', { required: true }),
    f.textarea('description', 'Deskripsi'),
    f.userOnly('status', 'Status', 'select'),
    f.select('priority', 'Prioritas', TASK_PRIORITY_OPTIONS),
    done
      ? f.readOnly('progressPercent', 'Progres (%)', 'number')
      : f.number('progressPercent', 'Progres (%)', { min: 0, max: 100, step: 1, hint: 'Bilangan bulat 0–100.' }),
    f.userOnly('assigneeId', 'ID penanggung jawab', 'number', { hint: 'Nomor ID akun; diisi pengguna.' }),
    f.date('startDate', 'Tanggal mulai'),
    f.date('dueDate', 'Jatuh tempo'),
  ],
});

const EMPTY_COMMENT = { comment: '' };
// A comment is text only; the user presses "Kirim komentar".
const AI_TASK_COMMENT = defineAIForm({
  id: 'task-comment',
  title: 'Komentar tugas',
  permission: 'task.update',
  submitLabel: 'Kirim komentar',
  fields: [f.textarea('comment', 'Komentar', { required: true, maxLength: 5000 })],
});

function loadErrorText(e) {
  const status = e.response?.status;
  if (status === 403) return 'Anda tidak memiliki akses ke task ini.';
  if (status === 404) return 'Task tidak ditemukan atau sudah dihapus.';
  return e.response?.data?.error?.message || 'Task gagal dimuat.';
}

export default function TaskDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();

  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // Bumped on every successful load (after save, status change, comment,
  // retry): the checklist/watcher/dependency cards remount and refetch, as
  // they did when the whole page re-rendered from a loading state.
  const [loadKey, setLoadKey] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [comment, setComment] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  const can = (permission) => (user?.permissions || []).includes(permission);
  const canUpdate = can('task.update');
  const canDelete = can('task.delete');
  const canWatch = can('task.watch');
  const canWatchManage = can('task.watch.manage');
  const canChecklist = can('task.checklist.manage');
  const canDependency = can('task.dependency.manage');
  const canActivity = can('task.activity.view');

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/tasks/${id}`);
      setTask(r.data.data);
      setForm(initialFormFromTask(r.data.data));
      setDirty({});
      setErrors({});
      setLoadError('');
      setLoadKey((k) => k + 1);
    } catch (e) {
      setLoadError(loadErrorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // The values as loaded: what counts as "not changed by the user" for Prakasa AI.
  const loaded = useMemo(() => (task ? initialFormFromTask(task) : null), [task]);
  // A value put back to what was loaded (the AI's fill undone) is no longer a change.
  const applyFields = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setDirty((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(patch)) {
        if (String(value ?? '') === String(loaded?.[key] ?? '')) delete next[key];
        else next[key] = true;
      }
      return next;
    });
  };
  const ai = usePrakasaAIForm(AI_TASK_EDIT, {
    enabled: Boolean(task && form) && canUpdate,
    record: { type: 'task', id: task?.id },
    values: form || {},
    apply: applyFields,
    setErrors,
    validate: validateTaskForm,
    initialValues: loaded,
    context: { done: DONE_STATUSES.has(task?.status) },
  });
  const aiComment = usePrakasaAIForm(AI_TASK_COMMENT, {
    enabled: Boolean(task) && canUpdate,
    values: { comment },
    setters: { comment: setComment },
    initialValues: EMPTY_COMMENT,
  });

  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty((d) => ({ ...d, [key]: true }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const save = async (event) => {
    event?.preventDefault();
    if (!task) return;
    const found = validateTaskForm(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    const payload = {};
    for (const key of Object.keys(dirty)) {
      if (!dirty[key]) continue;
      const v = form[key];
      // Null semantics for nullable fields
      if (['assigneeId', 'dueDate', 'startDate', 'description'].includes(key)) {
        payload[key] = (v === '' || v === null || v === undefined) ? null : v;
        if (key === 'assigneeId' && payload[key] !== null) payload[key] = Number(payload[key]);
      } else if (key === 'progressPercent') {
        payload[key] = v === '' ? 0 : Number(v);
      } else {
        payload[key] = v;
      }
    }
    if (!Object.keys(payload).length) return;

    setSaving(true);
    try {
      await api.patch(`/tasks/${id}`, payload);
      toast('Task diperbarui', 'success');
      ai.saved();
      await load();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      const code = e.response?.data?.error?.code;
      if (code === 'WIP_LIMIT_EXCEEDED') toast('Kolom sudah mencapai batas WIP.', 'error');
      else toast(e.response?.data?.error?.message || 'Perubahan gagal disimpan.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status, message) => {
    setStatusBusy(true);
    try {
      await api.patch(`/tasks/${id}`, { status });
      toast(message, 'success');
      await load();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Status task gagal diubah.', 'error');
    } finally {
      setStatusBusy(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/tasks/${id}`);
      toast('Task dihapus', 'success');
      nav('/tasks');
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Task gagal dihapus.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const submitComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setCommentSubmitting(true);
    try {
      await api.post(`/tasks/${id}/comments`, { body: comment.trim() });
      setComment('');
      await load();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Komentar gagal dikirim.', 'error');
    } finally {
      setCommentSubmitting(false);
    }
  };

  if (loading && !task) return <LoadingState label="Memuat task…" />;
  if (loadError && !task) {
    return (
      <Page title="Task">
        <EmptyState
          tone="error"
          title="Task tidak bisa dibuka"
          description={loadError}
          action={<Button variant="secondary" onClick={load}>Coba lagi</Button>}
        />
      </Page>
    );
  }
  if (!task || !form) return null;

  const done = DONE_STATUSES.has(task.status);
  const overdue = isOverdue(task);
  const isDirty = Object.keys(dirty).length > 0;
  const sourceLabel = SOURCE_LABELS[task.sourceType] || 'Manual';

  return (
    <Page
      eyebrow="Tugas"
      dataTitle={Boolean(task.title)}
      title={task.title || `Task #${task.id}`}
      description={(
        <span className="pw-row">
          <StatusBadge status={task.status} label={taskStatusLabel(task.status)} />
          {overdue ? <StatusBadge status="overdue" /> : null}
          <span className="pw-text-meta">{`#${task.id}`}</span>
        </span>
      )}
      actions={(
        <>
          {canUpdate && done ? (
            <Button variant="secondary" icon="replay" loading={statusBusy} onClick={() => setStatus('open', 'Task dibuka kembali')}>Buka kembali task</Button>
          ) : null}
          {canUpdate && !done ? (
            <Button icon="check_circle" loading={statusBusy} onClick={() => setStatus('done', 'Task selesai')}>Tandai selesai</Button>
          ) : null}
          {canDelete ? (
            <ActionMenu label="Aksi task" items={[{ label: 'Hapus task', icon: 'delete', tone: 'danger', onClick: () => setDeleteOpen(true) }]} />
          ) : null}
        </>
      )}
    >
      <div className="pw-cols-sidebar task-detail">
        <div className="pw-stack pw-stack--lg">
          <Card title="Detail">
            <form className="pw-stack" onSubmit={save} noValidate>
              {ai.notice}
              <Input
                label="Judul"
                required
                value={form.title}
                error={errors.title}
                {...ai.field('title')}
                onChange={(e) => setField('title', e.target.value)}
                disabled={!canUpdate}
              />

              <Textarea
                label="Deskripsi"
                value={form.description || ''}
                {...ai.field('description')}
                onChange={(e) => setField('description', e.target.value)}
                rows={4}
                disabled={!canUpdate}
              />

              <div className="pw-form-grid">
                <Select
                  label="Status"
                  value={form.status}
                  options={TASK_STATUS_OPTIONS}
                  onChange={(e) => setField('status', e.target.value)}
                  disabled={!canUpdate}
                />
                <Select
                  label="Prioritas"
                  value={form.priority}
                  options={TASK_PRIORITY_OPTIONS}
                  {...ai.field('priority')}
                  onChange={(e) => setField('priority', e.target.value)}
                  disabled={!canUpdate}
                />
                <Input
                  label="Progres (%)"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={form.progressPercent}
                  error={errors.progressPercent}
                  {...ai.field('progressPercent')}
                  onChange={(e) => setField('progressPercent', e.target.value)}
                  disabled={!canUpdate || done}
                />
                {canUpdate ? (
                  <Input
                    label="ID penanggung jawab"
                    type="number"
                    min="1"
                    step="1"
                    value={form.assigneeId || ''}
                    error={errors.assigneeId}
                    hint={task.assigneeName
                      ? `Nomor ID akun pengguna. Saat ini: ${task.assigneeName}. Kosongkan untuk melepas penanggung jawab.`
                      : 'Nomor ID akun pengguna di entitas yang sama. Kosongkan bila belum ditugaskan.'}
                    onChange={(e) => setField('assigneeId', e.target.value)}
                  />
                ) : null}
                {canUpdate ? (
                  <DateInput label="Tanggal mulai" value={form.startDate || ''} {...ai.field('startDate')} onChange={(e) => setField('startDate', e.target.value)} />
                ) : null}
                {canUpdate ? (
                  <DateInput
                    label="Jatuh tempo"
                    value={form.dueDate || ''}
                    error={errors.dueDate}
                    min={form.startDate || undefined}
                    {...ai.field('dueDate')}
                    onChange={(e) => setField('dueDate', e.target.value)}
                  />
                ) : null}
              </div>

              <TaskProgress percent={form.progressPercent || 0} />

              {canUpdate && isDirty ? (
                <FormActions>
                  <Button variant="text" type="button" onClick={() => { setForm(initialFormFromTask(task)); setDirty({}); setErrors({}); }}>Batal</Button>
                  <Button type="submit" icon="save" loading={saving}>Simpan perubahan</Button>
                </FormActions>
              ) : null}
            </form>
          </Card>

          <TaskChecklist
            key={`checklist-${loadKey}`}
            taskId={task.id}
            canManage={canChecklist}
            onChanged={() => setRefreshKey((k) => k + 1)}
          />

          <Card title={`Komentar (${task.comments?.length || 0})`}>
            <div className="pw-stack">
              {task.comments?.length ? (
                <ul className="task-comments">
                  {task.comments.map((c) => (
                    <li key={c.id} className="task-comment">
                      <span className="pw-cell__meta"><span data-no-translate={c.userName ? '' : undefined}>{c.userName || 'Pengguna'}</span>{' · '}{formatDateTime(c.createdAt)}</span>
                      <p className="task-comment__body" data-no-translate="">{c.body}</p>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState compact icon="chat_bubble" description="Belum ada komentar." />}
              {canUpdate ? (
                <form onSubmit={submitComment} className="pw-stack pw-stack--sm">
                  {aiComment.notice}
                  <Textarea
                    label="Komentar"
                    value={comment}
                    {...aiComment.field('comment')}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    maxLength={5000}
                  />
                  <FormActions>
                    <Button type="submit" loading={commentSubmitting} disabled={!comment.trim()}>Kirim komentar</Button>
                  </FormActions>
                </form>
              ) : null}
            </div>
          </Card>

          {canActivity ? <TaskActivityTimeline taskId={task.id} refreshKey={refreshKey} /> : null}
        </div>

        <aside className="pw-stack pw-stack--lg">
          <Card title="Ringkasan">
            <KeyValue items={[
              { label: 'Pelapor', value: task.reporterName || null },
              { label: 'Penanggung jawab', value: task.assigneeName || <Translate>Belum ditugaskan</Translate> },
              { label: 'Board', value: task.boardId ? <Link className="pw-link" to={`/tasks?board=${task.boardId}`}>Buka board</Link> : null, translate: true },
              { label: 'Tanggal mulai', value: taskDate(task.startDate) || null },
              { label: 'Jatuh tempo', value: taskDate(task.dueDate) || null },
              { label: 'Sumber', value: <Badge>{sourceLabel}</Badge>, translate: true },
            ]}
            />
          </Card>

          {done ? (
            <Card title="Penyelesaian">
              <KeyValue items={[
                { label: 'Selesai oleh', value: task.completedByName || <Translate>{task.completedBy ? `Pengguna #${task.completedBy}` : 'Sistem'}</Translate> },
                { label: 'Waktu', value: task.completedAt ? formatDateTime(task.completedAt) : null },
              ]}
              />
            </Card>
          ) : null}

          <TaskWatchers
            key={`watchers-${loadKey}`}
            task={task}
            canWatch={canWatch}
            canManage={canWatchManage}
            onChanged={() => setRefreshKey((k) => k + 1)}
          />

          <TaskDependencies
            key={`deps-${loadKey}`}
            task={task}
            canManage={canDependency}
            onChanged={() => setRefreshKey((k) => k + 1)}
          />

          {task.attachments?.length > 0 ? (
            <Card title={`Lampiran (${task.attachments.length})`}>
              <ul className="task-list">
                {task.attachments.map((a) => (
                  <li key={a.id} className="task-list__row">
                    {a.webViewLink ? (
                      <a data-no-translate="" className="pw-link" href={a.webViewLink} target="_blank" rel="noreferrer">{a.name}</a>
                    ) : (
                      <span data-no-translate="">{a.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </aside>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Hapus task ini?"
        message={`Task "${task.title}" akan dihapus dan tidak tampil lagi di board.`}
        confirmLabel="Hapus task"
        tone="danger"
        loading={deleting}
        onConfirm={doDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </Page>
  );
}

function initialFormFromTask(task) {
  return {
    title: task.title || '',
    description: task.description || '',
    status: task.status || 'open',
    priority: task.priority || 'normal',
    assigneeId: task.assigneeId || '',
    startDate: task.startDate || '',
    dueDate: task.dueDate || '',
    progressPercent: task.progressPercent ?? 0,
  };
}
