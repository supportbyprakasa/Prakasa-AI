import { useId, useRef } from 'react';
import Button from './Button';
import { DialogBase } from './Modal';
import { confirmInitialFocus, shouldCloseDialogOnKey } from './confirmDialogModel';

// Confirmation before a destructive or important action (docs/ui-guideline.md
// §4.13–4.14): the small-dialog base at 480px, title, message, then Batal (text)
// and the action on the right. While `loading`, Escape and the scrim do nothing.
// A destructive confirmation opens with focus on Batal, so Enter never deletes.
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
  const messageId = useId();
  const loadingRef = useRef(loading);
  const closeRef = useRef(onClose);
  loadingRef.current = loading;
  closeRef.current = onClose;

  const close = () => { if (!loadingRef.current) closeRef.current?.(); };
  const onEscape = () => {
    if (shouldCloseDialogOnKey({ key: 'Escape', loading: loadingRef.current })) closeRef.current?.();
  };
  const initialFocus = (root) => root.querySelector(`[data-confirm-focus="${confirmInitialFocus(tone)}"]`);

  return (
    <DialogBase
      open={open}
      size="sm"
      title={title}
      onClose={close}
      onEscape={onEscape}
      closeButton={false}
      className="pw-confirm"
      describedBy={message ? messageId : undefined}
      initialFocus={initialFocus}
      footer={(
        <>
          <Button variant="text" onClick={close} disabled={loading} data-confirm-focus="cancel">
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
            data-confirm-focus="confirm"
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      {message ? <div id={messageId} className="pw-confirm__message">{message}</div> : null}
    </DialogBase>
  );
}
