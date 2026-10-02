import { strictTranslate } from '../../i18n/NoTranslate';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import ActionMenu from '../ActionMenu';
import Button from '../Button';
import ConfirmDialog from '../ConfirmDialog';
import CountBadge from '../CountBadge';
import Icon from '../Icon';
import IconButton from '../IconButton';
import { toast } from '../Toast';
import { formatDateTime } from '../format';
import { batchDecision, decisionError, eventIcon, eventLabel, hasEventLabel, safeInternalPath } from './notificationModel';
import './notifications.css';

// One notification as a list row (docs/ui-guideline.md §4.9, like a grid row):
// the title is the link to the record (the whole row is its hit area, keyboard
// reachable through the link), unread rows show a dot and a 500 title. Row
// actions: one IconButton (read / unread) and ⋮ (Buka, Hapus); a waiting
// Accurate batch also gets "Setujui" under its text (program 1.2) with its
// confirmation.
export default function NotificationItem({
  notification,
  onMarkRead,
  onMarkUnread,
  onDismiss,
}) {
  const nav = useNavigate();
  const { user } = useAuth() || {};
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [decision, setDecision] = useState({ busy: false, error: '' });
  const isRead = !!notification.isRead;
  const target = safeInternalPath(notification.actionUrl);
  // Quick approval is for a new notification: approving marks it read, and a read
  // one is decided from its batch page ("Buka").
  const batch = !isRead && (user?.permissions || []).includes('approval.decide') ? batchDecision(notification) : null;

  const approve = async () => {
    setDecision({ busy: true, error: '' });
    try {
      await api.post(`/approvals/${batch.approvalId}/decide`, { action: 'approve' });
      setApproveOpen(false);
      toast('Data Accurate disetujui & diterapkan', 'success');
      if (onMarkRead) await Promise.resolve(onMarkRead(notification.id, { silent: true })).catch(() => {});
    } catch (err) {
      setApproveOpen(false);
      setDecision({ busy: false, error: decisionError(err?.response?.status, err?.response?.data?.error?.message) });
    }
  };

  const handleOpen = async () => {
    if (!isRead && onMarkRead) {
      try {
        await onMarkRead(notification.id, { silent: true });
      } catch {
        // Navigation still goes ahead.
      }
    }
    if (target) nav(target);
  };

  const onLinkClick = (event) => {
    // Plain clicks mark the notification read first; a modified click (new tab) is left to the browser.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    handleOpen();
  };

  const title = notification.title || eventLabel(notification.event);
  const menu = [
    target ? { label: 'Buka', icon: 'open_in_new', onClick: handleOpen } : null,
    { label: 'Hapus', icon: 'delete', tone: 'danger', onClick: () => setConfirmOpen(true) },
  ];

  return (
    <li className={`pw-notification pw-state-layer${isRead ? '' : ' is-unread'}${target ? ' is-link' : ''}`}>
      <span className="pw-notification__dot">
        {isRead ? null : <CountBadge dot label="Belum dibaca" />}
      </span>
      <Icon name={eventIcon(notification.event)} className="pw-notification__icon" />

      <div className="pw-notification__body">
        {target ? (
          <Link to={target} className="pw-notification__title pw-notification__link" onClick={onLinkClick}>{title}</Link>
        ) : (
          <span className="pw-notification__title">{title}</span>
        )}
        {/* The body is a record's number and title, a reason someone typed, or a
            sentence of the app around them: only a whole sentence is translated. */}
        {notification.body ? <p className="pw-notification__text" {...strictTranslate}>{notification.body}</p> : null}
        <p className="pw-notification__meta">
          <span data-no-translate={hasEventLabel(notification.event) ? undefined : ''}>{eventLabel(notification.event)}</span>
          {notification.createdAt ? <span aria-hidden="true">·</span> : null}
          {notification.createdAt ? <span className="pw-nowrap">{formatDateTime(notification.createdAt)}</span> : null}
        </p>
        {decision.error ? <p className="pw-notification__error" role="alert">{decision.error}</p> : null}
        {batch ? (
          <div className="pw-notification__quick">
            <Button variant="secondary" icon="done_all" onClick={() => setApproveOpen(true)} disabled={decision.busy}>Setujui</Button>
          </div>
        ) : null}
      </div>

      <div className="pw-notification__actions">
        {isRead ? (
          <IconButton size="sm" icon="mark_email_unread" label="Tandai belum dibaca" onClick={() => onMarkUnread(notification.id)} />
        ) : (
          <IconButton size="sm" icon="mark_email_read" label="Tandai dibaca" onClick={() => onMarkRead(notification.id)} />
        )}
        <ActionMenu size="sm" label="Aksi notifikasi" items={menu} />
      </div>

      {batch ? (
        <ConfirmDialog
          open={approveOpen}
          tone="primary"
          title="Setujui data Accurate?"
          message={`${notification.body || notification.title}. Data disimpan sebagai data Accurate divisinya; data lama di aplikasi tidak diubah dan tidak ada yang dihapus. Untuk menolak, buka batch-nya.`}
          confirmLabel="Setujui & terapkan"
          loading={decision.busy}
          onConfirm={approve}
          onClose={() => setApproveOpen(false)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="Hapus notifikasi?"
        message={`Notifikasi "${title}" akan dihapus.`}
        confirmLabel="Hapus notifikasi"
        tone="danger"
        onConfirm={() => { setConfirmOpen(false); onDismiss(notification.id); }}
        onClose={() => setConfirmOpen(false)}
      />
    </li>
  );
}
