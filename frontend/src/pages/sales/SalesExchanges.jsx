import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import ConfirmDialog from '../../components/ConfirmDialog';
import DateInput from '../../components/DateInput';
import FormActions from '../../components/FormActions';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDate } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import useSalesList from './useSalesList';
import {
  apiError, formatRupiah, splitServerErrors, todayIso,
} from './salesModel';
import { EXCHANGE_FILTERS, exchangeBody, exchangeChipLabel, exchangeParts, exchangeText, isDueForExchange } from './salesExchangeModel';
import { NoTranslate, Translate } from '../../i18n/NoTranslate';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';

// "Tukar 29 Sep · TT-12 · janji bayar 15 Okt": the tanda terima number is typed
// by the user and stays data; the rest is interface text.
const exchangeCell = (r) => exchangeParts(r.exchange, formatDate).map((part, index) => (
  <span key={part.text}>{index ? ' · ' : ''}{part.data ? part.text : <Translate>{part.text}</Translate>}</span>
));

// Prakasa AI may fill the tukar faktur record (dates, tanda terima number,
// note); the user reviews it and presses "Catat tukar faktur" / "Simpan
// perubahan" (docs/prakasa-ai-rencana.md §9.9). The invoice itself is the row's.
const exchangeFields = [
  f.date('exchangedOn', 'Tanggal tukar faktur', { required: true }),
  f.text('receiptNo', 'No. tanda terima', { maxLength: 80 }),
  f.date('promisedPayDate', 'Janji bayar', { hint: 'Tidak boleh sebelum tanggal tukar faktur.' }),
  f.textarea('note', 'Catatan', { maxLength: 255 }),
];
const AI_EXCHANGE = defineAIForm({
  id: 'sales-exchange', title: 'Tukar faktur', permission: 'sales.order.manage', submitLabel: 'Catat tukar faktur', fields: exchangeFields,
});
const AI_EXCHANGE_EDIT = defineAIForm({
  id: 'sales-exchange-edit', title: 'Ubah tukar faktur', permission: 'sales.order.manage', submitLabel: 'Simpan perubahan', mode: 'edit', fields: exchangeFields,
});

// Tukar faktur (program 2.3): Accurate keeps none, so Sales records here when a
// credit invoice was handed to the customer, the tanda terima number and the
// promised pay date. A record is never deleted — cancelling keeps it.
function ExchangeModal({ target, onClose, onSaved }) {
  const editing = Boolean(target?.exchange);
  const [opened] = useState(() => ({
    exchangedOn: target?.exchange?.exchangedOn?.slice?.(0, 10) || todayIso(),
    receiptNo: target?.exchange?.receiptNo || '',
    promisedPayDate: target?.exchange?.promisedPayDate?.slice?.(0, 10) || '',
    note: target?.exchange?.note || '',
  }));
  const [form, setForm] = useState(opened);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const set = (key) => (e) => { setForm((current) => ({ ...current, [key]: e.target.value })); setErrors((x) => ({ ...x, [key]: undefined })); };
  const ai = usePrakasaAIForm(editing ? AI_EXCHANGE_EDIT : AI_EXCHANGE, {
    enabled: Boolean(target),
    record: { type: 'sales_invoice_exchange', id: target?.exchange?.id },
    values: form,
    setValues: setForm,
    setErrors,
    // The form's own rule (salesExchangeModel.exchangeBody).
    validate: (next) => { const { error, field } = exchangeBody(next); return error ? { [field]: error } : {}; },
    initialValues: opened,
  });
  const save = async (e) => {
    e.preventDefault();
    const { body, error, field } = exchangeBody(form);
    if (error) { setErrors({ [field]: error }); return; }
    setBusy(true);
    try {
      if (editing) await api.patch(`/sales/invoice-exchanges/${target.exchange.id}`, body);
      else await api.post('/sales/invoice-exchanges', { ...body, invoiceNumber: target.invoiceNumber });
      toast(editing ? 'Tukar faktur diperbarui' : 'Tukar faktur dicatat', 'success');
      onSaved();
    } catch (err) {
      // invoiceNumber has no field here (it is the row's): it goes to a toast.
      const { fields, message } = splitServerErrors(err, ['exchangedOn', 'receiptNo', 'promisedPayDate', 'note'], { fallback: 'Tukar faktur gagal disimpan' });
      setErrors(fields);
      if (message) toast(message, 'error');
      setBusy(false);
    }
  };
  return (
    <Modal open={Boolean(target)} onClose={onClose} title={target ? `Tukar faktur ${target.invoiceNumber}` : 'Tukar faktur'} size="md">
      {target ? (
        <form className="pw-stack" onSubmit={save} noValidate>
          <p className="pw-text-helper"><NoTranslate>{target.customerName}</NoTranslate> · sisa {formatRupiah(target.outstandingAmount)} · jatuh tempo {formatDate(target.dueDate)}</p>
          {ai.notice}
          <DateInput label="Tanggal tukar faktur" value={form.exchangedOn} {...ai.field('exchangedOn')} onChange={set('exchangedOn')} required error={errors.exchangedOn} />
          <Input label="No. tanda terima" value={form.receiptNo} {...ai.field('receiptNo')} onChange={set('receiptNo')} maxLength={80} error={errors.receiptNo} />
          <DateInput label="Janji bayar" value={form.promisedPayDate} {...ai.field('promisedPayDate')} onChange={set('promisedPayDate')} error={errors.promisedPayDate} />
          <Textarea label="Catatan" value={form.note} {...ai.field('note')} onChange={set('note')} maxLength={255} rows={2} error={errors.note} />
          <FormActions>
            <Button variant="text" type="button" onClick={onClose}>Batal</Button>
            <Button type="submit" loading={busy}>{editing ? 'Simpan perubahan' : 'Catat tukar faktur'}</Button>
          </FormActions>
        </form>
      ) : null}
    </Modal>
  );
}

