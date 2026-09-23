export default function GanttLegend() {
  return (
    <div style={{
      display: 'flex', gap: 16, flexWrap: 'wrap',
      fontSize: 12, color: 'var(--color-text-muted)',
      padding: '8px 12px',
      boxShadow: 'inset 0 1px 0 0 var(--color-border)',
      background: 'var(--color-surface)',
    }}>
      <Item color="#3b82f6" label="In Progress" />
      <Item color="#16a34a" label="Done" />
      <Item color="#f59e0b" label="Review" />
      <Item color="#94a3b8" label="Open / Cancelled" />
      <Item border dashed label="Tanggal estimasi" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="24" height="8">
          <line x1="0" y1="4" x2="24" y2="4" stroke="#dc2626" strokeWidth="1.5" />
        </svg>
        <span>Blocks</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="24" height="8">
          <line x1="0" y1="4" x2="24" y2="4" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" />
        </svg>
        <span>Related</span>
      </div>
    </div>
  );
}

function Item({ color, label, border, dashed }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 14, height: 10, borderRadius: 3,
        background: color ? `${color}33` : 'transparent',
        boxShadow: border
          ? `inset 0 0 0 1px ${color || '#94a3b8'}`
          : (color ? `inset 0 0 0 1.5px ${color}` : 'none'),
      }} />
      <span>{label}</span>
    </div>
  );
}