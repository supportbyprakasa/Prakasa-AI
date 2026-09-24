const ROLE_LEVEL_ORDER = Object.freeze(['member', 'supervisor', 'head']);

function titleFromKey(key) {
  return key
    .split(/[._]/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function groupPermissions(permissions = []) {
  const groups = new Map();

  for (const permission of permissions) {
    const parts = permission.code.split('.');
    const key = parts.length > 1 ? parts.slice(0, -1).join('.') : parts[0];
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: titleFromKey(key),
        permissions: [],
      });
    }
    groups.get(key).permissions.push(permission);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      permissions: group.permissions.toSorted((left, right) => (
        left.code.localeCompare(right.code)
      )),
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label));
}

export function roleDiff(original = [], selected = []) {
  const originalSet = new Set(original);
  const selectedSet = new Set(selected);
  return {
    added: [...selectedSet].filter((code) => !originalSet.has(code)).toSorted(),
    removed: [...originalSet].filter((code) => !selectedSet.has(code)).toSorted(),
    unchanged: [...selectedSet].filter((code) => originalSet.has(code)).toSorted(),
  };
}

export function rolesForDepartment(roles = [], entityId, departmentId) {
  const normalizedEntityId = Number(entityId);
  const normalizedDepartmentId = departmentId == null || departmentId === ''
    ? null
    : Number(departmentId);

  return roles.filter((role) => {
    if (Number(role.entityId) !== normalizedEntityId) return false;
    if (role.departmentId == null) return role.roleKey === 'system.super_admin';
    return normalizedDepartmentId != null
      && Number(role.departmentId) === normalizedDepartmentId;
  });
}

export function roleHierarchyRows(roles = [], departmentId) {
  const normalizedDepartmentId = Number(departmentId);
  return roles
    .filter((role) => Number(role.departmentId) === normalizedDepartmentId
      && ROLE_LEVEL_ORDER.includes(role.roleLevel))
    .toSorted((left, right) => (
      ROLE_LEVEL_ORDER.indexOf(left.roleLevel) - ROLE_LEVEL_ORDER.indexOf(right.roleLevel)
    ));
}

export function shouldCloseRoleEditorFromBackdrop({
  confirmOpen,
  eventTargetIsBackdrop,
}) {
  return !confirmOpen && eventTargetIsBackdrop;
}

export { ROLE_LEVEL_ORDER };
