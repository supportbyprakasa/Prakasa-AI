// The one tooltip of the app (docs/ui-guideline.md §4.14). Any element with
// data-pw-tooltip="text" (IconButton `label`, Button/Chip `tooltip`) shows a
// single bubble BELOW itself after --pw-delay-tooltip (500ms) of mouse hover or
// keyboard focus, and hides it at once on leave, blur, press, scroll or Escape.
// The bubble is position:fixed in <body>, so a scrolling or clipping parent
// (tables, dialogs, sheets) never cuts it, and it is kept inside the viewport:
// it opens above the trigger only when there is no room below.
// data-pw-tooltip-placement="right" puts it beside the trigger instead,
// vertically centred (the collapsed side-menu rail: its labels open to the
// right of each 40px pill); it moves to the left only when there is no room.
// Installed once for the whole app by styles/ripple.js installPwRipple().

const GAP = 4; // px between the trigger and the bubble
const SIDE_GAP = 8; // px beside the trigger for placement="right"
const EDGE = 8; // px the bubble keeps from the viewport edge
const SELECTOR = '[data-pw-tooltip]';

let installed = false;
let bubble = null;
let current = null;
let showTimer = 0;
let watchTimer = 0;

function delayMs() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--pw-delay-tooltip').trim();
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return 500;
  return raw.endsWith('ms') ? n : n * 1000;
}

function ensureBubble() {
  if (bubble && bubble.isConnected) return bubble;
  bubble = document.createElement('div');
  bubble.className = 'pw-tooltip';
  // The text comes from data-pw-tooltip, which the DOM translator already
  // handles in place (and leaves alone in a record-data zone).
  bubble.setAttribute('data-no-translate', '');
  bubble.id = 'pw-tooltip';
  bubble.setAttribute('role', 'tooltip');
  document.body.appendChild(bubble);
  return bubble;
}

function hide() {
  window.clearTimeout(showTimer);
  window.clearInterval(watchTimer);
  showTimer = 0;
  watchTimer = 0;
  current = null;
  if (bubble) bubble.classList.remove('is-visible');
}

function place(trigger) {
  const text = trigger.getAttribute('data-pw-tooltip');
  if (!text || !trigger.isConnected) { hide(); return; }
  const el = ensureBubble();
  el.textContent = text;
  const rect = trigger.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  // offsetWidth/Height ignore the entry scale transform.
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const { top, left, placement } = tooltipPosition(
    { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
    { width: w, height: h },
    { width: vw, height: vh },
    trigger.getAttribute('data-pw-tooltip-placement') || 'bottom',
  );
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.dataset.placement = placement;
  el.classList.add('is-visible');
  // The trigger can vanish or lose hover/focus without an event reaching us
  // (a dialog closes, a row re-renders): check while the bubble is open.
  window.clearInterval(watchTimer);
  watchTimer = window.setInterval(() => {
    if (!current || !current.isConnected || !(current.matches(':hover') || current.contains(document.activeElement))) hide();
  }, 250);
}

// Where the bubble goes (pure, unit-tested in test/controls.test.js).
// placement 'bottom': centred 4px below, above when there is no room below;
// 'right': 8px beside, vertically centred, left when there is no room right.
// Always clamped 8px inside the viewport.
export function tooltipPosition(anchor, bubble, viewport, placement = 'bottom') {
  const clampX = (x) => Math.min(Math.max(EDGE, x), Math.max(EDGE, viewport.width - bubble.width - EDGE));
  const clampY = (y) => Math.min(Math.max(EDGE, y), Math.max(EDGE, viewport.height - bubble.height - EDGE));
  if (placement === 'right') {
    const right = anchor.right + SIDE_GAP;
    const flip = right + bubble.width > viewport.width - EDGE && anchor.left - SIDE_GAP - bubble.width >= EDGE;
    return {
      top: Math.round(clampY((anchor.top + anchor.bottom) / 2 - bubble.height / 2)),
      left: Math.round(flip ? anchor.left - SIDE_GAP - bubble.width : clampX(right)),
      placement: flip ? 'left' : 'right',
    };
  }
  let top = anchor.bottom + GAP;
  const above = top + bubble.height > viewport.height - EDGE && anchor.top - GAP - bubble.height >= EDGE;
  if (above) top = anchor.top - GAP - bubble.height;
  return {
    top: Math.round(top),
    left: Math.round(clampX((anchor.left + anchor.right) / 2 - bubble.width / 2)),
    placement: above ? 'top' : 'bottom',
  };
}

function schedule(trigger) {
  if (trigger === current) return;
  hide();
  current = trigger;
  showTimer = window.setTimeout(() => { if (current === trigger) place(trigger); }, delayMs());
}

export function installPwTooltip(root = document) {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  root.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const trigger = event.target.closest?.(SELECTOR);
    if (trigger) schedule(trigger);
  }, { passive: true });
  root.addEventListener('pointerout', (event) => {
    if (!current) return;
    const to = event.relatedTarget;
    if (to && current.contains(to)) return;
    if (current.contains(event.target) && document.activeElement && current.contains(document.activeElement) && document.activeElement.matches(':focus-visible')) return;
    hide();
  }, { passive: true });
  root.addEventListener('focusin', (event) => {
    const trigger = event.target.closest?.(SELECTOR);
    if (trigger && event.target.matches(':focus-visible')) schedule(trigger);
  });
  root.addEventListener('focusout', (event) => {
    if (current && current.contains(event.target) && !current.contains(event.relatedTarget)) hide();
  });
  root.addEventListener('pointerdown', hide, { passive: true });
  root.addEventListener('keydown', (event) => { if (event.key === 'Escape' && current) hide(); });
  window.addEventListener('scroll', () => { if (current) hide(); }, { passive: true, capture: true });
  window.addEventListener('resize', () => { if (current) hide(); }, { passive: true });
  window.addEventListener('blur', hide);
}
