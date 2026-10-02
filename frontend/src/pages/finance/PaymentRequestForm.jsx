import { useEffect, useId, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import DateInput from '../../components/DateInput';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import Input from '../../components/Input';
import Segmented from '../../components/Segmented';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { formatMoney } from '../../components/format';
import { splitServerErrors } from '../sales/salesModel';
import { PAYROLL_NOTE, WORKFLOW_TYPES, requestPayload, totalOf } from './financeModel';

const str = (value) => (value === null || value === undefined ? '' : String(value));

function initialForm(request) {
  if (request) {
    return {
      workflowType: request.workflowType, title: request.title || '', description: request.description || '', category: request.category || '',
      payeeName: request.payeeName || '', payeeBank: request.payeeBank || '', payeeAccountNumber: request.payeeAccountNumber || '',
      payeeAccountName: request.payeeAccountName || '', amount: str(request.amount), taxAmount: str(request.taxAmount || 0),
      totalAmount: str(request.totalAmount), requestedPaymentDate: request.requestedPaymentDate || '', dueDate: request.dueDate || '',
      notes: request.notes || '',
    };
  }
  return {
    workflowType: 'payment_request', title: '', description: '', category: '', payeeName: '', payeeBank: '', payeeAccountNumber: '',
    payeeAccountName: '', amount: '', taxAmount: '0', totalAmount: '', requestedPaymentDate: '', dueDate: '', notes: '',
  };
}

const FIELDS = ['title', 'category', 'description', 'payeeName', 'payeeBank', 'payeeAccountNumber', 'payeeAccountName',
  'amount', 'taxAmount', 'totalAmount', 'requestedPaymentDate', 'dueDate', 'notes'];

// Create or edit a payment request or reimbursement: a long form, so the
// full-screen dialog with sections (docs/ui-guideline.md §3.3). The request
// belongs to the signed-in account and its division; the server sets both.
export default function PaymentRequestForm({ open, request = null, onClose, onSaved }) {
  const formId = useId();
  const create = !request;
  const [form, setForm] = useState(() => initialForm(request));
  const [errors, setErrors] = useState({});
  const [totalTouched, setTotalTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const employee = form.workflowType === 'reimbursement';

  useEffect(() => {
    if (!open) return;
    setForm(initialForm(request));
    setErrors({});
    setTouched(false);
    setTotalTouched(Boolean(request));
  }, [open, request]);

  const change = (key, value) => {
    setTouched(true);
    setErrors((x) => ({ ...x, [key]: undefined }));
    setForm((f) => {
      const next = { ...f, [key]: value };
      if ((key === 'amount' || key === 'taxAmount') && !totalTouched) next.totalAmount = totalOf(next.amount, next.taxAmount);
      return next;
    });
  };
  const set = (key) => (e) => change(key, e.target.value);

  // Prakasa AI may fill this form; the user reviews it and saves the draft
  // (docs/prakasa-ai-rencana.md §9.8). Where the money goes — bank, account
  // number, account holder — is never the AI's to fill: only the user types it.
  const ai = usePrakasaAIForm({
    id: 'payment-request',
    title: create ? 'Pengajuan pembayaran' : 'Ubah pengajuan pembayaran',
    permission: 'finance.request',
    submitLabel: create ? 'Simpan draf' : 'Simpan perubahan',
    enabled: open,
    initialValues: initialForm(request),
    fields: [
      ...(create ? [{ name: 'workflowType', label: 'Jenis pengajuan', type: 'radio', options: WORKFLOW_TYPES, required: true, hint: 'Reimbursement = mengganti uang pribadi karyawan; dibayar ke rekening payroll.' }] : []),
      { name: 'title', label: 'Judul', type: 'text', required: true },
      { name: 'category', label: 'Kategori', type: 'text', hint: 'mis. Tagihan GA, Langganan IT, Perjalanan' },
      { name: 'description', label: 'Keterangan dan referensi', type: 'textarea', hint: 'Nomor tagihan, nomor invoice pemasok, atau keperluan pembayaran.' },
      ...(employee ? [] : [
        { name: 'payeeName', label: 'Nama penerima', type: 'text', required: true },
        { name: 'payeeBank', label: 'Bank', type: 'text', aiFillable: false },
        { name: 'payeeAccountNumber', label: 'Nomor rekening', type: 'text', aiFillable: false },
        { name: 'payeeAccountName', label: 'Atas nama', type: 'text', aiFillable: false },
      ]),
      { name: 'amount', label: 'Subtotal', type: 'number', required: true, hint: 'Rupiah, tanpa pajak.' },
      { name: 'taxAmount', label: 'Pajak', type: 'number', hint: 'Rupiah.' },
      // The form's own rule fills the total (subtotal + tax); only the user overrides it.
      { name: 'totalAmount', label: 'Total', type: 'number', aiFillable: false, hint: 'Otomatis subtotal + pajak; hanya pengguna yang mengubahnya.' },
      { name: 'requestedPaymentDate', label: 'Tanggal bayar yang diminta', type: 'date' },
      ...(employee ? [] : [{ name: 'dueDate', label: 'Jatuh tempo', type: 'date' }]),
      { name: 'notes', label: 'Catatan untuk Finance', type: 'textarea' },
    ],
    getValues: () => form,
    // Through the form's own change(): the total follows subtotal + tax, and
    // the dialog knows it holds unsaved changes.
    setValues: (patch) => {
      const order = ['workflowType', 'amount', 'taxAmount'];
      const keys = [...order.filter((key) => key in patch), ...Object.keys(patch).filter((key) => !order.includes(key))];
      keys.forEach((key) => change(key, patch[key]));
    },
    validate: (next) => {
      const totalGiven = next.totalAmount !== '' && next.totalAmount !== undefined && next.totalAmount !== null;
      const withTotal = totalGiven || totalTouched ? next : { ...next, totalAmount: totalOf(next.amount, next.taxAmount) };
      return requestPayload(withTotal, { create }).errors || {};
    },
  });

  const submit = async (e) => {
    e.preventDefault();
    const { body, errors: problems } = requestPayload(form, { create });
    if (problems) { setErrors(problems); return; }
    setSaving(true);
    try {
      if (create) {
        const r = await api.post('/finance/payment-requests', body);
        toast(`Draf ${r.data.data.requestNumber} dibuat. Lampirkan dokumennya, lalu ajukan.`, 'success');
        onSaved?.(r.data.data);
      } else {
        await api.patch(`/finance/payment-requests/${request.id}`, body);
        toast('Pengajuan diperbarui', 'success');
        onSaved?.();
      }
      onClose();
    } catch (err) {
      // An error for a field this form does not show still reaches the user.
      const visible = employee ? FIELDS.filter((f) => !f.startsWith('payee')) : FIELDS;
      const { fields, message } = splitServerErrors(err, visible, { fallback: 'Pengajuan gagal disimpan' });
      setErrors(fields);
      if (message) toast(message, 'error');
    } finally { setSaving(false); }
  };

  const title = create ? 'Buat pengajuan' : `Ubah ${request.requestNumber}`;
  return (
    <FullScreenDialog
      open={open}
      onClose={onClose}
      dirty={touched && !saving}
      title={title}
      card={false}
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>{create ? 'Simpan draf' : 'Simpan perubahan'}</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack pw-stack--lg" onSubmit={submit} noValidate>
        {ai.notice}
        {create ? (
          <FullScreenSection title="Jenis pengajuan">
            <div className="pw-stack">
              <Segmented label="Jenis pengajuan" options={WORKFLOW_TYPES} value={form.workflowType} {...ai.field('workflowType')} onChange={(value) => change('workflowType', value)} />
              <p className="pw-text-helper fin-hint">
                {employee
                  ? 'Mengganti uang pribadi yang Anda pakai untuk keperluan kantor. Lampirkan kuitansi atau nota.'
                  : 'Pembayaran ke pemasok atau pihak lain, termasuk tagihan GA dan langganan IT. Lampirkan invoice.'}
              </p>
            </div>
          </FullScreenSection>
        ) : null}

        <FullScreenSection title="Rincian">
          <div className="pw-fsdialog__fields">
            <Input label="Judul" value={form.title} {...ai.field('title')} onChange={set('title')} required error={errors.title} placeholder={employee ? 'mis. Taksi kunjungan ke pemasok' : 'mis. Tagihan listrik gudang September'} />
            <Input label="Kategori" value={form.category} {...ai.field('category')} onChange={set('category')} error={errors.category} placeholder="mis. Tagihan GA, Langganan IT, Perjalanan" />
          </div>
          <Textarea
            label="Keterangan dan referensi"
            rows={3}
            value={form.description}
            {...ai.field('description')}
            onChange={set('description')}
            error={errors.description}
            hint="Nomor tagihan, nomor invoice pemasok, atau keperluan pembayaran ini."
          />
        </FullScreenSection>

        <FullScreenSection title="Penerima">
          {employee ? (
            <Banner tone="info" title={PAYROLL_NOTE}>
              Nomor rekening karyawan tidak diisi dan tidak disimpan di aplikasi. Finance membayar ke rekening payroll Anda.
            </Banner>
          ) : (
            <div className="pw-stack">
              <div className="pw-fsdialog__fields">
                <Input label="Nama penerima" value={form.payeeName} {...ai.field('payeeName')} onChange={set('payeeName')} required error={errors.payeeName} placeholder="mis. PT PLN (Persero)" />
                <Input label="Bank" value={form.payeeBank} onChange={set('payeeBank')} error={errors.payeeBank} />
                <Input label="Nomor rekening" value={form.payeeAccountNumber} onChange={set('payeeAccountNumber')} inputMode="numeric" mono error={errors.payeeAccountNumber} />
                <Input label="Atas nama" value={form.payeeAccountName} onChange={set('payeeAccountName')} error={errors.payeeAccountName} />
              </div>
              <p className="pw-text-helper fin-hint">Rekening pemasok atau pihak lain. Kosongkan bila dibayar lewat virtual account atau tagihan.</p>
            </div>
          )}
        </FullScreenSection>

        <FullScreenSection title="Nilai dan tanggal">
          <div className="pw-fsdialog__fields">
            <Input label="Subtotal" type="number" min="0" step="any" value={form.amount} {...ai.field('amount')} onChange={set('amount')} required hint={form.amount ? formatMoney(form.amount) : 'Rupiah'} error={errors.amount} />
            <Input label="Pajak" type="number" min="0" step="any" value={form.taxAmount} {...ai.field('taxAmount')} onChange={set('taxAmount')} hint={Number(form.taxAmount) ? formatMoney(form.taxAmount) : 'Rupiah'} error={errors.taxAmount} />
            <Input
              label="Total"
              type="number"
              min="0"
              step="any"
              value={form.totalAmount}
              onChange={(e) => { setTotalTouched(true); set('totalAmount')(e); }}
              required
              hint={form.totalAmount ? formatMoney(form.totalAmount) : 'Otomatis subtotal + pajak; boleh diubah'}
              error={errors.totalAmount}
            />
            <DateInput label="Tanggal bayar yang diminta" value={form.requestedPaymentDate} {...ai.field('requestedPaymentDate')} onChange={set('requestedPaymentDate')} error={errors.requestedPaymentDate} />
            {!employee ? <DateInput label="Jatuh tempo" value={form.dueDate} {...ai.field('dueDate')} onChange={set('dueDate')} error={errors.dueDate} /> : null}
          </div>
          <Textarea label="Catatan untuk Finance" rows={2} value={form.notes} {...ai.field('notes')} onChange={set('notes')} error={errors.notes} />
        </FullScreenSection>
      </form>
    </FullScreenDialog>
  );
}
