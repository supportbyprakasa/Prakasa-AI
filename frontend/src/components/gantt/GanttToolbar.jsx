import { RefreshCw, Calendar, Filter } from 'lucide-react';
import Button from '../Button';
import Input from '../Input';

const ZOOMS = [
  { value: 'week', label: 'Minggu' },
  { value: 'month', label: 'Bulan' },
];

export default function GanttToolbar({
  filters, onChange, onRefresh, loading, canCrossEntity, zoom, onZoomChange,
}) {
  const set = (k, v) => onChange({ ...filters, [k]: v });

  return (
    <div style={{
      display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end',
      padding: 12, background: 'var(--color-surface)',
      borderBottom: '1px solid var(--color-border)',
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Input
          label="Dari"
          type="date"
          value={filters.from}
          onChange={(e) => set('from', e.target.value)}
          style={{ margin: 0, width: 150 }}
        />
        <Input
          label="Sampai"
          type="date"
          value={filters.to}
          onChange={(e) => set('to', e.target.value)}
          style={{ margin: 0, width: 150 }}
        />
        <Input
          label="Department ID"
          type="number"
          value={filters.departmentId}
          onChange={(e) => set('departmentId', e.target.value)}
          placeholder="opsional"
          style={{ margin: 0, width: 130 }}
        />
        <Input
          label="Board ID"
          type="number"
          value={filters.boardId}
          onChange={(e) => set('boardId', e.target.value)}
          placeholder="opsional"
          style={{ margin: 0, width: 120 }}
        />
        {canCrossEntity && (
          <Input
            label="Entity ID"
            type="number"
            value={filters.entityId}
            onChange={(e) => set('entityId', e.target.value)}
            placeholder="kosong = milik Anda"
            style={{ margin: 0, width: 150 }}
          />
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginRight: 4 }}>Zoom:</span>
        {ZOOMS.map((z) => (
          <button
            key={z.value}
            type="button"
            onClick={() => onZoomChange(z.value)}
            style={{
              padding: '6px 10px', fontSize: 12,
              border: `1px solid ${zoom === z.value ? 'var(--color-primary)' : 'var(--color-border)'}`,
              borderRadius: 6,
              background: zoom === z.value ? 'rgba(31,78,216,.08)' : 'transparent',
              color: zoom === z.value ? 'var(--color-primary)' : 'var(--color-text)',
              cursor: 'pointer',
            }}
          >
            {z.label}
          </button>
        ))}
        <Button variant="secondary" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </Button>
      </div>
    </div>
  );
}