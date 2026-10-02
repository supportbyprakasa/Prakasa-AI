import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import ConfirmDialog from '../../components/ConfirmDialog';
import DataGrid from '../../components/datagrid/DataGrid';
import { apiErrorMessage, fieldErrorsFromApi } from '../../components/datagrid/gridModel';
import EmptyState from '../../components/EmptyState';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';
import { formatMoney, formatNumber } from '../../components/format';
import ApprovalMatrixEditor, { MATRIX_EDITOR_FORM_ID } from './ApprovalMatrixEditor';
import {
  FLOW_LABELS, FLOW_OPTIONS, RuleFields, humanizeCode, isKnownRequestType, requestTypeLabel, validateRule,
} from './approvalMatrixParts';
import { DEFAULT_CURRENCY, isDefaultCurrency, normalizeCurrency } from './approvalMatrixModel';
import './admin-editors.css';
import { Translate } from '../../i18n/NoTranslate';

const CONFIG_FORM_ID = 'approval-matrix-config-form';
const RULE_FORM_ID = 'approval-matrix-rule-form';

function toNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  return Number(value);
}

function resolveName(items, id) {
  return items.find((item) => Number(item.id) === Number(id))?.name || null;
}

function amountRange(group) {
  const currency = normalizeCurrency(group.currency);
  const format = (value) => (isDefaultCurrency(currency) ? formatMoney(value) : `${currency} ${formatNumber(value)}`);
  const min = group.amountMin != null ? format(group.amountMin) : null;
  const max = group.amountMax != null ? format(group.amountMax) : null;
  if (min && max) return `${min} – ${max}`;
  if (min) return `mulai ${min}`;
  if (max) return `sampai ${max}`;
  return 'semua nominal';
}

// A person's name is record data; a role name or the "#id" fallback is a label.
function personOrRole(userName, roleName, userId, roleId) {
  if (userName) return userName;
  const label = roleName || (userId ? `Pengguna #${userId}` : roleId ? `Role #${roleId}` : '');
  return label ? <Translate>{label}</Translate> : '';
}

function docCode(docTypes, id) {
  const code = docTypes.find((item) => String(item.id) === String(id))?.code;
  return code ? `Kode ${code}` : undefined;
}

const hours = (value) => (value == null || value === '' ? '—' : `${formatNumber(value)} jam`);

const RULE_COLUMNS = [
  {
    key: 'orderIndex',
    header: 'Urutan',
    translate: true,
    render: (rule) => (
      <span className="pw-cell">
        <span className="pw-cell__title">{rule.orderIndex}</span>
        <span className="pw-cell__meta">Level {rule.level}</span>
      </span>
    ),
  },
  { key: 'parallelGroup', header: 'Grup paralel', render: (rule) => (rule.parallelGroup ? humanizeCode(rule.parallelGroup) : ''), sortValue: (rule) => rule.parallelGroup || '', exportValue: (rule) => rule.parallelGroup || '' },
  {
    key: 'approver',
    header: 'Approver',
    render: (rule) => personOrRole(rule.approverUserName, rule.approverRoleName, rule.approverUserId, rule.approverRoleId),
  },
  {
    key: 'signer',
    header: 'Penanda tangan',
    render: (rule) => personOrRole(rule.signerUserName, rule.signerRoleName, rule.signerUserId, rule.signerRoleId),
  },
  {
    key: 'reminder',
    header: 'Pengingat / eskalasi',
    render: (rule) => (
      <span className="pw-cell">
        <span data-translate="" className="pw-cell__title">{hours(rule.reminderAfterHours)} / {hours(rule.escalateAfterHours)}</span>
        {rule.escalationUserName || rule.escalationRoleName ? (
          <span className="pw-cell__meta"><Translate>ke</Translate> {rule.escalationUserName || <Translate>{rule.escalationRoleName}</Translate>}</span>
        ) : null}
      </span>
    ),
  },
  { key: 'isOptional', header: 'Tipe', translate: true, render: (rule) => (rule.isOptional ? 'Opsional' : 'Wajib') },
];

