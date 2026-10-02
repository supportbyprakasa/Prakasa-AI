import { dataZone } from '../i18n/zones.js';
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import FormActions from './FormActions';
import Icon from './Icon';
import IconButton from './IconButton';
import { useLatestWhileOpen, useOverlay, usePresence, useScrimDismiss } from './useOverlay';
import './side-sheet.css';

// Side sheet on the right (docs/ui-guideline.md §4.14): 400px wide, full
// screen on phones, a 64px header with the title and the close X, a scrim.
// `modal={false}` gives a sheet without scrim or focus trap that the page
// behind stays usable with (Escape still closes it).
export default function SideSheet({
  open,
  onClose,
  title,
  // The title is a record's own name or number: never translated.
  dataTitle = false,
  children,
  footer,
  actions,
  modal = true,
  size = 'md',
  className = '',
}) {
  const { present, closing, onAnimationEnd } = usePresence(Boolean(open));
  const sheetRef = useRef(null);
  const titleId = useId();
  useOverlay({ open: Boolean(open), containerRef: sheetRef, onEscape: onClose, modal });
  const view = useLatestWhileOpen(Boolean(open), { title, children, footer: footer ?? actions });
  const scrim = useScrimDismiss(onClose);

  if (!present || typeof document === 'undefined') return null;
  return createPortal(
    <div className={`pw-sheet-layer${modal ? '' : ' pw-sheet-layer--modeless'}`} data-state={closing ? 'closing' : 'open'}>
      {modal ? <div className="pw-sheet-scrim" role="presentation" {...scrim} /> : null}
      <aside
        ref={sheetRef}
        role="dialog"
        aria-modal={modal ? 'true' : undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        className={['pw-sheet', size === 'lg' ? 'pw-sheet--lg' : '', className].filter(Boolean).join(' ')}
        onAnimationEnd={onAnimationEnd}
      >
        <header className="pw-sheet__header">
          <h2 id={titleId} className="pw-sheet__title" {...dataZone(dataTitle)}>{view.title}</h2>
          <IconButton label="Tutup" onClick={onClose} disabled={!onClose || closing} className="pw-sheet__close">
            <Icon name="close" />
          </IconButton>
        </header>
        <div className="pw-sheet__body">{view.children}</div>
        {view.footer ? (
          <div className="pw-sheet__footer">
            <FormActions>{view.footer}</FormActions>
          </div>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}
