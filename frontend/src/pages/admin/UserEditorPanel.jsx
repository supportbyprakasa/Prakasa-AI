import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import ConfirmDialog from '../../components/ConfirmDialog';
import { apiErrorMessage, fieldErrorsFromApi } from '../../components/datagrid/gridModel';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import Field from '../../components/Field';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import Input from '../../components/Input';
import Select from '../../components/Select';
import {
  roleLevelLabel,
  rolesForDepartment,
  userEditFormFromDetail,
  userEditPayload,
  userFormForScope,
} from './roleAdminModel';
import InfoTip from '../../components/InfoTip';
import { roleInfo, roleMixWarning } from './roleInfoModel';
import { Mixed } from '../../i18n/NoTranslate';
import './admin-editors.css';

const EMPTY_FORM = userEditFormFromDetail();
const FORM_ID = 'user-editor-form';
const STATUS_OPTIONS = [
  { value: 'active', label: 'Aktif' },
  { value: 'inactive', label: 'Nonaktif' },
];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

function validate(form) {
  const errors = {};
  if (!form.name.trim()) errors.name = 'Isi nama lengkap.';
  if (!form.email.trim()) errors.email = 'Isi email.';
  else if (!EMAIL_PATTERN.test(form.email.trim())) errors.email = 'Format email belum benar, contoh nama@prakasa.id.';
  if (!form.entityId) errors.entityId = 'Pilih entity.';
  return errors;
}

