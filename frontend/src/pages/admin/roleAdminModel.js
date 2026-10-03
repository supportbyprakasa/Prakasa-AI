const ROLE_LEVEL_ORDER = Object.freeze(['member', 'supervisor', 'head']);

// Role levels are categories (not statuses): shown as plain labels.
export const ROLE_LEVEL_LABELS = Object.freeze({
  member: 'Member',
  supervisor: 'Supervisor',
  head: 'Head',
  admin: 'Admin',
  custom: 'Custom',
});

// Passwords are managed by the Super Admin only: the Users page shows the
// password field and "Atur ulang kata sandi" to a Super Admin, nobody else.
// user: the signed-in user from GET /auth/me ({ roles: [{ roleKey }] }). The
// server enforces the same rule (users.controller).
export function isSuperAdminUser(user) {
  return (Array.isArray(user?.roles) ? user.roles : []).some((role) => role?.roleKey === 'system.super_admin');
}

// Body of POST /users. An initial password is sent only by a Super Admin who
// typed one; without it the account signs in with Google.
export function userCreatePayload(form, superAdmin) {
  const payload = {
    name: form.name,
    email: form.email,
    entityId: Number(form.entityId),
    departmentId: form.departmentId ? Number(form.departmentId) : null,
    roleIds: form.roleIds.map(Number),
    status: form.status,
  };
  if (superAdmin && form.password) payload.password = form.password;
  return payload;
}

export function roleLevelLabel(level) {
  return ROLE_LEVEL_LABELS[level] || 'Custom';
}

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
    if (role.departmentId == null) return ['system.super_admin', 'system.admin'].includes(role.roleKey);
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

export function userEditFormFromDetail(detail = {}) {
  return {
    name: detail.name || '',
    email: detail.email || '',
    entityId: detail.entityId == null ? '' : String(detail.entityId),
    departmentId: detail.departmentId == null ? '' : String(detail.departmentId),
    status: detail.status || 'active',
    roleIds: (detail.roles || []).map((role) => String(role.id)),
  };
}

export function userFormForScope(current, roles, entityId, departmentId) {
  const allowedRoleIds = new Set(
    rolesForDepartment(roles, entityId, departmentId).map((role) => String(role.id)),
  );
  return {
    ...current,
    entityId: String(entityId),
    departmentId: departmentId == null || departmentId === '' ? '' : String(departmentId),
    roleIds: current.roleIds.filter((roleId) => allowedRoleIds.has(String(roleId))),
  };
}

export function userEditPayload(form) {
  return {
    name: form.name.trim(),
    email: form.email.trim().toLowerCase(),
    entityId: Number(form.entityId),
    departmentId: form.departmentId ? Number(form.departmentId) : null,
    status: form.status,
    roleIds: form.roleIds.map(Number),
  };
}

export function shouldCloseRoleEditorFromBackdrop({
  confirmOpen,
  eventTargetIsBackdrop,
}) {
  return !confirmOpen && eventTargetIsBackdrop;
}

export { ROLE_LEVEL_ORDER };
