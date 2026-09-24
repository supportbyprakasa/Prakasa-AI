export function SkeletonLine({ width = '100%', height = 14, radius = 4, style }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        background: 'linear-gradient(90deg, #eef2f7 25%, #e2e8f0 37%, #eef2f7 63%)',
        backgroundSize: '400% 100%',
        animation: 'prakasa-skel 1.4s ease infinite',
        ...(style || {}),
      }}
    />
  );
}

export function SkeletonTable({ rows = 5, columns = 4 }) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        boxShadow: 'inset 0 0 0 1px var(--color-border)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          background: '#f1f5f9',
        }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} style={{ padding: 12 }}>
            <SkeletonLine width="60%" height={12} />
          </div>
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            boxShadow: 'inset 0 1px 0 0 var(--color-border)',
          }}
        >
          {Array.from({ length: columns }).map((__, j) => (
            <div key={j} style={{ padding: 12 }}>
              <SkeletonLine width={`${50 + Math.random() * 40}%`} height={12} />
            </div>
          ))}
        </div>
      ))}
      <style>{`
        @keyframes prakasa-skel {
          0% { background-position: 100% 50%; }
          100% { background-position: 0 50%; }
        }
      `}</style>
    </div>
  );
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        boxShadow: 'inset 0 0 0 1px var(--color-border)',
        borderRadius: 12,
        padding: 20,
      }}
    >
      <SkeletonLine width="40%" height={16} style={{ marginBottom: 12 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine
          key={i}
          width={`${60 + Math.random() * 30}%`}
          height={12}
          style={{ marginBottom: 8 }}
        />
      ))}
    </div>
  );
}

