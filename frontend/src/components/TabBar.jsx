import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import CountBadge from './CountBadge';
import IconButton from './IconButton';
import { ControlIcon } from './controlParts';
import { nextEdges, scrollEdges, scrollToReveal } from './tabsModel';
import './primitives.css';
import './tabs.css';

// A row of tabs (docs/ui-guideline.md §4.8), the only role="tablist" in the app.
// The page decides which tab is open (for example from ?tab=) and renders the
// panel with id `panelId`. tabs: [{ k, l, icon?, count?, disabled? }] (also
// accepted: key/value and label). Left/Right/Home/End move the focus; Enter or
// Space opens the focused tab. The indicator is as wide as the label.
// A tab with `data: true` is named after a record (never translated).
// Clicking the open tab calls onChange again: pages use it to reset the tab
// (back to its first page, filters cleared).
// When the tabs do not fit, the row scrolls like Material's scrollable tabs:
// the cut edge fades and a chevron button (floating over the faded edge)
// scrolls that way. The chevrons are
// for the pointer only; the keyboard moves between tabs as before and the
// focused tab scrolls into view.
const keyOf = (tab) => tab.k ?? tab.key ?? tab.value;
const labelOf = (tab) => tab.l ?? tab.label;

// Edges are measured on scroll, when the row or a tab changes size
// (ResizeObserver) and after the tabs or the open tab change — never on every
// render. The chevrons float over the row (tabs.css), so the row's width never
// depends on the edges and a measurement cannot feed back into itself.
function useScrollEdges(ref, signature) {
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const measured = scrollEdges({ scrollLeft: el.scrollLeft, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth });
    setEdges((current) => nextEdges(current, measured));
  }, [ref]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    el.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    observer?.observe(el);
    [...el.children].forEach((child) => observer?.observe(child));
    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [ref, measure, signature]);
  useLayoutEffect(() => { measure(); }, [measure, signature]);
  return { ...edges, measure };
}

export default function TabBar({ tabs, value, onChange, label, idPrefix = 'pw-tab', panelId, className = '' }) {
  const refs = useRef(new Map());
  const listRef = useRef(null);
  // Tabs, labels or counts that change alter the row's scroll width.
  const signature = tabs.map((tab) => `${keyOf(tab)}:${typeof labelOf(tab) === 'string' ? labelOf(tab) : ''}:${tab.count ?? ''}:${tab.icon ? 1 : 0}`).join('|');
  const edges = useScrollEdges(listRef, signature);
  const overflowing = edges.start || edges.end;
  const enabled = tabs.filter((tab) => !tab.disabled).map(keyOf);
  const tabStop = enabled.includes(value) ? value : enabled[0];

  // The selected tab is always in view (a deep link to the last tab, or a row
  // narrower than the tabs): scroll the row only, never the page.
  useLayoutEffect(() => {
    const list = listRef.current;
    const el = refs.current.get(value);
    if (!list || !el) return;
    const left = el.offsetLeft - list.offsetLeft;
    const target = scrollToReveal({ left, right: left + el.offsetWidth }, { scrollLeft: list.scrollLeft, clientWidth: list.clientWidth });
    if (target !== list.scrollLeft) list.scrollLeft = target;
    edges.measure();
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusTab = (key) => {
    const el = refs.current.get(key);
    if (!el) return;
    el.focus();
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  const onKeyDown = (event, key) => {
    if (!enabled.length) return;
    const at = enabled.indexOf(key);
    const next = {
      ArrowRight: enabled[(at + 1) % enabled.length],
      ArrowLeft: enabled[(at - 1 + enabled.length) % enabled.length],
      Home: enabled[0],
      End: enabled[enabled.length - 1],
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    focusTab(next);
  };

  const scrollBy = (direction) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.8, 96), behavior: 'smooth' });
  };

  const chevron = (direction) => (
    <span className={`pw-tabs__scroll pw-tabs__scroll--${direction < 0 ? 'start' : 'end'}`} aria-hidden="true">
      <IconButton
        size="sm"
        icon={direction < 0 ? 'chevron_left' : 'chevron_right'}
        label={direction < 0 ? 'Geser tab ke kiri' : 'Geser tab ke kanan'}
        tabIndex={-1}
        disabled={direction < 0 ? !edges.start : !edges.end}
        onClick={() => scrollBy(direction)}
      />
    </span>
  );

  return (
    <div
      className={['pw-tabs-frame', overflowing ? 'is-overflowing' : '', edges.start ? 'can-scroll-start' : '', edges.end ? 'can-scroll-end' : '', className].filter(Boolean).join(' ')}
    >
      {overflowing ? chevron(-1) : null}
      <div ref={listRef} className="pw-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab) => {
          const key = keyOf(tab);
          const selected = value === key;
          const hasCount = tab.count !== undefined && tab.count !== null && tab.count !== '';
          return (
            <button
              key={key}
              ref={(el) => { if (el) refs.current.set(key, el); else refs.current.delete(key); }}
              type="button"
              role="tab"
              id={`${idPrefix}-${key}`}
              aria-selected={selected}
              aria-controls={panelId}
              aria-disabled={tab.disabled || undefined}
              tabIndex={key === tabStop ? 0 : -1}
              className="pw-tab pw-state-layer"
              onClick={() => { if (!tab.disabled) onChange?.(key); }}
              onKeyDown={(event) => onKeyDown(event, key)}
            >
              <span className="pw-tab__content">
                {tab.icon ? <ControlIcon icon={tab.icon} size="md" legacySize={20} /> : null}
                <span className="pw-tab__label" data-no-translate={tab.data ? '' : undefined}>{labelOf(tab)}</span>
                {hasCount ? (typeof tab.count === 'number' ? <CountBadge count={tab.count} /> : <CountBadge>{tab.count}</CountBadge>) : null}
              </span>
            </button>
          );
        })}
      </div>
      {overflowing ? chevron(1) : null}
    </div>
  );
}