export default function ApprovalMatrix() {
  const [rules, setRules] = useState([]);
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editMatrix, setEditMatrix] = useState(null);
  const [editRule, setEditRule] = useState(null);
  const [formSaving, setFormSaving] = useState(false);
  const [deleteRuleTarget, setDeleteRuleTarget] = useState(null);
  const [deleteMatrixTarget, setDeleteMatrixTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [matrixRes, usersRes, rolesRes, docTypesRes, departmentsRes] =
        await Promise.all([
          api.get('/approval-matrix'),
          api.get('/users', { params: { limit: 100 } }).catch(() => ({ data: { data: [] } })),
          api.get('/roles').catch(() => ({ data: { data: [] } })),
          api.get('/document-types').catch(() => ({ data: { data: [] } })),
          api.get('/departments').catch(() => ({ data: { data: [] } })),
        ]);

      setRules(matrixRes.data.data || []);
      setUsers(usersRes.data.data || []);
      setRoles(rolesRes.data.data || []);
      setDocTypes(docTypesRes.data.data || []);
      setDepartments(departmentsRes.data.data || []);
    } catch (error) {
      setLoadError(apiErrorMessage(error, 'Approval matrix tidak dapat dimuat.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const grouped = new Map();

    for (const rule of rules) {
      if (!grouped.has(rule.matrixKey)) {
        grouped.set(rule.matrixKey, {
          matrixKey: rule.matrixKey,
          matrixName: rule.matrixName,
          departmentId: rule.departmentId,
          documentType: rule.documentType,
          documentTypeId: rule.documentTypeId,
          requestType: rule.requestType,
          amountMin: rule.amountMin,
          amountMax: rule.amountMax,
          currency: rule.currency,
          flowType: rule.flowType,
          priority: rule.priority,
          isActive: rule.isActive,
          rules: [],
        });
      }
      grouped.get(rule.matrixKey).rules.push(rule);
    }

    for (const group of grouped.values()) {
      group.rules.sort(
        (a, b) =>
          Number(a.orderIndex || 0) - Number(b.orderIndex || 0) ||
          Number(a.id) - Number(b.id)
      );
    }

    return [...grouped.values()].sort((a, b) =>
      String(a.matrixKey).localeCompare(String(b.matrixKey))
    );
  }, [rules]);

  const removeRule = async () => {
    if (!deleteRuleTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/approval-matrix/rules/${deleteRuleTarget.id}`);
      toast('Approval rule dihapus', 'success');
      setDeleteRuleTarget(null);
      await load();
    } catch (error) {
      toast(apiErrorMessage(error, 'Rule gagal dihapus.'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const removeMatrix = async () => {
    if (!deleteMatrixTarget) return;
    setDeleting(true);
    try {
      await api.delete(
        `/approval-matrix/matrix/${encodeURIComponent(deleteMatrixTarget.matrixKey)}`
      );
      toast('Approval matrix dihapus', 'success');
      setDeleteMatrixTarget(null);
      await load();
    } catch (error) {
      toast(apiErrorMessage(error, 'Matrix gagal dihapus.'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const closeDialog = (setter) => () => { if (!formSaving) setter(null); };
  const closeCreate = () => { if (!formSaving) setCreateOpen(false); };
  const dialogActions = (formId, label, onCancel) => (
    <>
      <Button variant="text" type="button" onClick={onCancel} disabled={formSaving}>Batal</Button>
      <Button type="submit" form={formId} loading={formSaving}>{label}</Button>
    </>
  );

  let content;
  if (loading) content = <SkeletonCard lines={7} />;
  else if (loadError) {
    content = (
      <EmptyState
        tone="error"
        title="Approval matrix gagal dimuat"
        description={loadError}
        action={<Button variant="text" type="button" onClick={load}>Coba lagi</Button>}
      />
    );
  } else if (!groups.length) {
    content = (
      <EmptyState
        icon="grid_view"
        title="Belum ada approval matrix"
        description="Buat matrix pertama dengan tombol Tambah matrix untuk mengatur alur approval."
      />
    );
  } else {
    content = groups.map((group) => {
      const departmentName = group.departmentId ? (resolveName(departments, group.departmentId) || `#${group.departmentId}`) : null;
      const documentName = group.documentTypeId ? (resolveName(docTypes, group.documentTypeId) || `#${group.documentTypeId}`) : null;
      return (
        <DataGrid
          key={group.matrixKey}
          title={group.matrixName || humanizeCode(group.matrixKey)}
          dataTitle={!group.matrixName}
          filters={(
            <span className="admin-matrix-meta">
              <StatusBadge status={group.isActive ? 'active' : 'inactive'} />
              <span>{FLOW_LABELS[group.flowType] || FLOW_LABELS.sequential}</span>
              {departmentName ? <span>Divisi {departmentName}</span> : null}
              {group.requestType ? <span>Permintaan <span data-no-translate={isKnownRequestType(group.requestType) ? undefined : ''}>{requestTypeLabel(group.requestType)}</span></span> : null}
              {documentName ? <span>Dokumen {documentName}</span> : null}
              <span>Nominal {amountRange(group)}</span>
              <span>Prioritas {group.priority ?? 100}</span>
            </span>
          )}
          toolbarActions={(
            <>
              <Button variant="secondary" icon="tune" onClick={() => setEditMatrix(group)}>Ubah konfigurasi</Button>
              <IconButton icon="delete" label="Hapus matrix" tone="danger" onClick={() => setDeleteMatrixTarget(group)} />
            </>
          )}
          columns={RULE_COLUMNS}
          rows={group.rules}
          searchable={false}
          exportable={false}
          empty="Belum ada rule pada matrix ini"
          onRowClick={(rule) => setEditRule(rule)}
          rowActions={(rule) => (
            <>
              <IconButton size="sm" icon="edit" label="Ubah rule" onClick={() => setEditRule(rule)} />
              <IconButton size="sm" icon="delete" label="Hapus rule" tone="danger" onClick={() => setDeleteRuleTarget(rule)} />
            </>
          )}
        />
      );
    });
  }

  return (
    <Page>
      <PageHeader
        title="Matriks approval"
        description="Alur approval per entitas, divisi, jenis permintaan, tipe dokumen, dan nominal: berurutan atau paralel, dengan delegasi, pengingat, dan eskalasi."
        actions={<Button icon="add" onClick={() => setCreateOpen(true)}>Tambah matrix</Button>}
      />

      {content}

      <FullScreenDialog
        open={createOpen}
        onClose={closeCreate}
        title="Tambah approval matrix"
        card={false}
        actions={dialogActions(MATRIX_EDITOR_FORM_ID, 'Buat matrix', closeCreate)}
      >
        {createOpen ? (
          <ApprovalMatrixEditor
            users={users}
            roles={roles}
            docTypes={docTypes}
            departments={departments}
            onSavingChange={setFormSaving}
            onSaved={async () => {
              setCreateOpen(false);
              await load();
            }}
          />
        ) : null}
      </FullScreenDialog>

      <FullScreenDialog
        open={Boolean(editMatrix)}
        onClose={closeDialog(setEditMatrix)}
        title="Ubah konfigurasi matrix"
        card={false}
        actions={dialogActions(CONFIG_FORM_ID, 'Simpan konfigurasi', closeDialog(setEditMatrix))}
      >
        {editMatrix ? (
          <MatrixConfigForm
            key={editMatrix.matrixKey}
            group={editMatrix}
            docTypes={docTypes}
            departments={departments}
            onSavingChange={setFormSaving}
            onSaved={async () => {
              setEditMatrix(null);
              await load();
            }}
          />
        ) : null}
      </FullScreenDialog>

      <FullScreenDialog
        open={Boolean(editRule)}
        onClose={closeDialog(setEditRule)}
        title="Ubah approval rule"
        card={false}
        actions={dialogActions(RULE_FORM_ID, 'Simpan rule', closeDialog(setEditRule))}
      >
        {editRule ? (
          <RuleForm
            key={editRule.id}
            rule={editRule}
            users={users}
            roles={roles}
            onSavingChange={setFormSaving}
            onSaved={async () => {
              setEditRule(null);
              await load();
            }}
          />
        ) : null}
      </FullScreenDialog>

      <ConfirmDialog
        open={Boolean(deleteRuleTarget)}
        title="Hapus approval rule?"
        message={`Rule urutan ${deleteRuleTarget?.orderIndex ?? ''} (${deleteRuleTarget?.approverUserName || deleteRuleTarget?.approverRoleName || 'approver'}) akan dihapus. Approval yang sudah berjalan tetap menyimpan langkah yang sudah ditetapkan.`}
        confirmLabel="Hapus rule"
        loading={deleting}
        onConfirm={removeRule}
        onClose={() => { if (!deleting) setDeleteRuleTarget(null); }}
      />

      <ConfirmDialog
        open={Boolean(deleteMatrixTarget)}
        title="Hapus seluruh matrix?"
        message={`Semua rule pada matrix “${deleteMatrixTarget?.matrixName || deleteMatrixTarget?.matrixKey || ''}” akan dihapus.`}
        confirmLabel="Hapus matrix"
        loading={deleting}
        onConfirm={removeMatrix}
        onClose={() => { if (!deleting) setDeleteMatrixTarget(null); }}
      />
    </Page>
  );
}

