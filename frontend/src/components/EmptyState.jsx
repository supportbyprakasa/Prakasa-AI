import { useEffect, useState } from 'react';
import IconSlot from './IconSlot';
import { SkeletonCard, SkeletonTable } from './Skeleton';
import Spinner from './Spinner';
import './empty-state.css';

// Empty list / nothing to show, and the error-with-retry state, share one
// shape (docs/ui-guideline.md §4.15): a 48px --pw-text-muted icon, a Roboto 14
// --pw-text-muted 400 title and text, and an optional action. `compact` (inside
// a grid, card or sheet) keeps the icon at 24px on purpose — the spec's
// "varian ringkas"; the full state is 48.
// `icon` is a Material Symbols name; a lucide component still works.
export default function EmptyState({ icon, title, description, action, tone = 'default', compact = false }) {
  const kind = tone === 'error' ? 'error' : 'default';
  return (
    <div className={`pw-empty-state pw-empty-state--${kind}${compact ? ' is-compact' : ''}`} role={kind === 'error' ? 'alert' : undefined}>
      <span className="pw-empty-state__glyph" aria-hidden="true">
        <IconSlot icon={icon || (kind === 'error' ? 'error' : 'inbox')} size={compact ? 'lg' : 'xl'} />
      </span>
      {title ? <strong className="pw-empty-state__title">{title}</strong> : null}
      {description ? <span className="pw-empty-state__text">{description}</span> : null}
      {action ? <div className="pw-empty-state__action">{action}</div> : null}
    </div>
  );
}

// After this long a loading state says it is still working: heavy dashboards
// (division and management dashboards, the stock reconciliation, the AI
// settings) compute their figures on request and can take several seconds.
export const SLOW_LOADING_MS = 8000;
export const SLOW_LOADING_TEXT = 'Masih memuat… data sedang dihitung';

function useSlow(active, after = SLOW_LOADING_MS) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) { setSlow(false); return undefined; }
    const timer = window.setTimeout(() => setSlow(true), after);
    return () => window.clearTimeout(timer);
  }, [active, after]);
  return slow;
}

// Placeholder shapes for a whole page section (§4.15): `dashboard` is a row of
// summary cards over a wide card, `table` the DataGrid shape, `form` a stack
// of cards.
function LoadingSkeleton({ kind }) {
  if (kind === 'table') return <SkeletonTable rows={6} columns={5} framed />;
  if (kind === 'form') {
    return (
      <div className="pw-loading-skeleton pw-loading-skeleton--stack">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={4} />
      </div>
    );
  }
  return (
    <div className="pw-loading-skeleton">
      <div className="pw-loading-skeleton__cards">
        {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} lines={2} />)}
      </div>
      <SkeletonCard lines={5} />
    </div>
  );
}

// Loading a page or a section (§4.15): the spinner alone, like the admin
// console, or — with `skeleton` ('dashboard' | 'table' | 'form') — the shape
// of what is coming. `label` is read by screen readers. A full (non-compact)
// state adds a visible "still loading" line after SLOW_LOADING_MS.
export function LoadingState({ label = 'Memuat…', compact = false, skeleton = null }) {
  const slow = useSlow(!compact);
  const hint = slow ? <span className="pw-loading-state__hint">{SLOW_LOADING_TEXT}</span> : null;
  if (skeleton) {
    return (
      <div className="pw-loading-state pw-loading-state--skeleton" role="status" aria-live="polite">
        <span className="pw-empty-state__sr">{slow ? SLOW_LOADING_TEXT : label}</span>
        <div aria-hidden="true"><LoadingSkeleton kind={skeleton} /></div>
        {hint ? <div className="pw-loading-state__hint-row" aria-hidden="true">{hint}</div> : null}
      </div>
    );
  }
  return (
    <div className={`pw-empty-state pw-loading-state${compact ? ' is-compact' : ''}`} role="status" aria-live="polite">
      <Spinner size={compact ? 'md' : 'lg'} label={null} />
      <span className="pw-empty-state__sr">{slow ? SLOW_LOADING_TEXT : label}</span>
      {hint ? <span aria-hidden="true">{hint}</span> : null}
    </div>
  );
}
