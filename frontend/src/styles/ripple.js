// Pointer-origin ripple for any `.pw-ripple` element, installed once for the whole app.
let installed = false;

export function installPwRipple(root = document) {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  root.addEventListener('pointerdown', (event) => {
    const target = event.target.closest?.('.pw-ripple');
    if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return;
    const rect = target.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const size = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)) * 2;
    target.style.setProperty('--pw-ripple-x', `${x}px`);
    target.style.setProperty('--pw-ripple-y', `${y}px`);
    target.style.setProperty('--pw-ripple-size', `${size}px`);
    target.classList.remove('is-rippling');
    void target.offsetWidth; // restart on rapid repeated presses
    target.classList.add('is-rippling');
  });
  root.addEventListener('animationend', (event) => {
    if (event.animationName === 'pw-ripple') event.target.classList.remove('is-rippling');
  });
}
