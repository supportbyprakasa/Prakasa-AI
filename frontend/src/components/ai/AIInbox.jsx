import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  ClipboardCheck,
  Inbox,
  Loader2,
  Menu,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import api from '../../api/client';
import { toast } from '../Toast';
import ConfirmDialog from '../ConfirmDialog';
import {
  confirmationDialogCopy,
  confirmationSuccessMessage,
  shouldShowInboxEmpty,
} from './aiInboxModel';

const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatAmount(amount, currency) {
  if (amount === null || amount === undefined) return '';
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  try {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: currency || 'IDR', maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency || ''} ${value.toLocaleString('id-ID')}`;
  }
}

const isInternalUrl = (url) => typeof url === 'string' && url.startsWith('/') && !url.startsWith('//');

export default function AIInbox({ onOpenSession, onChanged, onOpenSidebar }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [confirmTarget, setConfirmTarget] = useState(null);

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
          <button type="button" className="ai-icon-button ai-ripple" onClick={onOpenSidebar} aria-label="Buka navigasi">
            <Menu size={20} />
          </button>
        )}
        <span className="ai-title-text">Kotak aksi</span>
        <div className="ai-topbar-actions">
          <button
            type="button"
            className="ai-icon-button ai-ripple"
            onClick={load}
            disabled={loading}
            aria-label="Muat ulang kotak aksi"
            title="Muat ulang"
          >
            {loading ? <Loader2 className="ai-spin" size={19} /> : <RefreshCw size={19} />}
          </button>
        </div>
      </header>

      <div className="ai-message-scroll">
        <div className="ai-thread ai-inbox">
          <p className="ai-inbox-intro">Hal yang menunggu keputusan Anda, dikumpulkan dari AI, approval, dan notifikasi.</p>

          {loadError && (
            <div className="ai-inbox-error" role="alert">
              <strong>Kotak aksi belum dapat dimuat</strong>
              <span>{loadError}</span>
              <button type="button" className="ai-tonal-button ai-ripple" onClick={load} disabled={loading}>
                {loading ? <Loader2 className="ai-spin" size={15} /> : <RefreshCw size={15} />}
                Coba lagi
              </button>
            </div>
          )}

          {empty && (
            <div className="ai-inbox-empty">
              <Inbox size={32} />
              <strong>Semua beres</strong>
              <span>Tidak ada proposal, approval, atau notifikasi yang menunggu Anda.</span>
            </div>
          )}

          {proposals.length > 0 && (
            <section className="ai-inbox-section" aria-label="Proposal aksi dari AI">
              <h2><Sparkles size={18} /> Proposal aksi dari AI <span className="ai-count">{proposals.length}</span></h2>
              {proposals.map((item) => (
                <article key={item.id} className="ai-inbox-card">
                  <div className="ai-inbox-card-main">
                    <span className="ai-inbox-tag">{item.actionLabel}</span>
                    <strong>{item.title}</strong>
                    <small>Dari percakapan “{item.sessionTitle}” · {formatDate(item.createdAt)}</small>
                  </div>
                  <div className="ai-inbox-card-actions">
                    <button type="button" className="ai-tonal-button ai-ripple" disabled={Boolean(busyKey)} onClick={() => setConfirmTarget(item)}>
                      Konfirmasi
                    </button>
                    <button type="button" className="ai-text-button ai-ripple" disabled={Boolean(busyKey)} onClick={() => rejectProposal(item)}>
                      {busyKey === `reject-${item.id}` ? <Loader2 className="ai-spin" size={15} /> : 'Tolak'}
                    </button>
                    <button type="button" className="ai-text-button ai-ripple" onClick={() => onOpenSession(item.sessionId)}>
                      Buka percakapan
                    </button>
                  </div>
                </article>
              ))}
            </section>
          )}

          {approvals.length > 0 && (
            <section className="ai-inbox-section" aria-label="Approval menunggu keputusan Anda">
              <h2><ClipboardCheck size={18} /> Approval menunggu keputusan Anda <span className="ai-count">{approvals.length}</span></h2>
              {approvals.map((item) => (
                <article key={item.id} className="ai-inbox-card">
                  <div className="ai-inbox-card-main">
                    {item.requestType && <span className="ai-inbox-tag">{item.requestType}</span>}
                    <strong>{item.title}</strong>
                    <small>
                      {[item.requesterName && `Diajukan ${item.requesterName}`, formatAmount(item.amount, item.currency), formatDate(item.createdAt)]
                        .filter(Boolean).join(' · ')}
                    </small>
                  </div>
                  <div className="ai-inbox-card-actions">
                    <button type="button" className="ai-tonal-button ai-ripple" onClick={() => navigate('/approvals')}>
                      Buka di Approval
                    </button>
                  </div>
                </article>
              ))}
            </section>
          )}

          {notifications.length > 0 && (
            <section className="ai-inbox-section" aria-label="Notifikasi belum dibaca">
              <h2>
                <Bell size={18} /> Notifikasi belum dibaca <span className="ai-count">{data.counts.notifications}</span>
                <button type="button" className="ai-text-button ai-ripple ai-inbox-section-action" disabled={Boolean(busyKey)} onClick={markAllRead}>
                  <CheckCheck size={15} /> Tandai semua dibaca
                </button>
              </h2>
              {notifications.map((item) => (
                <article key={item.id} className="ai-inbox-card">
                  <div className="ai-inbox-card-main">
                    <strong>{item.title}</strong>
                    {item.body && <span className="ai-inbox-body">{item.body}</span>}
                    <small>{formatDate(item.createdAt)}</small>
                  </div>
                  <div className="ai-inbox-card-actions">
                    {isInternalUrl(item.actionUrl) && (
                      <button type="button" className="ai-tonal-button ai-ripple" onClick={() => openNotification(item)}>Buka</button>
                    )}
                    <button type="button" className="ai-text-button ai-ripple" disabled={Boolean(busyKey)} onClick={() => markRead(item)}>
                      Tandai dibaca
                    </button>
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
    </div>
  );
}
