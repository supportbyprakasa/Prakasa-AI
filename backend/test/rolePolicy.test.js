const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const pool = require('../src/db/pool');
const rolePolicy = require('../src/services/rolePolicy.service');
const rolesController = require('../src/controllers/roles.controller');
const usersController = require('../src/controllers/users.controller');
const {
  getAssignableRoles,
  loadRolesForAssignment,
  resetStandardRole,
  validateRoleAssignment,
} = require('../src/services/rolePolicy.service');
const {
  permissionsForStandardRole,
} = require('../src/config/standardOrganization');

function divisionRole(overrides = {}) {
  return {
    id: 9,
    name: 'Warehouse Member',
    entity_id: 1,
    department_id: 11,
    department_entity_id: 1,
    department_deleted_at: null,
    role_key: 'warehouse.member',
    role_level: 'member',
    deleted_at: null,
    ...overrides,
  };
}

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('division role matching the user entity and department is accepted', () => {
  const roles = [divisionRole()];
  assert.equal(validateRoleAssignment({
    entityId: 1,
    departmentId: 11,
    roleRows: roles,
  }), roles);
});

test('global Super Admin role is accepted without a division match', () => {
  const roles = [divisionRole({
    id: 1,
    name: 'Super Admin',
    department_id: null,
    department_entity_id: null,
    role_key: 'system.super_admin',
    role_level: 'admin',
  })];
  assert.equal(validateRoleAssignment({
    entityId: 1,
    departmentId: null,
    roleRows: roles,
  }), roles);
});

test('division role must match the user department', () => {
  assert.throws(
    () => validateRoleAssignment({
      entityId: 1,
      departmentId: 11,
      roleRows: [divisionRole({ department_id: 12 })],
    }),
    (error) => error.code === 'ROLE_ASSIGNMENT_INVALID'
      && error.status === 400
      && /divisi pengguna/.test(error.message),
  );
});

test('role from another entity is rejected', () => {
  assert.throws(
    () => validateRoleAssignment({
      entityId: 1,
      departmentId: 11,
      roleRows: [divisionRole({ entity_id: 2, department_entity_id: 2 })],
    }),
    /entity pengguna/,
  );
});

test('division role requires a user department', () => {
  assert.throws(
    () => validateRoleAssignment({
      entityId: 1,
      departmentId: null,
      roleRows: [divisionRole()],
    }),
    /divisi pengguna belum dipilih/,
  );
});

test('deleted roles and roles linked to deleted departments are rejected', () => {
  assert.throws(
    () => validateRoleAssignment({
      entityId: 1,
      departmentId: 11,
      roleRows: [divisionRole({ deleted_at: '2026-09-24 00:00:00' })],
    }),
    /tidak aktif/,
  );
  assert.throws(
    () => validateRoleAssignment({
      entityId: 1,
      departmentId: 11,
      roleRows: [divisionRole({ department_deleted_at: '2026-09-24 00:00:00' })],
    }),
    /Divisi role .* tidak aktif/,
  );
});

test('department change requires a compatible replacement role set', () => {
  const existingRoles = [divisionRole({ department_id: 11 })];
  assert.throws(
    () => validateRoleAssignment({
      entityId: 1,
      departmentId: 12,
      roleRows: existingRoles,
    }),
    /divisi pengguna/,
  );

  const replacementRoles = [divisionRole({
    id: 12,
    department_id: 12,
    role_key: 'finance.member',
    name: 'Finance Member',
  })];
  assert.equal(validateRoleAssignment({
    entityId: 1,
    departmentId: 12,
    roleRows: replacementRoles,
  }), replacementRoles);
});

test('assignable role lookup returns only the database-authorized role rows', async () => {
  const expected = [
    divisionRole(),
    divisionRole({
      id: 1,
      name: 'Super Admin',
      department_id: null,
      role_key: 'system.super_admin',
      role_level: 'admin',
    }),
  ];
  const connection = {
    async query(sql, params) {
      assert.match(sql, /r\.entity_id = \?/);
      assert.match(sql, /r\.department_id = \?|system\.super_admin/);
      assert.deepEqual(params, [1, 11]);
      return [expected];
    },
  };

  assert.deepEqual(await getAssignableRoles({
    entityId: 1,
    departmentId: 11,
    connection,
  }), expected);
});

test('role loading rejects missing role ids before assignment writes', async () => {
  const connection = {
    async query(sql, params) {
      assert.match(sql, /FOR SHARE/);
      assert.deepEqual(params, [[9, 10]]);
      return [[divisionRole({ id: 9 })]];
    },
  };

  await assert.rejects(
    loadRolesForAssignment({ connection, roleIds: [9, 10] }),
    (error) => error.code === 'ROLE_ASSIGNMENT_INVALID'
      && /tidak ditemukan atau tidak aktif/.test(error.message),
  );
});

