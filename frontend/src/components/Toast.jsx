import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Snackbar from './Snackbar';
import { snackbarFor, snackbarYields } from './overlayModel';

// toast(message, 'success' | 'error' | 'info' | 'warning', options?) shows a
// snackbar bottom-left (docs/ui-guideline.md §4.13), always above dialogs
// (--pw-z-snackbar). One at a time; the others queue in order. A newer
// message cuts a timed snackbar short, but a sticky one (an error, role
// "alert") stays until the user closes it — a success that arrives meanwhile
// shows after it. Timed ones leave after 4 s (role="status"), paused while
// hovered or focused.
// options: { action: { label, onClick }, duration, sticky }.
let pushFn = null;
const early = [];
export function toast(message, tone = 'info', options) {
  if (pushFn) pushFn(message, tone, options);
  else early.push([message, tone, options]);
}

export default function ToastHost() {
  const [current, setCurrent] = useState(null);
  const [closing, setClosing] = useState(false);
  const currentRef = useRef(null);
  const closingRef = useRef(false);
  const queueRef = useRef([]);
  const timerRef = useRef(null);
  const startedRef = useRef(0);
  const remainingRef = useRef(null);
  const seq = useRef(0);

  const clearTimer = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const dismiss = useCallback(() => {
    clearTimer();
    closingRef.current = true;
    setClosing(true);
  }, []);
  const startTimer = useCallback((ms) => {
    clearTimer();
    if (ms === null || ms === undefined) return;
    remainingRef.current = ms;
    startedRef.current = Date.now();
    timerRef.current = window.setTimeout(dismiss, ms);
  }, [dismiss]);
  const show = useCallback((item) => {
    currentRef.current = item;
    closingRef.current = false;
    setCurrent(item);
    setClosing(false);
    startTimer(item.duration);
  }, [startTimer]);

  useEffect(() => {
    pushFn = (message, tone, options) => {
      seq.current += 1;
      const item = { id: seq.current, ...snackbarFor(message, tone, options) };
      if (!currentRef.current) {
        show(item);
        return;
      }
      queueRef.current.push(item);
      // A timed snackbar fades out now so the next one enters; a sticky one
      // stays until closed and the queue waits behind it.
      if (!closingRef.current && snackbarYields(currentRef.current)) dismiss();
    };
    early.splice(0).forEach(([message, tone, options]) => pushFn(message, tone, options));
    return () => { pushFn = null; clearTimer(); };
  }, [show, dismiss]);

  const onAnimationEnd = (event) => {
    if (!closing || event.target !== event.currentTarget) return;
    const next = queueRef.current.shift();
    if (next) {
      show(next);
      return;
    }
    currentRef.current = null;
    closingRef.current = false;
    setCurrent(null);
    setClosing(false);
  };

  // Hover / focus pause the countdown; leaving resumes it with what was left.
  const pause = () => {
    if (!timerRef.current) return;
    clearTimer();
    remainingRef.current = Math.max(1000, remainingRef.current - (Date.now() - startedRef.current));
  };
  const resume = () => {
    if (!current || closing || current.duration === null || timerRef.current) return;
    startTimer(remainingRef.current ?? current.duration);
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="pw-snackbar-host">
      {/* Persistent live regions: they stay mounted and only their content is
          swapped, so every message is announced (polite for status, assertive
          for an error that stays until closed). */}
      <div className="pw-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {current && current.role !== 'alert' && !closing ? <span key={current.id}>{current.message}</span> : null}
      </div>
      <div className="pw-visually-hidden" role="alert" aria-live="assertive" aria-atomic="true">
        {current && current.role === 'alert' && !closing ? <span key={current.id}>{current.message}</span> : null}
      </div>
      {current ? (
        <Snackbar
          key={current.id}
          live={false}
          message={current.message}
          tone={current.tone}
          role={current.role}
          action={current.action}
          closing={closing}
          onClose={dismiss}
          onAnimationEnd={onAnimationEnd}
          onPointerEnter={pause}
          onPointerLeave={resume}
          onFocus={pause}
          onBlur={resume}
        />
      ) : null}
    </div>,
    document.body,
  );
}
