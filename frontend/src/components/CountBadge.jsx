import { formatBadgeCount } from './format';
import './count-badge.css';

// Count on a tab, icon button or menu item (docs/ui-guideline.md §4.12): a
// 20px --pw-accent pill with white Roboto 12/500 .3px text (the admin
// console's "NEW" badge), or an 8px dot with `dot`. `count` above `max` shows
// "99+"; 0 shows nothing. Text instead of a number: pass children ("Baru").
// `label` is the accessible text (e.g. "3 belum dibaca").
export default function CountBadge({ count, max = 99, dot = false, label, children, className = '' }) {
  const text = children ?? formatBadgeCount(count, max);
  if (!dot && !text) return null;
  const classes = ['pw-count-badge', dot ? 'pw-count-badge--dot' : '', className].filter(Boolean).join(' ');
  if (dot) return <span className={classes} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'} />;
  return <span className={classes} aria-label={label}>{text}</span>;
}
