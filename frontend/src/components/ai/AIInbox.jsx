import { noTranslate, strictTranslate } from '../../i18n/NoTranslate';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { toast } from '../Toast';
import Badge from '../Badge';
import Button from '../Button';
import ConfirmDialog from '../ConfirmDialog';
import EmptyState from '../EmptyState';
import Icon from '../Icon';
import IconButton from '../IconButton';
import Spinner from '../Spinner';
import './ai-components.css';
import {
  confirmationDialogCopy,
  confirmationSuccessMessage,
  shouldShowInboxEmpty,
} from './aiInboxModel';
import { safeInAppPath } from '../safeHref.js';
import { numberLocale, dateLocale } from '../../i18n/language.js';

const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatAmount(amount, currency) {
  if (amount === null || amount === undefined) return '';
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  try {
    return new Intl.NumberFormat(numberLocale(), { style: 'currency', currency: currency || 'IDR', maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency || ''} ${value.toLocaleString(numberLocale())}`;
  }
}

const isInternalUrl = (url) => Boolean(safeInAppPath(url));

export default function AIInbox({ onOpenSession, onChanged, onOpenSidebar }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await api.get('/ai-command/inbox');
      setData(response.data.data);
      onChanged?.(response.data.data.counts);
    } catch (error) {
      const message = errorMessage(error, 'Gagal memuat kotak aksi');
      setLoadError(message);
      toast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const runBusy = async (key, fn) => {
    setBusyKey(key);
    try {
      await fn();
      await load();
    } finally {
      setBusyKey('');
    }
  };

  const confirmProposal = () => runBusy(`confirm-${confirmTarget.id}`, async () => {
    try {
      const response = await api.post(`/ai-command/actions/${confirmTarget.id}/confirm`);
      toast(confirmationSuccessMessage(response.data.data), 'success');
    } catch (error) {
      toast(errorMessage(error, 'Gagal menjalankan aksi'), 'error');
    } finally {
      setConfirmTarget(null);
    }
  });

  const rejectProposal = (item) => runBusy(`reject-${item.id}`, async () => {
    try {
      await api.post(`/ai-command/actions/${item.id}/reject`, { reason: null });
      toast('Proposal ditolak', 'success');
    } catch (error) {
      toast(errorMessage(error, 'Gagal menolak proposal'), 'error');
    } finally {
      setRejectTarget(null);
    }
  });

  const markRead = (item) => runBusy(`read-${item.id}`, async () => {
    try {
      await api.patch(`/notifications/${item.id}/read`);
    } catch (error) {
      toast(errorMessage(error, 'Gagal menandai notifikasi'), 'error');
    }
  });

  const markAllRead = () => runBusy('read-all', async () => {
    try {
      await api.patch('/notifications/read-all');
    } catch (error) {
      toast(errorMessage(error, 'Gagal menandai notifikasi'), 'error');
    }
  });

  const openNotification = async (item) => {
    try { await api.patch(`/notifications/${item.id}/read`); } catch { /* opening still works */ }
    if (isInternalUrl(item.actionUrl)) navigate(item.actionUrl);
    else load();
  };

  const proposals = data?.proposals || [];
  const approvals = data?.approvals || [];
  const notifications = data?.notifications || [];
  const empty = shouldShowInboxEmpty({ loading, error: loadError, data });

  return (
    <div className="ai-conversation">
      <header className="ai-topbar">
        {onOpenSidebar && (
          <IconButton label="Buka navigasi" icon="menu" onClick={onOpenSidebar} />
        )}
        <span className="ai-title"><span className="ai-title-text">Kotak aksi</span></span>
        <div className="ai-topbar-actions">
          <IconButton label="Muat ulang kotak aksi" icon={loading ? <Spinner label={null} /> : 'refresh'} onClick={load} disabled={loading} />
        </div>
      </header>

      <div className="ai-message-scroll">
        <div className="ai-thread ai-inbox">
          <p className="ai-inbox-intro">Hal yang menunggu keputusan Anda, dikumpulkan dari AI, approval, dan notifikasi.</p>

          {loadError && (
            <EmptyState
              tone="error"
              title="Kotak aksi belum dapat dimuat"
              description={loadError}
              action={(
                <Button variant="secondary" icon="refresh" onClick={load} loading={loading}>
                  Coba lagi
                </Button>
              )}
            />
          )}

          {empty && (
            <EmptyState
              icon="inbox"
              title="Semua beres"
              description="Tidak ada proposal, approval, atau notifikasi yang menunggu Anda."
            />
          )}

          {proposals.length > 0 && (
            <section className="ai-inbox-section" aria-label="Proposal aksi dari AI">
              <h2><Icon name="auto_awesome" /> Proposal aksi dari AI <Badge>{proposals.length}</Badge></h2>
              {proposals.map((item) => (
                <article key={item.id} className="ai-inbox-card">
                  <div className="ai-inbox-card-main">
                    <span className="ai-inbox-tag"><Badge tone="info">{item.actionLabel}</Badge></span>
                    <span className="ai-inbox-title" {...noTranslate}>{item.title}</span>
                    <span className="ai-inbox-meta">Dari percakapan “<span {...noTranslate}>{item.sessionTitle}</span>” · {formatDate(item.createdAt)}</span>
                  </div>
                  <div className="ai-inbox-card-actions">
                    <Button variant="text" onClick={() => onOpenSession(item.sessionId)}>
                      Buka percakapan
                    </Button>
                    <Button variant="danger" disabled={Boolean(busyKey)} onClick={() => setRejectTarget(item)}>
                      Tolak
                    </Button>
                    <Button disabled={Boolean(busyKey)} onClick={() => setConfirmTarget(item)}>
                      Konfirmasi
                    </Button>
                  </div>
                </article>
              ))}
            </section>
          )}

          {approvals.length > 0 && (
            <section className="ai-inbox-section" aria-label="Approval menunggu keputusan Anda">
              <h2><Icon name="assignment_turned_in" /> Approval menunggu keputusan Anda <Badge>{approvals.length}</Badge></h2>
              {approvals.map((item) => (
                <article key={item.id} className="ai-inbox-card">
                  <div className="ai-inbox-card-main">
                    {item.requestType && <span className="ai-inbox-tag"><Badge tone="info">{item.requestType}</Badge></span>}
                    <span className="ai-inbox-title" {...noTranslate}>{item.title}</span>
                    <span className="ai-inbox-meta">
                      {[item.requesterName && `Diajukan ${item.requesterName}`, formatAmount(item.amount, item.currency), formatDate(item.createdAt)]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <div className="ai-inbox-card-actions">
                    <Button variant="secondary" onClick={() => navigate('/approvals')}>
                      Buka di Approval
                    </Button>
                  </div>
                </article>
              ))}
            </section>
          )}

          {notifications.length > 0 && (
            <section className="ai-inbox-section" aria-label="Notifikasi belum dibaca">
              <h2>
                <Icon name="notifications" /> Notifikasi belum dibaca <Badge>{data.counts.notifications}</Badge>
                <span className="ai-inbox-section-action">
                  <Button variant="text" icon="done_all" disabled={Boolean(busyKey)} loading={busyKey === 'read-all'} onClick={markAllRead}>
                    Tandai semua dibaca
                  </Button>
                </span>
              </h2>
              {notifications.map((item) => (
                <article key={item.id} className="ai-inbox-card">
                  <div className="ai-inbox-card-main">
                    <span className="ai-inbox-title">{item.title}</span>
                    {item.body && <span className="ai-inbox-body" {...strictTranslate}>{item.body}</span>}
                    <span className="ai-inbox-meta">{formatDate(item.createdAt)}</span>
                  </div>
                  <div className="ai-inbox-card-actions">
                    <Button variant="text" disabled={Boolean(busyKey)} onClick={() => markRead(item)}>
                      Tandai dibaca
                    </Button>
                    {isInternalUrl(item.actionUrl) && (
                      <Button variant="secondary" onClick={() => openNotification(item)}>Buka notifikasi</Button>
                    )}
                  </div>
                </article>
              ))}
            </section>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmTarget)}
        title="Jalankan aksi ini?"
        message={confirmationDialogCopy(confirmTarget)}
        confirmLabel={confirmTarget?.actionType === 'create_task' ? 'Ya, jalankan' : 'Ya, konfirmasi'}
        tone="primary"
        loading={Boolean(confirmTarget) && busyKey === `confirm-${confirmTarget.id}`}
        onConfirm={confirmProposal}
        onClose={() => setConfirmTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(rejectTarget)}
        title="Tolak proposal ini?"
        message={rejectTarget ? `${rejectTarget.actionLabel}: “${rejectTarget.title}” akan ditolak dan tidak dijalankan.` : ''}
        confirmLabel="Tolak proposal"
        tone="danger"
        loading={Boolean(rejectTarget) && busyKey === `reject-${rejectTarget.id}`}
        onConfirm={() => rejectProposal(rejectTarget)}
        onClose={() => setRejectTarget(null)}
      />
    </div>
  );
}
