import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ConfirmDialog from '../../components/ConfirmDialog';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';
import { RoleSelect, UserSelect } from '../../components/UserRoleSelects';
import ApprovalMatrixEditor from './ApprovalMatrixEditor';

function toNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  return Number(value);
}

function resolveName(items, id) {
  return items.find((item) => Number(item.id) === Number(id))?.name || null;
}

export default function ApprovalMatrix() {
  const [rules, setRules] = useState([]);
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editMatrix, setEditMatrix] = useState(null);
  const [editRule, setEditRule] = useState(null);
  const [deleteRuleTarget, setDeleteRuleTarget] = useState(null);
  const [deleteMatrixTarget, setDeleteMatrixTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
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
      toast(error.response?.data?.error?.message || 'Gagal memuat approval matrix', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

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
      toast(error.response?.data?.error?.message || 'Gagal menghapus rule', 'error');
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
      toast(error.response?.data?.error?.message || 'Gagal menghapus matrix', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Approval Matrix</h2>
          <div
            style={{
              fontSize: 13,
              color: 'var(--color-text-muted)',
              marginTop: 4,
            }}
          >
            Konfigurasi approval berdasarkan entity, department, request type,
            document type, amount, sequential/parallel stage, delegation,
            reminder, dan escalation.
          </div>
        </div>

        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={14} />
          Matrix Baru
        </Button>
      </div>

      {loading && <SkeletonCard lines={7} />}

      {!loading && !groups.length && (
        <Card>
          <div
            style={{
              padding: 28,
              textAlign: 'center',
              color: 'var(--color-text-muted)',
            }}
          >
            Belum ada approval matrix.
          </div>
        </Card>
      )}

      {!loading &&
        groups.map((group) => (
          <div key={group.matrixKey} style={{ marginBottom: 14 }}>
            <Card
              title={
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <Layers size={16} />
                  {group.matrixName || group.matrixKey}
                  <code
                    style={{
                      fontSize: 11,
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {group.matrixKey}
                  </code>
                </span>
              }
              actions={
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button variant="secondary" onClick={() => setEditMatrix(group)}>
                    <Pencil size={14} />
                    Config
                  </Button>
                  <Button variant="danger" onClick={() => setDeleteMatrixTarget(group)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              }
            >
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  marginBottom: 12,
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                }}
              >
                <Badge tone={group.flowType === 'parallel' ? 'warning' : 'info'}>
                  {group.flowType || 'sequential'}
                </Badge>
                <Badge tone={group.isActive ? 'success' : 'default'}>
                  {group.isActive ? 'Aktif' : 'Nonaktif'}
                </Badge>

                {group.departmentId && (
                  <span>
                    Department:{' '}
                    <b>{resolveName(departments, group.departmentId) || `#${group.departmentId}`}</b>
                  </span>
                )}
                {group.requestType && (
                  <span>
                    Request: <b>{group.requestType}</b>
                  </span>
                )}
                {group.documentTypeId && (
                  <span>
                    Document:{' '}
                    <b>{resolveName(docTypes, group.documentTypeId) || `#${group.documentTypeId}`}</b>
                  </span>
                )}
                <span>
                  Amount:{' '}
                  <b>
                    {group.currency || 'IDR'}{' '}
                    {group.amountMin != null
                      ? Number(group.amountMin).toLocaleString('id-ID')
                      : '−∞'}
                    {' – '}
                    {group.amountMax != null
                      ? Number(group.amountMax).toLocaleString('id-ID')
                      : '+∞'}
                  </b>
                </span>
                <span>
                  Priority: <b>{group.priority ?? 100}</b>
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        textAlign: 'left',
                        background: '#f8fafc',
                      }}
                    >
                      <th style={{ padding: 8 }}>Order</th>
                      <th style={{ padding: 8 }}>Group</th>
                      <th style={{ padding: 8 }}>Approver</th>
                      <th style={{ padding: 8 }}>Signer</th>
                      <th style={{ padding: 8 }}>Reminder / Escalation</th>
                      <th style={{ padding: 8 }}>Type</th>
                      <th style={{ padding: 8, width: 96 }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rules.map((rule) => (
                      <tr
                        key={rule.id}
                        style={{ borderTop: '1px solid var(--color-border)' }}
                      >
                        <td style={{ padding: 8 }}>
                          <b>#{rule.orderIndex}</b>
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--color-text-muted)',
                            }}
                          >
                            level {rule.level}
                          </div>
                        </td>
                        <td style={{ padding: 8 }}>{rule.parallelGroup || '—'}</td>
                        <td style={{ padding: 8 }}>
                          {rule.approverUserName ||
                            rule.approverRoleName ||
                            (rule.approverUserId
                              ? `User #${rule.approverUserId}`
                              : rule.approverRoleId
                                ? `Role #${rule.approverRoleId}`
                                : '—')}
                        </td>
                        <td style={{ padding: 8 }}>
                          {rule.signerUserName ||
                            rule.signerRoleName ||
                            (rule.signerUserId
                              ? `User #${rule.signerUserId}`
                              : rule.signerRoleId
                                ? `Role #${rule.signerRoleId}`
                                : '—')}
                        </td>
                        <td style={{ padding: 8 }}>
                          <div>
                            Reminder:{' '}
                            <b>
                              {rule.reminderAfterHours == null
                                ? '—'
                                : `${rule.reminderAfterHours}h`}
                            </b>
                          </div>
                          <div>
                            Escalate:{' '}
                            <b>
                              {rule.escalateAfterHours == null
                                ? '—'
                                : `${rule.escalateAfterHours}h`}
                            </b>
                          </div>
                          {(rule.escalationUserName || rule.escalationRoleName) && (
                            <div
                              style={{
                                fontSize: 11,
                                color: 'var(--color-text-muted)',
                              }}
                            >
                              ke {rule.escalationUserName || rule.escalationRoleName}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: 8 }}>
                          {rule.isOptional ? (
                            <Badge tone="info">Optional</Badge>
                          ) : (
                            <Badge tone="default">Required</Badge>
                          )}
                        </td>
                        <td style={{ padding: 8 }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <Button
                              variant="secondary"
                              title="Edit rule"
                              onClick={() => setEditRule(rule)}
                            >
                              <Pencil size={14} />
                            </Button>
                            <Button
                              variant="danger"
                              title="Hapus rule"
                              onClick={() => setDeleteRuleTarget(rule)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        ))}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Approval Matrix Baru"
        maxWidth={980}
      >
        <ApprovalMatrixEditor
          users={users}
          roles={roles}
          docTypes={docTypes}
          departments={departments}
          onCancel={() => setCreateOpen(false)}
          onSaved={async () => {
            setCreateOpen(false);
            await load();
          }}
        />
      </Modal>

      <Modal
        open={Boolean(editMatrix)}
        onClose={() => setEditMatrix(null)}
        title="Edit Matrix Configuration"
        maxWidth={760}
      >
        {editMatrix && (
          <MatrixConfigForm
            group={editMatrix}
            docTypes={docTypes}
            departments={departments}
            onCancel={() => setEditMatrix(null)}
            onSaved={async () => {
              setEditMatrix(null);
              await load();
            }}
          />
        )}
      </Modal>

      <Modal
        open={Boolean(editRule)}
        onClose={() => setEditRule(null)}
        title="Edit Approval Rule"
        maxWidth={820}
      >
        {editRule && (
          <RuleForm
            rule={editRule}
            users={users}
            roles={roles}
            onCancel={() => setEditRule(null)}
            onSaved={async () => {
              setEditRule(null);
              await load();
            }}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteRuleTarget)}
        title="Hapus approval rule?"
        message="Rule akan di-soft-delete. Approval request yang sudah berjalan tetap menyimpan step hasil resolusi sebelumnya."
        confirmLabel="Ya, hapus"
        loading={deleting}
        onConfirm={removeRule}
        onClose={() => setDeleteRuleTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteMatrixTarget)}
        title="Hapus seluruh matrix?"
        message={`Seluruh rule pada matrix “${deleteMatrixTarget?.matrixKey || ''}” akan di-soft-delete.`}
        confirmLabel="Ya, hapus matrix"
        loading={deleting}
        onConfirm={removeMatrix}
        onClose={() => setDeleteMatrixTarget(null)}
      />
    </div>
  );
}

function MatrixConfigForm({
  group,
  docTypes,
  departments,
  onCancel,
  onSaved,
}) {
  const [form, setForm] = useState({
    matrixName: group.matrixName || '',
    departmentId: group.departmentId || '',
    documentTypeId: group.documentTypeId || '',
    requestType: group.requestType || '',
    amountMin: group.amountMin ?? '',
    amountMax: group.amountMax ?? '',
    currency: group.currency || 'IDR',
    flowType: group.flowType || 'sequential',
    priority: group.priority ?? 100,
    isActive: Boolean(group.isActive),
  });
  const [saving, setSaving] = useState(false);

  const set = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!form.matrixName.trim()) {
      toast('Matrix name wajib', 'error');
      return;
    }
    if (
      form.amountMin !== '' &&
      form.amountMax !== '' &&
      Number(form.amountMin) > Number(form.amountMax)
    ) {
      toast('Amount min tidak boleh lebih besar dari amount max', 'error');
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
      currency: form.currency.trim().toUpperCase() || 'IDR',
      flowType: form.flowType,
      priority: Number(form.priority || 100),
      isActive: Boolean(form.isActive),
    };

    setSaving(true);
    try {
      await api.patch(
        `/approval-matrix/matrix/${encodeURIComponent(group.matrixKey)}`,
        payload
      );
      toast('Matrix configuration diperbarui', 'success');
      onSaved();
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal memperbarui matrix', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <Input
          label="Matrix Name"
          value={form.matrixName}
          onChange={(event) => set('matrixName', event.target.value)}
        />

        <Select
          label="Flow Type"
          value={form.flowType}
          onChange={(value) => set('flowType', value)}
          options={[
            { value: 'sequential', label: 'Sequential' },
            { value: 'parallel', label: 'Parallel' },
          ]}
        />

        <Select
          label="Department"
          value={form.departmentId}
          onChange={(value) => set('departmentId', value)}
          allowEmpty
          options={departments.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
        />

        <Select
          label="Document Type"
          value={form.documentTypeId}
          onChange={(value) => set('documentTypeId', value)}
          allowEmpty
          options={docTypes.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
        />

        <Input
          label="Request Type"
          value={form.requestType}
          onChange={(event) => set('requestType', event.target.value)}
        />
        <Input
          label="Amount Min"
          type="number"
          min="0"
          value={form.amountMin}
          onChange={(event) => set('amountMin', event.target.value)}
        />
        <Input
          label="Amount Max"
          type="number"
          min="0"
          value={form.amountMax}
          onChange={(event) => set('amountMax', event.target.value)}
        />
        <Input
          label="Currency"
          value={form.currency}
          onChange={(event) => set('currency', event.target.value)}
        />
        <Input
          label="Priority"
          type="number"
          min="0"
          value={form.priority}
          onChange={(event) => set('priority', event.target.value)}
        />
      </div>

      <label
        style={{
          display: 'flex',
          gap: 7,
          alignItems: 'center',
          fontSize: 13,
          marginTop: 2,
        }}
      >
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(event) => set('isActive', event.target.checked)}
        />
        Matrix aktif
      </label>

      <div
        style={{
          marginTop: 12,
          padding: 10,
          borderRadius: 8,
          background: '#f8fafc',
          fontSize: 12,
          color: 'var(--color-text-muted)',
        }}
      >
        Perubahan flow type divalidasi backend. Matrix tidak dapat diubah ke
        sequential jika masih memiliki order stage duplikat, dan parallel
        membutuhkan parallel group yang konsisten.
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          marginTop: 16,
        }}
      >
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Batal
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Menyimpan…' : 'Simpan Config'}
        </Button>
      </div>
    </div>
  );
}

