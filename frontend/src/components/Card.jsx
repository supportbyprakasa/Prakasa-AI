export default function Card({ children, title, actions, noPadding = false }) {
  return (
    <div
      className="pw-card"
      style={{ padding: noPadding ? 0 : 20, overflow: noPadding ? 'hidden' : 'visible' }}
    >
      {(title || actions) && (
        <div className="pw-card__header" style={noPadding ? { padding: '16px 20px 0' } : undefined}>
          {title && <h3 className="pw-card__title">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
