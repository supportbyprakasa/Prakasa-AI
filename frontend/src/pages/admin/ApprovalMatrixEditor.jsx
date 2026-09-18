import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import Input from '../../components/Input';
import { RoleSelect, UserSelect } from '../../components/UserRoleSelects';
import { toast } from '../../components/Toast';

function blankRule(orderIndex = 1) {
  return {
    level: orderIndex,
    orderIndex,
    parallelGroup: '',
    approverUserId: '',
    approverRoleId: '',
    signerUserId: '',
    signerRoleId: '',
    isOptional: false,
    escalationUserId: '',
    escalationRoleId: '',
    reminderAfterHours: '',
    escalateAfterHours: '',
  };
}

function numberOrNull(value) {
  return value === '' || value === null || value === undefined
    ? null
    : Number(value);
}

function validateRules(flowType, rules) {
  const seenSequential = new Set();
  const groupOrder = new Map();
  const orderGroup = new Map();

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    const label = `Rule #${index + 1}`;
    const order = Number(rule.orderIndex || index + 1);

    if (!rule.approverUserId && !rule.approverRoleId) {
      return `${label}: approver user atau role wajib dipilih`;
    }
    if (rule.approverUserId && rule.approverRoleId) {
      return `${label}: pilih approver user atau role, bukan keduanya`;
    }
    if (rule.signerUserId && rule.signerRoleId) {
      return `${label}: pilih signer user atau role, bukan keduanya`;
    }
    if (
      rule.reminderAfterHours !== '' &&
      rule.escalateAfterHours !== '' &&
      Number(rule.escalateAfterHours) < Number(rule.reminderAfterHours)
    ) {
      return `${label}: waktu eskalasi harus >= waktu reminder`;
    }

    if (flowType === 'sequential') {
      if (seenSequential.has(order)) {
        return `${label}: orderIndex ${order} duplikat pada sequential flow`;
      }
      seenSequential.add(order);
    } else {
      const group = String(rule.parallelGroup || '').trim();
      if (!group) return `${label}: parallel group wajib diisi`;

      if (groupOrder.has(group) && groupOrder.get(group) !== order) {
        return `${label}: semua rule pada group ${group} harus memakai order yang sama`;
      }
      groupOrder.set(group, order);

      if (orderGroup.has(order) && orderGroup.get(order) !== group) {
        return `${label}: satu order hanya boleh memiliki satu parallel group`;
      }
      orderGroup.set(order, group);
    }
  }

  return null;
}

