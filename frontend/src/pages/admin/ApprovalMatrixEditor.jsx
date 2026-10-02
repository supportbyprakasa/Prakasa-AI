import { useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import Field from '../../components/Field';
import { apiErrorMessage } from '../../components/datagrid/gridModel';
import { FullScreenSection } from '../../components/FullScreenDialog';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import Select from '../../components/Select';
import { toast } from '../../components/Toast';
import { FLOW_OPTIONS, RuleFields, validateRule } from './approvalMatrixParts';
import { DEFAULT_CURRENCY, normalizeCurrency } from './approvalMatrixModel';
import './admin-editors.css';

export const MATRIX_EDITOR_FORM_ID = 'approval-matrix-create-form';

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

// Per-rule field errors: the rule's own checks plus the flow checks that
// compare rules (duplicate order in a sequential flow, parallel groups that
// must share one order).
function validateRules(flowType, rules) {
  const seenSequential = new Set();
  const groupOrder = new Map();
  const orderGroup = new Map();
  const errors = rules.map((rule) => validateRule(rule));

  rules.forEach((rule, index) => {
    const order = Number(rule.orderIndex || index + 1);
    const ruleErrors = errors[index];
    if (flowType === 'sequential') {
      if (seenSequential.has(order)) ruleErrors.orderIndex = `Urutan ${order} sudah dipakai rule lain pada alur berurutan.`;
      seenSequential.add(order);
      return;
    }
    const group = String(rule.parallelGroup || '').trim();
    if (!group) {
      ruleErrors.parallelGroup = 'Isi grup paralel.';
      return;
    }
    if (groupOrder.has(group) && groupOrder.get(group) !== order) {
      ruleErrors.orderIndex = `Semua rule di grup ${group} harus memakai urutan yang sama.`;
    }
    groupOrder.set(group, order);
    if (orderGroup.has(order) && orderGroup.get(order) !== group) {
      ruleErrors.parallelGroup = 'Satu urutan hanya boleh punya satu grup paralel.';
    }
    orderGroup.set(order, group);
  });
  return errors;
}

// Create a whole approval matrix (settings + its rules) in the full-screen
// dialog opened from Approval Matrix. The dialog's actions submit this form
// by id (MATRIX_EDITOR_FORM_ID).
export default function ApprovalMatrixEditor({
  users,
  roles,
  docTypes,
  departments,
  onSavingChange,
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
    currency: DEFAULT_CURRENCY,
    flowType: 'sequential',
    priority: 100,
    isActive: true,
  });
  const [rules, setRules] = useState([blankRule(1)]);
  const [metaErrors, setMetaErrors] = useState({});
  const [ruleErrors, setRuleErrors] = useState([]);
  const [rulesError, setRulesError] = useState('');
  const selectedDocType = docTypes.find((item) => String(item.id) === String(meta.documentTypeId));

  const setMetaValue = (key, value) => {
    setMeta((current) => ({ ...current, [key]: value }));
    setMetaErrors((current) => ({ ...current, [key]: undefined }));
  };

  const setRule = (index, key, value) => {
    setRules((current) => current.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, [key]: value } : rule)));
    setRuleErrors((current) => current.map((errors, ruleIndex) => (ruleIndex === index ? {} : errors)));
  };

  const addRule = () => {
    const maxOrder = rules.reduce(
      (max, rule) => Math.max(max, Number(rule.orderIndex || 0)),
      0
    );
    setRules((current) => [...current, blankRule(maxOrder + 1)]);
    setRulesError('');
  };

  const removeRule = (index) => {
    setRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index));
    setRuleErrors((current) => current.filter((_, ruleIndex) => ruleIndex !== index));
  };

  const submit = async (event) => {
    event.preventDefault();
    const nextMetaErrors = {};
    if (!meta.matrixKey || !/^[a-z0-9:_-]+$/.test(meta.matrixKey)) {
      nextMetaErrors.matrixKey = 'Isi kunci matrix: huruf kecil, angka, :, _ atau -.';
    }
    if (!meta.matrixName.trim()) nextMetaErrors.matrixName = 'Isi nama matrix.';
    if (meta.amountMin !== '' && meta.amountMax !== '' && Number(meta.amountMin) > Number(meta.amountMax)) {
      nextMetaErrors.amountMax = 'Nominal maksimum harus sama atau lebih besar dari minimum.';
    }
    const nextRuleErrors = validateRules(meta.flowType, rules);
    setMetaErrors(nextMetaErrors);
    setRuleErrors(nextRuleErrors);
    if (!rules.length) {
      setRulesError('Tambahkan minimal satu rule approval.');
      return;
    }
    if (Object.keys(nextMetaErrors).length || nextRuleErrors.some((errors) => Object.keys(errors).length)) return;

    const payload = {
      matrixKey: meta.matrixKey,
      matrixName: meta.matrixName.trim(),
      departmentId: numberOrNull(meta.departmentId),
      documentType: selectedDocType?.code || null,
      documentTypeId: numberOrNull(meta.documentTypeId),
      requestType: meta.requestType.trim() || null,
      amountMin: numberOrNull(meta.amountMin),
      amountMax: numberOrNull(meta.amountMax),
      currency: normalizeCurrency(meta.currency),
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

    onSavingChange(true);
    try {
      await api.post('/approval-matrix', payload);
      toast('Approval matrix dibuat', 'success');
      onSavingChange(false);
      onSaved();
    } catch (error) {
      onSavingChange(false);
      toast(apiErrorMessage(error, 'Matrix gagal disimpan.'), 'error');
    }
  };

  return (
    <form id={MATRIX_EDITOR_FORM_ID} className="admin-dialog-form" onSubmit={submit} noValidate>
      <FullScreenSection title="Informasi matrix">
        <div className="pw-fsdialog__fields">
          <Input
            label="Kunci matrix"
            required
            mono
            value={meta.matrixKey}
            error={metaErrors.matrixKey}
            hint="Huruf kecil, angka, :, _ atau -. Contoh payment:high-value."
            onChange={(event) => setMetaValue('matrixKey', event.target.value.toLowerCase().replace(/[^a-z0-9:_-]/g, '-'))}
            autoFocus
          />
          <Input
            label="Nama matrix"
            required
            value={meta.matrixName}
            error={metaErrors.matrixName}
            hint="Contoh approval pembayaran nilai besar."
            onChange={(event) => setMetaValue('matrixName', event.target.value)}
          />
          <Select
            label="Jenis alur"
            value={meta.flowType}
            onChange={(event) => setMetaValue('flowType', event.target.value)}
            options={FLOW_OPTIONS}
          />
          <Select
            label="Divisi"
            value={meta.departmentId}
            onChange={(event) => setMetaValue('departmentId', event.target.value)}
            options={departments.map((item) => ({ value: item.id, label: item.name }))}
            placeholder="Semua divisi"
          />
          <Select
            label="Tipe dokumen"
            value={meta.documentTypeId}
            onChange={(event) => setMetaValue('documentTypeId', event.target.value)}
            options={docTypes.map((item) => ({ value: item.id, label: item.name }))}
            placeholder="Semua tipe dokumen"
            hint={selectedDocType?.code ? `Kode ${selectedDocType.code}` : undefined}
          />
          <Input
            label="Jenis permintaan"
            mono
            value={meta.requestType}
            hint="Contoh payment_request."
            onChange={(event) => setMetaValue('requestType', event.target.value)}
          />
          <Input
            label="Nominal minimum"
            type="number"
            min="0"
            inputMode="numeric"
            value={meta.amountMin}
            error={metaErrors.amountMin}
            onChange={(event) => setMetaValue('amountMin', event.target.value)}
          />
          <Input
            label="Nominal maksimum"
            type="number"
            min="0"
            inputMode="numeric"
            value={meta.amountMax}
            error={metaErrors.amountMax}
            onChange={(event) => setMetaValue('amountMax', event.target.value)}
          />
          <Input
            label="Mata uang"
            value={meta.currency}
            onChange={(event) => setMetaValue('currency', event.target.value)}
          />
          <Input
            label="Prioritas"
            type="number"
            min="0"
            inputMode="numeric"
            hint="Angka kecil didahulukan."
            value={meta.priority}
            onChange={(event) => setMetaValue('priority', event.target.value)}
          />
        </div>
        <Checkbox label="Matrix aktif" checked={meta.isActive} onChange={(event) => setMetaValue('isActive', event.target.checked)} />
      </FullScreenSection>

      {rules.map((rule, index) => (
        <FullScreenSection
          key={index}
          title={(
            <span className="admin-section-heading">
              <span>Rule {index + 1}</span>
              <IconButton
                icon="delete"
                label={`Hapus rule ${index + 1}`}
                tone="danger"
                size="sm"
                disabled={rules.length === 1}
                onClick={() => removeRule(index)}
              />
            </span>
          )}
        >
          <RuleFields
            rule={rule}
            errors={ruleErrors[index] || {}}
            flowType={meta.flowType}
            users={users}
            roles={roles}
            onChange={(key, value) => setRule(index, key, value)}
          />
        </FullScreenSection>
      ))}

      <Field error={rulesError}>
        <div>
          <Button variant="secondary" icon="add" type="button" onClick={addRule}>Tambah rule</Button>
        </div>
      </Field>
    </form>
  );
}

