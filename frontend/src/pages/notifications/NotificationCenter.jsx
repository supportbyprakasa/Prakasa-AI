import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import Page from '../../components/Page';
import ActionMenu from '../../components/ActionMenu';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import DateInput from '../../components/DateInput';
import Select from '../../components/Select';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import ConfirmDialog from '../../components/ConfirmDialog';
import Pager from '../../components/datagrid/Pager';
import NotificationItem from '../../components/notifications/NotificationItem';
import {
  NOTIFICATION_EVENT_GROUPS, NOTIFICATION_SUBJECTS, dateRangeError, unreadSummary,
} from '../../components/notifications/notificationModel';
import { toast } from '../../components/Toast';
import { useNotificationCount } from '../../context/NotificationContext';
import './notification-center.css';

const PAGE_SIZE = 20;
const NO_FILTERS = { status: '', event: '', subjectType: '', from: '', to: '' };
const STATUS_CHIPS = [
  { value: '', label: 'Semua' },
  { value: 'unread', label: 'Belum dibaca' },
  { value: 'read', label: 'Dibaca' },
];
const errorMessage = (e, fallback) => e.response?.data?.error?.message || fallback;

export default function NotificationCenter() {
  const { refreshUnreadCount } = useNotificationCount();

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: PAGE_SIZE, total: 0, unreadCount: 0 });
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [clearReadOpen, setClearReadOpen] = useState(false);
  const rangeError = dateRangeError(filters.from, filters.to);

  const load = useCallback(async (nextPage = 1) => {
    // An inverted date range is shown on the "Sampai" field; nothing is requested.
    if (dateRangeError(filters.from, filters.to)) return;
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
      setLoadError('');
      setLoaded(true);
    } catch (e) {
      setLoadError(errorMessage(e, 'Gagal memuat notifikasi'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [filters.status, filters.event, filters.subjectType, filters.from, filters.to]);

  const setFilter = (name, value) => setFilters((current) => ({ ...current, [name]: value }));
  const filtered = Object.values(filters).some(Boolean);

  const afterMutation = async () => {
    await refreshUnreadCount();
  };

  const markRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      await load(page);
      await afterMutation();
    } catch (e) {
      toast(errorMessage(e, 'Gagal menandai notifikasi dibaca'), 'error');
    }
  };

  const markUnread = async (id) => {
    try {
      await api.patch(`/notifications/${id}/unread`);
      await load(page);
      await afterMutation();
    } catch (e) {
      toast(errorMessage(e, 'Gagal menandai notifikasi belum dibaca'), 'error');
    }
  };

  const dismiss = async (id) => {
    try {
      await api.delete(`/notifications/${id}`);
      await load(page);
      await afterMutation();
    } catch (e) {
      toast(errorMessage(e, 'Gagal menghapus notifikasi'), 'error');
    }
  };

  const markAll = async () => {
    try {
      await api.patch('/notifications/read-all');
      await load(page);
      await afterMutation();
      toast('Semua notifikasi ditandai dibaca', 'success');
    } catch (e) {
      toast(errorMessage(e, 'Gagal menandai semua notifikasi'), 'error');
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
      toast(errorMessage(e, 'Gagal membersihkan notifikasi'), 'error');
    }
  };

  const totalPages = Math.max(1, Math.ceil((meta.total || 0) / (meta.limit || PAGE_SIZE)));

  let list;
  if (loadError) {
    list = (
      <EmptyState
        tone="error"
        title="Notifikasi tidak dapat dimuat"
        description={loadError}
        action={<Button variant="secondary" onClick={() => load(page)}>Coba lagi</Button>}
      />
    );
  } else if (loading && !rows.length) {
    list = <LoadingState label="Memuat notifikasi…" />;
  } else if (!rows.length) {
    list = (
      <EmptyState
        icon="notifications_none"
        title={filtered ? 'Tidak ada notifikasi yang cocok' : 'Belum ada notifikasi'}
        description={filtered ? 'Ubah atau hapus filter untuk melihat notifikasi lain.' : 'Pemberitahuan dari task, persetujuan, dan modul lain akan muncul di sini.'}
      />
    );
  } else {
    list = (
      <ul className={`pw-notification-list${loading ? ' is-loading' : ''}`} aria-busy={loading || undefined}>
        {rows.map((n) => (
          <NotificationItem
            key={n.id}
            notification={n}
            onMarkRead={markRead}
            onMarkUnread={markUnread}
            onDismiss={dismiss}
          />
        ))}
      </ul>
    );
  }

  return (
    <Page
      title="Notifikasi"
      description={loaded ? unreadSummary(meta.unreadCount) : null}
      actions={(
        <>
          <Button variant="secondary" icon="done_all" onClick={markAll}>Tandai semua dibaca</Button>
          <ActionMenu
            label="Aksi lainnya"
            items={[
              { label: 'Muat ulang', icon: 'refresh', onClick: () => load(page) },
              { label: 'Bersihkan yang dibaca', icon: 'delete_sweep', tone: 'danger', onClick: () => setClearReadOpen(true) },
            ]}
          />
        </>
      )}
    >
      <section className="nc-panel" aria-label="Daftar notifikasi">
        <div className="nc-filters">
          <div className="pw-row" role="group" aria-label="Status baca">
            {STATUS_CHIPS.map((chip) => (
              <Chip key={chip.value || 'all'} selected={filters.status === chip.value} onClick={() => setFilter('status', chip.value)}>
                {chip.label}
              </Chip>
            ))}
            {filtered ? <Button variant="text" icon="filter_alt_off" onClick={() => setFilters(NO_FILTERS)}>Hapus filter</Button> : null}
          </div>
          <div className="nc-fields">
            <Select label="Jenis notifikasi" value={filters.event} placeholder="Semua jenis" onChange={(e) => setFilter('event', e.target.value)}>
              {NOTIFICATION_EVENT_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.events.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                </optgroup>
              ))}
            </Select>
            <Select
              label="Terkait dengan"
              value={filters.subjectType}
              placeholder="Semua"
              options={NOTIFICATION_SUBJECTS}
              onChange={(e) => setFilter('subjectType', e.target.value)}
            />
            <DateInput label="Dari" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} />
            <DateInput label="Sampai" value={filters.to} min={filters.from || undefined} error={rangeError} onChange={(e) => setFilter('to', e.target.value)} />
          </div>
        </div>

        {list}

        {rows.length > 0 && !loadError ? (
          <Pager page={page} pageCount={totalPages} onPageChange={(p) => load(p)} disabled={loading} label="Halaman notifikasi" />
        ) : null}
      </section>

      <ConfirmDialog
        open={clearReadOpen}
        title="Bersihkan notifikasi yang sudah dibaca?"
        message="Semua notifikasi berstatus dibaca akan dihapus dari daftar Anda. Notifikasi belum dibaca tidak terpengaruh."
        confirmLabel="Ya, bersihkan"
        tone="danger"
        onConfirm={clearRead}
        onClose={() => setClearReadOpen(false)}
      />
    </Page>
  );
}
