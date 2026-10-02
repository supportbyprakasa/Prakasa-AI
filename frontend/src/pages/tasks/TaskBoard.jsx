import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import DateInput from '../../components/DateInput';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import Icon from '../../components/Icon';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import SearchField from '../../components/SearchField';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import Textarea from '../../components/Textarea';
import PriorityBadge from '../../components/PriorityBadge';
import ConfirmDialog from '../../components/ConfirmDialog';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDateTime } from '../../components/format';
import { KanbanBoard, KanbanCard, KanbanColumn } from '../../components/tasks/Kanban';
import TaskProgress from '../../components/tasks/TaskProgress';
import {
  FINAL_STATUSES, TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS, isDueToday, isOverdue, mergeAssignees, taskDate,
  validateTaskForm,
} from '../../components/tasks/taskModel';
import { Mixed, NoTranslate, data as dataPart } from '../../i18n/NoTranslate';
import { toast } from '../../components/Toast';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { useAuth } from '../../context/AuthContext';
import './tasks.css';
import { safeExternalHref } from '../../components/safeHref.js';

const errorMessage = (e, fallback) => (e.response?.data?.error?.code === 'FORBIDDEN'
  ? 'Anda tidak memiliki akses untuk tindakan ini.'
  : (e.response?.data?.error?.message || fallback));

// /tasks — the boards, as one list; /tasks?board=<id> — one board's kanban.
// The chosen board lives in the URL, so the browser's back button and a
// shared link both work.
export default function TaskBoard() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [boards, setBoards] = useState([]);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [boardsError, setBoardsError] = useState('');
  const [createBoardOpen, setCreateBoardOpen] = useState(false);

  const canManageBoard = (user?.permissions || []).includes('board.manage');
  const canCreateTask = (user?.permissions || []).includes('task.create');
  const selectedBoardId = Number(params.get('board')) || null;
  const openBoard = (id) => setParams(id ? { board: String(id) } : {});
  // "Tambah task" opens by URL too (/tasks?board=ID&baru=1 — a link, or Prakasa
  // AI's buka_halaman); the parameter is removed once the form is open.
  const createRequested = params.get('baru') === '1';
  const createOpened = () => setParams((current) => { const next = new URLSearchParams(current); next.delete('baru'); return next; }, { replace: true });

  // "Tambah board" opens by URL as well: /tasks?baru=papan.
  const boardRequested = !selectedBoardId && params.get('baru') === 'papan';
  useEffect(() => {
    if (!boardRequested) return;
    if (canManageBoard) setCreateBoardOpen(true);
    createOpened();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardRequested, canManageBoard]);

  const loadBoards = async () => {
    setBoardsLoading(true);
    try {
      const r = await api.get('/boards');
      setBoards(r.data.data || []);
      setBoardsError('');
    } catch (e) {
      setBoardsError(errorMessage(e, 'Daftar board gagal dimuat.'));
    } finally {
      setBoardsLoading(false);
    }
  };

  useEffect(() => { loadBoards(); }, []);

  if (selectedBoardId) {
    return (
      <BoardWorkspace
        key={selectedBoardId}
        boardId={selectedBoardId}
        boards={boards}
        onPickBoard={openBoard}
        canCreateTask={canCreateTask}
        canManageBoard={canManageBoard}
        createRequested={createRequested}
        onCreateOpened={createOpened}
        onBoardDeleted={() => { openBoard(null); loadBoards(); }}
      />
    );
  }

  const columns = [
    {
      key: 'name', header: 'Board', exportValue: (b) => b.name,
      render: (b) => (
        <span className="pw-cell">
          <span data-no-translate="" className="pw-cell__title">{b.name}</span>
          {b.description ? <span className="pw-cell__meta">{String(b.description).slice(0, 120)}</span> : null}
        </span>
      ),
    },
    {
      key: 'isArchived', header: 'Status', sortValue: (b) => (b.isArchived ? 1 : 0),
      exportValue: (b) => (b.isArchived ? 'Diarsipkan' : 'Aktif'),
      render: (b) => <StatusBadge status={b.isArchived ? 'closed' : 'active'} label={b.isArchived ? 'Diarsipkan' : 'Aktif'} />,
    },
  ];

  return (
    <Page
      title="Papan tugas"
      description="Board tugas per tim. Pilih board untuk membuka papan kanban-nya."
      actions={canManageBoard ? <Button icon="add" onClick={() => setCreateBoardOpen(true)}>Tambah board</Button> : null}
    >
      <DataGrid
        title="Board"
        columns={columns}
        rows={boards}
        loading={boardsLoading}
        error={boardsError}
        onRetry={loadBoards}
        exportName="task-board"
        searchable={boards.length > 8}
        onRowClick={(b) => openBoard(b.id)}
        toolbarActions={<IconButton label="Muat ulang" icon="refresh" onClick={loadBoards} />}
        empty={(
          <EmptyState
            icon="view_kanban"
            title="Belum ada board"
            description={canManageBoard ? 'Buat board pertama dengan tombol Tambah board.' : 'Board yang dibagikan ke Anda akan muncul di sini.'}
          />
        )}
      />

      <CreateBoardModal
        open={createBoardOpen}
        onClose={() => setCreateBoardOpen(false)}
        onCreated={(id) => {
          setCreateBoardOpen(false);
          loadBoards();
          openBoard(id);
        }}
      />
    </Page>
  );
}

