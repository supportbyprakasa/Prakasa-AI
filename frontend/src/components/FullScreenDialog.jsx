import { dataZone } from '../i18n/zones.js';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ConfirmDialog from './ConfirmDialog';
import FormActions from './FormActions';
import Icon from './Icon';
import IconButton from './IconButton';
import { useLatestWhileOpen, useOverlay, usePresence } from './useOverlay';
import './dialog.css';

// Full-screen dialog, the admin console's "Add new user" (docs/ui-guideline.md
// §3.3, §4.14): a 72px accent app bar with the close X on the left and the
// title, white content cards with a section title, two-column fields, and the
// actions bottom-right outside the card. No scrim; slides up from the bottom.
//
//   <FullScreenDialog open title="Tambah pengguna" onClose={…}
//     actions={<><Button variant="text">Batal</Button><Button>Simpan</Button></>}
//     sectionTitle="Informasi pengguna">
//     <div className="pw-fsdialog__fields">…fields…</div>
//   </FullScreenDialog>
//
// Several cards: pass `card={false}` and wrap each part in <FullScreenSection>.
// `footer` is accepted as an alias of `actions` (Modal size="lg").
// `dirty`: the form holds unsaved changes — Escape and the X first ask
// "Buang perubahan?" (Buang / Lanjutkan mengisi); only "Buang" calls onClose.
// A Batal button in `actions` is the page's own and closes as it decides.
// `asPage`: the dialog IS the route's page (a /new or /:id/edit form), so its
// title is the page's <h1> (same look).
export default function FullScreenDialog({
  open,
  onClose,
  title,
  // The title is a record's own name or number: never translated.
  dataTitle = false,
  children,
  actions,
  footer,
  sectionTitle,
  headerActions,
  card = true,
  dirty = false,
  asPage = false,
  className = '',
}) {
  const TitleTag = asPage ? 'h1' : 'h2';
  const { present, closing, onAnimationEnd } = usePresence(Boolean(open));
  const dialogRef = useRef(null);
  const titleId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => { if (!open) setConfirmOpen(false); }, [open]);
  const requestClose = onClose ? () => { if (dirty) setConfirmOpen(true); else onClose(); } : undefined;
  useOverlay({ open: Boolean(open), containerRef: dialogRef, onEscape: requestClose });
  const view = useLatestWhileOpen(Boolean(open), {
    title, children, actions: actions ?? footer, sectionTitle, headerActions,
  });

  if (!present || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={['pw-dialog', 'pw-dialog--fullscreen', className].filter(Boolean).join(' ')}
      data-state={closing ? 'closing' : 'open'}
      onAnimationEnd={onAnimationEnd}
    >
      <header className="pw-fsdialog__appbar">
        <IconButton label="Tutup" onClick={requestClose} disabled={!onClose || closing} className="pw-fsdialog__close">
          <Icon name="close" />
        </IconButton>
        <TitleTag id={titleId} className="pw-fsdialog__title" {...dataZone(dataTitle)}>{view.title}</TitleTag>
        {view.headerActions ? <div className="pw-fsdialog__appbar-actions">{view.headerActions}</div> : null}
      </header>
      <div className="pw-fsdialog__body">
        <div className="pw-fsdialog__content">
          {card ? <FullScreenSection title={view.sectionTitle}>{view.children}</FullScreenSection> : view.children}
          {view.actions ? <FormActions className="pw-fsdialog__actions">{view.actions}</FormActions> : null}
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Buang perubahan?"
        message="Perubahan yang belum disimpan akan hilang."
        confirmLabel="Buang"
        cancelLabel="Lanjutkan mengisi"
        tone="danger"
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); onClose?.(); }}
      />
    </div>,
    document.body,
  );
}

// One white content card of a full-screen dialog, with its section title
// (Roboto 18/24, the admin console's "User information").
export function FullScreenSection({ title, children, className = '' }) {
  return (
    <section className={['pw-fsdialog__card', className].filter(Boolean).join(' ')}>
      {title ? <h3 className="pw-fsdialog__section-title">{title}</h3> : null}
      {children}
    </section>
  );
}
