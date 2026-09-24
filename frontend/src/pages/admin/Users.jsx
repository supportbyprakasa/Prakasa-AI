import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, UserPlus, UsersRound } from 'lucide-react';
import api from '../../api/client';
import Button from '../../components/Button';
import DataTable from '../../components/DataTable';
import { rolesForDepartment } from './roleAdminModel';

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

  const load = useCallback(async (page = 1) => {
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
  }, []);

  useEffect(() => { load(1); }, [load]);

  const entityId = Number(form.entityId || 0);
  const departmentId = form.departmentId ? Number(form.departmentId) : null;
  const availableDepartments = useMemo(
    () => departments.filter((item) => Number(item.entityId) === entityId),
    [departments, entityId],
  );
  const availableRoles = useMemo(
    () => rolesForDepartment(roles, entityId, departmentId),
    [departmentId, entityId, roles],
  );
  const entityById = useMemo(
    () => new Map(entities.map((entity) => [Number(entity.id), entity.name])),
    [entities],
  );
  const departmentById = useMemo(
    () => new Map(departments.map((department) => [Number(department.id), department.name])),
    [departments],
  );

  const updateScope = (nextEntityId, nextDepartmentId) => {
    const allowedRoleIds = new Set(
      rolesForDepartment(roles, Number(nextEntityId), nextDepartmentId || null)
        .map((role) => String(role.id)),
    );
    setForm((current) => ({
      ...current,
      entityId: String(nextEntityId),
      departmentId: nextDepartmentId ? String(nextDepartmentId) : '',
      roleIds: current.roleIds.filter((roleId) => allowedRoleIds.has(String(roleId))),
    }));
  };

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
      setMessage(error.response?.data?.error?.message || 'Akun gagal dibuat.');
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async (user) => {
    const password = window.prompt(`Password baru untuk ${user.email} (minimal 10 karakter):`);
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
    if (!window.confirm(`${nextStatus === 'inactive' ? 'Nonaktifkan' : 'Aktifkan'} akun ${user.email}?`)) return;

    try {
      await api.patch(`/users/${user.id}`, { status: nextStatus });
      await load(meta.page || 1);
    } catch (error) {
      window.alert(error.response?.data?.error?.message || 'Status akun gagal diubah.');
    }
  };

  const roleSelectionDisabled = availableRoles.length === 0;

  return (
    <div className="user-admin-page">
      <header className="role-admin-header">
        <div>
          <span className="role-admin-eyebrow"><UsersRound size={16} /> Direktori internal</span>
          <h1>Pengguna</h1>
          <p>Tempatkan setiap akun pada entity, divisi, dan role yang tepat.</p>
        </div>
      </header>

      <form className="user-create-card" onSubmit={createUser}>
        <div className="user-create-card__heading">
          <span><UserPlus size={20} /></span>
          <div>
            <h2>Buat akun</h2>
            <p>Role divisi baru tersedia setelah divisi dipilih.</p>
          </div>
        </div>

        <div className="user-create-grid">
          <label>
            <span>Nama lengkap</span>
            <input
              autoComplete="name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              required
            />
          </label>
          <label>
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              required
            />
          </label>
          <label>
            <span>Password awal</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              required
            />
            <small>Minimal 10 karakter.</small>
          </label>
          <label>
            <span>Entity</span>
            <select
              value={form.entityId}
              onChange={(event) => updateScope(event.target.value, '')}
              required
            >
              {entities.length === 0 ? <option value="1">Prakasa Group</option> : null}
              {entities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            <span>Divisi</span>
            <select
              value={form.departmentId}
              onChange={(event) => updateScope(form.entityId, event.target.value)}
            >
              <option value="">Tanpa divisi (Super Admin)</option>
              {availableDepartments.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Role</span>
            <select
              multiple
              className="user-role-select"
              value={form.roleIds.map(String)}
              disabled={roleSelectionDisabled}
              aria-describedby="role-selection-help"
              onChange={(event) => setForm((current) => ({
                ...current,
                roleIds: Array.from(event.target.selectedOptions, (option) => option.value),
              }))}
            >
              {availableRoles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} — {item.departmentName || 'Global'}
                </option>
              ))}
            </select>
            <small id="role-selection-help">
              {roleSelectionDisabled
                ? 'Pilih divisi untuk menampilkan role yang sesuai.'
                : 'Hanya role dari divisi terpilih dan Super Admin yang ditampilkan.'}
            </small>
          </label>
          <label>
            <span>Status awal</span>
            <select
              value={form.status}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="active">Aktif</option>
              <option value="inactive">Nonaktif</option>
            </select>
          </label>
        </div>

        <div className="user-create-card__footer">
          {message ? <span role="status">{message}</span> : <span />}
          <Button type="submit" disabled={saving || roleSelectionDisabled}>
            <UserPlus size={18} /> {saving ? 'Menyimpan…' : 'Buat akun'}
          </Button>
        </div>
      </form>

      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          {
            key: 'name',
            title: 'Pengguna',
            render: (user) => (
              <div className="role-name-cell"><strong>{user.name}</strong><span>{user.email}</span></div>
            ),
          },
          { key: 'entityId', title: 'Entity', render: (user) => entityById.get(Number(user.entityId)) || '—' },
          { key: 'departmentId', title: 'Divisi', render: (user) => departmentById.get(Number(user.departmentId)) || 'Global' },
          {
            key: 'status',
            title: 'Status',
            render: (user) => <span className={`user-status user-status--${user.status}`}>{user.status === 'active' ? 'Aktif' : 'Nonaktif'}</span>,
          },
          { key: 'hasPassword', title: 'Login manual', render: (user) => (user.hasPassword ? 'Siap' : 'Belum diset') },
          {
            key: 'lastLoginAt',
            title: 'Login terakhir',
            render: (user) => user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('id-ID') : '—',
          },
          {
            key: 'actions',
            title: 'Tindakan',
            render: (user) => (
              <div className="role-row-actions">
                <Button variant="secondary" type="button" onClick={() => resetPassword(user)}>
                  <KeyRound size={16} /> Reset password
                </Button>
                <Button variant="secondary" type="button" onClick={() => toggleStatus(user)}>
                  {user.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                </Button>
              </div>
            ),
          },
        ]}
      />

      <div className="user-admin-total">Total: {meta.total}</div>
    </div>
  );
}
