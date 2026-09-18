export default function Badge({ children, tone = 'default' }) {
  const colors = {
    default: { bg: '#e2e8f0', fg: 'var(--color-text)' },
    success: { bg: '#dcfce7', fg: '#166534' },
    warning: { bg: '#fef3c7', fg: '#92400e' },
    error: { bg: '#fee2e2', fg: '#991b1b' },
    info: { bg: '#dbeafe', fg: '#1e40af' },
  }[tone];
  return (
    <span style={{
      background: colors.bg, color: colors.fg, fontSize: 12,
      padding: '2px 8px', borderRadius: 999, fontWeight: 500,
    }}>{children}</span>
  );
}
