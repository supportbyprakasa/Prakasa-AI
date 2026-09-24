import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, Plus, RefreshCw, Save, Send, Trash2 } from 'lucide-react';
import api from '../../api/client';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { AccurateNotice } from './WarehouseMovements';
import {
  MOVEMENT_TYPE_COPY,
  emptyMovementItem,
  formFromMovement,
  formatQuantity,
  movementPayload,
  movementValidationSummary,
  normalizeMovementItem,
  todayLocal,
} from './warehouseMovementModel';
import './warehouse-movements.css';

const MOBILE_QUERY = '(max-width: 760px)';

function useIsMobile() {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setMobile(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

const blankForm = () => ({ movementDate: todayLocal(), referenceNo: '', party: '', notes: '', items: [emptyMovementItem()] });
const snapshot = (form) => JSON.stringify(movementPayload(form));
const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

const ITEM_FIELDS = [
  { key: 'sku', label: 'SKU', placeholder: 'Opsional' },
  { key: 'product', label: 'Produk', placeholder: 'Nama barang', required: true },
  { key: 'quantity', label: 'Jumlah', placeholder: '0', required: true, inputMode: 'decimal' },
  { key: 'unit', label: 'Satuan', placeholder: 'kg, pcs, sak', required: true },
  { key: 'batchNo', label: 'Batch', placeholder: 'Opsional' },
  { key: 'expiresOn', label: 'Kedaluwarsa', type: 'date' },
  { key: 'location', label: 'Lokasi', placeholder: 'Rak / gudang' },
  { key: 'note', label: 'Catatan', placeholder: 'Opsional' },
];

export default function WarehouseMovementForm() {
  const { type, id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const copy = MOVEMENT_TYPE_COPY[type];
  const permissions = user?.permissions || [];

  const [form, setForm] = useState(blankForm);
  const [baseline, setBaseline] = useState(() => snapshot(blankForm()));
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

  const leave = () => {
    const target = editing ? `/warehouse/movements/${type}/${id}` : `/warehouse?tab=${type}`;
    setLeaveOpen(false);
    navigate(target);
  };

  if (!copy) {
    return <div className="wm-state wm-state--error" role="alert"><strong>Jenis pergerakan tidak dikenal.</strong></div>;
  }
  if (!permissions.includes(editing ? 'warehouse.movement.update' : 'warehouse.movement.create')) {
    return <div className="wm-state wm-state--error" role="alert"><strong>Anda tidak memiliki izin untuk halaman ini.</strong></div>;
  }
  if (loadState.loading) return <div className="wm-page"><SkeletonCard lines={4} /><SkeletonCard lines={6} /></div>;
  if (loadState.error || loadState.locked) {
    return (
      <div className="wm-page">
        <div className="wm-state wm-state--error" role="alert">
          <strong>{loadState.error ? 'Pergerakan tidak dapat dibuka' : 'Tidak dapat diubah'}</strong>
          <span>{loadState.error || loadState.locked}</span>
          <Link to={editing ? `/warehouse/movements/${type}/${id}` : '/warehouse'} className="wm-link">Kembali ke detail</Link>
        </div>
      </div>
    );
  }

  const itemCount = form.items.length;
  const current = form.items[Math.min(activeItem, itemCount - 1)];
  const totalUnits = form.items.reduce((sum, item) => sum + (normalizeMovementItem(item).quantity || 0), 0);

  const itemInputs = (item, index) => ITEM_FIELDS.map((field) => (
    <label key={field.key} className={`wm-item__field wm-item__field--${field.key}`}>
      <span className="wm-item__label">{field.label}{field.required ? ' *' : ''}</span>
      <input
        className="pw-field__input"
        type={field.type || 'text'}
        inputMode={field.inputMode}
        value={item[field.key]}
        placeholder={field.placeholder}
        onChange={(event) => setItem(index, field.key, event.target.value)}
        aria-label={`${field.label} baris ${index + 1}`}
      />
    </label>
  ));

  return (
    <div className="wm-page wm-form-page">
      <button type="button" className="wm-back" onClick={() => (dirty ? setLeaveOpen(true) : leave())}>
        <ArrowLeft size={18} aria-hidden="true" /> {editing ? 'Kembali ke detail' : copy.label}
      </button>

      <header className="wm-detail-header">
        <div className="wm-detail-header__title">
          <span className="wm-eyebrow">{copy.label}</span>
          <h1>{editing ? 'Ubah draft' : `Buat ${copy.label.toLowerCase()}`}</h1>
        </div>
      </header>

      {conflict && (
        <div className="wm-conflict" role="alert">
          <AlertCircle size={20} aria-hidden="true" />
          <span>Data ini sudah diubah orang lain sejak Anda membukanya. Muat versi terbaru untuk melanjutkan; perubahan Anda di layar ini akan diganti.</span>
          <Button variant="secondary" onClick={loadMovement}><RefreshCw size={16} aria-hidden="true" /> Muat versi terbaru</Button>
        </div>
      )}

      <form className="wm-form" onSubmit={(event) => { event.preventDefault(); save(false); }} noValidate>
        <section className="wm-card" aria-labelledby="wm-step-1">
          <h2 id="wm-step-1"><span className="wm-step">1</span> Informasi transaksi</h2>
          <div className="wm-form-grid">
            <label className="pw-field">
              <span className="pw-field__label">Tanggal transaksi *</span>
              <input className="pw-field__input" type="date" value={form.movementDate} onChange={(event) => setField('movementDate', event.target.value)} required />
            </label>
            <label className="pw-field">
              <span className="pw-field__label">Nomor referensi</span>
              <input className="pw-field__input" value={form.referenceNo} maxLength={80} placeholder="PO, surat jalan, atau DO" onChange={(event) => setField('referenceNo', event.target.value)} />
            </label>
            <label className="pw-field">
              <span className="pw-field__label">{copy.partyLabel}</span>
              <input className="pw-field__input" value={form.party} maxLength={255} placeholder={copy.partyPlaceholder} onChange={(event) => setField('party', event.target.value)} />
            </label>
          </div>
        </section>

        <section className="wm-card" aria-labelledby="wm-step-2">
          <div className="wm-card__header">
            <h2 id="wm-step-2"><span className="wm-step">2</span> Barang <span className="wm-count">{itemCount}</span></h2>
            {!isMobile && (
              <Button type="button" variant="tonal" onClick={addItem}><Plus size={16} aria-hidden="true" /> Tambah barang</Button>
            )}
          </div>

          {isMobile ? (
            <div className="wm-item-card">
              <div className="wm-item-card__nav">
                <Button type="button" variant="text" aria-label="Barang sebelumnya" disabled={activeItem <= 0} onClick={() => setActiveItem((value) => value - 1)}>
                  <ChevronLeft size={18} aria-hidden="true" />
                </Button>
                <strong aria-live="polite">Barang {Math.min(activeItem, itemCount - 1) + 1} dari {itemCount}</strong>
                <Button type="button" variant="text" aria-label="Barang berikutnya" disabled={activeItem >= itemCount - 1} onClick={() => setActiveItem((value) => value + 1)}>
                  <ChevronRight size={18} aria-hidden="true" />
                </Button>
              </div>
              <div className="wm-item wm-item--card">{itemInputs(current, Math.min(activeItem, itemCount - 1))}</div>
              {itemCount > 1 && (
                <Button type="button" variant="text" onClick={() => removeItem(Math.min(activeItem, itemCount - 1))}>
                  <Trash2 size={16} aria-hidden="true" /> Hapus barang ini
                </Button>
              )}
            </div>
          ) : (
            <div className="wm-items-edit">
              <div className="wm-items-edit__head" aria-hidden="true">
                {ITEM_FIELDS.map((field) => <span key={field.key}>{field.label}{field.required ? ' *' : ''}</span>)}
                <span />
              </div>
              {form.items.map((item, index) => (
                <div className="wm-item" key={item.key}>
                  {itemInputs(item, index)}
                  <button
                    type="button"
                    className="pw-icon-button pw-state-layer pw-ripple"
                    aria-label={`Hapus barang baris ${index + 1}`}
                    disabled={itemCount <= 1}
                    onClick={() => removeItem(index)}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="wm-card" aria-labelledby="wm-step-3">
          <h2 id="wm-step-3"><span className="wm-step">3</span> Catatan dan ringkasan</h2>
          <label className="pw-field">
            <span className="pw-field__label">Catatan</span>
            <textarea className="pw-field__input" rows={3} value={form.notes} onChange={(event) => setField('notes', event.target.value)} placeholder="Kondisi barang, lampiran yang dicek, atau informasi untuk Supervisor" />
          </label>
          <dl className="wm-meta wm-meta--grid">
            <div><dt>Jenis</dt><dd>{copy.label}</dd></div>
            <div><dt>Jumlah baris</dt><dd>{itemCount}</dd></div>
            <div><dt>Total kuantitas</dt><dd>{formatQuantity(totalUnits)}</dd></div>
            <div><dt>Setelah diajukan</dt><dd>Direview Warehouse Supervisor</dd></div>
          </dl>
          {showErrors && messages.length > 0 && (
            <div ref={summaryRef} tabIndex={-1} className="wm-validation" role="alert" aria-labelledby="wm-validation-title">
              <strong id="wm-validation-title">Periksa {messages.length} hal berikut sebelum menyimpan:</strong>
              <ul>{messages.map((message) => <li key={message}>{message}</li>)}</ul>
            </div>
          )}
          <AccurateNotice />
        </section>

        <div className="wm-form-actions">
          {isMobile && (
            <Button type="button" variant="tonal" onClick={addItem}><Plus size={16} aria-hidden="true" /> Barang</Button>
          )}
          <Button type="button" variant="text" onClick={() => (dirty ? setLeaveOpen(true) : leave())}>Batal</Button>
          <Button type="submit" variant="secondary" loading={saving === 'draft'} disabled={Boolean(saving)}>
            <Save size={16} aria-hidden="true" /> Simpan draft
          </Button>
          {permissions.includes('warehouse.movement.submit') && (
            <Button type="button" loading={saving === 'submit'} disabled={Boolean(saving)} onClick={() => save(true)}>
              <Send size={16} aria-hidden="true" /> Simpan &amp; ajukan
            </Button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={leaveOpen}
        title="Buang perubahan?"
        message="Perubahan yang belum disimpan akan hilang."
        confirmLabel="Buang perubahan"
        cancelLabel="Lanjut mengisi"
        tone="warning"
        onConfirm={leave}
        onClose={() => setLeaveOpen(false)}
      />
    </div>
  );
}
