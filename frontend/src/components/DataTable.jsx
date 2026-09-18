export default function DataTable({ columns, rows, loading, empty = 'Belum ada data' }) {
  if (loading) return <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>Memuat…</div>;
  if (!rows?.length) return <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>{empty}</div>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--color-surface)', borderRadius: 8, overflow: 'hidden' }}>
      <thead style={{ background: '#f1f5f9', textAlign: 'left', fontSize: 13 }}>
        <tr>{columns.map((c) => <th key={c.key} style={{ padding: '10px 12px' }}>{c.title}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderTop: '1px solid var(--color-border)', fontSize: 14 }}>
            {columns.map((c) => <td key={c.key} style={{ padding: '10px 12px' }}>{c.render ? c.render(r) : r[c.key]}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
