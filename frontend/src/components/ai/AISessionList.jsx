import { useEffect, useState } from 'react';
import { Plus, RefreshCw, MessageSquare, Lock } from 'lucide-react';
import api from '../../api/client';
import Button from '../Button';
import Input from '../Input';
import Badge from '../Badge';
import Modal from '../Modal';
import { SkeletonCard } from '../Skeleton';
import { toast } from '../Toast';
import { useAuth } from '../../context/AuthContext';
import AIVisibilityBadge, { visibilityHelper } from './AIVisibilityBadge';

function relTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'baru saja';
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} hari lalu`;
  return d.toLocaleDateString('id-ID');
}

export default function AISessionList({
  selectedSessionId,
  onSelectSession,
  refreshKey,
}) {
  const { user } = useAuth();
  const canCreate = (user?.permissions || []).includes('ai_command.use');
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filters, setFilters] = useState({ status: 'active', visibility: '' });
  const [createOpen, setCreateOpen] = useState(false);

  const load = async (page = 1, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (filters.status) params.status = filters.status;
      if (filters.visibility) params.visibility = filters.visibility;
      const r = await api.get('/ai-command/sessions', { params });
      const nextRows = r.data.data || [];
      setRows((prev) => (append ? [...prev, ...nextRows] : nextRows));
      setMeta(r.data.meta || { page, limit: 20, total: nextRows.length });
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal memuat percakapan', 'error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => { load(1, false); /* eslint-disable-next-line */ }, [filters.status, filters.visibility, refreshKey]);

  const loadMore = () => {
    const nextPage = (meta.page || 1) + 1;
    if (nextPage * (meta.limit || 20) - (meta.limit || 20) >= (meta.total || 0)) return;
    load(nextPage, true);
  };

  const hasMore = rows.length < (meta.total || 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div style={{
        padding: 12, borderBottom: '1px solid var(--color-border)',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {canCreate && (
            <Button
              onClick={() => setCreateOpen(true)}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              <Plus size={14} /> Percakapan Baru
            </Button>
          )}
          <button
            type="button"
            onClick={() => load(1, false)}
            title="Refresh"
            style={{
              width: 36, height: 36, borderRadius: 8,
              border: '1px solid var(--color-border)',
              background: 'transparent', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <RefreshCw size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            style={{
              flex: 1, padding: 6, borderRadius: 8, fontSize: 12,
              border: '1px solid var(--color-border)',
            }}
          >
            <option value="active">Aktif</option>
            <option value="archived">Arsip</option>
            <option value="">Semua status</option>
          </select>
          <select
            value={filters.visibility}
            onChange={(e) => setFilters({ ...filters, visibility: e.target.value })}
            style={{
              flex: 1, padding: 6, borderRadius: 8, fontSize: 12,
              border: '1px solid var(--color-border)',
            }}
          >
            <option value="">Semua visibilitas</option>
            <option value="private">Private</option>
            <option value="department">Department</option>
            <option value="entity">Entity</option>
          </select>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {loading && (
          <div style={{ padding: 8 }}>
            <SkeletonCard lines={2} />
            <div style={{ height: 8 }} />
            <SkeletonCard lines={2} />
            <div style={{ height: 8 }} />
            <SkeletonCard lines={2} />
          </div>
        )}

        {!loading && !rows.length && (
          <div style={{
            padding: 24, textAlign: 'center',
            color: 'var(--color-text-muted)', fontSize: 13,
          }}>
            <MessageSquare size={28} style={{ opacity: 0.5 }} />
            <div style={{ marginTop: 8 }}>Belum ada percakapan AI.</div>
          </div>
        )}

        {!loading && rows.map((s) => {
          const isSelected = Number(s.id) === Number(selectedSessionId);
          const isOwner = Number(s.ownerUserId) === Number(user?.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelectSession(s.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: 10, marginBottom: 4,
                background: isSelected ? 'rgba(31,78,216,.08)' : 'transparent',
                border: '1px solid ' + (isSelected ? 'var(--color-primary)' : 'transparent'),
                borderRadius: 8, cursor: 'pointer', font: 'inherit',
                color: 'inherit',
              }}
            >
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'flex-start', gap: 6,
              }}>
                <div style={{
                  fontSize: 13, fontWeight: 600,
                  flex: 1, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {s.title || `Percakapan #${s.id}`}
                </div>
                {s.status === 'archived' && <Badge tone="default">arsip</Badge>}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                <AIVisibilityBadge visibility={s.visibility} />
                {!isOwner && (
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    <Lock size={10} /> {s.ownerName || 'user lain'}
                  </span>
                )}
              </div>
              <div style={{
                fontSize: 11, color: 'var(--color-text-muted)',
                marginTop: 4, display: 'flex',
                justifyContent: 'space-between',
              }}>
                <span>{relTime(s.lastMessageAt || s.createdAt)}</span>
                {s.provider && <span>{s.provider}</span>}
              </div>
            </button>
          );
        })}

        {!loading && hasMore && (
          <div style={{ textAlign: 'center', padding: 8 }}>
            <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
            </Button>
          </div>
        )}
      </div>

      <CreateSessionModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          load(1, false);
          onSelectSession?.(id);
        }}
      />
    </div>
  );
}

/* ============================================================
   Create session modal
   ============================================================ */

function CreateSessionModal({ open, onClose, onCreated }) {
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
            border: '1px solid var(--color-border)',
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
            border: '1px solid var(--color-border)',
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
            border: '1px solid var(--color-border)',
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
            border: '1px solid var(--color-border)', fontSize: 13,
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