export default function ApprovalMatrixEditor({
  users,
  roles,
  docTypes,
  departments,
  onCancel,
  onSaved,
}) {
  const [meta, setMeta] = useState({
    matrixKey: '',
    matrixName: '',
    departmentId: '',
    documentTypeId: '',
    requestType: '',
    amountMin: '',
    amountMax: '',
    currency: 'IDR',
    flowType: 'sequential',
    priority: 100,
    isActive: true,
  });
  const [rules, setRules] = useState([blankRule(1)]);
  const [saving, setSaving] = useState(false);

  const setMetaValue = (key, value) =>
    setMeta((current) => ({ ...current, [key]: value }));

  const setRule = (index, key, value) =>
    setRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, [key]: value } : rule
      )
    );

  const addRule = () => {
    const maxOrder = rules.reduce(
      (max, rule) => Math.max(max, Number(rule.orderIndex || 0)),
      0
    );
    setRules((current) => [...current, blankRule(maxOrder + 1)]);
  };

  const submit = async () => {
    if (!meta.matrixKey || !/^[a-z0-9:_-]+$/.test(meta.matrixKey)) {
      toast('Matrix key wajib dan hanya boleh a-z, 0-9, :, _, -', 'error');
      return;
    }
    if (!meta.matrixName.trim()) {
      toast('Matrix name wajib', 'error');
      return;
    }
    if (!rules.length) {
      toast('Minimal satu approval rule wajib', 'error');
      return;
    }
    if (
      meta.amountMin !== '' &&
      meta.amountMax !== '' &&
      Number(meta.amountMin) > Number(meta.amountMax)
    ) {
      toast('Amount min tidak boleh lebih besar dari amount max', 'error');
      return;
    }

    const ruleError = validateRules(meta.flowType, rules);
    if (ruleError) {
      toast(ruleError, 'error');
      return;
    }

    const selectedDocType = docTypes.find(
      (item) => String(item.id) === String(meta.documentTypeId)
    );

    const payload = {
      matrixKey: meta.matrixKey,
      matrixName: meta.matrixName.trim(),
      departmentId: numberOrNull(meta.departmentId),
      documentType: selectedDocType?.code || null,
      documentTypeId: numberOrNull(meta.documentTypeId),
      requestType: meta.requestType.trim() || null,
      amountMin: numberOrNull(meta.amountMin),
      amountMax: numberOrNull(meta.amountMax),
      currency: meta.currency.trim().toUpperCase() || 'IDR',
      flowType: meta.flowType,
      priority: Number(meta.priority || 100),
      isActive: Boolean(meta.isActive),
      rules: rules.map((rule, index) => ({
        level: Number(rule.level || rule.orderIndex || index + 1),
        orderIndex: Number(rule.orderIndex || index + 1),
        approverUserId: numberOrNull(rule.approverUserId),
        approverRoleId: numberOrNull(rule.approverRoleId),
        signerUserId: numberOrNull(rule.signerUserId),
        signerRoleId: numberOrNull(rule.signerRoleId),
        parallelGroup:
          meta.flowType === 'parallel'
            ? String(rule.parallelGroup || '').trim()
            : null,
        isOptional: Boolean(rule.isOptional),
        escalationUserId: numberOrNull(rule.escalationUserId),
        escalationRoleId: numberOrNull(rule.escalationRoleId),
        reminderAfterHours: numberOrNull(rule.reminderAfterHours),
        escalateAfterHours: numberOrNull(rule.escalateAfterHours),
      })),
    };

    setSaving(true);
    try {
      await api.post('/approval-matrix', payload);
      toast('Approval matrix dibuat', 'success');
      onSaved();
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal menyimpan matrix', 'error');
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
          label="Matrix Key *"
          value={meta.matrixKey}
          onChange={(event) =>
            setMetaValue(
              'matrixKey',
              event.target.value.toLowerCase().replace(/[^a-z0-9:_-]/g, '-')
            )
          }
          placeholder="payment:high-value"
        />
        <Input
          label="Matrix Name *"
          value={meta.matrixName}
          onChange={(event) => setMetaValue('matrixName', event.target.value)}
          placeholder="High Value Payment Approval"
        />

        <SelectField
          label="Flow Type"
          value={meta.flowType}
          onChange={(value) => setMetaValue('flowType', value)}
          options={[
            { value: 'sequential', label: 'Sequential' },
            { value: 'parallel', label: 'Parallel' },
          ]}
        />

        <SelectField
          label="Department"
          value={meta.departmentId}
          onChange={(value) => setMetaValue('departmentId', value)}
          options={departments.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
          allowEmpty
        />

        <SelectField
          label="Document Type"
          value={meta.documentTypeId}
          onChange={(value) => setMetaValue('documentTypeId', value)}
          options={docTypes.map((item) => ({
            value: item.id,
            label: `${item.name} (${item.code})`,
          }))}
          allowEmpty
        />

        <Input
          label="Request Type"
          value={meta.requestType}
          onChange={(event) => setMetaValue('requestType', event.target.value)}
          placeholder="payment_request"
        />
        <Input
          label="Amount Min"
          type="number"
          min="0"
          value={meta.amountMin}
          onChange={(event) => setMetaValue('amountMin', event.target.value)}
        />
        <Input
          label="Amount Max"
          type="number"
          min="0"
          value={meta.amountMax}
          onChange={(event) => setMetaValue('amountMax', event.target.value)}
        />
        <Input
          label="Currency"
          value={meta.currency}
          onChange={(event) => setMetaValue('currency', event.target.value)}
        />
        <Input
          label="Priority"
          type="number"
          min="0"
          value={meta.priority}
          onChange={(event) => setMetaValue('priority', event.target.value)}
        />
      </div>

      <label
        style={{
          display: 'flex',
          gap: 7,
          alignItems: 'center',
          fontSize: 13,
          marginBottom: 16,
        }}
      >
        <input
          type="checkbox"
          checked={meta.isActive}
          onChange={(event) => setMetaValue('isActive', event.target.checked)}
        />
        Matrix aktif
      </label>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <b>Approval Rules ({rules.length})</b>
        <Button variant="secondary" onClick={addRule}>
          <Plus size={14} />
          Tambah Rule
        </Button>
      </div>

      {rules.map((rule, index) => (
        <div
          key={index}
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: 12,
            marginBottom: 10,
            background: '#f8fafc',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <b style={{ fontSize: 13 }}>Rule #{index + 1}</b>
            <Button
              variant="danger"
              disabled={rules.length === 1}
              onClick={() =>
                setRules((current) =>
                  current.filter((_, ruleIndex) => ruleIndex !== index)
                )
              }
            >
              <Trash2 size={14} />
            </Button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 10,
            }}
          >
            <Input
              label="Order Index"
              type="number"
              min="1"
              value={rule.orderIndex}
              onChange={(event) => setRule(index, 'orderIndex', event.target.value)}
            />
            <Input
              label="Level"
              type="number"
              min="1"
              value={rule.level}
              onChange={(event) => setRule(index, 'level', event.target.value)}
            />

            {meta.flowType === 'parallel' && (
              <Input
                label="Parallel Group *"
                value={rule.parallelGroup}
                onChange={(event) =>
                  setRule(index, 'parallelGroup', event.target.value)
                }
                placeholder="finance-review"
              />
            )}

            <UserSelect
              label="Approver User"
              value={rule.approverUserId}
              onChange={(value) => setRule(index, 'approverUserId', value)}
              users={users}
            />
            <RoleSelect
              label="Approver Role"
              value={rule.approverRoleId}
              onChange={(value) => setRule(index, 'approverRoleId', value)}
              roles={roles}
            />
            <UserSelect
              label="Signer User (opsional)"
              value={rule.signerUserId}
              onChange={(value) => setRule(index, 'signerUserId', value)}
              users={users}
            />
            <RoleSelect
              label="Signer Role (opsional)"
              value={rule.signerRoleId}
              onChange={(value) => setRule(index, 'signerRoleId', value)}
              roles={roles}
            />
            <UserSelect
              label="Escalation User"
              value={rule.escalationUserId}
              onChange={(value) => setRule(index, 'escalationUserId', value)}
              users={users}
            />
            <RoleSelect
              label="Escalation Role"
              value={rule.escalationRoleId}
              onChange={(value) => setRule(index, 'escalationRoleId', value)}
              roles={roles}
            />
            <Input
              label="Reminder after (jam)"
              type="number"
              min="0"
              value={rule.reminderAfterHours}
              onChange={(event) =>
                setRule(index, 'reminderAfterHours', event.target.value)
              }
            />
            <Input
              label="Escalate after (jam)"
              type="number"
              min="0"
              value={rule.escalateAfterHours}
              onChange={(event) =>
                setRule(index, 'escalateAfterHours', event.target.value)
              }
            />
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 13,
              marginTop: 4,
            }}
          >
            <input
              type="checkbox"
              checked={rule.isOptional}
              onChange={(event) =>
                setRule(index, 'isOptional', event.target.checked)
              }
            />
            Optional step — dapat di-skip dengan catatan
          </label>
        </div>
      ))}

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
        <Button onClick={submit} disabled={saving}>
          {saving ? 'Menyimpan…' : 'Buat Matrix'}
        </Button>
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  allowEmpty = false,
}) {
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
