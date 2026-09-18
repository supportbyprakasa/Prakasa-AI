import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';

const initialForm = {
  name: '',
  email: '',
  password: '',
  entityId: '1',
  departmentId: '',
  roleIds: [],
  status: 'active',
};

export default function Users() {
  const [rows, setRows] = useState([]);
  const [entities, setEntities] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [meta, setMeta] = useState({ page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState('');

  const load = async (page = 1) => {
    setLoading(true);
    try {
      const [usersRes, entitiesRes, departmentsRes, rolesRes] = await Promise.all([
        api.get('/users', { params: { page, limit: 20 } }),
        api.get('/entities', { params: { page: 1, limit: 100 } }),
        api.get('/departments', { params: { page: 1, limit: 100 } }),
        api.get('/roles', { params: { page: 1, limit: 100 } }),
      ]);

      setRows(usersRes.data.data);
      setMeta(usersRes.data.meta);
      setEntities(entitiesRes.data.data || []);
      setDepartments(departmentsRes.data.data || []);
      setRoles(rolesRes.data.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
  }, []);

  const entityId = Number(form.entityId || 0);
  const availableDepartments = useMemo(
    () => departments.filter((item) => !entityId || Number(item.entityId) === entityId),
    [departments, entityId]
  );
  const availableRoles = useMemo(
    () => roles.filter((item) => !entityId || Number(item.entityId) === entityId),
    [roles, entityId]
  );

  const createUser = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      await api.post('/users', {
        name: form.name,
        email: form.email,
        password: form.password,
        entityId: Number(form.entityId),
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        roleIds: form.roleIds.map(Number),
        status: form.status,
        mustChangePassword: false,
      });
      setForm(initialForm);
      setMessage('Akun berhasil dibuat.');
      await load(1);
    } catch (error) {
      setMessage(error.response?.data?.error?.message || 'Gagal membuat akun.');
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async (user) => {
    const password = window.prompt(
      `Password baru untuk ${user.email} (minimal 10 karakter):`
    );
    if (!password) return;
    if (password.length < 10) {
      window.alert('Password minimal 10 karakter.');
      return;
    }

    try {
      await api.post(`/users/${user.id}/reset-password`, {
        password,
        mustChangePassword: false,
      });
      window.alert('Password berhasil di-reset.');
      await load(meta.page || 1);
    } catch (error) {
      window.alert(error.response?.data?.error?.message || 'Reset password gagal.');
    }
  };

  const toggleStatus = async (user) => {
    const nextStatus = user.status === 'active' ? 'inactive' : 'active';
    if (
      !window.confirm(
        `${nextStatus === 'inactive' ? 'Nonaktifkan' : 'Aktifkan'} akun ${user.email}?`
      )
    ) {
      return;
    }

    try {
      await api.patch(`/users/${user.id}`, { status: nextStatus });
      await load(meta.page || 1);
    } catch (error) {
      window.alert(error.response?.data?.error?.message || 'Update status gagal.');
    }
  };

  const fieldStyle = {
    padding: '9px 10px',
    borderRadius: 7,
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Users & Login Accounts</h2>
      <p style={{ color: 'var(--color-text-muted)', marginTop: -8 }}>
        Super Admin dapat membuat akun, menentukan role, menonaktifkan akun,
        dan melakukan reset password.
      </p>

      <form
        onSubmit={createUser}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 10,
          padding: 16,
          marginBottom: 20,
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          background: 'var(--color-surface)',
        }}
      >
        <input
          style={fieldStyle}
          placeholder="Nama lengkap"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <input
          style={fieldStyle}
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <input
          style={fieldStyle}
          type="password"
          placeholder="Password awal (min. 10)"
          minLength={10}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />

        <select
          style={fieldStyle}
          value={form.entityId}
          onChange={(e) =>
            setForm({ ...form, entityId: e.target.value, departmentId: '', roleIds: [] })
          }
          required
        >
          {entities.length === 0 && <option value="1">Entity 1</option>}
          {entities.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        <select
          style={fieldStyle}
          value={form.departmentId}
          onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
        >
          <option value="">Tanpa department</option>
          {availableDepartments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        <select
          multiple
          style={{ ...fieldStyle, minHeight: 74 }}
          value={form.roleIds.map(String)}
          onChange={(e) =>
            setForm({
              ...form,
              roleIds: Array.from(e.target.selectedOptions).map((option) => option.value),
            })
          }
        >
          {availableRoles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        <select
          style={fieldStyle}
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        <button
          type="submit"
          disabled={saving}
          style={{
            ...fieldStyle,
            border: 0,
            background: 'var(--color-primary)',
            color: '#fff',
            fontWeight: 600,
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          {saving ? 'Menyimpan…' : 'Create Account'}
        </button>
      </form>

      {message && (
        <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--color-text-muted)' }}>
          {message}
        </div>
      )}

      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'name', title: 'Nama' },
          { key: 'email', title: 'Email' },
          { key: 'entityId', title: 'Entity' },
          { key: 'departmentId', title: 'Department' },
          { key: 'status', title: 'Status' },
          {
            key: 'hasPassword',
            title: 'Manual Login',
            render: (row) => (row.hasPassword ? 'Ready' : 'Belum diset'),
          },
          {
            key: 'lastLoginAt',
            title: 'Last Login',
            render: (row) =>
              row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString() : '-',
          },
          {
            key: 'actions',
            title: 'Actions',
            render: (row) => (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button type="button" onClick={() => resetPassword(row)}>
                  Reset Password
                </button>
                <button type="button" onClick={() => toggleStatus(row)}>
                  {row.status === 'active' ? 'Disable' : 'Enable'}
                </button>
              </div>
            ),
          },
        ]}
      />

      <div
        style={{
          marginTop: 12,
          color: 'var(--color-text-muted)',
          fontSize: 13,
        }}
      >
        Total: {meta.total}
      </div>
    </div>
  );
}
