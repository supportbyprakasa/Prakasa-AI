import Input from './Input';
import Button from './Button';

/**
 * <FilterBar filters={[{name,label,type:'text'|'select',options?,placeholder?}]} values onChange onReset />
 */
export default function FilterBar({ filters, values, onChange, onReset, children }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'flex-end',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
      }}
    >
      {filters.map((f) => (
        <div
          key={f.name}
          style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 180 }}
        >
          <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            {f.label}
          </label>
          {f.type === 'select' ? (
            <select
              value={values[f.name] || ''}
              onChange={(e) =>
                onChange({ ...values, [f.name]: e.target.value })
              }
              style={{
                padding: 8,
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                fontSize: 13,
              }}
            >
              <option value="">Semua</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={values[f.name] || ''}
              onChange={(e) =>
                onChange({ ...values, [f.name]: e.target.value })
              }
              placeholder={f.placeholder || ''}
              style={{ margin: 0 }}
            />
          )}
        </div>
      ))}
      <div style={{ flex: 1 }} />
      {children}
      {onReset && (
        <Button variant="secondary" onClick={onReset}>
          Reset
        </Button>
      )}
    </div>
  );
}

