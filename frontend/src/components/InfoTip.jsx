import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { anchoredProps, useAnchoredPosition } from './useOverlay';
import './info-tip.css';

// Rich tooltip behind an ⓘ button (docs/ui-guideline.md §4.14): a title and a
// few lines of explanation, longer than the plain one-line tooltip allows.
// Opens after the tooltip delay on hover or keyboard focus and closes on
// leave/blur; a click (or tap on a phone) pins it open until the next click,
// a click elsewhere or Escape. Read-only content: nothing inside to focus.
const DELAY_MS = 500;

export default function InfoTip({ label, title, children }) {
  const id = useId();
  const buttonRef = useRef(null);
  const surfaceRef = useRef(null);
  const timer = useRef(0);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;
  const position = useAnchoredPosition({ open, anchorRef: buttonRef, surfaceRef, align: 'start', placement: 'bottom' });

  const show = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setHovered(true), DELAY_MS); };
  const hide = () => { window.clearTimeout(timer.current); setHovered(false); };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      hide();
      setPinned(false);
    };
    const onPointer = (event) => {
      if (buttonRef.current?.contains(event.target)) return;
      setPinned(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="pw-info-tip pw-state-layer"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={() => { hide(); setPinned(false); }}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); window.clearTimeout(timer.current); setPinned((value) => !value); }}
      >
        <Icon name="info" size="sm" />
      </button>
      {open ? createPortal(
        <div ref={surfaceRef} id={id} role="tooltip" className="pw-info-tip__surface" {...anchoredProps(position)}>
          {title ? <div className="pw-info-tip__title">{title}</div> : null}
          <div className="pw-info-tip__body">{children}</div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
