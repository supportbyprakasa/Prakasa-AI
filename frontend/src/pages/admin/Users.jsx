import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import ConfirmDialog from '../../components/ConfirmDialog';
import DataGrid from '../../components/datagrid/DataGrid';
import { apiErrorMessage, fieldErrorsFromApi } from '../../components/datagrid/gridModel';
import EmptyState from '../../components/EmptyState';
import Field from '../../components/Field';
import FormActions from '../../components/FormActions';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import { formatDateTime } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import { noTranslate } from '../../i18n/NoTranslate';
import UserEditorPanel from './UserEditorPanel';
import { isSuperAdminUser, rolesForDepartment, userCreatePayload } from './roleAdminModel';
import './admin-editors.css';

const initialForm = {
  name: '',
  email: '',
  password: '',
  entityId: '1',
  departmentId: '',
  roleIds: [],
  status: 'active',
};

const STATUS_OPTIONS = [
  { value: 'active', label: 'Aktif' },
  { value: 'inactive', label: 'Nonaktif' },
];

const CREATE_FORM_ID = 'user-create-form';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

// superAdmin: only a Super Admin sees (and may fill) the initial password.
function validateCreate(form, superAdmin) {
  const errors = {};
  if (!form.name.trim()) errors.name = 'Isi nama lengkap.';
  if (!form.email.trim()) errors.email = 'Isi email.';
  else if (!EMAIL_PATTERN.test(form.email.trim())) errors.email = 'Format email belum benar, contoh nama@prakasa.id.';
  if (superAdmin && form.password && form.password.length < 10) errors.password = 'Kata sandi minimal 10 karakter.';
  return errors;
}

