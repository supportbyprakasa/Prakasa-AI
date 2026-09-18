import { AlertTriangle } from 'lucide-react';
import Button from './Button';

export default function ConfirmDialog({
  open,
  title = 'Yakin?',
  message,
  confirmLabel = 'Ya, lanjutkan',
  cancelLabel = 'Batal',
  tone = 'danger',
  loading = false,
  onConfirm,
  onClose,
}) {
  if (!open) return null;
  const accent =
    tone === 'danger'
      ? 'var(--color-error)'
      : tone === 'warning'
      ? 'var(--color-warning)'
      : 'var(--color-primary)';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,.45)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 300,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)',
          borderRadius: 12,
          minWidth: 0,
          maxWidth: 480,
          width: '90%',
          padding: 24,
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              flexShrink: 0,
              background: `${accent}20`,
              color: accent,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <AlertTriangle size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>{title}</h3>
            <div
              style={{
                fontSize: 13,
                color: 'var(--color-text-muted)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {message}
            </div>
          </div>
        </div>
        <div
          style={{
            marginTop: 20,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Memproses…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

