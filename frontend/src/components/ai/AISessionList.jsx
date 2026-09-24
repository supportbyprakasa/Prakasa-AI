import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, Building2, Inbox, Lock, MessagesSquare, MoreHorizontal, Pencil, Pin, PinOff,
  Settings2, SquarePen, Trash2, Users,
} from 'lucide-react';
import ConfirmDialog from '../ConfirmDialog';
import api from '../../api/client';
import Button from '../Button';
import Input from '../Input';
import Modal from '../Modal';
import { toast } from '../Toast';
import { useAuth } from '../../context/AuthContext';
import { visibilityHelper } from './AIVisibilityBadge';
import { groupSessionsByRecency } from '../../pages/ai/aiCommandCenterModel';

const PAGE_SIZE = 30;

const SPACES = [
  { value: '', label: 'Semua percakapan', icon: MessagesSquare },
  { value: 'private', label: 'Pribadi', icon: Lock },
  { value: 'department', label: 'Divisi', icon: Users },
  { value: 'entity', label: 'Lintas divisi', icon: Building2 },
];

const SHARED_ICONS = { department: Users, entity: Building2 };

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
        <button type="button" className="ai-new-chat-button ai-ripple" onClick={onNewChat}>
          <SquarePen size={18} />
          <span>Percakapan baru</span>
        </button>
      )}

      {onOpenInbox && (
        <button
          type="button"
          className={`ai-nav-item ai-ripple ai-inbox-nav${inboxActive ? ' is-active' : ''}`}
          aria-current={inboxActive ? 'page' : undefined}
          onClick={onOpenInbox}
        >
          <Inbox size={18} />
          <span>Kotak aksi</span>
          {inboxCount > 0 && <span className="ai-nav-badge" aria-label={`${inboxCount} menunggu`}>{inboxCount > 99 ? '99+' : inboxCount}</span>}
        </button>
      )}

      <nav className="ai-sidebar-section" aria-label="Ruang kerja">
        <div className="ai-sidebar-label">Ruang kerja</div>
        {SPACES.map(({ value, label, icon: Icon }) => {
          const active = visibility === value;
          return (
            <button
              key={value || 'all'}
              type="button"
              className={`ai-nav-item ai-ripple${active ? ' is-active' : ''}`}
              aria-current={active ? 'true' : undefined}
              onClick={() => setVisibility(value)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`ai-nav-item ai-ripple${archived ? ' is-active' : ''}`}
          aria-pressed={archived}
          onClick={() => setArchived((current) => !current)}
        >
          <Archive size={18} />
          <span>{archived ? 'Menampilkan arsip' : 'Arsip'}</span>
        </button>
        {visibility === 'department' && canStartDivisionChat && onNewDivisionChat && (
          <button type="button" className="ai-text-button ai-ripple ai-division-new" onClick={onNewDivisionChat}>
            <Users size={16} />
            <span>Percakapan divisi baru</span>
          </button>
        )}
      </nav>

      <div className="ai-recents" aria-label="Riwayat percakapan">
        {loading && (
          <div className="ai-skeleton-list" aria-hidden="true">
            {[72, 56, 84, 64, 48].map((width) => (
              <span key={width} className="ai-skeleton-line" style={{ width: `${width}%` }} />
            ))}
          </div>
        )}

        {!loading && !rows.length && (
          <div className="ai-session-empty">
            {archived
              ? 'Tidak ada percakapan yang diarsipkan.'
              : visibility === 'department'
                ? 'Belum ada percakapan divisi. Mulai satu agar tim bisa bertanya bersama.'
                : 'Belum ada percakapan di ruang ini.'}
          </div>
        )}

        {!loading && groups.map((group) => (
          <section key={group.key} className="ai-recent-group">
            <div className="ai-sidebar-label">{group.label}</div>
            {group.items.map((session) => {
              const isSelected = !inboxActive && Number(session.id) === Number(selectedSessionId);
              const isOwner = Number(session.ownerUserId) === Number(user?.id);
              const title = session.title || `Percakapan #${session.id}`;
              const SharedIcon = SHARED_ICONS[session.visibility];
              if (renamingId === session.id) {
                return (
                  <input
                    key={session.id}
                    className="ai-rename-input"
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
                  <button
                    type="button"
                    title={title}
                    onClick={() => onSelectSession(session.id)}
                    className={`ai-session-link ai-ripple${isSelected ? ' is-active' : ''}`}
                    aria-current={isSelected ? 'page' : undefined}
                  >
                    {session.pinned && <Pin size={13} className="ai-session-pin" aria-label="Disematkan" />}
                    <span className="ai-session-title">{title}</span>
                    {!isOwner && <small className="ai-session-owner">{session.ownerName || 'user lain'}</small>}
                    {SharedIcon && <SharedIcon size={14} className="ai-session-shared" aria-label="Dibagikan" />}
                  </button>
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
          <button
            type="button"
            className="ai-text-button ai-ripple ai-load-more"
            onClick={() => load((meta.page || 1) + 1, true)}
            disabled={loadingMore}
          >
            {loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
          </button>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus percakapan ini?"
        message={deleteTarget?.visibility === 'department'
          ? `“${deleteTarget?.title || 'Percakapan'}” akan hilang untuk semua anggota divisi. Tindakan ini tidak dapat dibatalkan dari antarmuka.`
          : `“${deleteTarget?.title || 'Percakapan'}” tidak akan tampil lagi. Tindakan ini tidak dapat dibatalkan dari antarmuka.`}
        confirmLabel="Hapus"
        tone="danger"
        loading={busy}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function SessionMenu({ title, pinned, canManage, onPin, onRename, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (action) => () => { setOpen(false); action(); };
  const items = [
    { key: 'pin', icon: pinned ? PinOff : Pin, label: pinned ? 'Lepas sematan' : 'Sematkan', run: onPin },
    ...(canManage ? [
      { key: 'rename', icon: Pencil, label: 'Ganti nama', run: onRename },
      { key: 'edit', icon: Settings2, label: 'Edit detail', run: onEdit },
      { key: 'delete', icon: Trash2, label: 'Hapus', run: onDelete, danger: true },
    ] : []),
  ];

  return (
    <div className={`ai-dropdown is-bottom is-right ai-session-menu${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="ai-icon-button is-small ai-ripple ai-session-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Opsi untuk ${title}`}
        title="Opsi"
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="ai-menu" role="menu" aria-label={`Opsi untuk ${title}`}>
          {items.map(({ key, icon: Icon, label, run, danger }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              className={`ai-menu-item ai-ripple${danger ? ' is-danger' : ''}`}
              onClick={choose(run)}
            >
              <Icon size={16} aria-hidden="true" />
              <span className="ai-menu-item-text"><strong>{label}</strong></span>
            </button>
          ))}
        </div>
      )}
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
      toast(e.response?.data?.error?.message || 'Gagal membuat', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Percakapan Baru" maxWidth={520}>
      <Input
        label="Judul (opsional)"
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        placeholder="Contoh: Analisa pipeline Q4"
      />

      <div style={{ marginTop: 12 }}>
        <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Tipe Session</label>
        <select
          value={form.sessionType}
          onChange={(e) => setForm({ ...form, sessionType: e.target.value })}
          style={{
            width: '100%', padding: 8, borderRadius: 8,
            boxShadow: 'inset 0 0 0 1px var(--color-border)',
          }}
        >
          <option value="general">Umum</option>
          <option value="analysis">Analisa</option>
          <option value="drafting">Drafting</option>
          <option value="research">Research</option>
        </select>
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>AI Engine</label>
        <select
          value={form.provider}
          onChange={(e) => setForm({ ...form, provider: e.target.value })}
          disabled={providersLoading}
          style={{
            width: '100%', padding: 8, borderRadius: 8,
            boxShadow: 'inset 0 0 0 1px var(--color-border)',
          }}
        >
          {!providers.length && (
            <option value="">
              {providersLoading ? 'Memuat engine…' : 'Belum ada engine yang dikonfigurasi'}
            </option>
          )}
          {providers.map((item) => (
            <option key={item.id} value={item.id} disabled={!item.available}>
              {item.label}
              {item.model ? ` · ${item.model}` : ''}
              {!item.available ? ' · belum dikonfigurasi' : ''}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
          Credential dan model dikontrol oleh server. User tidak dapat memasukkan API key sendiri.
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Visibilitas</label>
        <select
          value={form.visibility}
          onChange={(e) => setForm({ ...form, visibility: e.target.value })}
          style={{
            width: '100%', padding: 8, borderRadius: 8,
            boxShadow: 'inset 0 0 0 1px var(--color-border)',
          }}
        >
          <option value="private">Private — {visibilityHelper('private')}</option>
          <option value="department">Department — {visibilityHelper('department')}</option>
          <option value="entity">Entity — {visibilityHelper('entity')}</option>
        </select>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
          Default: Private. Visibilitas dapat diubah di pengaturan session.
        </div>
      </div>

      <Input
        label="Department ID (opsional)"
        type="number"
        min="1"
        value={form.departmentId}
        onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
        placeholder="Kosong = department user"
      />

      <div style={{ marginTop: 12 }}>
        <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
          Catatan / Instruksi Session (opsional)
        </label>
        <textarea
          value={form.systemContext}
          onChange={(e) => setForm({ ...form, systemContext: e.target.value })}
          rows={3}
          placeholder="Konteks tambahan yang Anda kontrol untuk percakapan ini."
          style={{
            width: '100%', padding: 10, borderRadius: 8,
            boxShadow: 'inset 0 0 0 1px var(--color-border)', fontSize: 13,
          }}
        />
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
          Catatan session adalah konteks tambahan yang Anda kontrol. Ini bukan permission atau otorisasi.
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>Batal</Button>
        <Button
          onClick={submit}
          disabled={saving || providersLoading || !providers.some((item) => item.available)}
        >
          {saving ? 'Membuat…' : 'Buat Percakapan'}
        </Button>
      </div>
    </Modal>
  );
}
