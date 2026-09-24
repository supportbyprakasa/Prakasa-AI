import { useEffect, useId, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import Button from './Button';
import { shouldCloseDialogOnKey } from './confirmDialogModel';

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
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const loadingRef = useRef(loading);
  const titleId = useId();
  const messageId = useId();

  closeRef.current = onClose;
  loadingRef.current = loading;

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusInitial = window.requestAnimationFrame(() => {
      const focusable = dialog?.querySelectorAll(focusableSelector) || [];
      (focusable[focusable.length - 1] || dialog)?.focus();
    });

    const handleKeyDown = (event) => {
      if (shouldCloseDialogOnKey({ key: event.key, loading: loadingRef.current })) {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll(focusableSelector)];
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusInitial);
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;
  const accent =
    tone === 'danger'
      ? 'var(--pw-error)'
      : tone === 'warning'
      ? 'var(--pw-warning)'
      : 'var(--pw-primary)';

  return (
    <div
      className="pw-scrim"
      onClick={() => { if (!loading) onClose?.(); }}
      role="presentation"
      style={{ zIndex: 300 }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        tabIndex={-1}
        className="pw-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 480 }}
      >
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 'var(--pw-radius-full)',
              flexShrink: 0,
              background: `color-mix(in srgb, ${accent} 12%, transparent)`,
              color: accent,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <AlertTriangle size={20} aria-hidden="true" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 id={titleId} className="pw-dialog__title" style={{ marginBottom: 8 }}>{title}</h3>
            <div
              id={messageId}
              style={{
                fontSize: 14,
                lineHeight: 1.5,
                color: 'var(--pw-on-surface-variant)',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {message}
            </div>
          </div>
        </div>
        <div className="pw-dialog__footer">
          <Button variant="text" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
