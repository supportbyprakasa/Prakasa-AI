import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, children, footer, maxWidth = 640, minWidth = 0 }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const frame = window.requestAnimationFrame(() => {
      if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus();
    });
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        // Only the top-most modal dialog reacts, so a stacked confirmation closes first.
        const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
        if (dialogs[dialogs.length - 1] !== dialogRef.current) return;
        closeRef.current?.();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="pw-scrim" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="pw-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth, minWidth: `min(${minWidth}px, calc(100vw - 32px))` }}
      >
        <div className="pw-dialog__header">
          <h3 id={titleId} className="pw-dialog__title">{title}</h3>
          <button type="button" className="pw-icon-button pw-state-layer pw-ripple" aria-label="Tutup" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {children}
        {footer && <div className="pw-dialog__footer">{footer}</div>}
      </div>
    </div>
  );
}