export default function SalesExchanges() {
  const { user } = useAuth();
  const canRecord = (user?.permissions || []).includes('sales.order.manage');
  const [params] = useSearchParams();
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState(params.get('q') || '');
  const [target, setTarget] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = useSalesList('/sales/invoice-exchanges', { status, q });
  // The dialog opens by URL too (a link, or Prakasa AI's buka_halaman):
  // ?tab=exchange&baru=<no. faktur> records one, &ubah=<no. faktur> changes the
  // record it has. The invoice is looked up in this list (the user's own scope).
  const [wanted, setWanted] = useState(null);
  const want = (edit) => (invoiceNumber) => {
    if (!canRecord) return;
    setStatus(edit ? 'done' : 'pending');
    setQ(invoiceNumber);
    setWanted({ invoiceNumber, edit });
  };
  // One dialog for record and change: an unsaved one is never replaced by a link (keepUnsaved).
  useOpenFromUrl('baru', want(false), { keepUnsaved: true });
  useOpenFromUrl('ubah', want(true), { keepUnsaved: true });
  useEffect(() => {
    if (!wanted) return undefined;
    const row = list.loading ? null : list.rows.find((r) => r.invoiceNumber === wanted.invoiceNumber && Boolean(r.exchange) === wanted.edit);
    if (row) { setTarget(row); setWanted(null); return undefined; }
    // Not in the list (wrong number, or outside the user's scope): stop waiting.
    const timer = setTimeout(() => setWanted(null), 8000);
    return () => clearTimeout(timer);
  }, [wanted, list.loading, list.rows]);
  const cancel = async () => {
    setBusy(true);
    try {
      await api.post(`/sales/invoice-exchanges/${cancelling.exchange.id}/cancel`);
      toast('Tukar faktur dibatalkan', 'success');
      list.reload();
    } catch (err) {
      toast(apiError(err, 'Tukar faktur gagal dibatalkan'), 'error');
    }
    setBusy(false);
    setCancelling(null);
  };
  const columns = [
    { key: 'invoiceNumber', header: 'No. faktur', nowrap: true },
    {
      key: 'date', header: 'Tanggal', translate: true,
      render: (r) => (
        <span className="pw-cell">
          <span className="pw-cell__title pw-nowrap">{formatDate(r.date)}</span>
          {isDueForExchange(r)
            ? <StatusBadge status="overdue" label={`${r.daysSinceInvoice} hari lalu`} />
            : <span className="pw-cell__meta">{`${r.daysSinceInvoice} hari lalu`}</span>}
        </span>
      ),
      exportValue: (r) => r.date,
    },
    {
      key: 'dueDate', header: 'Jatuh tempo', translate: true,
      render: (r) => <span className="pw-cell"><span className="pw-cell__title pw-nowrap">{formatDate(r.dueDate)}</span><span className="pw-cell__meta">{`${r.termDays} hari`}</span></span>,
      exportValue: (r) => r.dueDate,
    },
    {
      key: 'customerName', header: 'Pelanggan',
      render: (r) => <span className="pw-cell"><span data-no-translate="" className="pw-cell__title">{r.customerName}</span><span className="pw-cell__meta">{r.salesPersonName ? `Sales: ${r.salesPersonName}` : r.channel || ''}</span></span>,
      exportValue: (r) => r.customerName,
    },
    { key: 'outstandingAmount', header: 'Sisa', type: 'money' },
    { key: 'exchange', header: 'Tukar faktur', render: exchangeCell, exportValue: (r) => exchangeText(r.exchange, formatDate) },
  ];
  return (
    <div className="pw-stack">
      <DataGrid
        key={status}
        title="Faktur kredit"
        columns={columns}
        rows={list.rows.map((r) => ({ ...r, id: r.invoiceNumber }))}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        onPageChange={list.setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Cari nomor faktur atau pelanggan"
        filters={EXCHANGE_FILTERS.map((f) => (
          <Chip key={f.key} selected={status === f.key} onClick={() => setStatus(f.key)}>{exchangeChipLabel(f.key, list.meta.counts)}</Chip>
        ))}
        exportName={`tukar-faktur-${status}`}
        rowActions={canRecord ? (r) => (r.exchange ? (
          <>
            <IconButton size="sm" icon="edit" label="Ubah tukar faktur" onClick={() => setTarget(r)} />
            <IconButton size="sm" icon="cancel" tone="danger" label="Batalkan tukar faktur" onClick={() => setCancelling(r)} />
          </>
        ) : <IconButton size="sm" icon="task" label="Catat tukar faktur" onClick={() => setTarget(r)} />) : undefined}
        empty={q ? 'Tidak ada faktur yang cocok dengan pencarian' : 'Tidak ada faktur di sini'}
      />
      <p className="pw-text-helper">Faktur kredit dari Accurate (jatuh tempo setelah tanggal faktur) yang masih ada sisanya. Merah: sudah 7 hari atau lebih dan belum ditukar.</p>
      {target ? <ExchangeModal key={target.invoiceNumber} target={target} onClose={() => setTarget(null)} onSaved={() => { setTarget(null); list.reload(); }} /> : null}
      <ConfirmDialog
        open={Boolean(cancelling)}
        tone="danger"
        title="Batalkan tukar faktur?"
        message={cancelling ? `Catatan tukar faktur ${cancelling.invoiceNumber} dibatalkan (tetap tersimpan di riwayat). Faktur kembali ke "Belum tukar faktur".` : ''}
        confirmLabel="Batalkan tukar faktur"
        loading={busy}
        onConfirm={cancel}
        onClose={() => { if (!busy) setCancelling(null); }}
      />
    </div>
  );
}