test('user create validates role scope before inserting the user', async (t) => {
  const writes = [];
  let rolledBack = false;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() { rolledBack = true; },
    release() {},
    async query(sql) {
      const statement = String(sql);
      if (statement.includes('FROM roles r')) {
        return [[divisionRole({ department_id: 12 })]];
      }
      if (/INSERT INTO users|INSERT IGNORE INTO user_roles|UPDATE users/.test(statement)) {
        writes.push(statement);
      }
      if (statement.includes('INSERT INTO users')) return [{ insertId: 44 }];
      return [{ affectedRows: 1 }];
    },
  };
  t.mock.method(bcrypt, 'hash', async () => 'hash');
  t.mock.method(pool, 'getConnection', async () => connection);
  t.mock.method(pool, 'query', async () => [{ affectedRows: 1 }]);

  let nextError;
  await usersController.create({
    body: {
      name: 'Warehouse User',
      email: 'warehouse@example.com',
      password: 'strong-password',
      entityId: 1,
      departmentId: 11,
      roleIds: [9],
    },
    user: { sub: 1 },
  }, responseDouble(), (error) => { nextError = error; });

  assert.equal(nextError?.code, 'ROLE_ASSIGNMENT_INVALID');
  assert.deepEqual(writes, []);
  assert.equal(rolledBack, true);
});

test('department update validates retained roles before updating the user', async (t) => {
  const writes = [];
  let rolledBack = false;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() { rolledBack = true; },
    release() {},
    async query(sql) {
      const statement = String(sql);
      if (statement.includes('FROM users') && statement.includes('FOR UPDATE')) {
        return [[{ id: 20, entity_id: 1, department_id: 11 }]];
      }
      if (statement.includes('FROM user_roles')) {
        return [[divisionRole({ department_id: 11 })]];
      }
      if (/UPDATE users|DELETE FROM user_roles|INSERT IGNORE INTO user_roles/.test(statement)) {
        writes.push(statement);
      }
      return [{ affectedRows: 1 }];
    },
  };
  t.mock.method(pool, 'getConnection', async () => connection);
  t.mock.method(pool, 'query', async () => [{ affectedRows: 1 }]);

  let nextError;
  await usersController.update({
    params: { id: '20' },
    body: { departmentId: 12 },
    user: { sub: 1, entityId: 1 },
  }, responseDouble(), (error) => { nextError = error; });

  assert.equal(nextError?.code, 'ROLE_ASSIGNMENT_INVALID');
  assert.deepEqual(writes, []);
  assert.equal(rolledBack, true);
});

test('reset standard role restores only its catalog permissions and audits the diff', async () => {
  const targetCodes = permissionsForStandardRole('warehouse.member');
  const permissionRows = targetCodes.map((code, index) => ({ id: index + 100, code }));
  const codeById = new Map(permissionRows.map((row) => [row.id, row.code]));
  const assigned = new Set(['document.view', 'legacy.permission']);
  let auditMetadata;
  let committed = false;
  const connection = {
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() {},
    release() {},
    async query(sql, params) {
      const statement = String(sql);
      if (statement.includes('FROM roles r') && statement.includes('FOR UPDATE')) {
        return [[{
          id: 31,
          entity_id: 1,
          role_key: 'warehouse.member',
          is_system_template: 1,
          deleted_at: null,
        }]];
      }
      if (statement.includes('FROM permissions p') && statement.includes('p.code IN')) {
        return [permissionRows];
      }
      if (statement.includes('FROM role_permissions rp')) {
        return [[...assigned].map((code) => ({ code }))];
      }
      if (statement.startsWith('DELETE FROM role_permissions')) {
        assigned.clear();
        return [{ affectedRows: 2 }];
      }
      if (statement.startsWith('INSERT IGNORE INTO role_permissions')) {
        for (const [, permissionId] of params[0]) assigned.add(codeById.get(permissionId));
        return [{ affectedRows: params[0].length }];
      }
      if (statement.includes('INSERT INTO activity_logs')) {
        auditMetadata = JSON.parse(params[5]);
        return [{ insertId: 1 }];
      }
      throw new Error(`Unexpected query: ${statement}`);
    },
  };

  const result = await resetStandardRole({
    roleId: 31,
    actor: { userId: 1, entityId: 1 },
    connection,
  });

  assert.equal(committed, true);
  assert.equal(result.permissionCount, targetCodes.length);
  assert.deepEqual(result.removedPermissions, ['legacy.permission']);
  assert.equal(result.addedPermissions.includes('warehouse.movement.submit'), true);
  assert.equal(assigned.size, targetCodes.length);
  assert.equal(assigned.has('legacy.permission'), false);
  assert.equal(auditMetadata.roleKey, 'warehouse.member');
  assert.deepEqual(auditMetadata.removedPermissions, ['legacy.permission']);
});

