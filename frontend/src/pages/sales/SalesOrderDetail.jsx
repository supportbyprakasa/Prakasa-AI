import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Link, useNavigate, useParams, useSearchParams,
} from 'react-router-dom';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ConfirmDialog from '../../components/ConfirmDialog';
import DateInput from '../../components/DateInput';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FormActions from '../../components/FormActions';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { fieldErrorsFromApi } from '../../components/datagrid/gridModel';
import { formatDate, formatDateTime } from '../../components/format';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import {
  apiError, dueDate as addTerms, formatRupiah, orderBillingStatus, orderBillingText, todayIso,
} from './salesModel';
import { AccurateHoldBanner, useAccurateSource } from './SalesScopeBanner';
import { salesChanged } from '../../components/useSalesActionBadge';
import { Mixed, data } from '../../i18n/NoTranslate';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { hasUnsavedForm } from '../../components/ai/useOpenFromUrl';

const LINE_COLUMNS = [
  { key: 'productName', header: 'Produk' },
  { key: 'skuCode', header: 'SKU', nowrap: true },
  { key: 'qty', header: 'Qty', type: 'number' },
  { key: 'unitPrice', header: 'Harga', type: 'money' },
  { key: 'lineTotal', header: 'Total', type: 'money' },
  { key: 'taxable', header: 'PPN', translate: true, render: (r) => (r.taxable ? 'Ya' : 'Tidak'), exportValue: (r) => (r.taxable ? 'Ya' : 'Tidak') },
  { key: 'outstandingAmount', header: 'Piutang', type: 'money' },
];

const PAYMENT_COLUMNS = [
  { key: 'paidAt', header: 'Tanggal', type: 'date' },
  { key: 'amount', header: 'Jumlah', type: 'money' },
  { key: 'method', header: 'Metode' },
  { key: 'note', header: 'Catatan' },
  { key: 'createdByName', header: 'Dicatat oleh' },
];

// Prakasa AI may fill the number and the dates of an order's surat jalan or
// invoice; the user reviews them and presses "Simpan surat jalan" / "Simpan
// invoice" (docs/prakasa-ai-rencana.md §9.9). No amount is entered here.
const AI_DELIVERY = defineAIForm({
  id: 'sales-order-delivery', title: 'Surat jalan', permission: 'sales.order.manage', submitLabel: 'Simpan surat jalan', mode: 'edit',
  fields: ({ suggested }) => [
    f.text('number', 'Nomor surat jalan', { required: true, maxLength: 80, hint: `Saran: ${suggested}` }),
    f.date('date', 'Tanggal kirim', { required: true }),
  ],
});
const AI_INVOICE = defineAIForm({
  id: 'sales-order-invoice', title: 'Invoice', permission: 'sales.order.manage', submitLabel: 'Simpan invoice', mode: 'edit',
  fields: ({ suggested }) => [
    f.text('number', 'Nomor invoice', { required: true, maxLength: 80, hint: `Saran: ${suggested}` }),
    f.date('date', 'Tanggal invoice', { required: true }),
    f.date('dueDate', 'Jatuh tempo', { hint: 'Tidak boleh sebelum tanggal invoice. Kosongkan bila tidak ada jatuh tempo.' }),
  ],
});
// The values the dialog opens with.
const documentValues = (kind, order, suggested) => ({
  number: (kind === 'DO' ? order.doNumbers : order.invoiceNumbers) || suggested,
  date: (kind === 'DO' ? order.doDate : order.invoiceDate) ? String(kind === 'DO' ? order.doDate : order.invoiceDate).slice(0, 10) : todayIso(),
  dueDate: order.dueDate ? String(order.dueDate).slice(0, 10) : '',
});

