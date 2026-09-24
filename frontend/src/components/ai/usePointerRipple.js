import { useEffect } from 'react';

// Material-style ripple that starts at the pointer position of any `.ai-ripple` element.
export default function usePointerRipple(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const onPointerDown = (event) => {
      const target = event.target.closest?.('.ai-ripple');
      if (!target || !root.contains(target) || target.disabled) return;
      const rect = target.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const size = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)) * 2;
      target.style.setProperty('--ripple-x', `${x}px`);
      target.style.setProperty('--ripple-y', `${y}px`);
      target.style.setProperty('--ripple-size', `${size}px`);
      target.classList.remove('is-rippling');
      void target.offsetWidth; // restart the animation on rapid repeated clicks
      target.classList.add('is-rippling');
    };

    const onAnimationEnd = (event) => {
      if (event.animationName === 'ai-ripple') event.target.classList.remove('is-rippling');
    };

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('animationend', onAnimationEnd);
    return () => {
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('animationend', onAnimationEnd);
    };
  }, [rootRef]);
}
