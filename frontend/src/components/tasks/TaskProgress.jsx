/**
 * Compact progress bar. Purely presentational.
 * Backend is authoritative for actual progress value.
 */
export default function TaskProgress({ percent, showLabel = true, height = 6 }) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const color =
    p >= 100 ? 'var(--color-success)' :
    p >= 60 ? 'var(--color-primary)' :
    p >= 30 ? 'var(--color-warning)' :
    'var(--color-text-muted)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1,
        height,
        background: '#e2e8f0',
        borderRadius: height / 2,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${p}%`,
          height: '100%',
          background: color,
          transition: 'width 250ms ease',
        }} />
      </div>
      {showLabel && (
        <span style={{
          fontSize: 11, color: 'var(--color-text-muted)',
          minWidth: 32, textAlign: 'right',
        }}>
          {p}%
        </span>
      )}
    </div>
  );
}