import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import CountBadge from './CountBadge';
import Spinner from './Spinner';
import { ControlIcon } from './controlParts';
import './icon-button.css';

// Icon-only action (docs/ui-guideline.md §4.2): 48×48, or 40×40 with size="sm".
// `label` is required: it is the accessible name and the shared tooltip
// (shown below after 500ms). `icon` takes a Material Symbols name; older pages
// pass the icon as children. tone: default | primary | danger;
// variant="filled" for a primary round action; `selected` for a toggled state
// (aria-pressed); `badge`: a number/text (CountBadge pill), true (CountBadge
// dot) or a node — put the count in `label` too ("Notifikasi, 3 baru").
// tooltipPlacement="right" opens the tooltip beside the button (a rail).
const IconButton = forwardRef(function IconButton({
  label: labelProp, title, icon, tone = 'default', size = 'md', variant, selected, badge,
  tooltipPlacement, loading = false, className = '', to, href, children, ...props
}, ref) {
  // An old `title` only fills in for a missing label: no native title box (§4.14).
  const label = labelProp ?? title;
  const classes = [
    'pw-icon-button', 'pw-state-layer', 'pw-ripple', `pw-icon-button--${tone}`,
    size === 'sm' ? 'pw-icon-button--sm' : '', variant === 'filled' ? 'pw-icon-button--filled' : '',
    selected ? 'is-selected' : '', className,
  ].filter(Boolean).join(' ');
  const pressed = selected === undefined || props['aria-expanded'] !== undefined ? undefined : Boolean(selected);
  const placement = tooltipPlacement === 'right' ? 'right' : undefined;
  const content = (
    <>
      {loading ? <Spinner label={null} className="pw-icon-button__spinner" /> : (icon ? <ControlIcon icon={icon} /> : children)}
      <Badge value={badge} />
    </>
  );

  if (to || href) {
    const Tag = to ? Link : 'a';
    return (
      <span className="pw-tooltip-anchor" data-translate="" data-pw-tooltip={label} data-pw-tooltip-placement={placement}>
        <Tag ref={ref} aria-label={label} {...(to ? { to } : { href })} {...props} className={classes}>{content}</Tag>
      </span>
    );
  }
  return (
    <span className="pw-tooltip-anchor" data-translate="" data-pw-tooltip={label} data-pw-tooltip-placement={placement}>
      <button ref={ref} type="button" aria-label={label} aria-pressed={pressed} aria-busy={loading || undefined} {...props} disabled={props.disabled || loading} className={classes}>
        {content}
      </button>
    </span>
  );
});

function Badge({ value }) {
  if (value === undefined || value === null || value === false || value === '') return null;
  if (typeof value === 'number' && !(value > 0)) return null;
  if (value === true) {
    return <span className="pw-icon-button__badge pw-icon-button__badge--dot" aria-hidden="true"><CountBadge dot /></span>;
  }
  if (typeof value === 'number') return <span className="pw-icon-button__badge" aria-hidden="true"><CountBadge count={value} /></span>;
  if (typeof value === 'string') return <span className="pw-icon-button__badge" aria-hidden="true"><CountBadge>{value}</CountBadge></span>;
  return <span className="pw-icon-button__badge">{value}</span>;
}

export default IconButton;