function MatrixConfigForm({
  group,
  docTypes,
  departments,
  onSavingChange,
  onSaved,
}) {
  const [form, setForm] = useState({
    matrixName: group.matrixName || '',
    departmentId: group.departmentId || '',
    documentTypeId: group.documentTypeId || '',
    requestType: group.requestType || '',
    amountMin: group.amountMin ?? '',
    amountMax: group.amountMax ?? '',
    currency: group.currency || DEFAULT_CURRENCY,
    flowType: group.flowType || 'sequential',
    priority: group.priority ?? 100,
    isActive: Boolean(group.isActive),
  });
  const [errors, setErrors] = useState({});

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const save = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.matrixName.trim()) nextErrors.matrixName = 'Isi nama matrix.';
    if (form.amountMin !== '' && form.amountMax !== '' && Number(form.amountMin) > Number(form.amountMax)) {
      nextErrors.amountMax = 'Nominal maksimum harus sama atau lebih besar dari minimum.';
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    const selectedDocType = docTypes.find(
      (item) => String(item.id) === String(form.documentTypeId)
    );

    const payload = {
      matrixName: form.matrixName.trim(),
      departmentId: toNumberOrNull(form.departmentId),
      documentType: selectedDocType?.code || null,
      documentTypeId: toNumberOrNull(form.documentTypeId),
      requestType: form.requestType.trim() || null,
      amountMin: toNumberOrNull(form.amountMin),
      amountMax: toNumberOrNull(form.amountMax),
      currency: normalizeCurrency(form.currency),
      flowType: form.flowType,
      priority: Number(form.priority || 100),
      isActive: Boolean(form.isActive),
    };

    onSavingChange(true);
    try {
      await api.patch(
        `/approval-matrix/matrix/${encodeURIComponent(group.matrixKey)}`,
        payload
      );
      toast('Konfigurasi matrix diperbarui', 'success');
      onSavingChange(false);
      onSaved();
    } catch (error) {
      onSavingChange(false);
      const fieldErrors = fieldErrorsFromApi(error);
      if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
      else toast(apiErrorMessage(error, 'Matrix gagal diperbarui.'), 'error');
    }
  };

  return (
    <form id={CONFIG_FORM_ID} className="admin-dialog-form" onSubmit={save} noValidate>
      <FullScreenSection title={`Konfigurasi ${group.matrixName || humanizeCode(group.matrixKey)}`}>
        <div className="pw-fsdialog__fields">
          <Input
            label="Nama matrix"
            required
            value={form.matrixName}
            error={errors.matrixName}
            onChange={(event) => set('matrixName', event.target.value)}
            autoFocus
          />
          <Select
            label="Jenis alur"
            value={form.flowType}
            error={errors.flowType}
            onChange={(event) => set('flowType', event.target.value)}
            options={FLOW_OPTIONS}
          />
          <Select
            label="Divisi"
            value={form.departmentId}
            onChange={(event) => set('departmentId', event.target.value)}
            placeholder="Semua divisi"
            options={departments.map((item) => ({ value: item.id, label: item.name }))}
          />
          <Select
            label="Tipe dokumen"
            value={form.documentTypeId}
            onChange={(event) => set('documentTypeId', event.target.value)}
            placeholder="Semua tipe dokumen"
            options={docTypes.map((item) => ({ value: item.id, label: item.name }))}
            hint={docCode(docTypes, form.documentTypeId)}
          />
          <Input
            label="Jenis permintaan"
            mono
            value={form.requestType}
            hint="Contoh payment_request."
            onChange={(event) => set('requestType', event.target.value)}
          />
          <Input
            label="Nominal minimum"
            type="number"
            min="0"
            inputMode="numeric"
            value={form.amountMin}
            error={errors.amountMin}
            onChange={(event) => set('amountMin', event.target.value)}
          />
          <Input
            label="Nominal maksimum"
            type="number"
            min="0"
            inputMode="numeric"
            value={form.amountMax}
            error={errors.amountMax}
            onChange={(event) => set('amountMax', event.target.value)}
          />
          <Input
            label="Mata uang"
            value={form.currency}
            onChange={(event) => set('currency', event.target.value)}
          />
          <Input
            label="Prioritas"
            type="number"
            min="0"
            inputMode="numeric"
            hint="Angka kecil didahulukan."
            value={form.priority}
            onChange={(event) => set('priority', event.target.value)}
          />
        </div>
        <Checkbox label="Matrix aktif" checked={form.isActive} onChange={(event) => set('isActive', event.target.checked)} />
        <Banner tone="info">
          Server memeriksa perubahan jenis alur: matrix tidak bisa menjadi berurutan bila masih ada urutan
          ganda, dan alur paralel butuh grup paralel yang konsisten.
        </Banner>
      </FullScreenSection>
    </form>
  );
}