// Surat jalan (DO) or invoice (SI) number + date for the whole order.
function DocumentModal({ open, kind, order, suggested, onClose, onSaved }) {
  const [form, setForm] = useState({ number: '', date: todayIso(), dueDate: '' });
  const [errors, setErrors] = useState({});
  const [terms, setTerms] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(documentValues(kind, order, suggested));
    if (kind === 'SI') {
      api.get('/sales/document-settings').then((r) => setTerms(r.data.data.paymentTermsDays ?? null)).catch(() => setTerms(null));
    }
  }, [open, kind, order, suggested]);
  // Jatuh tempo follows the invoice date + payment terms until changed by hand.
  const [dueTouched, setDueTouched] = useState(false);
  useEffect(() => { if (open) setDueTouched(Boolean(order.dueDate)); }, [open, order.dueDate]);
  useEffect(() => {
    if (kind !== 'SI' || dueTouched || terms === null) return;
    setForm((f) => ({ ...f, dueDate: addTerms(f.date, terms) || '' }));
  }, [kind, dueTouched, terms, form.date]);
  const set = (k) => (e) => { setForm((current) => ({ ...current, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  // Jatuh tempo set by the form itself (invoice date + terms) is not the user's
  // typing: until someone changes it, the AI may still set it.
  const opened = useMemo(() => documentValues(kind, order, suggested), [kind, order, suggested]);
  const ai = usePrakasaAIForm(kind === 'DO' ? AI_DELIVERY : AI_INVOICE, {
    enabled: open && (kind === 'DO' || kind === 'SI'),
    record: { type: 'sales_order', id: order.id },
    values: form,
    setValues: setForm,
    setters: { dueDate: (value) => { setDueTouched(true); setForm((current) => ({ ...current, dueDate: value })); } },
    setErrors,
    validate: (next) => (kind === 'SI' && next.dueDate && next.date && next.dueDate < next.date ? { dueDate: 'Jatuh tempo tidak boleh sebelum tanggal invoice.' } : {}),
    initialValues: dueTouched ? opened : { ...opened, dueDate: form.dueDate },
    context: { suggested },
  });
  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.number.trim()) next.number = `Isi nomor ${kind === 'DO' ? 'surat jalan' : 'invoice'}`;
    if (!form.date) next.date = 'Isi tanggal';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await api.post(`/sales/orders/${order.id}/${kind === 'DO' ? 'delivery' : 'invoice'}`, {
        number: form.number.trim() || undefined, date: form.date,
        ...(kind === 'SI' ? { dueDate: form.dueDate || null } : {}),
      });
      salesChanged();
      toast(kind === 'DO' ? 'Surat jalan disimpan' : 'Invoice disimpan', 'success');
      onSaved();
      onClose();
    } catch (err) {
      const fields = fieldErrorsFromApi(err);
      if (Object.keys(fields).length) setErrors(fields);
      else toast(apiError(err, kind === 'DO' ? 'Surat jalan gagal disimpan' : 'Invoice gagal disimpan'), 'error');
    } finally { setSaving(false); }
  };
  const label = kind === 'DO' ? 'surat jalan' : 'invoice';
  return (
    <Modal open={open} onClose={onClose} title={kind === 'DO' ? 'Surat jalan' : 'Invoice'} size="sm">
      <form className="pw-stack" onSubmit={submit} noValidate>
        {ai.notice}
        <Input label={`Nomor ${label}`} value={form.number} {...ai.field('number')} onChange={set('number')} hint={`Saran: ${suggested}`} required error={errors.number} mono />
        <DateInput label={kind === 'DO' ? 'Tanggal kirim' : 'Tanggal invoice'} value={form.date} {...ai.field('date')} onChange={set('date')} required error={errors.date} />
        {kind === 'SI' ? (
          <DateInput
            label="Jatuh tempo"
            value={form.dueDate}
            {...ai.field('dueDate')}
            min={form.date}
            onChange={(e) => { setDueTouched(true); set('dueDate')(e); }}
            hint={terms !== null ? `Otomatis ${terms} hari dari tanggal invoice; boleh diubah` : 'Kosongkan bila tidak ada jatuh tempo'}
            error={errors.dueDate}
          />
        ) : null}
        <FormActions>
          <Button variant="text" type="button" onClick={onClose}>Batal</Button>
          <Button type="submit" loading={saving}>Simpan {label}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}

function PaymentModal({ open, order, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setErrors({});
      setForm({ amount: String(Number(order.outstandingAmount) || ''), paidAt: todayIso(), method: 'Transfer', note: '' });
    }
  }, [open, order]);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!(Number(form.amount) > 0)) next.amount = 'Isi jumlah lebih dari 0';
    if (!form.paidAt) next.paidAt = 'Isi tanggal bayar';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await api.post(`/sales/orders/${order.id}/payments`, {
        amount: Number(form.amount), paidAt: form.paidAt, method: form.method || null, note: form.note || null,
      });
      toast('Pembayaran dicatat', 'success');
      salesChanged();
      onSaved();
      onClose();
    } catch (err) {
      const fields = fieldErrorsFromApi(err);
      if (Object.keys(fields).length) setErrors(fields);
      else toast(apiError(err, 'Pembayaran gagal disimpan'), 'error');
    } finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Catat pembayaran" size="sm">
      <form className="pw-stack" onSubmit={submit} noValidate>
        <Input label="Jumlah" type="number" min="0" step="any" value={form.amount || ''} onChange={set('amount')} hint={`Sisa piutang ${formatRupiah(order.outstandingAmount)}`} required error={errors.amount} />
        <DateInput label="Tanggal bayar" value={form.paidAt || ''} onChange={set('paidAt')} required error={errors.paidAt} />
        <Input label="Metode" value={form.method || ''} onChange={set('method')} placeholder="mis. Transfer, Tunai, Giro" error={errors.method} />
        <Input label="Catatan" value={form.note || ''} onChange={set('note')} error={errors.note} />
        <FormActions>
          <Button variant="text" type="button" onClick={onClose}>Batal</Button>
          <Button type="submit" loading={saving}>Simpan pembayaran</Button>
        </FormActions>
      </form>
    </Modal>
  );
}

