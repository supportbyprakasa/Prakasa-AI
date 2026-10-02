import Select from './Select';

export function UserSelect({
  label,
  value,
  onChange,
  users = [],
  placeholder = '— User —',
  disabled = false,
  required = false,
  error,
  hint,
}) {
  return (
    <Select
      label={label}
      value={value || ''}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      required={required}
      error={error}
      hint={hint}
      placeholder={placeholder}
      dataOptions
      options={users.map((user) => ({
        value: user.id,
        label: user.name || user.email || `User #${user.id}`,
      }))}
    />
  );
}

export function RoleSelect({
  label,
  value,
  onChange,
  roles = [],
  placeholder = '— Peran —',
  disabled = false,
  required = false,
  error,
  hint,
}) {
  return (
    <Select
      label={label}
      value={value || ''}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      required={required}
      error={error}
      hint={hint}
      placeholder={placeholder}
      options={roles.map((role) => ({
        value: role.id,
        label: role.name || `Role #${role.id}`,
      }))}
    />
  );
}
