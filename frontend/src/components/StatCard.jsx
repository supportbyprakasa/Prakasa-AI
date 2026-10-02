import Card from './Card';
import { SkeletonLine } from './Skeleton';
import './stat-card.css';

// Key figure on a dashboard (docs/ui-guideline.md §3.4, §4.11): a tinted card
// with the label (Roboto 12/16, .3px, --pw-text-header), the number (Google
// Sans 32/40, --pw-text-stat) and a small note. `alert` marks a figure that
// needs attention by turning the NOTE --pw-error — never a red background.
// `empty` greys the number when there is nothing to count yet.
export default function StatCard({ label, value, note, alert = false, empty = false, loading = false, action, className = '' }) {
  const classes = ['pw-stat-card', alert ? 'is-alert' : '', empty ? 'is-empty' : '', className].filter(Boolean).join(' ');
  return (
    <Card className={classes}>
      <div className="pw-stat-card__label">{label}</div>
      {loading ? (
        <div className="pw-stat-card__value" aria-busy="true"><SkeletonLine width="48%" height={32} /></div>
      ) : (
        <div className="pw-stat-card__value">{value === null || value === undefined || value === '' ? '—' : value}</div>
      )}
      {note ? <div className="pw-stat-card__note">{note}</div> : null}
      {action ? <div className="pw-stat-card__action">{action}</div> : null}
    </Card>
  );
}
