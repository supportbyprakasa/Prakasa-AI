const test = require('node:test');
const assert = require('node:assert/strict');
const resolver = require('../src/services/approverResolver.service');

// Decision 7 (wave 2): manager → division Head → Management Office Head, never
// the requester or the subject, never an excluded account; nobody → 409.

// A fake connection: `eligible` holds approval.decide (active, not excluded);
// `managers` maps a directory person to an account; `roles` maps a role key to
// its holders.
function fakeConn({ eligible = [], managers = {}, roles = {} } = {}) {
  const ids = Object.fromEntries(Object.keys(roles).map((key, i) => [key, i + 100]));
  return {
    async query(sql, args) {
      if (/FROM people_directory p\s+LEFT JOIN users u/.test(sql)) {
        const m = managers[args[0]];
        return [[m ? { user_id: m, name: `User ${m}` } : undefined].filter(Boolean)];
      }
      if (/SELECT u\.id FROM users u WHERE u\.id = \?/.test(sql)) {
        return [[eligible.includes(args[0]) ? { id: args[0] } : undefined].filter(Boolean)];
      }
      if (/SELECT code FROM departments/.test(sql)) return [[{ code: args[0] === 9 ? 'warehouse' : 'sales' }]];
      if (/FROM roles WHERE entity_id = \? AND role_key = \?/.test(sql)) {
        return [[ids[args[1]] ? { id: ids[args[1]], name: args[1] } : undefined].filter(Boolean)];
      }
      if (/JOIN user_roles ur ON ur\.user_id = u\.id AND ur\.role_id = \?/.test(sql)) {
        const key = Object.keys(ids).find((k) => ids[k] === args[0]);
        const exclude = args.length > 3 ? args[3] : [];
        const n = (roles[key] || []).filter((u) => eligible.includes(u) && !exclude.includes(u)).length;
        return [[{ n }]];
      }
      throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
    },
  };
}

const base = { entityId: 1, managerPersonId: 5, departmentId: 9 };

test('the manager decides when they have an account that may decide', async () => {
  const conn = fakeConn({ eligible: [20], managers: { 5: 20 }, roles: { 'warehouse.head': [21] } });
  assert.deepEqual(await resolver.resolveApprover(conn, { ...base, excludeUserIds: [7] }), { userId: 20, roleId: null, basis: 'manager', name: 'User 20' });
});

test('manager without account, without approval.decide, the requester or excluded → the division Head', async () => {
  for (const [label, opts, exclude] of [
    ['no account', { managers: {}, eligible: [21] }, [7]],
    ['no approval.decide / excluded in the directory', { managers: { 5: 20 }, eligible: [21] }, [7]],
    ['is the requester', { managers: { 5: 20 }, eligible: [20, 21] }, [20]],
  ]) {
    const conn = fakeConn({ ...opts, roles: { 'warehouse.head': [21], 'management_office.head': [30] } });
    const out = await resolver.resolveApprover(conn, { ...base, excludeUserIds: exclude });
    assert.equal(out.basis, 'division_head', label);
    assert.equal(out.userId, null);
    assert.equal(out.name, 'warehouse.head');
  }
});

test('the division Head is the subject → the Management Office Head', async () => {
  const conn = fakeConn({ eligible: [21, 30], roles: { 'warehouse.head': [21], 'management_office.head': [30] } });
  const out = await resolver.resolveApprover(conn, { ...base, managerPersonId: null, excludeUserIds: [21] });
  assert.equal(out.basis, 'management_office');
});

test('nobody can decide → 409 APPROVER_MISSING; never returns the requester or subject', async () => {
  const conn = fakeConn({ eligible: [21, 30], managers: { 5: 21 }, roles: { 'warehouse.head': [21], 'management_office.head': [30] } });
  await assert.rejects(resolver.resolveApprover(conn, { ...base, excludeUserIds: [21, 30] }), (e) => e.code === 'APPROVER_MISSING' && e.status === 409);
});

test('step 1 gets exactly the resolved approver', async () => {
  const calls = [];
  await resolver.assignFirstStep({ query: async (sql, args) => { calls.push({ sql, args }); return [{}]; } }, 77, { userId: null, roleId: 12 });
  assert.match(calls[0].sql, /UPDATE approval_steps SET approver_user_id = \?, approver_role_id = \?\s+WHERE approval_request_id = \? AND order_index = 1/);
  assert.deepEqual(calls[0].args, [null, 12, 77]);
});

test('eligibility needs an active account of the entity with approval.decide and no exclusion', () => {
  assert.match(resolver.ELIGIBLE_SQL, /u\.entity_id = \? AND u\.status = 'active' AND u\.deleted_at IS NULL/);
  assert.match(resolver.ELIGIBLE_SQL, /p\.code = 'approval\.decide'/);
  assert.match(resolver.ELIGIBLE_SQL, /xp\.kind = 'excluded'/);
});
