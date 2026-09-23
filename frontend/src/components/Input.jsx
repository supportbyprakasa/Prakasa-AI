export default function Input({ label, error, ...props }) {
  const id = props.id || props.name;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
      {label && <label htmlFor={id} style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{label}</label>}
      <input id={id} {...props} style={{
        padding: '10px 12px', borderRadius: 8, fontSize: 13,
        border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-border)'}`,
        outline: 'none', ...(props.style || {}),
      }} />
      {error && <span style={{ fontSize: 12, color: 'var(--color-error)' }}>{error}</span>}
    </div>
  );
}