// Edit an existing account: the admin console's full-screen user form
// (docs/ui-guideline.md §3.3), opened from a row of the Users list.
export default function UserEditorPanel({
  user,
  open,
  entities = [],
  departments = [],
  roles = [],
  isSelf = false,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [errors, setErrors] = useState({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open || !user?.id) return undefined;
    let active = true;
    setLoading(true);
    setLoadError('');
    setSaveError('');
    setErrors({});
    setConfirmOpen(false);

    api.get(`/users/${user.id}`)
      .then((response) => {
        if (active) setForm(userEditFormFromDetail(response.data.data));
      })
      .catch((requestError) => {
        if (active) setLoadError(apiErrorMessage(requestError, 'Data pengguna tidak dapat dimuat.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [open, user?.id, attempt]);

  const entityId = Number(form.entityId || 0);
  const departmentId = form.departmentId ? Number(form.departmentId) : null;
  const availableDepartments = useMemo(
    () => departments.filter((department) => Number(department.entityId) === entityId),
    [departments, entityId],
  );
  const availableRoles = useMemo(
    () => rolesForDepartment(roles, entityId, departmentId),
    [departmentId, entityId, roles],
  );
  const mixWarning = roleMixWarning(availableRoles.filter((role) => form.roleIds.includes(String(role.id))));
  const selectedRoleNames = useMemo(() => {
    const selectedIds = new Set(form.roleIds.map(String));
    return availableRoles
      .filter((role) => selectedIds.has(String(role.id)))
      .map((role) => role.name);
  }, [availableRoles, form.roleIds]);

  const close = useCallback(() => {
    if (!saving) onClose?.();
  }, [onClose, saving]);

  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const updateScope = (nextEntityId, nextDepartmentId) => {
    setErrors((current) => ({ ...current, entityId: undefined, departmentId: undefined }));
    setForm((current) => userFormForScope(
      current,
      roles,
      Number(nextEntityId),
      nextDepartmentId ? Number(nextDepartmentId) : null,
    ));
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

  const requestSave = (event) => {
    event.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (!Object.keys(nextErrors).length) setConfirmOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await api.patch(`/users/${user.id}`, userEditPayload(form));
      setConfirmOpen(false);
      await onSaved?.();
      onClose?.();
    } catch (requestError) {
      setConfirmOpen(false);
      const fieldErrors = fieldErrorsFromApi(requestError);
      if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
      else setSaveError(apiErrorMessage(requestError, 'Perubahan pengguna gagal disimpan.'));
    } finally {
      setSaving(false);
    }
  };

  const ready = !loading && !loadError;
  const canSave = ready && !saving && availableRoles.length > 0;

  return (
    <>
      <FullScreenDialog
        open={open}
        title={user ? `Ubah pengguna ${user.name}` : 'Ubah pengguna'}
        onClose={close}
        card={false}
        actions={ready ? (
          <>
            <Button variant="text" type="button" onClick={close} disabled={saving}>Batal</Button>
            <Button type="submit" form={FORM_ID} loading={saving} disabled={!canSave}>Simpan perubahan</Button>
          </>
        ) : null}
      >
        {loading ? <LoadingState label="Memuat data pengguna…" /> : null}
        {loadError ? (
          <EmptyState
            tone="error"
            title="Data pengguna gagal dimuat"
            description={loadError}
            action={<Button variant="text" type="button" onClick={() => setAttempt((value) => value + 1)}>Coba lagi</Button>}
          />
        ) : null}

        {ready ? (
          <form id={FORM_ID} className="admin-dialog-form" onSubmit={requestSave} noValidate>
            {saveError ? <Banner tone="error">{saveError}</Banner> : null}
            <FullScreenSection title="Informasi pengguna">
              <div className="pw-fsdialog__fields">
                <Input
                  label="Nama lengkap"
                  autoComplete="name"
                  value={form.name}
                  error={errors.name}
                  onChange={(event) => setField('name', event.target.value)}
                  required
                />
                <Input
                  label="Email"
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  value={form.email}
                  error={errors.email}
                  onChange={(event) => setField('email', event.target.value)}
                  required
                />
                <Select
                  label="Status"
                  value={form.status}
                  disabled={isSelf}
                  error={errors.status}
                  hint={isSelf ? 'Akun Anda sendiri tidak dapat dinonaktifkan.' : undefined}
                  onChange={(event) => setField('status', event.target.value)}
                  options={STATUS_OPTIONS}
                />
              </div>
            </FullScreenSection>

            <FullScreenSection title="Organisasi dan peran">
              <div className="pw-fsdialog__fields">
                <Select
                  label="Entitas"
                  value={form.entityId}
                  error={errors.entityId}
                  onChange={(event) => updateScope(event.target.value, '')}
                  options={entities.map((entity) => ({ value: entity.id, label: entity.name }))}
                  dataOptions
                  required
                />
                <Select
                  label="Divisi"
                  value={form.departmentId}
                  error={errors.departmentId}
                  hint={departmentId ? 'Akses mengikuti divisi.' : 'Tanpa divisi: akses global.'}
                  onChange={(event) => updateScope(form.entityId, event.target.value)}
                  placeholder="Tanpa divisi (Super Admin / Administrator Sistem)"
                  options={availableDepartments.map((department) => ({ value: department.id, label: department.name }))}
                />
              </div>
              <Field
                label={`Role (${form.roleIds.length} dipilih)`}
                error={errors.roleIds}
                hint="Pilih satu atau beberapa peran yang sesuai dengan cakupan pengguna."
              >
                {mixWarning ? <Banner tone="warning">{mixWarning}</Banner> : null}
                {availableRoles.length ? (
                  <div className="admin-choice-list">
                    {availableRoles.map((role) => {
                      const info = roleInfo(role);
                      return (
                        <div key={role.id} className="admin-choice-row">
                          <Checkbox
                            checked={form.roleIds.includes(String(role.id))}
                            onChange={() => toggleRole(role.id)}
                            label={(
                              <span className="pw-cell">
                                <span className="pw-cell__title">{role.name}</span>
                                <span className="pw-cell__meta">{role.departmentName || 'Global'} · {roleLevelLabel(role.roleLevel)}</span>
                              </span>
                            )}
                          />
                          <InfoTip label={`Penjelasan peran ${role.name}`} title={info.title}>
                            {info.lines.map((line) => <p key={line}>{line}</p>)}
                          </InfoTip>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState compact icon="shield" title="Tidak ada peran aktif untuk cakupan ini." />
                )}
              </Field>
            </FullScreenSection>
          </form>
        ) : null}
      </FullScreenDialog>

      <ConfirmDialog
        open={confirmOpen}
        title="Simpan perubahan pengguna?"
        message={(
          <div className="admin-confirm-summary">
            <p>Perubahan pada <span data-no-translate="" className="pw-strong">{form.name || user?.name}</span> akan langsung berlaku.</p>
            <div>
              <span className="pw-strong">Peran setelah disimpan</span>
              <span>{selectedRoleNames.length ? <Mixed parts={selectedRoleNames} separator=", " /> : 'Tanpa peran'}</span>
            </div>
          </div>
        )}
        confirmLabel="Simpan perubahan"
        tone="primary"
        loading={saving}
        onClose={() => setConfirmOpen(false)}
        onConfirm={save}
      />
    </>
  );
}
