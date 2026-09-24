import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupPermissions,
  roleDiff,
  roleHierarchyRows,
  rolesForDepartment,
  shouldCloseRoleEditorFromBackdrop,
} from '../src/pages/admin/roleAdminModel.js';

test('permissions are grouped by tool prefix with stable labels and ordering', () => {
  const groups = groupPermissions([
    { id: 4, code: 'warehouse.movement.submit', description: 'Ajukan movement' },
    { id: 1, code: 'document.view', description: 'Lihat dokumen' },
    { id: 3, code: 'warehouse.movement.view', description: 'Lihat movement' },
    { id: 2, code: 'document.create', description: 'Buat dokumen' },
  ]);

  assert.deepEqual(groups.map((group) => group.key), [
    'document',
    'warehouse.movement',
  ]);
  assert.deepEqual(groups[0].permissions.map((permission) => permission.code), [
    'document.create',
    'document.view',
  ]);
  assert.equal(groups[1].label, 'Warehouse Movement');
});

test('role diff returns exact added and removed permission codes', () => {
  assert.deepEqual(
    roleDiff(['document.view', 'task.view'], ['document.view', 'task.create']),
    {
      added: ['task.create'],
      removed: ['task.view'],
      unchanged: ['document.view'],
    },
  );
});

test('role hierarchy rows are ordered Member Supervisor Head for one division', () => {
  const roles = [
    { id: 3, departmentId: 11, roleLevel: 'head' },
    { id: 1, departmentId: 11, roleLevel: 'member' },
    { id: 4, departmentId: 12, roleLevel: 'member' },
    { id: 2, departmentId: 11, roleLevel: 'supervisor' },
  ];
  assert.deepEqual(
    roleHierarchyRows(roles, 11).map((role) => role.id),
    [1, 2, 3],
  );
});

test('department role filter retains only matching roles and global Super Admin', () => {
  const roles = [
    { id: 1, entityId: 1, departmentId: null, roleKey: 'system.super_admin' },
    { id: 2, entityId: 1, departmentId: null, roleKey: null },
    { id: 3, entityId: 1, departmentId: 11, roleKey: 'warehouse.member' },
    { id: 4, entityId: 1, departmentId: 12, roleKey: 'finance.member' },
    { id: 5, entityId: 2, departmentId: 11, roleKey: 'warehouse.member' },
  ];

  assert.deepEqual(
    rolesForDepartment(roles, 1, 11).map((role) => role.id),
    [1, 3],
  );
  assert.deepEqual(
    rolesForDepartment(roles, 1, null).map((role) => role.id),
    [1],
  );
});

test('nested confirmation interaction never closes the role editor backdrop', () => {
  assert.equal(shouldCloseRoleEditorFromBackdrop({
    confirmOpen: true,
    eventTargetIsBackdrop: true,
  }), false);
  assert.equal(shouldCloseRoleEditorFromBackdrop({
    confirmOpen: false,
    eventTargetIsBackdrop: false,
  }), false);
  assert.equal(shouldCloseRoleEditorFromBackdrop({
    confirmOpen: false,
    eventTargetIsBackdrop: true,
  }), true);
});
