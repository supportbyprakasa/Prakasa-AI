import { SkeletonTable } from './Skeleton';
import Button from './Button';

export default function DataTable({
  columns,
  rows,
  loading,
  empty = 'Belum ada data',
  meta,
  onPageChange,
  actions,
  onRowClick,
}) {
  if (loading) return <SkeletonTable rows={5} columns={columns.length} />;
  if (!rows?.length) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: 'center',
          color: 'var(--pw-on-surface-variant)',
          background: 'var(--pw-surface)',
          boxShadow: 'inset 0 0 0 1px var(--pw-outline-variant)',
          borderRadius: 'var(--pw-radius-md)',
          fontSize: 14,
        }}
      >
        {empty}
      </div>
    );
  }

  return (
    <>
      <div className="prakasa-table-scroll" style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            background: 'var(--pw-surface)',
            borderRadius: 'var(--pw-radius-md)',
            overflow: 'hidden',
          }}
        >
          <thead style={{ background: 'var(--pw-surface-container)', textAlign: 'left', fontSize: 12 }}>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" style={{ padding: '12px 16px', fontWeight: 500 }}>
                  {c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.id ?? i}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                style={{
                  boxShadow: 'inset 0 1px 0 0 var(--pw-outline-variant)',
                  fontSize: 14,
                  cursor: onRowClick ? 'pointer' : 'default',
                }}
              >
                {columns.map((c) => (
                  <td key={c.key} style={{ padding: '14px 16px' }}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {meta && (meta.page || meta.total !== undefined) && (
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 13,
            color: 'var(--pw-on-surface-variant)',
          }}
        >
          <div>
            Total: <b>{meta.total ?? rows.length}</b>
            {meta.page && meta.limit && (
              <> · Hal {meta.page} dari {Math.max(1, Math.ceil((meta.total || 0) / meta.limit))}</>
            )}
          </div>
          {onPageChange && (
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                variant="secondary"
                disabled={meta.page <= 1}
                onClick={() => onPageChange(meta.page - 1)}
              >
                Sebelumnya
              </Button>
              <Button
                variant="secondary"
                disabled={meta.page * (meta.limit || 20) >= (meta.total || 0)}
                onClick={() => onPageChange(meta.page + 1)}
              >
                Berikutnya
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
