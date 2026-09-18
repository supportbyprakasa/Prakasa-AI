export default function Modal({ open, onClose, title, children, footer, maxWidth = 640, minWidth = 0 }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)',
      display: 'grid', placeItems: 'center', zIndex: 100,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--color-surface)', borderRadius: 12, minWidth,
        maxWidth, width: '90%', padding: 24, maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        {children}
        {footer && <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{footer}</div>}
      </div>
    </div>
  );
}
