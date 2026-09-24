const VARIANTS = new Set(['primary', 'secondary', 'tonal', 'text', 'danger']);

export default function Button({
  children,
  variant = 'primary',
  loading = false,
  block = false,
  className = '',
  disabled,
  ...props
}) {
  const tone = VARIANTS.has(variant) ? variant : 'primary';
  const classes = [
    'pw-button', 'pw-ripple', `pw-button--${tone}`,
    block ? 'pw-button--block' : '', className,
  ].filter(Boolean).join(' ');

  return (
    <button {...props} className={classes} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading ? (
        <>
          {/* Hidden label keeps the button width stable while loading. */}
          <span style={{ visibility: 'hidden', display: 'inline-flex', alignItems: 'center', gap: 8 }}>{children}</span>
          <span className="pw-button__spinner" aria-hidden="true" style={{ position: 'absolute' }} />
        </>
      ) : children}
    </button>
  );
}
