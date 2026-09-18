export default function Card({ children, title, actions }) {
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20 }}>
      {(title || actions) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          {title && <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
