import { useEffect, useId, useState } from 'react';
import Button from './Button';
import Modal from './Modal';
import Textarea from './Textarea';

// Every "why?" is one dialog (docs/ui-guideline.md §3.3, §4.14): a small Modal
// holding a <form> with the reason field, its error on the field, then the
// cancel button and the action bottom-right. Used by Warehouse (the
// Supervisor's decision, cancelling an approved movement, explaining or undoing
// a reconciliation) and Sales (rejecting an Accurate batch).
//
//   open, title, description?, label = 'Alasan', hint?
//   tone         'primary' | 'danger' (the action button)
//   confirmLabel, cancelLabel = 'Batal'
//   required     an empty field shows "<label> wajib diisi." ("Alasan wajib diisi." by default)
//   minLength, maxLength = 500
//   onConfirm(text) is awaited; the dialog stays open (and busy) until it
//   settles, and cannot be closed meanwhile. onClose()
export const REASON_REQUIRED = 'Alasan wajib diisi.';

export default function ReasonDialog({
  open,
  title,
  description,
  label = 'Alasan',
  required = true,
  minLength = 1,
  maxLength = 500,
  hint,
  confirmLabel,
  cancelLabel = 'Batal',
  tone = 'primary',
  onClose,
  onConfirm,
}) {
  const formId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setValue(''); setError(''); setBusy(false); }
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    const text = value.trim();
    if (required && !text) { setError(label && label !== 'Alasan' ? `${label.replace(/\s*\*$/, '')} wajib diisi.` : REASON_REQUIRED); return; }
    if (text && text.length < minLength) { setError(`${label} minimal ${minLength} karakter.`); return; }
    setBusy(true);
    try {
      await onConfirm(text);
    } finally {
      setBusy(false);
    }
  };
  const close = () => { if (!busy) onClose(); };

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      size="sm"
      footer={(
        <>
          <Button type="button" variant="text" onClick={close} disabled={busy}>{cancelLabel}</Button>
          <Button type="submit" form={formId} variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy}>{confirmLabel}</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        {description ? <div className="pw-muted">{description}</div> : null}
        <Textarea
          label={label}
          required={required}
          rows={3}
          maxLength={maxLength}
          value={value}
          error={error}
          hint={hint}
          onChange={(event) => { setValue(event.target.value); setError(''); }}
        />
      </form>
    </Modal>
  );
}