/* ============================================================
   Create board (long form: board + its columns)
   ============================================================ */

const DEFAULT_COLUMNS = [
  { name: 'Backlog', position: 0, wipLimit: '' },
  { name: 'Dikerjakan', position: 1, wipLimit: '' },
  { name: 'Selesai', position: 2, wipLimit: '' },
];

const EMPTY_BOARD = { name: '', description: '', departmentId: '' };
const MAX_BOARD_COLUMNS = 12;
// The form as it opens (the starting columns included): an untouched form is not "unsaved".
const BOARD_START = { ...EMPTY_BOARD, columns: DEFAULT_COLUMNS };
const emptyBoardColumn = () => ({ name: '', position: 0, wipLimit: '' });

// Prakasa AI may fill a new board and add its columns; the user reviews them
// and presses "Buat board" (docs/prakasa-ai-rencana.md §9.9). The three
// starting columns count as the user's rows: the AI adds after them and never
// removes one.
const AI_BOARD = defineAIForm({
  id: 'task-board',
  title: 'Tambah board',
  permission: 'board.manage',
  submitLabel: 'Buat board',
  fields: ({ departmentOptions, getColumns, setColumns }) => [
    f.text('name', 'Nama board', { required: true }),
    departmentOptions
      ? f.select('departmentId', 'Divisi', departmentOptions, { hint: 'Opsional.' })
      : f.userOnly('departmentId', 'ID divisi', 'number'),
    f.textarea('description', 'Deskripsi'),
    f.rows('columns', 'Kolom', [
      f.text('name', 'Nama kolom', { required: true }),
      f.number('wipLimit', 'Batas WIP', { min: 1, step: 1, hint: 'Kosong = tanpa batas.' }),
    ], { required: true, maxRows: MAX_BOARD_COLUMNS, emptyRow: emptyBoardColumn, getRows: getColumns, setRows: setColumns }),
  ],
});

function CreateBoardModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_BOARD);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  // Divisions of the user's entity (GET /departments/options, open to every
  // signed-in user). null = list unavailable → the ID field stays as before.
  const [departments, setDepartments] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_BOARD);
    setColumns(DEFAULT_COLUMNS);
    setErrors({});
    api.get('/departments/options')
      .then((r) => setDepartments(r.data.data || []))
      .catch(() => setDepartments(null));
  }, [open]);

  const dirty = Boolean(form.name.trim() || form.description.trim() || form.departmentId)
    || JSON.stringify(columns) !== JSON.stringify(DEFAULT_COLUMNS);

  const departmentOptions = useMemo(() => (departments ? departments.map((d) => ({ value: String(d.id), label: d.name })) : null), [departments]);
  const ai = usePrakasaAIForm(AI_BOARD, {
    enabled: open,
    values: form,
    setValues: setForm,
    setErrors,
    initialValues: BOARD_START,
    context: { departmentOptions, getColumns: () => columns, setColumns },
  });

  const setCol = (idx, key, value) => {
    const copy = [...columns];
    copy[idx] = { ...copy[idx], [key]: value };
    setColumns(copy);
    if (errors[`col-${idx}-${key}`]) setErrors((e) => ({ ...e, [`col-${idx}-${key}`]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const found = {};
    if (!form.name.trim()) found.name = 'Nama board wajib diisi.';
    if (!columns.length) found.columns = 'Board perlu minimal 1 kolom.';
    columns.forEach((c, idx) => {
      if (!c.name.trim()) found[`col-${idx}-name`] = 'Nama kolom wajib diisi.';
      if (c.wipLimit !== '' && (!Number.isInteger(Number(c.wipLimit)) || Number(c.wipLimit) <= 0)) {
        found[`col-${idx}-wipLimit`] = 'Angka positif atau kosong.';
      }
    });
    if (form.departmentId) {
      const departmentId = Number(form.departmentId);
      if (!Number.isInteger(departmentId) || departmentId <= 0) found.departmentId = 'ID divisi tidak valid.';
    }
    setErrors(found);
    if (Object.keys(found).length) return;

    const payload = {
      name: form.name.trim(),
      description: form.description || null,
      // entityId intentionally omitted — backend derives from user
    };
    if (form.departmentId) payload.departmentId = Number(form.departmentId);
    payload.columns = columns.map((c, i) => ({
      name: c.name.trim(),
      position: i,
      wipLimit: c.wipLimit === '' ? null : Number(c.wipLimit),
    }));

    setSaving(true);
    try {
      const r = await api.post('/boards', payload);
      toast('Board dibuat', 'success');
      onCreated?.(r.data.data.id);
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Board gagal dibuat.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FullScreenDialog
      open={open}
      onClose={saving ? () => {} : onClose}
      dirty={dirty}
      title="Tambah board"
      card={false}
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form="task-board-create" loading={saving}>Buat board</Button>
        </>
      )}
    >
      <form id="task-board-create" className="pw-stack pw-stack--lg" onSubmit={submit} noValidate>
        {ai.notice}
        <FullScreenSection title="Informasi board">
          <div className="pw-form-grid">
            <Input
              label="Nama board"
              required
              value={form.name}
              error={errors.name}
              {...ai.field('name')}
              onChange={(e) => { setForm({ ...form, name: e.target.value }); if (errors.name) setErrors((x) => ({ ...x, name: undefined })); }}
            />
            {departments ? (
              <Select
                label="Divisi"
                value={form.departmentId}
                placeholder="Tanpa divisi"
                options={departmentOptions}
                error={errors.departmentId}
                hint="Opsional."
                {...ai.field('departmentId')}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
              />
            ) : (
              <Input
                label="ID divisi"
                type="number"
                min="1"
                step="1"
                value={form.departmentId}
                error={errors.departmentId}
                hint="Opsional. Nomor ID divisi; daftar divisi tidak bisa dimuat saat ini."
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
              />
            )}
          </div>
          <Textarea
            label="Deskripsi"
            rows={2}
            value={form.description}
            {...ai.field('description')}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </FullScreenSection>

        <FullScreenSection title="Kolom">
          {errors.columns ? <Banner tone="error">{errors.columns}</Banner> : null}
          <ul className="task-col-list">
            {columns.map((c, idx) => (
              // eslint-disable-next-line react/no-array-index-key
              <li key={idx} className={ai.rowClass('columns', idx, 'task-col-row')}>
                <Input
                  label={`Nama kolom ${idx + 1}`}
                  value={c.name}
                  {...ai.row('columns', idx)}
                  error={errors[`col-${idx}-name`]}
                  onChange={(e) => setCol(idx, 'name', e.target.value)}
                />
                <Input
                  label="Batas WIP"
                  type="number"
                  min="1"
                  value={c.wipLimit}
                  error={errors[`col-${idx}-wipLimit`]}
                  hint="Kosong = tanpa batas."
                  onChange={(e) => setCol(idx, 'wipLimit', e.target.value)}
                />
                <IconButton
                  label={`Hapus kolom ${idx + 1}`}
                  icon="delete"
                  onClick={() => setColumns(columns.filter((_, i) => i !== idx))}
                  disabled={columns.length === 1}
                />
              </li>
            ))}
          </ul>
          <div>
            <Button
              variant="text"
              type="button"
              icon="add"
              onClick={() => setColumns([...columns, { name: '', position: columns.length, wipLimit: '' }])}
            >
              Tambah kolom
            </Button>
          </div>
        </FullScreenSection>
      </form>
    </FullScreenDialog>
  );
}

/* ============================================================
   Board workspace
   ============================================================ */

const NO_FILTERS = { assigneeId: '', priority: '', status: '' };

function BoardWorkspace({ boardId, boards, onPickBoard, canCreateTask, canManageBoard, onBoardDeleted, createRequested = false, onCreateOpened }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const canUpdateTask = (user?.permissions || []).includes('task.update');
  const [board, setBoard] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filters, setFilters] = useState(NO_FILTERS);
  const [assignees, setAssignees] = useState([]);
  const [dragging, setDragging] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const boardReady = Boolean(board);
  const boardArchived = Boolean(board?.isArchived);
  useEffect(() => {
    if (!createRequested || !boardReady) return;
    if (canCreateTask && !boardArchived) setCreateOpen(true);
    onCreateOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequested, boardReady, boardArchived, canCreateTask]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [spaceOpen, setSpaceOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [b, t] = await Promise.all([
        api.get(`/boards/${boardId}`),
        api.get(`/boards/${boardId}/tasks`, {
          params: Object.fromEntries(
            Object.entries(filters).filter(([, v]) => v !== '')
          ),
        }),
      ]);
      setBoard(b.data.data);
      setTasks(t.data.data || []);
      setAssignees((known) => mergeAssignees(known, t.data.data || []));
      setLoadError('');
    } catch (e) {
      const status = e.response?.status;
      setLoadError(status === 403
        ? 'Anda tidak memiliki akses ke board ini.'
        : status === 404 ? 'Board tidak ditemukan.' : (e.response?.data?.error?.message || 'Board gagal dimuat.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [boardId, filters.assigneeId, filters.priority, filters.status]);

  const filteredTasks = useMemo(() => {
    if (!localSearch.trim()) return tasks;
    const q = localSearch.toLowerCase();
    return tasks.filter((t) => (t.title || '').toLowerCase().includes(q));
  }, [tasks, localSearch]);

  const onDragStart = (e, task) => {
    if (!canUpdateTask || board?.isArchived) {
      e.preventDefault();
      return;
    }
    setDragging(task);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(task.id));
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onDrop = async (e, colId) => {
    e.preventDefault();
    if (!canUpdateTask || board?.isArchived || !dragging) return;
    if (Number(dragging.columnId) === Number(colId)) { setDragging(null); return; }

    const previous = tasks;
    const optimistic = tasks.map((t) =>
      t.id === dragging.id ? { ...t, columnId: colId } : t
    );
    setTasks(optimistic);

    try {
      await api.patch(`/tasks/${dragging.id}`, { columnId: colId });
      setDragging(null);
    } catch (err) {
      const code = err.response?.data?.error?.code;
      setTasks(previous);
      if (code === 'WIP_LIMIT_EXCEEDED') {
        toast('Kolom sudah mencapai batas WIP.', 'error');
      } else if (code === 'BOARD_ARCHIVED') {
        toast('Board ini sudah diarsipkan.', 'error');
      } else {
        toast(err.response?.data?.error?.message || 'Task gagal dipindahkan.', 'error');
      }
      setDragging(null);
      // Reload authoritative state
      load();
    }
  };

  const doDeleteBoard = async () => {
    setDeleting(true);
    try {
      await api.delete(`/boards/${boardId}`);
      toast('Board dihapus', 'success');
      onBoardDeleted?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Board gagal dihapus.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // The board picker doubles as the way back to every board.
  const boardOptions = [
    { value: '', label: 'Semua board', translate: true },
    ...boards.map((b) => ({ value: String(b.id), label: b.name })),
    ...(board && !boards.some((b) => b.id === board.id) ? [{ value: String(board.id), label: board.name }] : []),
  ];
  const picker = (
    <Select
      dense
      label="Board"
      value={String(boardId)}
      options={boardOptions}
      dataOptions
      fieldClassName="task-filters__board"
      onChange={(e) => onPickBoard(e.target.value ? Number(e.target.value) : null)}
    />
  );

  if (loading && !board) {
    return (
      <Page eyebrow="Task board" title="Board">
        <LoadingState label="Memuat board…" />
      </Page>
    );
  }
  if (!board) {
    return (
      <Page eyebrow="Task board" title="Board">
        <div className="task-filters">{picker}</div>
        <EmptyState
          tone="error"
          title="Board tidak bisa dibuka"
          description={loadError}
          action={<Button variant="secondary" onClick={load}>Coba lagi</Button>}
        />
      </Page>
    );
  }

  const filtered = Boolean(localSearch.trim() || filters.assigneeId || filters.priority || filters.status);
  const menuItems = [
    { label: 'Muat ulang', icon: 'refresh', onClick: load },
    canManageBoard ? { label: 'Hapus board', icon: 'delete', tone: 'danger', onClick: () => setDeleteOpen(true) } : null,
  ];

  return (
    <Page
      eyebrow="Task board"
      dataTitle
      title={board.name}
      description={board.isArchived ? 'Board ini diarsipkan: task tidak bisa ditambah atau dipindahkan.' : (board.description ? <NoTranslate>{board.description}</NoTranslate> : undefined)}
      actions={(
        <>
          <Button variant="secondary" icon="chat" onClick={() => setSpaceOpen(true)}>Buka Space</Button>
          {canCreateTask && !board.isArchived ? (
            <Button icon="add" onClick={() => setCreateOpen(true)}>Tambah task</Button>
          ) : null}
          <ActionMenu label="Aksi board" items={menuItems} />
        </>
      )}
    >
      {loadError ? <Banner tone="error" action={<Button variant="text" onClick={load}>Coba lagi</Button>}>{loadError}</Banner> : null}

      <div className="task-filters" role="group" aria-label="Filter task">
        {picker}
        <SearchField
          className="task-filters__search"
          label="Cari judul task"
          placeholder="Cari judul di board ini"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
        />
        <Select
          dense
          label="Prioritas"
          value={filters.priority}
          placeholder="Semua prioritas"
          options={TASK_PRIORITY_OPTIONS}
          fieldClassName="task-filters__field"
          onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
        />
        <Select
          dense
          label="Status"
          value={filters.status}
          placeholder="Semua status"
          options={TASK_STATUS_OPTIONS}
          fieldClassName="task-filters__field"
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        />
        <Select
          dense
          label="Penanggung jawab"
          value={filters.assigneeId}
          placeholder="Semua orang"
          options={assignees}
          dataOptions
          fieldClassName="task-filters__field"
          onChange={(e) => setFilters({ ...filters, assigneeId: e.target.value })}
        />
        {filtered ? (
          <Button variant="text" icon="close" onClick={() => { setLocalSearch(''); setFilters(NO_FILTERS); }}>Hapus filter</Button>
        ) : null}
      </div>

      <KanbanBoard label={`Kolom board ${board.name}`}>
        {board.columns.map((col) => {
          const colTasks = filteredTasks.filter((t) => Number(t.columnId) === Number(col.id));
          const allColumnTasks = tasks.filter((t) => Number(t.columnId) === Number(col.id));
          const nonFinal = allColumnTasks.filter((t) => !FINAL_STATUSES.has(t.status)).length;
          const hasLimit = col.wipLimit != null;
          const wipReached = hasLimit && nonFinal >= Number(col.wipLimit);

          return (
            <KanbanColumn
              key={col.id}
              title={col.name}
              dataTitle
              count={colTasks.length}
              countLabel={`${colTasks.length} task`}
              note={hasLimit ? (wipReached ? `WIP ${nonFinal}/${col.wipLimit} · batas tercapai` : `WIP ${nonFinal}/${col.wipLimit}`) : null}
              alert={wipReached}
              dropTarget={Boolean(dragging) && Number(dragging.columnId) !== Number(col.id)}
              empty={!colTasks.length ? (filtered ? 'Tidak ada yang cocok' : 'Kosong') : null}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, col.id)}
            >
              {colTasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  dragging={dragging?.id === t.id}
                  canDrag={canUpdateTask && !board.isArchived}
                  onDragStart={onDragStart}
                  onDragEnd={() => setDragging(null)}
                  onOpen={() => nav(`/tasks/${t.id}`)}
                />
              ))}
            </KanbanColumn>
          );
        })}
      </KanbanBoard>

      <CreateTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        board={board}
        onCreated={() => { setCreateOpen(false); load(); }}
      />

      <SpacePanel
        open={spaceOpen}
        onClose={() => setSpaceOpen(false)}
        board={board}
        canCreateTask={canCreateTask}
        onConverted={load}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Hapus board ini?"
        message={`Board "${board.name}" akan dihapus. Task di dalamnya tidak lagi ditampilkan pada board.`}
        confirmLabel="Hapus board"
        tone="danger"
        loading={deleting}
        onConfirm={doDeleteBoard}
        onClose={() => setDeleteOpen(false)}
      />
    </Page>
  );
}

/* ============================================================
   Space panel — this board's Google Chat Space
   ============================================================ */

function SpacePanel({ open, onClose, board, canCreateTask, onConverted }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [convertingName, setConvertingName] = useState(null);
  const hasSpace = Boolean(board?.googleChatSpaceUrl);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/boards/${board.id}/chat/messages`);
      setMessages(res.data.data?.messages || []);
    } catch (e) {
      setError(e.response?.data?.error?.message || 'Pesan Space gagal dimuat.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && hasSpace) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, board?.id]);

  const send = async (event) => {
    event.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.post(`/boards/${board.id}/chat/messages`, { text: text.trim() });
      setText('');
      load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Pesan gagal dikirim.', 'error');
    } finally {
      setSending(false);
    }
  };

  const convertToTask = async (message) => {
    setConvertingName(message.name);
    try {
      await api.post(`/boards/${board.id}/chat/convert-to-task`, { messageName: message.name });
      toast('Pesan dijadikan task', 'success');
      onConverted?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Pesan gagal dijadikan task.', 'error');
    } finally {
      setConvertingName(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={<Mixed separator=" " parts={['Space', dataPart(board?.name)]} />}
      size="md"
      footer={hasSpace ? (
        <Button variant="secondary" icon="open_in_new" href={safeExternalHref(board.googleChatSpaceUrl) || undefined} target="_blank" rel="noreferrer">
          Buka di Google Chat
        </Button>
      ) : undefined}
    >
      {!hasSpace ? (
        <EmptyState
          compact
          icon="chat_bubble"
          title="Space belum tersedia"
          description="Space belum tersedia untuk board ini. Coba lagi nanti atau hubungi admin IT."
        />
      ) : (
        <div className="pw-stack">
          {error ? <Banner tone="error" action={<Button variant="text" onClick={load}>Coba lagi</Button>}>{error}</Banner> : null}
          <ul className="task-chat-log">
            {loading ? <li><LoadingState compact label="Memuat pesan…" /></li> : messages.length ? messages.map((m) => (
              <li key={m.name} className="task-chat-msg">
                <span className="pw-cell__meta">
                  <span className="task-chat-msg__sender" data-no-translate={m.sender?.displayName || m.sender?.name ? '' : undefined}>{m.sender?.displayName || m.sender?.name || 'Anggota Space'}</span>
                  {m.createTime ? ` · ${formatDateTime(m.createTime)}` : ''}
                </span>
                <p className="task-chat-msg__text" data-no-translate="">{m.text}</p>
                {canCreateTask ? (
                  <div>
                    <Button variant="text" icon="add_task" onClick={() => convertToTask(m)} loading={convertingName === m.name}>
                      Jadikan task
                    </Button>
                  </div>
                ) : null}
              </li>
            )) : <li><EmptyState compact icon="chat_bubble" description="Belum ada pesan." /></li>}
          </ul>
          <form onSubmit={send} className="task-chat-form">
            <Input label="Pesan" fieldClassName="pw-grow" value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="submit" icon="send" loading={sending} disabled={!text.trim()}>Kirim pesan</Button>
          </form>
        </div>
      )}
    </Modal>
  );
}

/* ============================================================
   Task card
   ============================================================ */

function TaskCard({ task, dragging, canDrag, onDragStart, onDragEnd, onOpen }) {
  const overdue = isOverdue(task);
  const dueToday = isDueToday(task);
  const done = FINAL_STATUSES.has(task.status);

  return (
    <KanbanCard
      dragging={dragging}
      muted={done && !dragging}
      draggable={canDrag}
      onDragStart={(e) => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      onClick={(event) => { if (!event.target.closest('a, button')) onOpen(); }}
    >
      <Link className="pw-kanban__title" to={`/tasks/${task.id}`} data-no-translate="">{task.title}</Link>

      <div className="pw-kanban__tags">
        <PriorityBadge priority={task.priority || 'normal'} />
        {done ? <StatusBadge status="done" /> : null}
        {overdue ? <StatusBadge status="overdue" /> : null}
        {!overdue && dueToday ? <StatusBadge status="due_soon" label="Hari ini" /> : null}
      </div>

      {task.progressPercent > 0 ? <TaskProgress percent={task.progressPercent} /> : null}

      <div className="pw-kanban__meta">
        <span className="pw-kanban__meta-item">
          <Icon name="person" size="sm" /><span data-no-translate={task.assigneeName ? '' : undefined}>{task.assigneeName || 'Belum ditugaskan'}</span>
        </span>
        {task.dueDate ? (
          <span className={`pw-kanban__meta-item${overdue ? ' is-error' : ''}`}>
            <Icon name="calendar_today" size="sm" />{taskDate(task.dueDate)}
          </span>
        ) : null}
      </div>
    </KanbanCard>
  );
}

/* ============================================================
   Create task (long form)
   ============================================================ */

const emptyTask = (board) => ({
  title: '',
  description: '',
  columnId: board?.columns?.[0]?.id || '',
  priority: 'normal',
  assigneeId: '',
  startDate: '',
  dueDate: '',
  progressPercent: '',
});

function CreateTaskModal({ open, onClose, board, onCreated }) {
  const [form, setForm] = useState(() => emptyTask(board));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(emptyTask(board));
      setErrors({});
    }
    /* eslint-disable-next-line */
  }, [open]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (errors[key]) setErrors((x) => ({ ...x, [key]: undefined }));
  };
  const blank = emptyTask(board);
  const dirty = Object.keys(blank).some((key) => String(form[key] ?? '') !== String(blank[key] ?? ''));

  // Prakasa AI may fill a new task; the user reviews it and presses "Buat task"
  // (docs/prakasa-ai-rencana.md §9.8). The assignee is an account ID the AI
  // cannot look up: the user fills it.
  const ai = usePrakasaAIForm({
    id: 'task',
    title: 'Tugas',
    permission: 'task.create',
    submitLabel: 'Buat task',
    enabled: open,
    initialValues: blank,
    fields: [
      { name: 'title', label: 'Judul', type: 'text', required: true },
      { name: 'description', label: 'Deskripsi', type: 'textarea' },
      { name: 'columnId', label: 'Kolom', type: 'select', options: (board?.columns || []).map((c) => ({ value: String(c.id), label: c.name })) },
      { name: 'priority', label: 'Prioritas', type: 'select', options: TASK_PRIORITY_OPTIONS },
      { name: 'assigneeId', label: 'ID penanggung jawab', type: 'number', aiFillable: false, hint: 'Nomor ID akun; diisi pengguna.' },
      { name: 'progressPercent', label: 'Progres (%)', type: 'number', hint: 'Bilangan bulat 0–100.' },
      { name: 'startDate', label: 'Tanggal mulai', type: 'date' },
      { name: 'dueDate', label: 'Jatuh tempo', type: 'date' },
    ],
    getValues: () => form,
    setValues: (patch) => {
      setForm((f) => ({ ...f, ...patch }));
      setErrors((x) => ({ ...x, ...Object.fromEntries(Object.keys(patch).map((key) => [key, undefined])) }));
    },
    validate: validateTaskForm,
  });

  const submit = async (event) => {
    event.preventDefault();
    const found = validateTaskForm(form);
    if (form.columnId) {
      const columnId = Number(form.columnId);
      if (!Number.isInteger(columnId) || columnId <= 0) found.columnId = 'Kolom tidak valid.';
    }
    setErrors(found);
    if (Object.keys(found).length) return;

    const payload = {
      departmentId: board.departmentId ?? null,
      boardId: board.id,
      columnId: form.columnId ? Number(form.columnId) : null,
      title: form.title.trim(),
      description: form.description || null,
      priority: form.priority,
    };
    if (form.assigneeId) payload.assigneeId = Number(form.assigneeId);
    if (form.startDate) payload.startDate = form.startDate;
    if (form.dueDate) payload.dueDate = form.dueDate;
    if (form.progressPercent !== '') payload.progressPercent = Number(form.progressPercent);

    setSaving(true);
    try {
      await api.post('/tasks', payload);
      toast('Task dibuat', 'success');
      onCreated?.();
    } catch (e) {
      const code = e.response?.data?.error?.code;
      if (code === 'WIP_LIMIT_EXCEEDED') {
        setErrors({ columnId: 'Kolom ini sudah mencapai batas WIP.' });
      } else {
        toast(e.response?.data?.error?.message || 'Task gagal dibuat.', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <FullScreenDialog
      open={open}
      onClose={saving ? () => {} : onClose}
      dirty={dirty}
      title="Tambah task"
      sectionTitle="Informasi task"
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form="task-create" loading={saving}>Buat task</Button>
        </>
      )}
    >
      <form id="task-create" className="pw-stack" onSubmit={submit} noValidate>
        {ai.notice}
        <Input label="Judul" required value={form.title} error={errors.title} {...ai.field('title')} onChange={set('title')} autoFocus />
        <Textarea label="Deskripsi" value={form.description} {...ai.field('description')} onChange={set('description')} rows={3} />
        <div className="pw-form-grid">
          <Select
            label="Kolom"
            value={form.columnId}
            {...ai.field('columnId')}
            error={errors.columnId}
            options={board.columns.map((c) => ({ value: c.id, label: c.name }))}
            dataOptions
            onChange={set('columnId')}
          />
          <Select label="Prioritas" value={form.priority} options={TASK_PRIORITY_OPTIONS} {...ai.field('priority')} onChange={set('priority')} />
          <Input
            label="ID penanggung jawab"
            type="number"
            min="1"
            step="1"
            value={form.assigneeId}
            error={errors.assigneeId}
            hint="Opsional. Nomor ID akun pengguna di entitas yang sama."
            onChange={set('assigneeId')}
          />
          <Input
            label="Progres (%)"
            type="number"
            min={0}
            max={100}
            step={1}
            value={form.progressPercent}
            {...ai.field('progressPercent')}
            error={errors.progressPercent}
            onChange={set('progressPercent')}
          />
          <DateInput label="Tanggal mulai" value={form.startDate} {...ai.field('startDate')} onChange={set('startDate')} />
          <DateInput label="Jatuh tempo" value={form.dueDate} {...ai.field('dueDate')} error={errors.dueDate} min={form.startDate || undefined} onChange={set('dueDate')} />
        </div>
      </form>
    </FullScreenDialog>
  );
}
