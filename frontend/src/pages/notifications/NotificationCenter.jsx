import { useCallback, useEffect, useState } from 'react';
import { Check, Trash2, RefreshCw } from 'lucide-react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import FilterBar from '../../components/FilterBar';
import ConfirmDialog from '../../components/ConfirmDialog';
import NotificationItem from '../../components/notifications/NotificationItem';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';
import { useNotificationCount } from '../../context/NotificationContext';

const PAGE_SIZE = 20;

export default function NotificationCenter() {
  const { refreshUnreadCount } = useNotificationCount();

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: PAGE_SIZE, total: 0, unreadCount: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    status: '', event: '', subjectType: '', from: '', to: '',
  });
  const [clearReadOpen, setClearReadOpen] = useState(false);

  const load = useCallback(async (nextPage = 1) => {
    if (filters.from && filters.to && filters.from > filters.to) {
      toast('Rentang tanggal tidak valid', 'error');
      return;
    }
    setLoading(true);
    try {
      const params = { page: nextPage, limit: PAGE_SIZE };
      if (filters.status === 'unread') params.unread = '1';
      else if (filters.status === 'read') params.unread = '0';
      if (filters.event) params.event = filters.event;
      if (filters.subjectType) params.subjectType = filters.subjectType;
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;

      const r = await api.get('/notifications', { params });
      setRows(r.data.data || []);
      setMeta(r.data.meta || { page: nextPage, limit: PAGE_SIZE, total: 0, unreadCount: 0 });
      setPage(nextPage);
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal memuat notifikasi', 'error');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [filters.status, filters.event, filters.subjectType, filters.from, filters.to]);

  const afterMutation = async () => {
    await refreshUnreadCount();
  };

  const markRead = async (id, { silent = false } = {}) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      if (silent) {
        setRows((current) =>
          current.map((item) =>
            Number(item.id) === Number(id)
              ? { ...item, isRead: true, readAt: item.readAt || new Date().toISOString() }
              : item
          )
        );
        setMeta((current) => ({
          ...current,
          unreadCount: Math.max(0, Number(current.unreadCount || 0) - 1),
        }));
      } else {
        await load(page);
      }
      await afterMutation();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
      throw e;
    }
  };

  const markUnread = async (id) => {
    try {
      await api.patch(`/notifications/${id}/unread`);
      await load(page);
      await afterMutation();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const dismiss = async (id) => {
    try {
      await api.delete(`/notifications/${id}`);
      await load(page);
      await afterMutation();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const markAll = async () => {
    try {
      await api.patch('/notifications/read-all');
      await load(page);
      await afterMutation();
      toast('Semua notifikasi ditandai dibaca', 'success');
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const clearRead = async () => {
    try {
      const r = await api.delete('/notifications/read');
      await load(1);
      await afterMutation();
      toast(`${r.data?.data?.deleted || 0} notifikasi dibaca dihapus`, 'success');
      setClearReadOpen(false);
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const totalPages = Math.max(1, Math.ceil((meta.total || 0) / (meta.limit || PAGE_SIZE)));

  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 12,
      }}>
        <div>
          <h2 style={{ margin: 0 }}>
            Notification Center
            {meta.unreadCount > 0 && (
              <span style={{ marginLeft: 8, fontSize: 14, color: 'var(--color-primary)' }}>
                ({meta.unreadCount} belum dibaca)
              </span>
            )}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => load(1)}>
            <RefreshCw size={14} />
          </Button>
          <Button variant="secondary" onClick={markAll}>
            <Check size={14} /> Tandai semua dibaca          </Button>
          <Button variant="danger" onClick={() => setClearReadOpen(true)}>
            <Trash2 size={14} /> Bersihkan yang dibaca
          </Button>
        </div>
      </div>

      <FilterBar
        filters={[
          { name: 'status', label: 'Status', type: 'select', options: [
            { value: 'unread', label: 'Belum dibaca' },
            { value: 'read', label: 'Dibaca' },
          ]},
          { name: 'event', label: 'Event', type: 'text', placeholder: 'task.assigned' },
          { name: 'subjectType', label: 'Subjek', type: 'text', placeholder: 'task' },
        ]}
        values={filters}
        onChange={setFilters}
        onReset={() => setFilters({ status: '', event: '', subjectType: '', from: '', to: '' })}
      >
        <Input label="Dari" type="date" value={filters.from}
          onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          style={{ margin: 0, width: 150 }} />
        <Input label="Sampai" type="date" value={filters.to}
          onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          style={{ margin: 0, width: 150 }} />
        <Button variant="secondary" onClick={() => load(1)}>Terapkan</Button>
      </FilterBar>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      )}

      {!loading && !rows.length && (
        <Card>
          <div style={{
            padding: 24, textAlign: 'center',
            color: 'var(--color-text-muted)', fontSize: 13,
          }}>
            Belum ada notifikasi.
          </div>
        </Card>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              onMarkRead={markRead}
              onMarkUnread={markUnread}
              onDismiss={dismiss}
            />
          ))}
        </div>
      )}

      {!loading && rows.length > 0 && totalPages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginTop: 12, fontSize: 13, color: 'var(--color-text-muted)',
        }}>
          <Button variant="secondary" onClick={() => load(page - 1)} disabled={page <= 1}>
            ← Sebelumnya
          </Button>
          <span>Halaman {page} dari {totalPages}</span>
          <Button variant="secondary" onClick={() => load(page + 1)} disabled={page >= totalPages}>
            Selanjutnya →
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={clearReadOpen}
        title="Bersihkan notifikasi yang sudah dibaca?"
        message="Semua notifikasi berstatus dibaca akan dihapus dari daftar Anda. Notifikasi belum dibaca tidak terpengaruh."
        confirmLabel="Ya, bersihkan"
        tone="danger"
        onConfirm={clearRead}
        onClose={() => setClearReadOpen(false)}
      />
    </div>
  );
}