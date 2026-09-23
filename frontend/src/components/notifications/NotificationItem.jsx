import { useNavigate } from 'react-router-dom';
import { Bell, Check, RotateCcw, X, ExternalLink } from 'lucide-react';
import Button from '../Button';
import Badge from '../Badge';

function safeInternalPath(url) {
  if (typeof url !== 'string') return null;
  const s = url.trim();
  if (!s.startsWith('/')) return null;
  if (s.startsWith('//')) return null;
  if (s.includes('://')) return null;
  return s;
}

export default function NotificationItem({
  notification,
  onMarkRead,
  onMarkUnread,
  onDismiss,
}) {
  const nav = useNavigate();
  const isRead = !!notification.isRead;
  const target = safeInternalPath(notification.actionUrl);

  const handleOpen = async () => {
    if (!isRead && onMarkRead) {
      try {
        await onMarkRead(notification.id, { silent: true });
      } catch {
        // Navigation still offered separately.
      }
    }
    if (target) nav(target);
  };

  return (
    <div style={{
      background: isRead ? 'var(--color-surface)' : '#eff6ff',
      border: '1px solid var(--color-border)',
      borderRadius: 10,
      padding: 12,
      display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 16, flexShrink: 0,
        background: isRead ? '#f1f5f9' : 'rgba(31,78,216,.12)',
        color: isRead ? 'var(--color-text-muted)' : 'var(--color-primary)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Bell size={15} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
          <div style={{
            fontSize: 14, fontWeight: isRead ? 500 : 600,
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {notification.title}
          </div>
          <Badge tone={notification.event?.startsWith('task.') ? 'info' : 'default'}>
            {notification.event}
          </Badge>
        </div>

        {notification.body && (
          <div style={{
            fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4,
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
          }}>
            {notification.body}
          </div>
        )}

        <div style={{
          display: 'flex', gap: 10, marginTop: 6,
          fontSize: 11, color: 'var(--color-text-muted)', flexWrap: 'wrap',
        }}>
          {notification.createdAt && (
            <span>{new Date(notification.createdAt).toLocaleString('id-ID')}</span>
          )}
          {notification.subjectType && (
            <span>· {notification.subjectType}{notification.subjectId ? ` #${notification.subjectId}` : ''}</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {target && (
            <Button variant="secondary" onClick={handleOpen}>
              <ExternalLink size={12} /> Buka
            </Button>
          )}
          {!isRead && (
            <Button variant="secondary" onClick={() => onMarkRead(notification.id)}>
              <Check size={12} /> Tandai dibaca
            </Button>
          )}
          {isRead && (
            <Button variant="secondary" onClick={() => onMarkUnread(notification.id)}>
              <RotateCcw size={12} /> Tandai belum dibaca
            </Button>
          )}
          <Button variant="danger" onClick={() => onDismiss(notification.id)}>
            <X size={12} /> Hapus
          </Button>
        </div>
      </div>
    </div>
  );
}