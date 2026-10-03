import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createOverlayStack, menuPosition } from './overlayModel';

// Shared behaviour of every overlay (docs/ui-guideline.md §4.14): open order,
// Escape for the top-most one only, a focus trap for modal ones, scroll lock,
// focus back to the trigger, and an exit animation before unmounting.

const stack = createOverlayStack();
export const isTopOverlay = (id) => stack.isTop(id);

export const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe', '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function focusableIn(root) {
  if (!root) return [];
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

// Body scroll lock, counted so nested modals unlock only when the last closes.
let locks = 0;
let saved = null;
function lockScroll() {
  locks += 1;
  if (locks > 1) return;
  const { body, documentElement } = document;
  const scrollbar = window.innerWidth - documentElement.clientWidth;
  saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  body.style.overflow = 'hidden';
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
}
function unlockScroll() {
  locks = Math.max(0, locks - 1);
  if (locks > 0 || !saved) return;
  document.body.style.overflow = saved.overflow;
  document.body.style.paddingRight = saved.paddingRight;
  saved = null;
}

// Registers an open overlay.
//   containerRef  element that receives focus and holds the trap
//   onEscape      called on Escape when this overlay is the top-most one
//   modal         trap Tab and lock page scroll
//   initialFocus  (root) => element to focus first; default the container
//   escapeWithin  Escape counts only while focus is inside the container
//                 (a docked, non-modal panel must not eat the page's Escape)
export function useOverlay({
  open, containerRef, onEscape, onTabOut, modal = true, initialFocus, restoreFocus = true, escapeWithin = false,
}) {
  const id = useId();
  // The trigger is read while rendering the open overlay: React applies a
  // child's autoFocus when it commits, before any effect here runs, so by
  // effect time document.activeElement is already inside the overlay.
  const triggerRef = useRef(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    const active = document.activeElement;
    triggerRef.current = active && active !== document.body ? active : null;
  }
  wasOpen.current = Boolean(open);
  const escapeWithinRef = useRef(escapeWithin);
  escapeWithinRef.current = escapeWithin;
  const escapeRef = useRef(onEscape);
  const tabOutRef = useRef(onTabOut);
  tabOutRef.current = onTabOut;
  // Set when a non-modal overlay was left with Tab: focus then continues from
  // its trigger, so closing must not pull it back.
  const leftByTab = useRef(false);
  const initialRef = useRef(initialFocus);
  escapeRef.current = onEscape;
  initialRef.current = initialFocus;

  useEffect(() => {
    if (!open) return undefined;
    const root0 = containerRef.current;
    const captured = triggerRef.current;
    const active = document.activeElement;
    const previous = captured && !(root0 && root0.contains(captured))
      ? captured
      : (active && !(root0 && root0.contains(active)) ? active : null);
    leftByTab.current = false;
    stack.push(id);
    if (modal) lockScroll();
    const frame = window.requestAnimationFrame(() => {
      const root = containerRef.current;
      if (!root || root.contains(document.activeElement)) return;
      const target = initialRef.current?.(root);
      (target || root).focus({ preventScroll: true });
    });

    const onKeyDown = (event) => {
      if (!stack.isTop(id)) return;
      if (event.key === 'Escape') {
        // An inner control (an open listbox, a search field) handled it first.
        if (event.defaultPrevented || !escapeRef.current) return;
        if (escapeWithinRef.current && !containerRef.current?.contains(document.activeElement)) return;
        event.preventDefault();
        escapeRef.current();
        return;
      }
      if (event.key === 'Tab' && !modal && tabOutRef.current) {
        // Non-modal popover: Tab past its last item (Shift+Tab before its
        // first) closes it and moves on from the trigger, like a menu.
        const root = containerRef.current;
        const items = root ? focusableIn(root) : [];
        const active = document.activeElement;
        const leaving = root && root.contains(active)
          && (event.shiftKey ? (active === items[0] || active === root) : (active === items[items.length - 1] || !items.length));
        if (leaving) {
          leftByTab.current = true;
          if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
          tabOutRef.current();
          // No preventDefault: the browser's Tab now moves on from the trigger.
          if (event.shiftKey) event.preventDefault();
        }
        return;
      }
      if (event.key !== 'Tab' || !modal) return;
      const root = containerRef.current;
      if (!root) return;
      const items = focusableIn(root);
      if (!items.length) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (active === first || active === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      stack.remove(id);
      if (modal) unlockScroll();
      if (restoreFocus && !leftByTab.current && previous && previous.isConnected && typeof previous.focus === 'function') {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return id;
}

// Keeps an overlay mounted while its exit animation runs. `closing` is true
// between `open` turning false and the element's own animationend.
const EXIT_FALLBACK_MS = 400;
export function usePresence(open) {
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  const closing = present && !open;

  useEffect(() => {
    if (!closing) return undefined;
    const timer = window.setTimeout(() => setPresent(false), EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  const onAnimationEnd = (event) => {
    if (closing && event.target === event.currentTarget) setPresent(false);
  };
  return { present: open || present, closing, onAnimationEnd };
}

// The content shown while closing is the last content shown while open, so
// a parent that clears its data on close never renders a half-empty dialog.
export function useLatestWhileOpen(open, value) {
  const ref = useRef(value);
  if (open) ref.current = value;
  return open ? value : ref.current;
}

// Scrim click that closes only when the press also started on the scrim (a
// text selection dragged out of a field must not close the dialog).
export function useScrimDismiss(onDismiss) {
  const downRef = useRef(false);
  return {
    onPointerDown: (event) => { downRef.current = event.target === event.currentTarget; },
    onClick: (event) => {
      const fromScrim = downRef.current && event.target === event.currentTarget;
      downRef.current = false;
      if (fromScrim) onDismiss?.();
    },
  };
}

// Where a menu surface anchored to a trigger goes (Menu, the top bar's
// notification and account popovers, the app launcher): the shared
// menuPosition() rule — below the anchor's bottom edge (above when there is no
// room), aligned to its start or end, 8px from the viewport edges — measured
// before paint and again on scroll / resize. `deps` re-measure when the
// surface's content changes size. Returns { top, left, placement } or null
// until measured.
export function useAnchoredPosition({ open, anchorRef, surfaceRef, align = 'end', placement = 'bottom', deps = [] }) {
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const anchor = anchorRef?.current;
      const surface = surfaceRef.current;
      if (!anchor || !surface) return;
      const rect = anchor.getBoundingClientRect();
      const next = menuPosition(
        { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
        { width: surface.offsetWidth, height: surface.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        align,
        placement,
      );
      setPosition((current) => (current && current.top === next.top && current.left === next.left
        && current.placement === next.placement ? current : next));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, placement, anchorRef, surfaceRef, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return position;
}

// Style / data attributes of a positioned surface (see useAnchoredPosition).
export function anchoredProps(position) {
  return {
    'data-placement': position?.placement || 'bottom-end',
    'data-positioned': position ? 'true' : 'false',
    style: position ? { top: position.top, left: position.left } : undefined,
  };
}

