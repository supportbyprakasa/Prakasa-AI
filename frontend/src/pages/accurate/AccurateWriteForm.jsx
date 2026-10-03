import { useEffect, useId, useMemo, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import { apiError } from '../sales/salesModel';
import {
  EMPTY_FORM, FIELDS, RECORD_LABEL, fieldLabel, formErrors, formFrom, newRequestKey, toPayload,
} from './accurateWriteModel';

// "Ajukan ke Accurate": a customer or vendor proposed for Accurate. Saving here
// creates a request the division's Supervisor or Head decides; nothing reaches
// Accurate from this dialog. One request key per opened form, so a retried
// save is the same request.
//
//   recordType  'customer' | 'vendor'
//   action      'create' | 'update' (update needs accurateId, the Accurate record)
//   initial     field values to start from (an app customer, a mirror record)
//   localId     the app row the proposal comes from (sales_customers.id)
export default function AccurateWriteForm({ open, recordType = 'customer', action = 'create', accurateId = null, localId = null, initial = null, onClose, onSaved }) {
  const formId = useId();
  const [values, setValues] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [requestKey, setRequestKey] = useState('');

  useEffect(() => {
    if (!open) return;
    setValues(formFrom(initial || {}));
    setErrors({});
    setError('');
    setRequestKey(newRequestKey());
  }, [open, initial]);

  const label = RECORD_LABEL[recordType] || 'Data';
  const title = action === 'update' ? `Ajukan perubahan ${label.toLowerCase()} ke Accurate` : `Ajukan ${label.toLowerCase()} baru ke Accurate`;
  const set = (key) => (e) => { setValues((v) => ({ ...v, [key]: e.target.value })); setErrors((x) => ({ ...x, [key]: undefined })); };
  const fields = useMemo(() => FIELDS.filter((f) => !(action === 'update' && f.key === 'number')), [action]);

  const submit = async (e) => {
    e.preventDefault();
    const next = formErrors(values);
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    setError('');
    try {
      const body = { recordType, action, requestKey, payload: toPayload(values) };
      if (localId) body.localId = localId;
      if (action === 'update') { body.accurateId = String(accurateId); body.payload.number = initial?.number || undefined; }
      const r = await api.post('/accurate-write/requests', body);
      toast('Pengajuan dibuat. Supervisor atau Head divisi akan memutuskan sebelum dikirim ke Accurate.', 'success');
      onSaved?.(r.data.data);
      onClose?.();
    } catch (err) {
      setError(apiError(err, 'Pengajuan gagal dibuat'));
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={title}
      size="md"
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving} icon="send">Ajukan</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        <Banner tone="info">
          Pengajuan diputuskan Supervisor atau Head divisi dulu. Setelah disetujui, data menunggu di antrean sampai saluran kirim ke Accurate dinyalakan, dan baru dianggap selesai setelah tarikan berikutnya menampilkannya.
        </Banner>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {action === 'update' && initial?.number ? <div className="pw-text-helper">{`${fieldLabel('number', recordType)}: ${initial.number} (tidak diubah dari sini).`}</div> : null}
        {fields.map((f) => (f.multiline ? (
          <Textarea key={f.key} label={fieldLabel(f.key, recordType)} rows={2} value={values[f.key]} onChange={set(f.key)} error={errors[f.key]} maxLength={f.max} />
        ) : (
          <Input
            key={f.key} label={fieldLabel(f.key, recordType)} type={f.type || 'text'} value={values[f.key]} onChange={set(f.key)}
            error={errors[f.key]} hint={f.key === 'number' ? f.hint : undefined} required={f.required} maxLength={f.max}
          />
        )))}
      </form>
    </Modal>
  );
}
