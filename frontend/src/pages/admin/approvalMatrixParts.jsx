import Checkbox from '../../components/Checkbox';
import Input from '../../components/Input';
import { RoleSelect, UserSelect } from '../../components/UserRoleSelects';

// Pieces shared by the approval matrix create dialog and the rule editor.
export const FLOW_LABELS = { sequential: 'Berurutan', parallel: 'Paralel' };
export const FLOW_OPTIONS = Object.entries(FLOW_LABELS).map(([value, label]) => ({ value, label }));

// Codes typed by admins (matrix keys, request types, parallel groups) shown
// as words: "payment:high-value" → "Payment high value".
export function humanizeCode(code) {
  const words = String(code || '').replace(/[:._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

const REQUEST_TYPE_LABELS = {
  payment_request: 'Pengajuan pembayaran',
  reimbursement: 'Reimbursement',
  sales_accurate_sync: 'Sinkronisasi data Accurate',
  sales_accurate_batch: 'Batch data Accurate',
  finance_workflow: 'Alur keuangan',
  finance_payment_request: 'Pengajuan pembayaran',
  finance_reimbursement: 'Reimbursement',
  warehouse_inbound: 'Barang masuk',
  warehouse_outbound: 'Barang keluar',
  ga_request: 'Permintaan GA',
  ga_request_other: 'Permintaan GA lainnya',
  ga_booking: 'Peminjaman ruang',
  ga_vehicle_booking: 'Peminjaman kendaraan',
  hrga_workflow: 'Workflow HRGA',
  hrga_onboarding: 'Onboarding karyawan',
  hrga_offboarding: 'Offboarding karyawan',
};

// A request type with no label is shown as its code in words: record data,
// never translated.
export const isKnownRequestType = (code) => Boolean(REQUEST_TYPE_LABELS[code]);

export function requestTypeLabel(code) {
  return REQUEST_TYPE_LABELS[code] || humanizeCode(code);
}

// One rule's own checks, as field errors (the approver pair, the signer pair,
// escalation after the reminder).
export function validateRule(rule) {
  const errors = {};
  if (!rule.approverUserId && !rule.approverRoleId) {
    errors.approver = 'Pilih approver: pengguna atau role.';
  } else if (rule.approverUserId && rule.approverRoleId) {
    errors.approver = 'Pilih pengguna atau peran saja, bukan keduanya.';
  }
  if (rule.signerUserId && rule.signerRoleId) errors.signer = 'Pilih pengguna atau peran saja, bukan keduanya.';
  if (
    rule.reminderAfterHours !== ''
    && rule.escalateAfterHours !== ''
    && rule.reminderAfterHours != null
    && rule.escalateAfterHours != null
    && Number(rule.escalateAfterHours) < Number(rule.reminderAfterHours)
  ) {
    errors.escalateAfterHours = 'Eskalasi harus sama atau setelah pengingat.';
  }
  return errors;
}

// The fields of one approval rule, two columns inside a FullScreenSection.
export function RuleFields({ rule, errors = {}, flowType, users, roles, onChange }) {
  return (
    <>
      <div className="pw-fsdialog__fields">
        <Input
          label="Urutan"
          type="number"
          min="1"
          inputMode="numeric"
          value={rule.orderIndex}
          error={errors.orderIndex}
          onChange={(event) => onChange('orderIndex', event.target.value)}
        />
        <Input
          label="Level"
          type="number"
          min="1"
          inputMode="numeric"
          value={rule.level}
          error={errors.level}
          onChange={(event) => onChange('level', event.target.value)}
        />
        {flowType === 'parallel' || flowType === undefined ? (
          <Input
            label="Grup paralel"
            required={flowType === 'parallel'}
            mono
            value={rule.parallelGroup}
            error={errors.parallelGroup}
            hint="Contoh finance-review."
            onChange={(event) => onChange('parallelGroup', event.target.value)}
          />
        ) : null}
        <UserSelect
          label="Approver (pengguna)"
          value={rule.approverUserId}
          placeholder="Tidak ada"
          error={errors.approver}
          hint="Isi pengguna atau peran, salah satu saja."
          onChange={(value) => onChange('approverUserId', value)}
          users={users}
        />
        <RoleSelect
          label="Approver (role)"
          value={rule.approverRoleId}
          placeholder="Tidak ada"
          error={errors.approver}
          onChange={(value) => onChange('approverRoleId', value)}
          roles={roles}
        />
        <UserSelect
          label="Penanda tangan (pengguna)"
          value={rule.signerUserId}
          placeholder="Tidak ada"
          error={errors.signer}
          hint="Opsional."
          onChange={(value) => onChange('signerUserId', value)}
          users={users}
        />
        <RoleSelect
          label="Penanda tangan (role)"
          value={rule.signerRoleId}
          placeholder="Tidak ada"
          error={errors.signer}
          hint="Opsional."
          onChange={(value) => onChange('signerRoleId', value)}
          roles={roles}
        />
        <UserSelect
          label="Eskalasi ke pengguna"
          value={rule.escalationUserId}
          placeholder="Tidak ada"
          onChange={(value) => onChange('escalationUserId', value)}
          users={users}
        />
        <RoleSelect
          label="Eskalasi ke peran"
          value={rule.escalationRoleId}
          placeholder="Tidak ada"
          onChange={(value) => onChange('escalationRoleId', value)}
          roles={roles}
        />
        <Input
          label="Pengingat setelah (jam)"
          type="number"
          min="0"
          inputMode="numeric"
          value={rule.reminderAfterHours}
          error={errors.reminderAfterHours}
          onChange={(event) => onChange('reminderAfterHours', event.target.value)}
        />
        <Input
          label="Eskalasi setelah (jam)"
          type="number"
          min="0"
          inputMode="numeric"
          value={rule.escalateAfterHours}
          error={errors.escalateAfterHours}
          onChange={(event) => onChange('escalateAfterHours', event.target.value)}
        />
      </div>
      <Checkbox
        label="Langkah opsional, boleh dilewati dengan catatan"
        checked={Boolean(rule.isOptional)}
        onChange={(event) => onChange('isOptional', event.target.checked)}
      />
    </>
  );
}