function RuleForm({ rule, users, roles, onCancel, onSaved }) {
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
  const [saving, setSaving] = useState(false);

  const set = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!form.approverUserId && !form.approverRoleId) {
      toast('Approver user atau role wajib', 'error');
      return;
    }
    if (form.approverUserId && form.approverRoleId) {
      toast('Pilih approver user atau role, bukan keduanya', 'error');
      return;
    }
    if (form.signerUserId && form.signerRoleId) {
      toast('Pilih signer user atau role, bukan keduanya', 'error');
      return;
    }
    if (
      form.reminderAfterHours !== '' &&
      form.escalateAfterHours !== '' &&
      Number(form.escalateAfterHours) < Number(form.reminderAfterHours)
    ) {
      toast('Waktu eskalasi harus >= waktu reminder', 'error');
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

    setSaving(true);
    try {
      await api.patch(`/approval-matrix/rules/${rule.id}`, payload);
      toast('Approval rule diperbarui', 'success');
      onSaved();
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal memperbarui rule', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        <Input
          label="Level"
          type="number"
          min="1"
          value={form.level}
          onChange={(event) => set('level', event.target.value)}
        />
        <Input
          label="Order Index"
          type="number"
          min="1"
          value={form.orderIndex}
          onChange={(event) => set('orderIndex', event.target.value)}
        />
        <Input
          label="Parallel Group"
          value={form.parallelGroup}
          onChange={(event) => set('parallelGroup', event.target.value)}
        />

        <UserSelect
          label="Approver User"
          value={form.approverUserId}
          onChange={(value) => set('approverUserId', value)}
          users={users}
        />
        <RoleSelect
          label="Approver Role"
          value={form.approverRoleId}
          onChange={(value) => set('approverRoleId', value)}
          roles={roles}
        />
        <UserSelect
          label="Signer User"
          value={form.signerUserId}
          onChange={(value) => set('signerUserId', value)}
          users={users}
        />
        <RoleSelect
          label="Signer Role"
          value={form.signerRoleId}
          onChange={(value) => set('signerRoleId', value)}
          roles={roles}
        />
        <UserSelect
          label="Escalation User"
          value={form.escalationUserId}
          onChange={(value) => set('escalationUserId', value)}
          users={users}
        />
        <RoleSelect
          label="Escalation Role"
          value={form.escalationRoleId}
          onChange={(value) => set('escalationRoleId', value)}
          roles={roles}
        />

        <Input
          label="Reminder after (jam)"
          type="number"
          min="0"
          value={form.reminderAfterHours}
          onChange={(event) => set('reminderAfterHours', event.target.value)}
        />
        <Input
          label="Escalate after (jam)"
          type="number"
          min="0"
          value={form.escalateAfterHours}
          onChange={(event) => set('escalateAfterHours', event.target.value)}
        />
      </div>

      <label
        style={{
          display: 'flex',
          gap: 7,
          alignItems: 'center',
          fontSize: 13,
          marginTop: 4,
        }}
      >
        <input
          type="checkbox"
          checked={form.isOptional}
          onChange={(event) => set('isOptional', event.target.checked)}
        />
        Optional step
      </label>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          marginTop: 16,
        }}
      >
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Batal
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Menyimpan…' : 'Simpan Rule'}
        </Button>
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options, allowEmpty = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
      <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        {label}
      </label>
      <select
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        style={{
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
        }}
      >
        {allowEmpty && <option value="">Semua / tidak dibatasi</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
