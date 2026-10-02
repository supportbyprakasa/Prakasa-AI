// Pure rules shared by every overlay (Modal, ConfirmDialog, FullScreenDialog,
// SideSheet, Menu, snackbar) — docs/ui-guideline.md §1.6 and §4.13–4.14.
// No React here, so the rules are unit-tested in test/overlayModel.test.js.

// ---------------------------------------------------------------- stack
// Overlays register in the order they open. Only the top one reacts to
// Escape and traps Tab, so a confirmation stacked on a form closes first and
// a menu opened inside a dialog closes before the dialog.
export function createOverlayStack() {
  const items = [];
  return {
    push(id) { items.push(id); },
    remove(id) {
      const index = items.lastIndexOf(id);
      if (index >= 0) items.splice(index, 1);
    },
    isTop(id) { return items.length > 0 && items[items.length - 1] === id; },
    get size() { return items.length; },
  };
}

// ---------------------------------------------------------------- menu
export const MENU_MARGIN = 8; // never closer than this to a viewport edge

// Where a menu opens next to its anchor. Below the anchor by default, above it
// when there is no room below (prefer 'top': above, below when there is no
// room above); aligned to the anchor's start or end edge and clamped inside
// the viewport.
// anchor: { top, bottom, left, right }; menu: { width, height };
// viewport: { width, height }; align: 'start' | 'end'; prefer: 'bottom' | 'top'.
export function menuPosition(anchor, menu, viewport, align = 'end', prefer = 'bottom') {
  const spaceBelow = viewport.height - anchor.bottom - MENU_MARGIN;
  const spaceAbove = anchor.top - MENU_MARGIN;
  const above = prefer === 'top'
    ? !(menu.height > spaceAbove && spaceBelow > spaceAbove)
    : menu.height > spaceBelow && spaceAbove > spaceBelow;
  let top = above ? anchor.top - menu.height : anchor.bottom;
  top = Math.max(MENU_MARGIN, Math.min(top, viewport.height - MENU_MARGIN - menu.height));
  let left = align === 'start' ? anchor.left : anchor.right - menu.width;
  left = Math.max(MENU_MARGIN, Math.min(left, viewport.width - MENU_MARGIN - menu.width));
  return {
    top: Math.round(top),
    left: Math.round(left),
    placement: `${above ? 'top' : 'bottom'}-${align === 'start' ? 'start' : 'end'}`,
  };
}

// Arrow / Home / End movement between the enabled items of a menu.
// `count` items, `current` index (-1 when focus is not on an item).
export function nextMenuIndex(key, current, count) {
  if (count <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return current < 0 || current >= count - 1 ? 0 : current + 1;
  if (key === 'ArrowUp') return current <= 0 ? count - 1 : current - 1;
  return current;
}

// ---------------------------------------------------------------- snackbar
export const SNACKBAR_KINDS = new Set(['info', 'success', 'warning', 'error']);

// One snackbar at a time (Material); the others wait in a queue, in order.
// Errors stay until closed; everything else leaves after 4 seconds. A newer
// message cuts a timed one short, but never replaces a sticky one (an error
// the user has not closed yet): it waits until that one is closed.
export function snackbarFor(message, tone = 'info', options = {}) {
  const kind = SNACKBAR_KINDS.has(tone) ? tone : 'info';
  const sticky = options.sticky ?? kind === 'error';
  return {
    message: message === null || message === undefined ? '' : String(message),
    tone: kind,
    role: kind === 'error' ? 'alert' : 'status',
    duration: sticky ? null : (options.duration ?? 4000),
    action: options.action && options.action.label ? options.action : null,
  };
}

// Whether a newly queued message may end the one on screen now.
export function snackbarYields(current) {
  return Boolean(current) && current.duration !== null && current.duration !== undefined;
}
