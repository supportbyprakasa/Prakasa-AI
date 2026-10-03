import { dataZone } from '../i18n/zones.js';
import './card.css';

const VARIANTS = new Set(['tint', 'panel', 'chart']);

// Card and panel surfaces (docs/ui-guideline.md §4.10).
//   variant="tint"  (default) summary / dashboard card: --pw-surface-tint, radius 12
//   variant="panel" white list or form panel: 1px --pw-outline-panel, radius 3
//   variant="chart" white chart card: radius 2, --pw-elev-2, padding 24 24 0
// Title: Google Sans 22/28; size="sm" gives the Roboto 18/24 section title.
// `noPadding` removes the body padding (the header keeps its own).
// The title is an <h2> under the page's <h1>; `level` (2–6) sets another
// heading level for a card nested in a titled section. The look comes from
// .pw-card__title, not the element.
export default function Card({
  children,
  title,
  subtitle,
  // The title / subtitle is a record's own name (a room, a customer): never
  // translated by the language switch.
  dataTitle = false,
  dataSubtitle = false,
  actions,
  variant = 'tint',
  size = 'md',
  noPadding = false,
  className = '',
  as: Tag = 'div',
  level = 2,
  ...props
}) {
  const Heading = `h${Math.min(6, Math.max(2, Number(level) || 2))}`;
  const kind = VARIANTS.has(variant) ? variant : 'tint';
  const classes = [
    'pw-card',
    `pw-card--${kind}`,
    size === 'sm' ? 'pw-card--sm' : '',
    noPadding ? 'pw-card--flush' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <Tag className={classes} {...props}>
      {(title || subtitle || actions) && (
        <div className="pw-card__header">
          {title || subtitle ? (
            <div className="pw-card__heading">
              {title ? <Heading className="pw-card__title" {...dataZone(dataTitle)}>{title}</Heading> : null}
              {subtitle ? <p className="pw-card__subtitle" {...dataZone(dataSubtitle)}>{subtitle}</p> : null}
            </div>
          ) : null}
          {actions ? <div className="pw-card__actions">{actions}</div> : null}
        </div>
      )}
      {children}
    </Tag>
  );
}