export default function Users() {
  const [rows, setRows] = useState([]);
  const [entities, setEntities] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [meta, setMeta] = useState({ page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [formErrors, setFormErrors] = useState({});
  const [editingUser, setEditingUser] = useState(null);
  const [resetUser, setResetUser] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetting, setResetting] = useState(false);
  const [statusUser, setStatusUser] = useState(null);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const { user: currentUser } = useAuth();
  // Passwords are managed by the Super Admin only; the server enforces it too.
  const superAdmin = isSuperAdminUser(currentUser);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setLoadError('');
    try {
      const [usersRes, entitiesRes, departmentsRes, rolesRes] = await Promise.all([
        api.get('/users', { params: { page, limit: 20 } }),
        api.get('/entities', { params: { page: 1, limit: 100 } }),
        api.get('/departments', { params: { page: 1, limit: 100 } }),
        api.get('/roles', { params: { page: 1, limit: 100 } }),
      ]);

      setRows(usersRes.data.data || []);
      setMeta(usersRes.data.meta || { page, total: usersRes.data.data?.length || 0 });
      setEntities(entitiesRes.data.data || []);
      setDepartments(departmentsRes.data.data || []);
      setRoles(rolesRes.data.data || []);
    } catch (error) {
      setLoadError(apiErrorMessage(error, 'Daftar pengguna tidak dapat dimuat.'));
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

  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormErrors((current) => ({ ...current, [key]: undefined }));
  };

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

  const toggleRole = (roleId) => {
    const normalizedId = String(roleId);
    setForm((current) => ({
      ...current,
      roleIds: current.roleIds.includes(normalizedId)
        ? current.roleIds.filter((id) => id !== normalizedId)
        : [...current.roleIds, normalizedId],
    }));
  };

  // The draft survives closing the dialog; only a successful create clears it.
  const openCreate = () => {
    setFormErrors({});
    setCreateOpen(true);
  };
  const createDirty = JSON.stringify(form) !== JSON.stringify(initialForm);

  const closeCreate = () => {
    if (!saving) setCreateOpen(false);
  };

  const createUser = async (event) => {
    event.preventDefault();
    const errors = validateCreate(form, superAdmin);
    if (Object.keys(errors).length) {
      setFormErrors(errors);
      return;
    }
    setSaving(true);

    try {
      await api.post('/users', userCreatePayload(form, superAdmin));
      setForm(initialForm);
      setCreateOpen(false);
      toast('Akun berhasil dibuat.', 'success');
      await load(1);
    } catch (error) {
      const fieldErrors = fieldErrorsFromApi(error);
      if (Object.keys(fieldErrors).length) setFormErrors(fieldErrors);
      else toast(apiErrorMessage(error, 'Akun gagal dibuat.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const openResetPassword = (user) => {
    setResetUser(user);
    setResetPasswordValue('');
    setResetError('');
  };

  const closeResetPassword = () => {
    if (resetting) return;
    setResetUser(null);
  };

  const resetPassword = async (event) => {
    event.preventDefault();
    if (resetPasswordValue.length < 10) {
      setResetError('Kata sandi minimal 10 karakter.');
      return;
    }

    setResetting(true);
    try {
      await api.post(`/users/${resetUser.id}/reset-password`, {
        password: resetPasswordValue,
      });
      toast('Kata sandi berhasil diatur ulang.', 'success');
      setResetUser(null);
      await load(meta.page || 1);
    } catch (error) {
      const fieldErrors = fieldErrorsFromApi(error);
      if (fieldErrors.password) setResetError(fieldErrors.password);
      else toast(apiErrorMessage(error, 'Kata sandi gagal diatur ulang.'), 'error');
    } finally {
      setResetting(false);
    }
  };

  const nextStatus = statusUser?.status === 'active' ? 'inactive' : 'active';

  const toggleStatus = async () => {
    setTogglingStatus(true);
    try {
      await api.patch(`/users/${statusUser.id}`, { status: nextStatus });
      setStatusUser(null);
      await load(meta.page || 1);
    } catch (error) {
      toast(apiErrorMessage(error, 'Status akun gagal diubah.'), 'error');
      setStatusUser(null);
    } finally {
      setTogglingStatus(false);
    }
  };

  const roleSelectionDisabled = availableRoles.length === 0;

  const columns = [
    {
      key: 'name',
      header: 'Nama',
      render: (user) => (
        <span className="pw-cell">
          <span data-no-translate="" className="pw-cell__title">{user.name}</span>
          <span data-no-translate="" className="pw-cell__meta">{user.email}</span>
        </span>
      ),
    },
    { key: 'entityId', header: 'Entitas', render: (user) => entityById.get(Number(user.entityId)) },
    { key: 'departmentId', header: 'Divisi', translate: true, render: (user) => departmentById.get(Number(user.departmentId)) || 'Global' },
    { key: 'status', header: 'Status', render: (user) => <StatusBadge status={user.status} /> },
    { key: 'hasPassword', header: 'Masuk dengan kata sandi', translate: true, render: (user) => (user.hasPassword ? 'Siap' : 'Belum diatur') },
    { key: 'lastLoginAt', header: 'Login terakhir', type: 'datetime' },
  ];

  return (
    <Page>
      <PageHeader
        title="Pengguna"
        description="Tempatkan setiap akun pada entitas, divisi, dan peran yang tepat."
        actions={<Button icon="person_add" onClick={openCreate}>Tambah pengguna</Button>}
      />

      <DataGrid
        title="Semua pengguna"
        exportName="pengguna"
        columns={columns}
        rows={rows}
        loading={loading}
        error={loadError}
        onRetry={() => load(meta.page || 1)}
        meta={meta}
        onPageChange={load}
        empty="Belum ada pengguna"
        onRowClick={(user) => setEditingUser(user)}
        rowActions={(user) => (
          <>
            {superAdmin ? (
              <IconButton size="sm" icon="key" label={`Atur ulang kata sandi ${user.email}`} onClick={() => openResetPassword(user)} />
            ) : null}
            {Number(user.id) !== Number(currentUser?.id) ? (
              <IconButton
                size="sm"
                icon="power_settings_new"
                label={`${user.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} akun ${user.email}`}
                tone={user.status === 'active' ? 'danger' : 'primary'}
                onClick={() => setStatusUser(user)}
              />
            ) : null}
          </>
        )}
      />

      <FullScreenDialog
        open={createOpen}
        title="Tambah pengguna"
        onClose={closeCreate}
        dirty={createDirty}
        card={false}
        actions={(
          <>
            <Button variant="text" type="button" onClick={closeCreate} disabled={saving}>Batal</Button>
            <Button type="submit" form={CREATE_FORM_ID} loading={saving} disabled={roleSelectionDisabled}>Tambah pengguna</Button>
          </>
        )}
      >
        <form id={CREATE_FORM_ID} className="admin-dialog-form" onSubmit={createUser} noValidate>
          <FullScreenSection title="Informasi pengguna">
            <div className="pw-fsdialog__fields">
              <Input
                label="Nama lengkap"
                autoComplete="name"
                value={form.name}
                error={formErrors.name}
                onChange={(event) => setField('name', event.target.value)}
                required
              />
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                value={form.email}
                error={formErrors.email}
                onChange={(event) => setField('email', event.target.value)}
                required
              />
              {superAdmin ? (
                <Input
                  label="Kata sandi sementara (opsional)"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  hint="Minimal 10 karakter. Pengguna wajib menggantinya saat pertama masuk. Kosongkan bila pengguna masuk dengan akun Google kantor."
                  value={form.password}
                  error={formErrors.password}
                  onChange={(event) => setField('password', event.target.value)}
                />
              ) : null}
              <Select
                label="Status awal"
                value={form.status}
                onChange={(event) => setField('status', event.target.value)}
                options={STATUS_OPTIONS}
              />
            </div>
            {superAdmin ? null : (
              <Banner tone="info">
                Akun ini masuk dengan akun Google kantor. Kata sandi dikelola oleh Super Admin: bila pengguna memerlukan kata sandi, minta Super Admin mengaturnya.
              </Banner>
            )}
          </FullScreenSection>

          <FullScreenSection title="Organisasi dan peran">
            <div className="pw-fsdialog__fields">
              <Select
                label="Entitas"
                value={form.entityId}
                error={formErrors.entityId}
                onChange={(event) => updateScope(event.target.value, '')}
                required
              >
                {entities.length === 0 ? <option value="1" {...noTranslate}>Prakasa Foods Nusantara</option> : null}
                {entities.map((item) => <option key={item.id} value={item.id} {...noTranslate}>{item.name}</option>)}
              </Select>
              <Select
                label="Divisi"
                value={form.departmentId}
                error={formErrors.departmentId}
                hint="Peran divisi tampil setelah divisi dipilih."
                onChange={(event) => updateScope(form.entityId, event.target.value)}
                placeholder="Tanpa divisi (Super Admin)"
                options={availableDepartments.map((item) => ({ value: item.id, label: item.name }))}
              />
            </div>
            <Field
              label="Peran"
              error={formErrors.roleIds}
              hint={roleSelectionDisabled
                ? 'Pilih divisi untuk menampilkan peran yang sesuai.'
                : 'Hanya peran dari divisi terpilih dan Super Admin yang ditampilkan.'}
            >
              {availableRoles.length ? (
                <div className="admin-choice-list">
                  {availableRoles.map((role) => (
                    <Checkbox
                      key={role.id}
                      checked={form.roleIds.includes(String(role.id))}
                      onChange={() => toggleRole(role.id)}
                      label={(
                        <span className="pw-cell">
                          <span className="pw-cell__title">{role.name}</span>
                          <span className="pw-cell__meta">{role.departmentName || 'Global'}</span>
                        </span>
                      )}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState compact icon="shield" title="Belum ada peran untuk pilihan ini." />
              )}
            </Field>
          </FullScreenSection>
        </form>
      </FullScreenDialog>

      <UserEditorPanel
        open={Boolean(editingUser)}
        user={editingUser}
        isSelf={Number(editingUser?.id) === Number(currentUser?.id)}
        entities={entities}
        departments={departments}
        roles={roles}
        onClose={() => setEditingUser(null)}
        onSaved={() => load(meta.page || 1)}
      />

      {/* Only a Super Admin can open this (the row action is hidden otherwise). */}
      <Modal
        open={superAdmin && Boolean(resetUser)}
        size="sm"
        title="Atur ulang kata sandi"
        onClose={closeResetPassword}
      >
        <form className="pw-stack" onSubmit={resetPassword} noValidate>
          <Input
            label={`Kata sandi sementara untuk ${resetUser?.email || ''}`}
            type="password"
            autoComplete="new-password"
            hint="Minimal 10 karakter. Pengguna wajib menggantinya saat masuk berikutnya."
            error={resetError}
            value={resetPasswordValue}
            onChange={(event) => { setResetPasswordValue(event.target.value); setResetError(''); }}
            required
            autoFocus
          />
          <FormActions>
            <Button variant="text" type="button" onClick={closeResetPassword} disabled={resetting}>Batal</Button>
            <Button type="submit" loading={resetting}>Atur ulang kata sandi</Button>
          </FormActions>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(statusUser)}
        title={`${nextStatus === 'inactive' ? 'Nonaktifkan' : 'Aktifkan'} akun?`}
        message={`${nextStatus === 'inactive' ? 'Nonaktifkan' : 'Aktifkan'} akun ${statusUser?.email || ''}?`}
        confirmLabel={nextStatus === 'inactive' ? 'Nonaktifkan akun' : 'Aktifkan akun'}
        tone={nextStatus === 'inactive' ? 'danger' : 'primary'}
        loading={togglingStatus}
        onClose={() => setStatusUser(null)}
        onConfirm={toggleStatus}
      />
    </Page>
  );
}
