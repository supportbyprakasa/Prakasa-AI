import { dataZone } from '../i18n/zones.js';
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import FormActions from './FormActions';
import FullScreenDialog from './FullScreenDialog';
import Icon from './Icon';
import IconButton from './IconButton';
import { useLatestWhileOpen, useOverlay, usePresence, useScrimDismiss } from './useOverlay';
import './dialog.css';

// Dialog (docs/ui-guideline.md §3.3, §4.14).
//   size="sm"  480px — confirmation, form of up to 5 fields
//   size="md"  640px — standard short form (default)
//   size="lg"  full-screen dialog like the admin console's "Add new user"
// Full screen on phones. `maxWidth` / `minWidth` are no longer supported
// (§5.5): they are accepted and ignored so old callers keep working.
export default function Modal({ size = 'md', maxWidth, minWidth, ...props }) { // eslint-disable-line no-unused-vars
  if (size === 'lg' || size === 'full') return <FullScreenDialog {...props} />;
  return <DialogBase size={size === 'sm' ? 'sm' : 'md'} {...props} />;
}

// The base shared by Modal and ConfirmDialog: portal, scrim, motion, focus
// trap, Escape for the top-most dialog, focus back to the trigger.
export function DialogBase({
  open,
  onClose,
  onEscape,
  title,
  // The title is a record's own name (an event, a file): never translated.
  dataTitle = false,
  children,
  footer,
  size = 'md',
  closeButton = true,
  className = '',
  describedBy,
  initialFocus,
  dismissible = true,
  bodyClassName = '',
}) {
  const { present, closing, onAnimationEnd } = usePresence(Boolean(open));
  const dialogRef = useRef(null);
  const titleId = useId();
  useOverlay({ open: Boolean(open), containerRef: dialogRef, onEscape: onEscape ?? onClose, initialFocus });
  const view = useLatestWhileOpen(Boolean(open), { title, children, footer });
  const scrim = useScrimDismiss(dismissible ? onClose : undefined);

  if (!present || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="pw-scrim"
      data-state={closing ? 'closing' : 'open'}
      role="presentation"
      onAnimationEnd={onAnimationEnd}
      {...scrim}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={['pw-dialog', `pw-dialog--${size}`, className].filter(Boolean).join(' ')}
      >
        <div className="pw-dialog__header">
          <h2 id={titleId} className="pw-dialog__title" {...dataZone(dataTitle)}>{view.title}</h2>
          {closeButton ? (
            <IconButton size="sm" label="Tutup" onClick={onClose} disabled={!onClose || closing} className="pw-dialog__close">
              <Icon name="close" />
            </IconButton>
          ) : null}
        </div>
        <div className={['pw-dialog__body', bodyClassName].filter(Boolean).join(' ')}>{view.children}</div>
        {view.footer ? (
          <div className="pw-dialog__footer">
            <FormActions>{view.footer}</FormActions>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
