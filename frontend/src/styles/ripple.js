// Press ripple for every interactive surface, installed once for the whole app
// (docs/ui-guideline.md §1.10). The wave is its own element inside a clipping
// box, so it never fights a control's own ::before/::after (state layer, tab
// indicator…). It grows from the pointer for --pw-dur-ripple (450ms) while
// pressed at --pw-ripple-opacity (12%) and fades out on release. Selection
// controls (Checkbox, Radio, Switch) ripple in their round touch area from its
// centre, also when the label text is pressed.
import { installPwTooltip } from '../components/tooltip.js';

export const RIPPLE_SELECTOR = [
  '.pw-ripple', '.pw-state-layer', '.pw-button', '.pw-icon-button', '.pw-chip', '.pw-choice',
  '.pw-segmented__button', '.prakasa-sidebar__item', '.prakasa-navbar__menu', '.pw-menu__item', '.pw-apps__tile',
  '[role="tab"]', '[role="menuitem"]', '[role="menuitemradio"]', '[role="option"]',
].join(', ');

const MIN_VISIBLE_MS = 225;
let installed = false;

function isDisabled(el) {
  return el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('is-disabled') || el.closest('[inert]');
}

// Which element draws the wave, and whether it starts from the centre.
function resolveHost(el) {
  if (el.classList.contains('pw-choice')) {
    const touch = el.querySelector('.pw-choice__touch');
    return touch ? { host: touch, center: true } : null;
  }
  if (el.classList.contains('pw-choice__touch')) return { host: el, center: true };
  return { host: el, center: el.dataset.pwRipple === 'center' };
}

function ensureHost(el) {
  if (el.dataset.pwRippleHost) return;
  el.dataset.pwRippleHost = '1';
  if (window.getComputedStyle(el).position === 'static') el.classList.add('pw-ripple-host');
}

function release(wave) {
  if (!wave || wave.dataset.released) return;
  wave.dataset.released = '1';
  const host = wave.parentElement?.parentElement;
  const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - Number(wave.dataset.start)));
  window.setTimeout(() => {
    host?.classList.remove('pw-rippling');
    wave.classList.add('is-leaving');
    wave.addEventListener('transitionend', () => wave.parentElement?.remove(), { once: true });
    window.setTimeout(() => wave.parentElement?.remove(), 400);
  }, wait);
}

export function installPwRipple(root = document) {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // The shared tooltip belongs to the same app-wide interaction layer and must
  // work with reduced motion too, so it is installed before the early return.
  installPwTooltip(root);
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  let active = null;
  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const target = event.target.closest?.(RIPPLE_SELECTOR);
    if (!target) return;
    const resolved = resolveHost(target);
    if (!resolved || isDisabled(target) || isDisabled(resolved.host)) return;
    if (resolved.host.querySelector(':scope > input:disabled')) return;
    const { host, center } = resolved;
    ensureHost(host);
    const rect = host.getBoundingClientRect();
    const x = center ? rect.width / 2 : event.clientX - rect.left;
    const y = center ? rect.height / 2 : event.clientY - rect.top;
    const size = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)) * 2;

    const box = document.createElement('span');
    box.className = 'pw-ripple-box';
    box.setAttribute('aria-hidden', 'true');
    const wave = document.createElement('span');
    wave.className = 'pw-ripple-wave';
    wave.dataset.start = String(performance.now());
    wave.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px`;
    box.appendChild(wave);
    host.appendChild(box);
    host.classList.add('pw-rippling');

    release(active);
    active = wave;
  }, { passive: true });

  const end = () => { release(active); active = null; };
  root.addEventListener('pointerup', end, { passive: true });
  root.addEventListener('pointercancel', end, { passive: true });
  root.addEventListener('dragstart', end, { passive: true });
  window.addEventListener('blur', end);
}
