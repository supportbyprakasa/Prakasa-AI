import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import Spinner from './Spinner';
import { ControlIcon, useTooltip } from './controlParts';
import './primitives.css';

const VARIANTS = new Set(['primary', 'secondary', 'tonal', 'text', 'danger']);

// Generation B pill (docs/ui-guideline.md §4.1). `icon` is a Material Symbols
// name shown at 18px before the label; older pages may still pass a lucide svg
// as a child, which is sized the same. `tooltip` (or an old `title`) becomes
// the shared tooltip (tooltipPlacement="right" opens it beside the button).
// Navigation that looks like a button: `to` / `href`.
const Button = forwardRef(function Button({
  children,
  variant = 'primary',
  icon,
  loading = false,
  block = false,
  tooltip,
  tooltipPlacement,
  title,
  className = '',
  disabled,
  to,
  href,
  ...props
}, ref) {
  const tone = VARIANTS.has(variant) ? variant : 'primary';
  const tip = useTooltip(tooltip, title, props['aria-describedby'], tooltipPlacement);
  const classes = [
    'pw-button', 'pw-ripple', `pw-button--${tone}`,
    icon ? 'pw-button--icon' : '', block ? 'pw-button--block' : '', className,
  ].filter(Boolean).join(' ');
  const label = typeof children === 'string' ? <span className="pw-button__label">{children}</span> : children;
  const content = <>{icon ? <ControlIcon icon={icon} size="sm" legacySize={18} /> : null}{label}</>;

  if (to || href) {
    const Tag = to ? Link : 'a';
    return (
      <>
        <Tag ref={ref} data-translate="" {...(to ? { to } : { href })} {...props} {...tip.props} className={classes}>{content}</Tag>
        {tip.node}
      </>
    );
  }

  return (
    <>
      <button ref={ref} data-translate="" {...props} {...tip.props} className={classes} disabled={disabled || loading} aria-busy={loading || undefined}>
        {loading ? (
          <>
            {/* The hidden label keeps the button width while loading. */}
            <span className="pw-button__content pw-button__content--hidden">{content}</span>
            <Spinner label={null} className="pw-button__spinner" />
          </>
        ) : content}
      </button>
      {tip.node}
    </>
  );
});

export default Button;
