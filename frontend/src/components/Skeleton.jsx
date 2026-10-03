import './skeleton.css';

// Loading placeholders (docs/ui-guideline.md §4.15). Widths are fixed
// patterns, not random, so a reload never jumps and screenshots compare.
const WIDTHS = [72, 48, 60, 36, 54, 66, 42];
export const skeletonWidth = (row, column) => `${WIDTHS[(row * 3 + column) % WIDTHS.length]}%`;

// Width / height (and an optional radius override) are per-instance values,
// so they stay inline; colour, shape and motion live in skeleton.css.
export function SkeletonLine({ width = '100%', height = 12, radius, style }) {
  return (
    <div
      className="pw-skel-line"
      aria-hidden="true"
      style={{ width, height, ...(radius !== undefined ? { borderRadius: radius } : null), ...(style || {}) }}
    />
  );
}

// The same shape as DataGrid (§4.9): a 48px header row on --pw-surface-container,
// 48px rows split by --pw-divider, cells padded 0 10px with 24px at the ends.
// It sits inside the grid panel; `framed` draws the panel border for use
// outside a DataGrid.
export function SkeletonTable({ rows = 5, columns = 4, framed = false }) {
  const cols = Math.max(1, columns);
  return (
    <div className={`pw-skel-table${framed ? ' pw-skel-table--framed' : ''}`} style={{ '--pw-skel-cols': cols }} role="status" aria-label="Memuat">
      <div className="pw-skel-table__row pw-skel-table__row--head">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="pw-skel-table__cell">
            <SkeletonLine width={i === 0 ? '40%' : '56%'} height={12} />
          </div>
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="pw-skel-table__row">
          {Array.from({ length: cols }).map((__, j) => (
            <div key={j} className="pw-skel-table__cell">
              <SkeletonLine width={skeletonWidth(i, j)} height={12} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// The same shape as a default Card (§4.10): tinted, radius 12, padding 24,
// a title line and `lines` text lines.
export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="pw-skel-card" role="status" aria-label="Memuat">
      <SkeletonLine width="40%" height={20} />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} width={skeletonWidth(i, 1)} height={12} />
      ))}
    </div>
  );
}