function RuleForm({ rule, users, roles, onSavingChange, onSaved }) {
  const [form, setForm] = useState({
    level: rule.level ?? 1,
    orderIndex: rule.orderIndex ?? 1,
    parallelGroup: rule.parallelGroup || '',
    approverUserId: rule.approverUserId || '',
    approverRoleId: rule.approverRoleId || '',
    signerUserId: rule.signerUserId || '',
    signerRoleId: rule.signerRoleId || '',
    isOptional: Boolean(rule.isOptional),
    escalationUserId: rule.escalationUserId || '',
    escalationRoleId: rule.escalationRoleId || '',
    reminderAfterHours: rule.reminderAfterHours ?? '',
    escalateAfterHours: rule.escalateAfterHours ?? '',
  });
  const [errors, setErrors] = useState({});

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors({});
  };

  const save = async (event) => {
    event.preventDefault();
    const nextErrors = validateRule(form);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    const payload = {
      level: Number(form.level),
      orderIndex: Number(form.orderIndex),
      approverUserId: toNumberOrNull(form.approverUserId),
      approverRoleId: toNumberOrNull(form.approverRoleId),
      signerUserId: toNumberOrNull(form.signerUserId),
      signerRoleId: toNumberOrNull(form.signerRoleId),
      parallelGroup: form.parallelGroup.trim() || null,
      isOptional: Boolean(form.isOptional),
      escalationUserId: toNumberOrNull(form.escalationUserId),
      escalationRoleId: toNumberOrNull(form.escalationRoleId),
      reminderAfterHours: toNumberOrNull(form.reminderAfterHours),
      escalateAfterHours: toNumberOrNull(form.escalateAfterHours),
    };

    onSavingChange(true);
    try {
      await api.patch(`/approval-matrix/rules/${rule.id}`, payload);
      toast('Approval rule diperbarui', 'success');
      onSavingChange(false);
      onSaved();
    } catch (error) {
      onSavingChange(false);
      const fieldErrors = fieldErrorsFromApi(error);
      if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
      else toast(apiErrorMessage(error, 'Rule gagal diperbarui.'), 'error');
    }
  };

  return (
    <form id={RULE_FORM_ID} className="admin-dialog-form" onSubmit={save} noValidate>
      <FullScreenSection title={`Rule urutan ${rule.orderIndex ?? ''}`}>
        <RuleFields rule={form} errors={errors} users={users} roles={roles} onChange={set} />
      </FullScreenSection>
    </form>
  );
}
