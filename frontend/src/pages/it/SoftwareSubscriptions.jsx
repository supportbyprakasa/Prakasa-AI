import { useEffect, useId, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/Button';
import DateInput from '../../components/DateInput';
import FullScreenDialog from '../../components/FullScreenDialog';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import Page from '../../components/Page';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import DataGrid from '../../components/datagrid/DataGrid';
import { statusLabel } from '../../components/statusTone';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { BILLING_CYCLE_LABELS, optionsFrom } from './itModel';

const BILLING_CYCLES = optionsFrom(BILLING_CYCLE_LABELS, ['monthly', 'quarterly', 'yearly', 'multi_year']);
const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

// Prakasa AI may fill what describes a subscription or an invoice; every
// rupiah amount and the invoice file stay with the user, who presses the
// form's own button (docs/prakasa-ai-rencana.md §9.9). The fields the AI may
// fill are held in state; the forms are still read with FormData when sent.
const SUBSCRIPTION_EMPTY = { productName: '', planName: '', totalSeats: '1', startDate: '', renewalDate: '', billingCycle: 'monthly' };
const INVOICE_EMPTY = { invoiceNumber: '', invoiceDate: '', jurnalReferenceId: '' };
const AI_SUBSCRIPTION = defineAIForm({
  id: 'it-subscription',
  title: 'Tambah langganan',
  permission: 'subscription.manage',
  submitLabel: 'Simpan langganan',
  fields: [
    f.text('productName', 'Produk', { required: true }),
    f.text('planName', 'Paket'),
    f.number('totalSeats', 'Jumlah seat', { min: 1, step: 1 }),
    f.userOnly('unitPrice', 'Harga per seat', 'number'),
    f.date('startDate', 'Tanggal mulai'),
    f.date('renewalDate', 'Tanggal perpanjangan', { required: true }),
    f.select('billingCycle', 'Siklus tagihan', BILLING_CYCLES),
  ],
});
const AI_INVOICE = defineAIForm({
  id: 'it-subscription-invoice',
  title: 'Unggah invoice langganan',
  permission: 'subscription.invoice.manage',
  submitLabel: 'Unggah invoice',
  fields: [
    f.text('invoiceNumber', 'Nomor invoice', { required: true, maxLength: 120 }),
    f.date('invoiceDate', 'Tanggal invoice', { required: true }),
    f.userOnly('amount', 'Subtotal', 'number'),
    f.userOnly('taxAmount', 'Pajak', 'number'),
    f.userOnly('totalAmount', 'Total', 'number'),
    f.text('jurnalReferenceId', 'Referensi Jurnal.id', { maxLength: 190 }),
    f.userOnly('file', 'File invoice'),
  ],
});

export default function SoftwareSubscriptions() {
  const navigate = useNavigate();
  const createFormId = useId();
  const invoiceFormId = useId();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(null);
  const [saving, setSaving] = useState(false);
  // Set by any change inside a form; closing then asks before discarding.
  const [createDirty, setCreateDirty] = useState(false);
  const [invoiceDirty, setInvoiceDirty] = useState(false);
  const [draft, setDraft] = useState(SUBSCRIPTION_EMPTY);
  const [invoice, setInvoice] = useState(INVOICE_EMPTY);
  useEffect(() => { if (open) { setCreateDirty(false); setDraft(SUBSCRIPTION_EMPTY); } }, [open]);
  useEffect(() => { if (invoiceOpen) { setInvoiceDirty(false); setInvoice(INVOICE_EMPTY); } }, [invoiceOpen]);
  const setDraftField = (name) => (event) => { const { value } = event.target; setDraft((current) => ({ ...current, [name]: value })); };
  const setInvoiceField = (name) => (event) => { const { value } = event.target; setInvoice((current) => ({ ...current, [name]: value })); };
  // `ai` is the "Tambah langganan" registration, `aiInvoice` the invoice form's.
  const ai = usePrakasaAIForm(AI_SUBSCRIPTION, {
    enabled: open,
    values: draft,
    setValues: setDraft,
    onFill: () => setCreateDirty(true),
    initialValues: SUBSCRIPTION_EMPTY,
  });
  const aiInvoice = usePrakasaAIForm(AI_INVOICE, {
    enabled: Boolean(invoiceOpen),
    values: invoice,
    setValues: setInvoice,
    onFill: () => setInvoiceDirty(true),
    initialValues: INVOICE_EMPTY,
  });
  // ?baru=1 opens "Tambah langganan"; ?form=invoice&langganan=<id> opens the
  // invoice form of that subscription once the list has loaded. Opening saves nothing.
  const [params, setParams] = useSearchParams();
  const invoiceFor = params.get('langganan');
  useOpenFromUrl('baru', () => setOpen(true), { keepUnsaved: true });
  useOpenFromUrl('form', (name) => {
    const target = rows.find((row) => String(row.id) === String(invoiceFor));
    if (name === 'invoice' && target) setInvoiceOpen(target);
  }, { enabled: !loading && rows.length > 0, keepUnsaved: true });
  // `langganan` only named the row for `form`: it leaves the URL once `form` has.
  const hasFormParam = params.has('form');
  useEffect(() => {
    if (!invoiceFor || hasFormParam) return;
    setParams((current) => { const next = new URLSearchParams(current); next.delete('langganan'); return next; }, { replace: true });
  }, [invoiceFor, hasFormParam, setParams]);

  const load = () => {
    setLoading(true);
    setLoadError('');
    api.get('/it/subscriptions')
      .then((r) => setRows(r.data.data || []))
      .catch((error) => setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.')))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      productName: fd.get('productName'),
      planName: fd.get('planName') || null,
      totalSeats: Number(fd.get('totalSeats') || 1),
      unitPrice: fd.get('unitPrice') ? Number(fd.get('unitPrice')) : null,
      billingCycle: fd.get('billingCycle') || 'monthly',
      renewalDate: fd.get('renewalDate'),
      startDate: fd.get('startDate') || null,
      generateLicenses: true,
    };
    setSaving(true);
    try {
      await api.post('/it/subscriptions', body);
      toast('Langganan ditambahkan', 'success');
      setOpen(false); load();
    } catch (err) {
      toast(errorMessage(err, 'Langganan gagal ditambahkan'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const uploadInvoice = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    setSaving(true);
    try {
      await api.post(`/it/subscriptions/${invoiceOpen.id}/invoices`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast('Invoice diunggah', 'success');
      setInvoiceOpen(null); load();
    } catch (err) {
      toast(errorMessage(err, 'Invoice gagal diunggah'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page
      title="Langganan software"
      description="Software berlangganan, lisensinya, invoice, dan pembayarannya."
      actions={<Button icon="add" onClick={() => setOpen(true)}>Tambah langganan</Button>}
    >
      <DataGrid
        title="Langganan software"
        showTitle={false}
        exportName="langganan-software"
        loading={loading}
        error={loadError}
        onRetry={load}
        rows={rows}
        empty="Belum ada langganan software"
        onRowClick={(r) => navigate(`/it/subscriptions/${r.id}`)}
        rowActions={(r) => (
          <IconButton label="Unggah invoice" icon="upload_file" size="sm" onClick={() => setInvoiceOpen(r)} />
        )}
        columns={[
          { key: 'productName', header: 'Produk', render: (r) => r.productName || r.product_name },
          { key: 'planName', header: 'Paket' },
          { key: 'totalSeats', header: 'Seat', type: 'number' },
          { key: 'assignedSeats', header: 'Terpakai', type: 'number' },
          { key: 'idleSeats', header: 'Idle', type: 'number' },
          { key: 'renewalDate', header: 'Perpanjangan', type: 'date' },
          { key: 'status', header: 'Status', exportValue: (r) => statusLabel(r.status), render: (r) => <StatusBadge status={r.status} /> },
        ]}
      />

      <FullScreenDialog
        open={open}
        onClose={() => setOpen(false)}
        dirty={createDirty}
        title="Tambah langganan"
        sectionTitle="Informasi langganan"
        actions={(
          <>
            <Button variant="text" type="button" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit" form={createFormId} loading={saving}>Simpan langganan</Button>
          </>
        )}
      >
        {ai.notice}
        <form id={createFormId} className="pw-fsdialog__fields" onSubmit={create} onChange={() => setCreateDirty(true)}>
          <Input label="Produk" name="productName" required value={draft.productName} {...ai.field('productName')} onChange={setDraftField('productName')} />
          <Input label="Paket" name="planName" value={draft.planName} {...ai.field('planName')} onChange={setDraftField('planName')} />
          <Input label="Jumlah seat" name="totalSeats" type="number" value={draft.totalSeats} {...ai.field('totalSeats')} onChange={setDraftField('totalSeats')} />
          <Input label="Harga per seat" name="unitPrice" type="number" />
          <DateInput label="Tanggal mulai" name="startDate" value={draft.startDate} {...ai.field('startDate')} onChange={setDraftField('startDate')} />
          <DateInput label="Tanggal perpanjangan" name="renewalDate" required value={draft.renewalDate} {...ai.field('renewalDate')} onChange={setDraftField('renewalDate')} />
          <Select label="Siklus tagihan" name="billingCycle" options={BILLING_CYCLES} value={draft.billingCycle} {...ai.field('billingCycle')} onChange={setDraftField('billingCycle')} />
        </form>
      </FullScreenDialog>

      <FullScreenDialog
        open={!!invoiceOpen}
        onClose={() => setInvoiceOpen(null)}
        dirty={invoiceDirty}
        title={`Unggah invoice ${invoiceOpen?.productName || ''}`.trim()}
        sectionTitle="Invoice"
        actions={(
          <>
            <Button variant="text" type="button" onClick={() => setInvoiceOpen(null)}>Batal</Button>
            <Button type="submit" form={invoiceFormId} loading={saving}>Unggah invoice</Button>
          </>
        )}
      >
        {aiInvoice.notice}
        <form id={invoiceFormId} className="pw-fsdialog__fields" onSubmit={uploadInvoice} onChange={() => setInvoiceDirty(true)}>
          <Input label="Nomor invoice" name="invoiceNumber" required mono value={invoice.invoiceNumber} {...aiInvoice.field('invoiceNumber')} onChange={setInvoiceField('invoiceNumber')} />
          <DateInput label="Tanggal invoice" name="invoiceDate" required value={invoice.invoiceDate} {...aiInvoice.field('invoiceDate')} onChange={setInvoiceField('invoiceDate')} />
          <Input label="Subtotal" name="amount" type="number" required />
          <Input label="Pajak" name="taxAmount" type="number" defaultValue={0} />
          <Input label="Total" name="totalAmount" type="number" required />
          <Input label="Referensi Jurnal.id" name="jurnalReferenceId" value={invoice.jurnalReferenceId} {...aiInvoice.field('jurnalReferenceId')} onChange={setInvoiceField('jurnalReferenceId')} />
          <Input label="File invoice" name="file" type="file" hint="PDF." />
        </form>
      </FullScreenDialog>
    </Page>
  );
}