export default function SalesOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const canManage = (user?.permissions || []).includes('sales.order.manage');
  const accurate = useAccurateSource();
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [modal, setModal] = useState('');

  // Arriving from "Perlu tindakan": open the dialog that resolves it.
  useEffect(() => {
    const aksi = params.get('aksi');
    if (!aksi || !state.data || !canManage || accurate) return;
    const open = { 'surat-jalan': 'DO', invoice: 'SI', bayar: 'pay' }[aksi];
    // One `modal` for the delivery, invoice and payment dialogs: an unsaved one is never replaced by a link.
    if (open && !hasUnsavedForm()) setModal(open);
    setParams((p) => { const next = new URLSearchParams(p); next.delete('aksi'); return next; }, { replace: true });
  }, [params, state.data, canManage, accurate, setParams]);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/sales/orders/${id}`);
      setState({ loading: false, error: '', data: r.data.data });
    } catch (err) {
      setState({ loading: false, error: apiError(err, 'Sales order tidak ditemukan'), data: null });
    }
  }, [id]);
  useEffect(() => { setState({ loading: true, error: '', data: null }); load(); }, [load]);
  const retry = () => { setState({ loading: true, error: '', data: null }); load(); };

  const cancel = async () => {
    setCancelling(true);
    try {
      await api.delete(`/sales/orders/${id}`);
      toast('Sales order dibatalkan', 'success');
      salesChanged();
      navigate('/sales/orders');
    } catch (err) {
      toast(apiError(err, 'Sales order gagal dibatalkan'), 'error');
    } finally { setCancelling(false); }
  };

  if (state.loading) return <Page><LoadingState label="Memuat sales order…" /></Page>;
  if (state.error) {
    return (
      <Page>
        <EmptyState tone="error" title="Sales order belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={retry}>Coba lagi</Button>} />
      </Page>
    );
  }
  const { order, lines, payments, suggested } = state.data;
  const unpaid = Number(order.outstandingAmount) > 0;
  const manage = canManage && !accurate;
  // Where the order stands: paid, and the paperwork still missing.
  const pending = [
    !order.doNumbers ? 'belum ada surat jalan' : null,
    !order.invoiceNumbers ? 'belum ditagih' : null,
  ].filter(Boolean);
  const menu = manage ? [
    order.editable ? { label: 'Ubah sales order', icon: 'edit', onClick: () => navigate(`/sales/orders/${order.id}/edit`) } : null,
    order.customerId ? { label: 'Order lagi', icon: 'repeat', onClick: () => navigate(`/sales/orders/new?customer=${order.customerId}&dari=${order.id}`) } : null,
    order.cancellable ? { divider: true, key: 'cancel-divider' } : null,
    order.cancellable ? { label: 'Batalkan sales order', icon: 'cancel', tone: 'danger', onClick: () => setModal('cancel') } : null,
  ].filter(Boolean) : [];

  return (
    <Page>
      <PageHeader
        eyebrow="Sales order"
        dataTitle
        title={order.orderNumber}
        description={(
          <span className="pw-row">
            {order.daysOverdue
              ? <StatusBadge status="overdue" label={`Terlambat bayar ${order.daysOverdue} hari`} />
              : <StatusBadge status={`so_${orderBillingStatus(order)}`} label={orderBillingText(order)} />}
            <span>
              <Mixed parts={[data(order.customerName), data(order.channel), order.transactionDate ? formatDate(order.transactionDate) : null, ...pending]} />
            </span>
          </span>
        )}
        actions={manage ? (
          <>
            <Button variant="secondary" icon="local_shipping" onClick={() => setModal('DO')}>{order.doNumbers ? 'Ubah surat jalan' : 'Buat surat jalan'}</Button>
            <Button variant="secondary" icon="description" onClick={() => setModal('SI')}>{order.invoiceNumbers ? 'Ubah invoice' : 'Buat invoice'}</Button>
            {unpaid ? <Button icon="payments" onClick={() => setModal('pay')}>Catat pembayaran</Button> : null}
            <ActionMenu items={menu} />
          </>
        ) : null}
      />
      {accurate ? (
        <Banner tone="info">Dicatat di Accurate: surat jalan, invoice, dan pembayaran diperbarui dari sana.</Banner>
      ) : null}
      <AccurateHoldBanner />

      <div className="pw-cols-sidebar">
        <div className="pw-stack pw-stack--lg">
          <DataGrid title={`Barang (${lines.length})`} columns={LINE_COLUMNS} rows={lines} idKey="lineNo" exportName={`so-${order.orderNumber}`} searchable={false} />
          <DataGrid
            title={`Pembayaran (${payments.length})`}
            columns={PAYMENT_COLUMNS}
            rows={payments}
            rowActions={accurate ? undefined : (p) => (
              <IconButton size="sm" icon="print" label="Cetak kwitansi" href={`/print/sales/receipt/${order.id}?payment=${p.id}`} target="_blank" rel="noreferrer" />
            )}
            exportName={`pembayaran-${order.orderNumber}`}
            searchable={false}
            empty={Number(order.settledAmount) > 0 ? 'Pembayaran sebelum aplikasi ini dipakai tidak tercatat rinci' : 'Belum ada pembayaran'}
          />
        </div>
        <aside className="pw-stack pw-stack--lg">
          {accurate ? null : (
            <Card title="Cetak dokumen" subtitle="Terbuka di tab baru; pilih “Simpan sebagai PDF” di dialog cetak untuk menyimpan file.">
              <div className="pw-row">
                <Button variant="secondary" icon="print" href={`/print/sales/so/${order.id}`} target="_blank" rel="noreferrer">Sales order</Button>
                {order.doNumbers
                  ? <Button variant="secondary" icon="print" href={`/print/sales/do/${order.id}`} target="_blank" rel="noreferrer">Surat jalan</Button>
                  : <Button variant="secondary" icon="print" disabled tooltip="Buat surat jalan dulu">Surat jalan</Button>}
                {order.invoiceNumbers
                  ? <Button variant="secondary" icon="print" href={`/print/sales/invoice/${order.id}`} target="_blank" rel="noreferrer">Invoice</Button>
                  : <Button variant="secondary" icon="print" disabled tooltip="Buat invoice dulu">Invoice</Button>}
              </div>
            </Card>
          )}
          <Card title="Ringkasan">
            <KeyValue items={[
              { label: 'Pelanggan', value: order.customerId ? <Link data-no-translate="" to={`/sales/customers/${order.customerId}`}>{order.customerName}</Link> : order.customerName },
              { label: 'ID pelanggan', value: order.customerCode },
              { label: 'Sales', value: order.salesPersonName },
              { label: 'Tanggal order', value: order.orderDate ? formatDate(order.orderDate) : null },
              { label: 'ETD / kirim', value: order.deliveryDate ? formatDate(order.deliveryDate) : null },
              { label: 'Surat jalan', value: order.doNumbers ? <Mixed parts={[data(order.doNumbers), order.doDate ? formatDate(order.doDate) : null]} /> : null },
              { label: 'Invoice', value: order.invoiceNumbers ? <Mixed parts={[data(order.invoiceNumbers), order.invoiceDate ? formatDate(order.invoiceDate) : null]} /> : null },
              {
                label: 'Jatuh tempo',
                value: order.dueDate ? (
                  <span className="pw-row">
                    <span>{formatDate(order.dueDate)}</span>
                    {order.daysOverdue ? <StatusBadge status="overdue" label={`Terlambat ${order.daysOverdue} hari`} /> : null}
                  </span>
                ) : null,
              },
              { label: 'Catatan', value: order.notes },
            ]}
            />
          </Card>
          <Card title="Nilai">
            <div className="pw-stack">
              <KeyValue items={[
                { label: 'Subtotal', value: formatRupiah(order.subtotal) },
                { label: 'Ongkos kirim', value: formatRupiah(order.deliveryFee) },
                { label: 'Total', value: <span className="pw-strong">{formatRupiah(order.totalAmount)}</span> },
                { label: 'PPN (dicatat)', value: formatRupiah(order.taxAmount) },
                { label: 'DPP / omzet (sebelum PPN)', value: formatRupiah(order.dppAmount) },
                { label: 'Sudah dibayar', value: formatRupiah(order.settledAmount) },
                { label: 'Piutang', value: formatRupiah(order.outstandingAmount) },
              ]}
              />
              <p className="pw-text-helper">
                {order.source === 'import' ? 'Data awal (impor).' : (order.createdByName ? `Dibuat ${formatDateTime(order.createdAt)} oleh ${order.createdByName}.` : `Dibuat ${formatDateTime(order.createdAt)}.`)}
                {!order.editable ? ' Sudah ditagih atau dibayar, jadi barang dan nilainya terkunci.' : ''}
              </p>
            </div>
          </Card>
        </aside>
      </div>

      <DocumentModal open={modal === 'DO'} kind="DO" order={order} suggested={suggested.doNumber} onClose={() => setModal('')} onSaved={load} />
      <DocumentModal open={modal === 'SI'} kind="SI" order={order} suggested={suggested.invoiceNumber} onClose={() => setModal('')} onSaved={load} />
      <PaymentModal open={modal === 'pay'} order={order} onClose={() => setModal('')} onSaved={load} />
      <ConfirmDialog
        open={modal === 'cancel'}
        title="Batalkan sales order?"
        message={`Sales order ${order.orderNumber} (${formatRupiah(order.totalAmount)}) akan dibatalkan dan tidak dihitung lagi di omzet maupun status pelanggan.`}
        confirmLabel="Batalkan sales order"
        tone="danger"
        loading={cancelling}
        onConfirm={cancel}
        onClose={() => { if (!cancelling) setModal(''); }}
      />
    </Page>
  );
}
