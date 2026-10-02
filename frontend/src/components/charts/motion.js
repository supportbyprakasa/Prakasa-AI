import { useEffect, useRef, useState } from 'react';

// Motion for the dashboard charts. Everything here stops moving for people
// who ask their system for less motion (prefers-reduced-motion).

const query = '(prefers-reduced-motion: reduce)';

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

const easeOutCubic = (t) => 1 - (1 - t) ** 3;

/** A number that glides to `target` (from 0 the first time). */
export function useTweenedNumber(target, { duration = 900 } = {}) {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(reduced || target === null || target === undefined ? target : 0);
  const from = useRef(0);
  useEffect(() => {
    if (target === null || target === undefined || !Number.isFinite(Number(target))) { setValue(target); return undefined; }
    if (reduced) { setValue(target); from.current = target; return undefined; }
    const start = performance.now();
    const begin = Number(from.current) || 0;
    const end = Number(target);
    let frame;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const v = begin + (end - begin) * easeOutCubic(t);
      setValue(v);
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = end;
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); from.current = end; };
  }, [target, duration, reduced]);
  return value;
}

/** Width of an element, kept up to date. */
export function useWidth(ref, fallback = 600) {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** True once the element has been on screen (charts animate when seen). */
export function useSeen(ref) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}
