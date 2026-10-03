import { Context } from '../../i18n/NoTranslate';
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import DateInput from '../../components/DateInput';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { AccurateNotice } from './WarehouseMovements';
import {
  MOVEMENT_TYPE_COPY,
  emptyMovementItem,
  formFromMovement,
  formatQuantity,
  movementAiErrors,
  movementFieldErrors,
  movementPayload,
  movementValidationSummary,
  normalizeMovementItem,
  todayLocal,
} from './warehouseMovementModel';
import './warehouse-movements.css';

// Item rows become one-at-a-time cards below desktop (§1.9 compact and phone):
// the 8-column row editor needs the desktop width to stay readable.
const COMPACT_QUERY = '(max-width: 1023px)';

function useIsCompact() {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(COMPACT_QUERY);
    const onChange = () => setCompact(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return compact;
}

const blankForm = () => ({ movementDate: todayLocal(), referenceNo: '', party: '', notes: '', items: [emptyMovementItem()] });
const snapshot = (form) => JSON.stringify(movementPayload(form));
const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

// Instructions live in the header row (desktop) or in `hint` (cards); a
// placeholder only shows an example value.
const ITEM_FIELDS = [
  { key: 'sku', label: 'Kode barang Accurate', placeholder: 'MKR-002', hint: 'Wajib untuk pencocokan dengan Accurate.' },
  { key: 'product', label: 'Produk', placeholder: 'Nama barang', required: true },
  { key: 'quantity', label: 'Jumlah', translateContext: 'quantity', placeholder: '0', required: true, inputMode: 'decimal' },
  { key: 'unit', label: 'Satuan', placeholder: 'Pcs', required: true, hint: 'Seperti di Accurate (Pcs, Ctns).' },
  { key: 'batchNo', label: 'Batch' },
  { key: 'expiresOn', label: 'Kedaluwarsa', translateContext: 'expiry', type: 'date' },
  { key: 'location', label: 'Lokasi', placeholder: 'Rak A1' },
  { key: 'note', label: 'Catatan' },
];

// Prakasa AI may fill the document and add item rows; the user reviews, types
// the counted quantities and presses "Simpan draft" (docs/prakasa-ai-rencana.md
// §9.9). Quantity is the physical count: the user's only. There are no prices
// on this form. Product, code and unit are free text here (the page has no
// product search), so they are text columns, not a lookup.
const MAX_AI_ROWS = 50;
const aiMovementFields = ({ copy }) => [
  f.date('movementDate', 'Tanggal transaksi', { required: true }),
  f.text('referenceNo', 'Nomor referensi', { maxLength: 80, hint: 'No. dokumen Accurate, SJ pemasok, PO atau SO.' }),
  f.text('party', copy?.partyLabel || 'Pihak', { maxLength: 255, hint: copy?.partyPlaceholder }),
  f.rows('items', 'Barang', [
    f.text('sku', 'Kode barang Accurate', { maxLength: 80, hint: 'Wajib untuk pencocokan dengan Accurate.' }),
    f.text('product', 'Produk', { required: true, maxLength: 190 }),
    f.userOnly('quantity', 'Jumlah', 'number', { required: true, hint: 'Hasil hitung fisik, diisi pengguna.' }),
    f.text('unit', 'Satuan', { required: true, maxLength: 40, hint: 'Seperti di Accurate (Pcs, Ctns).' }),
    f.text('batchNo', 'Batch', { maxLength: 80 }),
    f.date('expiresOn', 'Kedaluwarsa'),
    f.text('location', 'Lokasi', { maxLength: 120 }),
    f.text('note', 'Catatan', { maxLength: 500 }),
  ], { required: true, maxRows: MAX_AI_ROWS, emptyRow: emptyMovementItem }),
  f.textarea('notes', 'Catatan', { maxLength: 5000, hint: 'Kondisi barang, lampiran yang dicek, atau informasi untuk Supervisor.' }),
];
const AI_MOVEMENT_NEW = defineAIForm({
  id: ({ type }) => `warehouse-movement-${type}`,
  title: ({ copy }) => (copy ? `Buat ${copy.label.toLowerCase()}` : 'Pergerakan barang'),
  permission: 'warehouse.movement.create',
  submitLabel: 'Simpan draft',
  fields: aiMovementFields,
});
const AI_MOVEMENT_EDIT = defineAIForm({
  id: ({ type }) => `warehouse-movement-${type}-edit`,
  title: ({ copy }) => (copy ? `Ubah draft ${copy.label.toLowerCase()}` : 'Pergerakan barang'),
  permission: 'warehouse.movement.update',
  submitLabel: 'Simpan draft',
  mode: 'edit',
  fields: aiMovementFields,
});

// "Buat barang masuk/keluar" and "Ubah draft" (routes …/new and …/:id/edit):
// a long form, so the whole route is the admin console's full-screen dialog
// (§3.3). Closing it leaves for the list or the detail, asking first when
// something is unsaved.
export default function WarehouseMovementForm() {
  const { type, id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const compact = useIsCompact();
  const copy = MOVEMENT_TYPE_COPY[type];
  const permissions = user?.permissions || [];
  const formId = useId();

  const [searchParams] = useSearchParams();
  const location = useLocation();
  // "Catat sekarang" from the Accurate reconciliation: the document number as the
  // reference and its items (no quantity — that is the physical count).
  const [form, setForm] = useState(() => {
    const base = blankForm();
    if (editing) return base;
    const ref = (searchParams.get('ref') || '').slice(0, 80);
    const items = (location.state?.reconItems || []).slice(0, 200).map((l) => ({ ...emptyMovementItem(), sku: l.sku || '', product: l.product || '', unit: l.unit || '' }));
    return { ...base, referenceNo: ref, items: items.length ? items : base.items };
  });
  const [baseline, setBaseline] = useState(() => snapshot(blankForm()));
  // What Prakasa AI treats as "not typed by the user": the form as it opened, or the loaded draft.
  const [aiInitial, setAiInitial] = useState(form);
  const [version, setVersion] = useState(null);
  const [loadState, setLoadState] = useState({ loading: editing, error: '', locked: '' });
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState('');
  const [conflict, setConflict] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [activeItem, setActiveItem] = useState(0);
  const summaryRef = useRef(null);

  const loadMovement = async () => {
    setLoadState({ loading: true, error: '', locked: '' });
    try {
      const response = await api.get(`/warehouse/movements/${type}/${id}`);
      const movement = response.data.data;
      const next = formFromMovement(movement);
      setForm(next);
      setAiInitial(next);
      setBaseline(snapshot(next));
      setVersion(movement.version);
      setConflict(false);
      setActiveItem(0);
      setLoadState({
        loading: false,
        error: '',
        locked: movement.permissions?.canEdit ? '' : 'Pergerakan ini tidak dapat diubah pada status saat ini.',
      });
    } catch (error) {
      setLoadState({ loading: false, error: errorMessage(error, 'Pergerakan tidak dapat dimuat.'), locked: '' });
    }
  };

  useEffect(() => {
    if (editing) loadMovement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id]);

  const dirty = snapshot(form) !== baseline;
  const messages = useMemo(() => movementValidationSummary(form), [form]);
  const fieldErrors = useMemo(() => (showErrors ? movementFieldErrors(form) : { items: [] }), [form, showErrors]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setItem = (index, key, value) => setForm((current) => ({
    ...current,
    items: current.items.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)),
  }));
  const addItem = () => {
    setForm((current) => ({ ...current, items: [...current.items, emptyMovementItem()] }));
    setActiveItem(form.items.length);
  };
  const removeItem = (index) => {
    setForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }));
    setActiveItem((current) => Math.max(0, Math.min(current, form.items.length - 2)));
  };

  const persist = async () => {
    const payload = movementPayload(form);
    if (editing) {
      const response = await api.patch(`/warehouse/movements/${type}/${id}`, { ...payload, version });
      return response.data.data;
    }
    const response = await api.post('/warehouse/movements', { type, ...payload });
    return response.data.data;
  };

  const save = async (andSubmit) => {
    if (messages.length) {
      setShowErrors(true);
      window.requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setSaving(andSubmit ? 'submit' : 'draft');
    try {
      const saved = await persist();
      setBaseline(snapshot(form));
      setVersion(saved.version);
      if (andSubmit) {
        try {
          await api.post(`/warehouse/movements/${type}/${saved.id}/submit`, { version: saved.version });
          toast('Pergerakan diajukan ke Warehouse Supervisor', 'success');
        } catch (submitError) {
          // The draft is saved; open it so a retry submits this record instead of creating another.
          toast(`Draft tersimpan, tetapi belum diajukan: ${errorMessage(submitError, 'pengajuan gagal')}`, 'error');
        }
      } else {
        toast('Draft tersimpan', 'success');
      }
      navigate(`/warehouse/movements/${type}/${saved.id}`, { replace: true });
    } catch (error) {
      if (error.response?.data?.error?.code === 'VERSION_CONFLICT') setConflict(true);
      toast(errorMessage(error, 'Pergerakan gagal disimpan'), 'error');
    } finally {
      setSaving('');
    }
  };

  const leaveTo = editing ? `/warehouse/movements/${type}/${id}` : `/warehouse?tab=${type}`;
  const leave = () => {
    setLeaveOpen(false);
    navigate(leaveTo);
  };
  // X and Escape ask through the dialog's own `dirty` guard; Batal asks the
  // same question here, in the same words.
  const requestLeave = () => (dirty ? setLeaveOpen(true) : leave());

  const title = copy ? (editing ? `Ubah draft ${copy.label.toLowerCase()}` : `Buat ${copy.label.toLowerCase()}`) : 'Pergerakan barang';
  // Whatever keeps the form from opening still shows inside the dialog.
  const blocker = (() => {
    if (!copy) return { title: 'Jenis pergerakan tidak dikenal', description: 'Buka formulir dari daftar Barang masuk atau Barang keluar.' };
    if (!permissions.includes(editing ? 'warehouse.movement.update' : 'warehouse.movement.create')) {
      return { title: 'Anda tidak memiliki izin untuk halaman ini' };
    }
    if (loadState.error) {
      return { title: 'Pergerakan tidak dapat dibuka', description: loadState.error, action: <Button variant="secondary" icon="refresh" onClick={loadMovement}>Coba lagi</Button> };
    }
    if (loadState.locked) {
      return { title: 'Tidak dapat diubah', description: loadState.locked, action: <Button variant="secondary" onClick={() => navigate(`/warehouse/movements/${type}/${id}`)}>Buka detail</Button> };
    }
    return null;
  })();

  const ai = usePrakasaAIForm(editing ? AI_MOVEMENT_EDIT : AI_MOVEMENT_NEW, {
    enabled: Boolean(copy) && !blocker && !loadState.loading,
    record: { type: 'warehouse_movement', id },
    values: form,
    setValues: setForm,
    initialValues: aiInitial,
    context: { type, copy },
    validate: movementAiErrors,
  });

  if (blocker || loadState.loading) {
    return (
      <FullScreenDialog open asPage title={title} onClose={() => navigate(leaveTo)} card={false}>
        {loadState.loading && !blocker ? <LoadingState label="Memuat pergerakan…" /> : (
          <EmptyState tone="error" title={blocker.title} description={blocker.description} action={blocker.action} />
        )}
      </FullScreenDialog>
    );
  }

  const itemCount = form.items.length;
  const currentIndex = Math.min(activeItem, itemCount - 1);
  const totalUnits = form.items.reduce((sum, item) => sum + (normalizeMovementItem(item).quantity || 0), 0);

  // Desktop rows share one header row, so each field carries an aria-label;
  // the compact card shows one item at a time with visible labels and hints.
  const itemInputs = (item, index, withLabel) => ITEM_FIELDS.map((field) => {
    const Field = field.type === 'date' ? DateInput : Input;
    // The context names an ambiguous label ("Jumlah" = Quantity here).
    const Wrap = field.translateContext ? Context : Fragment;
    const wrapProps = field.translateContext ? { name: field.translateContext } : {};
    return (
      <Wrap key={field.key} {...wrapProps}>
      <Field
        fieldClassName={`wm-item__field wm-item__field--${field.key}`}
        label={withLabel ? field.label : undefined}
        required={withLabel && field.required}
        hint={withLabel ? field.hint : undefined}
        error={fieldErrors.items[index]?.[field.key]}
        type={field.type === 'date' ? undefined : 'text'}
        inputMode={field.inputMode}
        value={item[field.key]}
        placeholder={field.placeholder}
        {...(field.key === 'product' ? ai.row('items', index) : {})}
        onChange={(event) => setItem(index, field.key, event.target.value)}
        aria-label={withLabel ? undefined : `${field.label} baris ${index + 1}`}
      />
      </Wrap>
    );
  });

  return (
    <>
      <FullScreenDialog
        open
        asPage
        title={title}
        onClose={leave}
        dirty={dirty}
        card={false}
        actions={(
          <>
            <Button type="button" variant="text" onClick={requestLeave}>Batal</Button>
            <Button type="submit" form={formId} variant="secondary" icon="save" loading={saving === 'draft'} disabled={Boolean(saving)}>
              Simpan draft
            </Button>
            {permissions.includes('warehouse.movement.submit') && (
              <Button type="button" icon="send" loading={saving === 'submit'} disabled={Boolean(saving)} onClick={() => save(true)}>
                Simpan &amp; ajukan
              </Button>
            )}
          </>
        )}
      >
        {conflict ? (
          <Banner
            tone="error"
            title="Data ini sudah diubah orang lain sejak Anda membukanya"
            action={<Button variant="text" icon="refresh" onClick={loadMovement}>Muat versi terbaru</Button>}
          >
            Muat versi terbaru untuk melanjutkan; perubahan Anda di layar ini akan diganti.
          </Banner>
        ) : null}

        <form id={formId} className="wm-form" onSubmit={(event) => { event.preventDefault(); save(false); }} noValidate>
          {ai.notice}
          <FullScreenSection title="Informasi transaksi">
            <div className="pw-fsdialog__fields">
              <DateInput label="Tanggal transaksi" required value={form.movementDate} error={fieldErrors.movementDate} {...ai.field('movementDate')} onChange={(event) => setField('movementDate', event.target.value)} />
              <Input
                label="Nomor referensi"
                value={form.referenceNo}
                maxLength={80}
                hint="No. dokumen Accurate, SJ pemasok, PO atau SO. Tanpa referensi, Supervisor harus memasangkannya manual."
                {...ai.field('referenceNo')}
                onChange={(event) => setField('referenceNo', event.target.value)}
              />
              <Input label={copy.partyLabel} value={form.party} maxLength={255} placeholder={copy.partyPlaceholder} hint={copy.partyHint} {...ai.field('party')} onChange={(event) => setField('party', event.target.value)} />
            </div>
          </FullScreenSection>

          <FullScreenSection title={`Barang (${itemCount})`}>
            {compact ? (
              <div className="pw-stack">
                <div className="pw-row pw-row--between pw-row--nowrap">
                  <IconButton label="Barang sebelumnya" icon="chevron_left" disabled={currentIndex <= 0} onClick={() => setActiveItem(currentIndex - 1)} />
                  <span className="pw-strong" aria-live="polite">Barang {currentIndex + 1} dari {itemCount}</span>
                  <div className="pw-row pw-row--nowrap">
                    <IconButton label="Barang berikutnya" icon="chevron_right" disabled={currentIndex >= itemCount - 1} onClick={() => setActiveItem(currentIndex + 1)} />
                    <IconButton label="Hapus barang ini" icon="delete" tone="danger" disabled={itemCount <= 1} onClick={() => removeItem(currentIndex)} />
                  </div>
                </div>
                <div className={ai.rowClass('items', currentIndex, 'wm-item wm-item--card')}>{itemInputs(form.items[currentIndex], currentIndex, true)}</div>
              </div>
            ) : (
              <div className="wm-items-edit">
                <div className="wm-items-edit__head" aria-hidden="true">
                  {ITEM_FIELDS.map((field) => <span key={field.key} data-i18n-context={field.translateContext}>{field.label}{field.required ? ' *' : ''}</span>)}
                  <span />
                </div>
                {form.items.map((item, index) => (
                  <div className={ai.rowClass('items', index, 'wm-item')} key={item.key}>
                    {itemInputs(item, index, false)}
                    <IconButton
                      label={`Hapus barang baris ${index + 1}`}
                      icon="delete"
                      tone="danger"
                      size="sm"
                      disabled={itemCount <= 1}
                      onClick={() => removeItem(index)}
                    />
                  </div>
                ))}
                <div className="pw-text-helper">Kode barang Accurate wajib untuk pencocokan; satuan ditulis seperti di Accurate (Pcs, Ctns).</div>
              </div>
            )}
            <div>
              <Button type="button" variant="text" icon="add" onClick={addItem}>Tambah barang</Button>
            </div>
          </FullScreenSection>

          <FullScreenSection title="Catatan dan ringkasan">
            <Textarea
              label="Catatan"
              rows={3}
              value={form.notes}
              hint="Kondisi barang, lampiran yang dicek, atau informasi untuk Supervisor."
              {...ai.field('notes')}
              onChange={(event) => setField('notes', event.target.value)}
            />
            <KeyValue
              columns={2}
              items={[
                { label: 'Jenis', value: copy.label, translate: true },
                { label: 'Jumlah baris', value: itemCount },
                { label: 'Total kuantitas', value: formatQuantity(totalUnits) },
                { label: 'Setelah diajukan', value: 'Direview Warehouse Supervisor', translate: true },
              ]}
            />
            {showErrors && messages.length > 0 ? (
              <div ref={summaryRef} tabIndex={-1} className="wm-summary">
                <Banner tone="error" title={`Periksa ${messages.length} hal berikut sebelum menyimpan`}>
                  <span className="wm-summary__list">{messages.join(' · ')}</span>
                </Banner>
              </div>
            ) : null}
            <AccurateNotice />
          </FullScreenSection>
        </form>
      </FullScreenDialog>

      <ConfirmDialog
        open={leaveOpen}
        title="Buang perubahan?"
        message="Perubahan yang belum disimpan akan hilang."
        confirmLabel="Buang"
        cancelLabel="Lanjutkan mengisi"
        tone="danger"
        onConfirm={leave}
        onClose={() => setLeaveOpen(false)}
      />
    </>
  );
}
