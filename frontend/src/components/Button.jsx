export default function Button({ children, variant = 'primary', ...props }) {
  const styles = {
    primary: { background: 'var(--color-primary)', color: '#fff', border: 'none' },
    secondary: { background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
    danger: { background: 'var(--color-error)', color: '#fff', border: 'none' },
  }[variant];
  return (
    <button {...props} style={{
      padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 14,
      display: 'inline-flex', alignItems: 'center', gap: 6, ...styles, ...(props.style || {}),
    }}>{children}</button>
  );
}
