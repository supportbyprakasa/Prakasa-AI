export function UserSelect({
  label,
  value,
  onChange,
  users = [],
  placeholder = '— User —',
  disabled = false,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          {label}
        </label>
      )}
      <select
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        style={{
          padding: 8,
          borderRadius: 8,
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
        }}
      >
        <option value="">{placeholder}</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name || user.email || `User #${user.id}`}
          </option>
        ))}
      </select>
    </div>
  );
}

export function RoleSelect({
  label,
  value,
  onChange,
  roles = [],
  placeholder = '— Role —',
  disabled = false,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          {label}
        </label>
      )}
      <select
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        style={{
          padding: 8,
          borderRadius: 8,
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
        }}
      >
        <option value="">{placeholder}</option>
        {roles.map((role) => (
          <option key={role.id} value={role.id}>
            {role.name || `Role #${role.id}`}
          </option>
        ))}
      </select>
    </div>
  );
}
