import { useEffect, useMemo, useRef, useState } from 'react';
import ConfirmDialog from '../ConfirmDialog';
import api from '../../api/client';
import Button from '../Button';
import CountBadge from '../CountBadge';
import EmptyState from '../EmptyState';
import FormActions from '../FormActions';
import Icon from '../Icon';
import IconButton from '../IconButton';
import Input from '../Input';
import Menu from '../Menu';
import Modal from '../Modal';
import Select from '../Select';
import Textarea from '../Textarea';
import { SkeletonLine } from '../Skeleton';
import { toast } from '../Toast';
import { useAuth } from '../../context/AuthContext';
import { visibilityOptions } from './AIVisibilityBadge';
import { groupSessionsByRecency } from '../../pages/ai/aiCommandCenterModel';
import './ai-components.css';

const PAGE_SIZE = 30;

const SPACES = [
  { value: '', label: 'Semua percakapan', icon: 'forum' },
  { value: 'private', label: 'Pribadi', icon: 'lock' },
  { value: 'department', label: 'Divisi', icon: 'group' },
  { value: 'entity', label: 'Lintas divisi', icon: 'domain' },
];

const SHARED_ICONS = { department: 'group', entity: 'domain' };

export default function AISessionList({
  selectedSessionId,
  onSelectSession,
  onNewChat,
  refreshKey,
  inboxActive = false,
  inboxCount = 0,
  onOpenInbox,
  onNewDivisionChat,
  onEditSession,
  onSessionDeleted,
  onSessionsChanged,
}) {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const canCreate = permissions.includes('ai_command.use');
  const canStartDivisionChat = canCreate && Boolean(user?.departmentId || permissions.includes('ai_command.admin.view'));
  const [renamingId, setRenamingId] = useState(null);
  const [renameText, setRenameText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const renameHandledRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [visibility, setVisibility] = useState('');
  const [archived, setArchived] = useState(false);

  const load = async (page = 1, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE, status: archived ? 'archived' : 'active' };
      if (visibility) params.visibility = visibility;
      const response = await api.get('/ai-command/sessions', { params });
      const nextRows = response.data.data || [];
      setRows((previous) => (append ? [...previous, ...nextRows] : nextRows));
      setMeta(response.data.meta || { page, limit: PAGE_SIZE, total: nextRows.length });
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal memuat percakapan', 'error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => { load(1, false); /* eslint-disable-next-line */ }, [visibility, archived, refreshKey]);

  const groups = useMemo(() => groupSessionsByRecency(rows), [rows]);

  const afterChange = async () => {
    await load(1, false);
    onSessionsChanged?.();
  };

  const togglePin = async (session) => {
    try {
      if (session.pinned) await api.delete(`/ai-command/sessions/${session.id}/pin`);
      else await api.put(`/ai-command/sessions/${session.id}/pin`);
      toast(session.pinned ? 'Sematan dilepas' : 'Percakapan disematkan', 'success');
      await afterChange();
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal mengubah sematan', 'error');
    }
  };

  const startRename = (session) => {
    renameHandledRef.current = null;
    setRenamingId(session.id);
    setRenameText(session.title || '');
  };

  const saveRename = async (session) => {
    // Enter and the following blur both call this; only the first one saves.
    if (renameHandledRef.current === session.id) return;
    renameHandledRef.current = session.id;
    const title = renameText.trim();
    setRenamingId(null);
    if (!title || title === session.title) return;
    try {
      await api.patch(`/ai-command/sessions/${session.id}`, { title });
      toast('Nama percakapan diganti', 'success');
      await afterChange();
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal mengganti nama', 'error');
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.delete(`/ai-command/sessions/${deleteTarget.id}`);
      toast('Percakapan dihapus', 'success');
      const deletedId = deleteTarget.id;
      setDeleteTarget(null);
      onSessionDeleted?.(deletedId);
      await afterChange();
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal menghapus percakapan', 'error');
    } finally {
      setBusy(false);
    }
  };
  const hasMore = rows.length < (meta.total || 0);

  return (
    <div className="ai-session-list">
      {canCreate && (
        <Button className="ai-sidebar-new" icon="edit_square" onClick={onNewChat}>
          Percakapan baru
        </Button>
      )}

      {onOpenInbox && (
        <button
          type="button"
          className={`ai-nav-item pw-state-layer ai-inbox-nav${inboxActive ? ' is-active' : ''}`}
          aria-current={inboxActive ? 'page' : undefined}
          onClick={onOpenInbox}
        >
          <Icon name="inbox" size="md" />
          <span className="ai-nav-label">Kotak aksi</span>
          <CountBadge count={inboxCount} label={`${inboxCount} menunggu`} />
        </button>
      )}

      <nav className="ai-sidebar-section" aria-label="Ruang kerja">
        <div className="ai-sidebar-label">Ruang kerja</div>
        {SPACES.map(({ value, label, icon }) => {
          const active = visibility === value;
          return (
            <button
              key={value || 'all'}
              type="button"
              className={`ai-nav-item pw-state-layer${active ? ' is-active' : ''}`}
              aria-current={active ? 'true' : undefined}
              onClick={() => setVisibility(value)}
            >
              <Icon name={icon} size="md" />
              <span className="ai-nav-label">{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`ai-nav-item pw-state-layer${archived ? ' is-active' : ''}`}
          aria-pressed={archived}
          onClick={() => setArchived((current) => !current)}
        >
          <Icon name="archive" size="md" />
          <span className="ai-nav-label">{archived ? 'Menampilkan arsip' : 'Arsip'}</span>
        </button>
        {visibility === 'department' && canStartDivisionChat && onNewDivisionChat && (
          <Button variant="text" icon="group" className="ai-division-new" onClick={onNewDivisionChat}>
            Buat percakapan divisi
          </Button>
        )}
      </nav>

      <div className="ai-recents" aria-label="Riwayat percakapan">
        {loading && (
          <div className="ai-skeleton-list" role="status" aria-label="Memuat percakapan">
            {['72%', '56%', '84%', '64%', '48%'].map((width) => (
              <SkeletonLine key={width} width={width} height={12} />
            ))}
          </div>
        )}

        {!loading && !rows.length && (
          <EmptyState
            compact
            icon={archived ? 'archive' : 'forum'}
            description={archived
              ? 'Tidak ada percakapan yang diarsipkan.'
              : visibility === 'department'
                ? 'Belum ada percakapan divisi. Mulai satu agar tim bisa bertanya bersama.'
                : 'Belum ada percakapan di ruang ini.'}
          />
        )}

        {!loading && groups.map((group) => (
          <section key={group.key} className="ai-recent-group">
            <div className="ai-sidebar-label">{group.label}</div>
            {group.items.map((session) => {
              const isSelected = !inboxActive && Number(session.id) === Number(selectedSessionId);
              const isOwner = Number(session.ownerUserId) === Number(user?.id);
              const title = session.title || `Percakapan #${session.id}`;
              const sharedIcon = SHARED_ICONS[session.visibility];
              if (renamingId === session.id) {
                return (
                  <Input
                    key={session.id}
                    fieldClassName="ai-rename-field"
                    value={renameText}
                    autoFocus
                    maxLength={255}
                    aria-label="Nama percakapan"
                    onChange={(event) => setRenameText(event.target.value)}
                    onBlur={() => saveRename(session)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); saveRename(session); }
                      if (event.key === 'Escape') { renameHandledRef.current = session.id; setRenamingId(null); }
                    }}
                  />
                );
              }
              return (
                <div key={session.id} className={`ai-session-row${isSelected ? ' is-active' : ''}`}>
                  {/* The full title on hover: long titles are cut with an ellipsis. */}
                  <span className="pw-tooltip-anchor ai-session-tip" data-pw-tooltip={title}>
                    <button
                      type="button"
                      onClick={() => onSelectSession(session.id)}
                      className={`ai-session-link pw-state-layer${isSelected ? ' is-active' : ''}`}
                      aria-current={isSelected ? 'page' : undefined}
                    >
                      {session.pinned && <Icon name="keep" size="sm" className="ai-session-pin" label="Disematkan" />}
                      <span className="ai-session-title" data-no-translate={session.title ? '' : undefined}>{title}</span>
                      {!isOwner && <span className="ai-session-owner" data-no-translate={session.ownerName ? '' : undefined}>{session.ownerName || 'user lain'}</span>}
                      {sharedIcon && <Icon name={sharedIcon} size="sm" className="ai-session-shared" label="Dibagikan" />}
                    </button>
                  </span>
                  <SessionMenu
                    title={title}
                    pinned={session.pinned}
                    canManage={isOwner && permissions.includes('ai_command.session.manage')}
                    onPin={() => togglePin(session)}
                    onRename={() => startRename(session)}
                    onEdit={() => onEditSession?.(session.id)}
                    onDelete={() => setDeleteTarget(session)}
                  />
                </div>
              );
            })}
          </section>
        ))}

        {!loading && hasMore && (
          <Button
            variant="text"
            block
            className="ai-load-more"
            onClick={() => load((meta.page || 1) + 1, true)}
            loading={loadingMore}
          >
            Muat lebih banyak
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus percakapan ini?"
        message={deleteTarget?.visibility === 'department'
          ? `“${deleteTarget?.title || 'Percakapan'}” akan hilang untuk semua anggota divisi. Tindakan ini tidak dapat dibatalkan dari antarmuka.`
          : `“${deleteTarget?.title || 'Percakapan'}” tidak akan tampil lagi. Tindakan ini tidak dapat dibatalkan dari antarmuka.`}
        confirmLabel="Hapus percakapan"
        tone="danger"
        loading={busy}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// Conversation options (the shared Menu, §4.14): pin, rename, edit, delete.
function SessionMenu({ title, pinned, canManage, onPin, onRename, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const items = [
    { key: 'pin', icon: pinned ? 'keep_off' : 'keep', label: pinned ? 'Lepas sematan' : 'Sematkan', onClick: onPin },
    ...(canManage ? [
      { key: 'rename', icon: 'edit', label: 'Ganti nama', onClick: onRename },
      { key: 'edit', icon: 'settings', label: 'Ubah detail', onClick: onEdit },
      { divider: true, key: 'divider' },
      { key: 'delete', icon: 'delete', label: 'Hapus', onClick: onDelete, tone: 'danger' },
    ] : []),
  ];

  return (
    <div className={`ai-session-menu${open ? ' is-open' : ''}`}>
      <IconButton
        ref={triggerRef}
        size="sm"
        label="Opsi"
        icon="more_vert"
        className="ai-session-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Opsi untuk ${title}`}
        onClick={() => setOpen((current) => !current)}
      />
      <Menu open={open} anchorRef={triggerRef} onClose={() => setOpen(false)} items={items} align="end" label={`Opsi untuk ${title}`} />
    </div>
  );
}

/* ============================================================
   Create session modal
   ============================================================ */

export function CreateSessionModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({
    title: '',
    sessionType: 'general',
    visibility: 'private',
    departmentId: '',
    systemContext: '',
    provider: '',
  });
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setProvidersLoading(true);
    api.get('/ai-command/providers')
      .then((r) => {
        if (cancelled) return;
        const items = r.data.data || [];
        setProviders(items);
        const available = items.filter((item) => item.available);
        setForm((currentForm) => {
          if (currentForm.provider && available.some((item) => item.id === currentForm.provider)) {
            return currentForm;
          }
          const preferred = available.find((item) => item.isDefault) || available[0];
          return { ...currentForm, provider: preferred?.id || '' };
        });
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      })
      .finally(() => {
        if (!cancelled) setProvidersLoading(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  const submit = async () => {
    setSaving(true);
    try {
      const r = await api.post('/ai-command/sessions', {
        title: form.title || undefined,
        sessionType: form.sessionType,
        visibility: form.visibility,
        departmentId: form.departmentId ? Number(form.departmentId) : undefined,
        systemContext: form.systemContext || undefined,
        provider: form.provider || undefined,
      });
      toast('Percakapan dibuat', 'success');
      onCreated?.(r.data.data.id);
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal membuat percakapan', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Percakapan baru" size="md">
      <div className="pw-stack">
        <Input
          label="Judul (opsional)"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Contoh: Analisa pipeline Q4"
        />

        <div className="pw-form-grid">
          <Select
            label="Tipe percakapan"
            value={form.sessionType}
            onChange={(e) => setForm({ ...form, sessionType: e.target.value })}
            options={[
              { value: 'general', label: 'Umum' },
              { value: 'analysis', label: 'Analisa' },
              { value: 'drafting', label: 'Penyusunan draf' },
              { value: 'research', label: 'Riset' },
            ]}
          />

          <Input
            label="ID divisi (opsional)"
            type="number"
            min="1"
            value={form.departmentId}
            onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
            hint="Kosongkan untuk memakai divisi Anda"
          />
        </div>

        <Select
          label="Engine AI"
          value={form.provider}
          onChange={(e) => setForm({ ...form, provider: e.target.value })}
          disabled={providersLoading}
          hint="Kredensial dan model diatur oleh server. Pengguna tidak dapat memasukkan API key sendiri."
          placeholder={providers.length ? undefined : (providersLoading ? 'Pilih engine' : 'Belum ada engine yang dikonfigurasi')}
          options={providers.map((item) => ({
            value: item.id,
            disabled: !item.available,
            label: `${item.label}${item.model ? ` · ${item.model}` : ''}${!item.available ? ' · belum dikonfigurasi' : ''}`,
          }))}
        />

        <Select
          label="Visibilitas"
          value={form.visibility}
          onChange={(e) => setForm({ ...form, visibility: e.target.value })}
          hint="Bawaan: Pribadi. Visibilitas dapat diubah di pengaturan percakapan."
          options={visibilityOptions()}
        />

        <Textarea
          label="Catatan atau instruksi percakapan (opsional)"
          value={form.systemContext}
          onChange={(e) => setForm({ ...form, systemContext: e.target.value })}
          rows={3}
          placeholder="Konteks tambahan yang Anda kontrol untuk percakapan ini."
          hint="Catatan percakapan adalah konteks tambahan yang Anda kontrol, bukan izin atau otorisasi."
        />

        <FormActions>
          <Button variant="text" onClick={onClose}>Batal</Button>
          <Button
            onClick={submit}
            loading={saving}
            disabled={providersLoading || !providers.some((item) => item.available)}
          >
            Buat percakapan
          </Button>
        </FormActions>
      </div>
    </Modal>
  );
}
