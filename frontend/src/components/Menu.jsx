import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import IconSlot from './IconSlot';
import { nextMenuIndex } from './overlayModel';
import {
  FOCUSABLE, anchoredProps, useAnchoredPosition, useOverlay, usePresence, useLatestWhileOpen,
} from './useOverlay';
import './menu.css';

const ITEM_SELECTOR = '[role^="menuitem"]:not([disabled]):not([aria-disabled="true"])';
const CHECKED_SELECTOR = '[aria-checked="true"]:not([disabled])';

// Menu anchored to a trigger (docs/ui-guideline.md §4.14): white, radius 4,
// --pw-elev-menu, 8px vertical padding, 48px items, 112–280px wide. Opens
// below the anchor (above when there is no room; placement="top" prefers
// above), aligned to its start or end edge. Arrow keys / Home / End move
// between items; Escape, Tab, a choice or a click outside closes it and focus
// goes back to the trigger.
//
//   <Menu open anchorRef={buttonRef} onClose={…} align="end" label="Aksi"
//     items={[{ label: 'Ubah', icon: 'edit', onClick }, { divider: true },
//             { label: 'Hapus', icon: 'delete', tone: 'danger', onClick }]} />
//
// items: { label, description, icon, onClick, tone: 'danger', disabled,
//          divider, checked, key }.
//   description  a second line (Roboto 12/16, --pw-text-muted) under the label
//   checked      true/false makes the item a menuitemradio (aria-checked) with
//                a check after the label when chosen; the chosen item takes
//                focus when the menu opens
//   data         the label (and description) is record data — a customer,
//                item, warehouse or person name — never translated by the
//                language switch; `dataDescription` marks the description only
// header: optional node above the items (e.g. the signed-in account), not
//   focusable, separated from the items by a divider.
export default function Menu({
  open, anchorRef, onClose, items = [], align = 'end', placement = 'bottom', header = null, label, id, className = '',
}) {
  const { present, closing, onAnimationEnd } = usePresence(Boolean(open));
  const menuRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const view = useLatestWhileOpen(Boolean(open), (items || []).filter(Boolean));

  // Focus goes back to the trigger (or the first focusable element inside
  // the anchor, when the anchor is a wrapper).
  const closeAndReturn = () => {
    closeRef.current?.();
    const anchor = anchorRef?.current;
    const target = anchor?.matches?.(FOCUSABLE) ? anchor : anchor?.querySelector?.(FOCUSABLE);
    target?.focus({ preventScroll: true });
  };

  useOverlay({
    open: Boolean(open),
    containerRef: menuRef,
    onEscape: closeAndReturn,
    modal: false,
    restoreFocus: false,
    initialFocus: (root) => root.querySelector(CHECKED_SELECTOR) || root.querySelector(ITEM_SELECTOR),
  });

  // Position from the anchor before paint, and again on scroll / resize.
  const position = useAnchoredPosition({
    open: Boolean(open), anchorRef, surfaceRef: menuRef, align, placement, deps: [view.length],
  });

  // A press outside the menu and its trigger closes it (focus stays where
  // the press landed).
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (menuRef.current?.contains(event.target) || anchorRef?.current?.contains(event.target)) return;
      closeRef.current?.();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, anchorRef]);

  const onKeyDown = (event) => {
    const menu = menuRef.current;
    if (!menu) return;
    if (event.key === 'Escape') {
      // Handled here so a drawer or dialog behind the menu does not also close.
      event.preventDefault();
      event.stopPropagation();
      closeAndReturn();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      closeAndReturn();
      return;
    }
    const enabled = [...menu.querySelectorAll(ITEM_SELECTOR)];
    const next = nextMenuIndex(event.key, enabled.indexOf(document.activeElement), enabled.length);
    if (next !== enabled.indexOf(document.activeElement) && next >= 0) {
      event.preventDefault();
      enabled[next].focus();
    }
  };

  if (!present || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      className={['pw-menu', className].filter(Boolean).join(' ')}
      data-state={closing ? 'closing' : 'open'}
      {...anchoredProps(position)}
      onKeyDown={onKeyDown}
      onAnimationEnd={onAnimationEnd}
    >
      {header ? <div className="pw-menu__header" role="none">{header}</div> : null}
      {view.map((item, index) => {
        if (item.divider) return <div key={item.key || `divider-${index}`} className="pw-menu__divider" role="separator" />;
        const radio = item.checked !== undefined;
        const classes = [
          'pw-menu__item', 'pw-state-layer', item.tone === 'danger' ? 'is-danger' : '',
          item.description ? 'has-description' : '', radio && item.checked ? 'is-checked' : '',
        ].filter(Boolean).join(' ');
        return (
          <button
            key={item.key || item.label}
            type="button"
            role={radio ? 'menuitemradio' : 'menuitem'}
            aria-checked={radio ? Boolean(item.checked) : undefined}
            className={classes}
            disabled={item.disabled}
            onClick={() => {
              closeAndReturn();
              item.onClick?.();
            }}
          >
            {item.icon ? <IconSlot icon={item.icon} size="lg" className="pw-menu__icon" /> : null}
            {item.description ? (
              <span className="pw-menu__text">
                <span className="pw-menu__label" data-no-translate={item.data ? '' : undefined}>{item.label}</span>
                <span className="pw-menu__description" data-no-translate={(item.dataDescription ?? item.data) ? '' : undefined}>{item.description}</span>
              </span>
            ) : <span className="pw-menu__label" data-no-translate={item.data ? '' : undefined}>{item.label}</span>}
            {radio && item.checked ? <Icon name="check" className="pw-menu__check" /> : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