test('reset refuses custom and Super Admin roles', async () => {
  for (const role of [
    { role_key: null, is_system_template: 0 },
    { role_key: 'system.super_admin', is_system_template: 1 },
  ]) {
    let rolledBack = false;
    const connection = {
      async beginTransaction() {},
      async commit() {},
      async rollback() { rolledBack = true; },
      release() {},
      async query(sql) {
        if (String(sql).includes('FROM roles r')) {
          return [[{
            id: 1,
            entity_id: 1,
            deleted_at: null,
            ...role,
          }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    await assert.rejects(
      resetStandardRole({
        roleId: 1,
        actor: { userId: 1, entityId: 1 },
        connection,
      }),
      (error) => error.code === 'ROLE_RESET_NOT_ALLOWED' && error.status === 400,
    );
    assert.equal(rolledBack, true);
  }
});

test('role list returns division metadata and permission/user counts', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const statement = String(sql);
    if (statement.includes('COUNT(*) AS total')) return [[{ total: 1 }]];
    assert.match(statement, /r\.role_key AS roleKey/);
    assert.match(statement, /d\.name AS departmentName/);
    assert.match(statement, /COUNT\(DISTINCT rp\.permission_id\) AS permissionCount/);
    assert.match(statement, /COUNT\(DISTINCT ur\.user_id\) AS userCount/);
    return [[{
      id: 31,
      entityId: 1,
      name: 'Warehouse Member',
      roleKey: 'warehouse.member',
      departmentId: 11,
      departmentName: 'Warehouse',
      roleLevel: 'member',
      isSystemTemplate: 1,
      permissionCount: 56,
      userCount: 3,
    }]];
  });
  const res = responseDouble();
  let nextError;
  await rolesController.list({ query: {}, user: { sub: 1 } }, res,
    (error) => { nextError = error; });

  assert.equal(nextError, undefined);
  assert.equal(res.body.data[0].roleKey, 'warehouse.member');
  assert.equal(res.body.data[0].departmentName, 'Warehouse');
  assert.equal(res.body.data[0].permissionCount, 56);
  assert.equal(res.body.data[0].userCount, 3);
});

test('role detail exposes structural scope and reset endpoint returns its diff', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const statement = String(sql);
    if (statement.includes('FROM roles r')) {
      assert.match(statement, /r\.role_key AS roleKey/);
      assert.match(statement, /d\.name AS departmentName/);
      return [[{
        id: 31,
        entityId: 1,
        name: 'Warehouse Member',
        roleKey: 'warehouse.member',
        departmentId: 11,
        departmentName: 'Warehouse',
        roleLevel: 'member',
        isSystemTemplate: 1,
        permissionCount: 56,
        userCount: 3,
      }]];
    }
    if (statement.includes('FROM role_permissions')) return [[]];
    throw new Error(`Unexpected query: ${statement}`);
  });
  const detailRes = responseDouble();
  let detailError;
  await rolesController.detail({ params: { id: '31' } }, detailRes,
    (error) => { detailError = error; });
  assert.equal(detailError, undefined);
  assert.equal(detailRes.body.data.departmentId, 11);
  assert.equal(detailRes.body.data.roleLevel, 'member');

  t.mock.method(rolePolicy, 'resetStandardRole', async ({ roleId, actor }) => ({
    id: Number(roleId),
    roleKey: 'warehouse.member',
    permissionCount: 56,
    addedPermissions: ['warehouse.movement.submit'],
    removedPermissions: [],
    actor,
  }));
  const resetRes = responseDouble();
  let resetError;
  await rolesController.resetStandard({
    params: { id: '31' },
    user: { sub: 7, entityId: 1 },
  }, resetRes, (error) => { resetError = error; });

  assert.equal(resetError, undefined);
  assert.equal(resetRes.body.data.roleKey, 'warehouse.member');
  assert.equal(resetRes.body.data.addedPermissions[0], 'warehouse.movement.submit');
});

test('permission-only role patch does not overwrite role identity fields', async (t) => {
  const statements = [];
  let committed = false;
  const connection = {
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() {},
    release() {},
    async query(sql) {
      const statement = String(sql);
      statements.push(statement);
      if (statement.includes('FROM roles') && statement.includes('FOR UPDATE')) {
        return [[{ id: 31, entity_id: 1, name: 'Warehouse Member' }]];
      }
      if (statement.startsWith('UPDATE roles')) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    },
  };
  t.mock.method(pool, 'getConnection', async () => connection);
  t.mock.method(pool, 'query', async () => [{ insertId: 1 }]);

  const res = responseDouble();
  let nextError;
  await rolesController.update({
    params: { id: '31' },
    body: { permissionIds: [1, 2] },
    user: { sub: 7 },
  }, res, (error) => { nextError = error; });

  assert.equal(nextError, undefined);
  assert.equal(committed, true);
  assert.equal(statements.some((statement) => statement.startsWith('UPDATE roles')), false);
  assert.equal(statements.some((statement) => statement.startsWith('DELETE FROM role_permissions')), true);
});
