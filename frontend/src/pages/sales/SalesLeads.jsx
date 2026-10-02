import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Chip from '../../components/Chip';
import DateInput from '../../components/DateInput';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FormActions from '../../components/FormActions';
import FullScreenDialog from '../../components/FullScreenDialog';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import Textarea from '../../components/Textarea';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDate } from '../../components/format';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import {
  LEAD_FILTERS, apiError, daysAgoText, formatCount, formatRupiah, splitServerErrors, todayIso,
} from './salesModel';
import SalesScopeBanner from './SalesScopeBanner';
import {
  CustomerFormModal, CustomerPicker, fetchCustomers, useCanViewAll, useSalesAccounts,
} from './SalesForms';
import useSalesList from './useSalesList';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import useOpenFromUrl, { hasUnsavedForm } from '../../components/ai/useOpenFromUrl';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { customerLabel, customerOptions, leadFormValues } from './salesAiModel';
import { salesChanged } from '../../components/useSalesActionBadge';
import './sales.css';
import { Mixed, NoTranslate, data } from '../../i18n/NoTranslate';

// Leads: outlets the field team visits that are not customers yet. Added,
// visited and turned into customers here. A lead opens as its own page view
// (?lead=ID); Sales rows are not clickable, "Lihat detail" opens it.

const customerCell = (r) => {
  if (r.customerId) return <StatusBadge status="converted" label={<NoTranslate>{r.customerName}</NoTranslate>} />;
  return r.status === 'dropped' ? <StatusBadge status="dropped" /> : '';
};

const COLUMNS = [
  { key: 'name', header: 'Outlet' },
  { key: 'outletCode', header: 'Kode outlet', nowrap: true },
  { key: 'area', header: 'Area' },
  { key: 'salesPersonName', header: 'Sales' },
  { key: 'lastVisitDate', header: 'Kunjungan terakhir', type: 'date' },
  { key: 'daysSinceVisit', header: 'Sejak kunjungan', align: 'end', translate: true, render: (r) => (r.lastVisitDate ? daysAgoText(r.daysSinceVisit) : 'Belum dikunjungi') },
  { key: 'visitCount', header: 'Kunjungan', type: 'number' },
  { key: 'lastNote', header: 'Catatan terakhir', render: (r) => <span className="sales-note">{r.lastNote || ''}</span>, exportValue: (r) => r.lastNote || '' },
  {
    key: 'customerName', header: 'Pelanggan', render: customerCell,
    exportValue: (r) => r.customerName || (r.status === 'dropped' ? 'Tidak berminat' : ''),
  },
];

const visitTime = (v) => (v.checkInTime ? `${v.checkInTime}${v.checkOutTime ? `–${v.checkOutTime}` : ''}` : '');
const VISIT_COLUMNS = [
  { key: 'visitDate', header: 'Tanggal', type: 'date' },
  {
    key: 'checkInTime', header: 'Jam', translate: true,
    render: (v) => (v.checkInTime ? (
      <span className="pw-cell">
        <span className="pw-cell__title pw-nowrap">{visitTime(v)}</span>
        {v.durationMinutes !== null && v.durationMinutes !== undefined ? <span className="pw-cell__meta">{`${v.durationMinutes} menit`}</span> : null}
      </span>
    ) : ''),
    exportValue: (v) => visitTime(v),
  },
  {
    key: 'salesPersonName', header: 'Sales', translate: true,
    render: (v) => <span className="pw-cell"><span data-no-translate="" className="pw-cell__title">{v.salesPersonName || '—'}</span><span className="pw-cell__meta">{v.isPlanned ? 'Terjadwal' : 'Tidak terjadwal'}</span></span>,
    exportValue: (v) => `${v.salesPersonName || ''} (${v.isPlanned ? 'terjadwal' : 'tidak terjadwal'})`,
  },
  { key: 'totalSales', header: 'Order', type: 'money', render: (v) => (Number(v.totalSales) > 0 ? formatRupiah(v.totalSales) : ''), exportValue: (v) => v.totalSales ?? '' },
  {
    key: 'summary', header: 'Hasil kunjungan',
    render: (v) => (
      <span className="pw-cell">
        <span className="sales-note">{v.summary || ''}</span>
        {v.geoMismatch ? <StatusBadge status="geo_mismatch" /> : null}
      </span>
    ),
    exportValue: (v) => [v.summary, v.geoMismatch ? 'Lokasi tidak cocok' : ''].filter(Boolean).join(' · '),
  },
];

const mapsUrl = (item) => `https://www.google.com/maps?q=${item.latitude},${item.longitude}`;

const LEAD_EMPTY = { name: '', address: '', area: '', latitude: '', longitude: '', ownerUserId: '', notes: '' };
const VISIT_PLANNED = [{ value: 'no', label: 'Tidak terjadwal' }, { value: 'yes', label: 'Terjadwal' }];

// "Sudah jadi pelanggan?" on a lead's page: Prakasa AI may pick the registered
// customer through the picker's own search; the user presses "Hubungkan ke
// pelanggan" (docs/prakasa-ai-rencana.md §9.9).
const AI_LEAD_LINK = defineAIForm({
  id: 'sales-lead-link', title: 'Hubungkan lead ke pelanggan', permission: 'sales.customer.manage', submitLabel: 'Hubungkan ke pelanggan', mode: 'edit',
  fields: ({ searchCustomer, labelOf }) => [
    f.lookup('customerId', 'Pelanggan', searchCustomer, { required: true, emptyValue: null, labelOf, hint: 'Nama atau ID pelanggan yang sudah terdaftar.' }),
  ],
});

// Seven fields: a long form, so the full-screen dialog (docs/ui-guideline.md §3.3).
function LeadFormDialog({ open, lead, onClose, onSaved }) {
  const formId = useId();
  const canViewAll = useCanViewAll();
  const accounts = useSalesAccounts(open && canViewAll);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setTouched(false);
    setForm(leadFormValues(lead));
  }, [open, lead]);
  // What an edit opened with: a value still equal to it was not typed by the user.
  const opened = useMemo(() => leadFormValues(lead), [lead]);
  const set = (k) => (e) => { setTouched(true); setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  // Prakasa AI may fill a new lead, or change one; the user reviews it and
  // presses "Simpan lead" / "Simpan perubahan" (docs/prakasa-ai-rencana.md §9.8, §9.9).
  const ai = usePrakasaAIForm({
    id: lead ? 'sales-lead-edit' : 'sales-lead',
    title: lead ? 'Ubah lead' : 'Lead',
    permission: 'sales.customer.manage',
    submitLabel: lead ? 'Simpan perubahan' : 'Simpan lead',
    enabled: open,
    ...(lead ? { mode: 'edit', record: { type: 'sales_lead', id: lead.id } } : {}),
    initialValues: lead ? opened : LEAD_EMPTY,
    fields: [
      { name: 'name', label: 'Nama outlet', type: 'text', required: true },
      { name: 'area', label: 'Area', type: 'text', hint: 'mis. Tangerang Selatan' },
      { name: 'address', label: 'Alamat', type: 'text' },
      ...(canViewAll ? [{ name: 'ownerUserId', label: 'PIC sales', type: 'select', options: accounts }] : []),
      { name: 'latitude', label: 'Latitude', type: 'text', maxLength: 20, hint: 'Opsional, angka desimal (mis. -6.2001).' },
      { name: 'longitude', label: 'Longitude', type: 'text', maxLength: 20, hint: 'Opsional, angka desimal (mis. 106.8166).' },
      ...(lead ? [] : [{ name: 'notes', label: 'Catatan', type: 'textarea' }]),
    ],
    getValues: () => form,
    setValues: (patch) => {
      setTouched(true);
      setForm((f) => ({ ...f, ...patch }));
      setErrors((x) => ({ ...x, ...Object.fromEntries(Object.keys(patch).map((key) => [key, undefined])) }));
    },
    validate: (next) => {
      const found = {};
      if (!String(next.name || '').trim()) found.name = 'Isi nama outlet';
      for (const key of ['latitude', 'longitude']) {
        if (next[key] !== '' && next[key] !== null && next[key] !== undefined && !Number.isFinite(Number(next[key]))) found[key] = 'Isi dengan angka desimal.';
      }
      return found;
    },
  });
  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setErrors({ name: 'Isi nama outlet' }); return; }
    const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
    const body = {
      name: form.name.trim(), address: form.address || null, area: form.area || null,
      latitude: num(form.latitude), longitude: num(form.longitude),
      ...(canViewAll ? { ownerUserId: form.ownerUserId ? Number(form.ownerUserId) : null } : {}),
      ...(lead ? {} : { notes: form.notes || null }),
    };
    setSaving(true);
    try {
      const r = lead ? await api.patch(`/sales/leads/${lead.id}`, body) : await api.post('/sales/leads', body);
      toast(lead ? 'Lead diperbarui' : `Lead dibuat · ${r.data.data.code}`, 'success');
      onSaved?.(r.data.data);
      onClose();
    } catch (err) {
      const visible = ['name', 'area', 'address', 'latitude', 'longitude'];
      if (canViewAll) visible.push('ownerUserId');
      if (!lead) visible.push('notes');
      const { fields, message } = splitServerErrors(err, visible, { fallback: 'Lead gagal disimpan' });
      setErrors(fields);
      if (message) toast(message, 'error');
    } finally { setSaving(false); }
  };
  return (
    <FullScreenDialog
      open={open}
      onClose={onClose}
      dirty={touched && !saving}
      title={lead ? 'Ubah lead' : 'Tambah lead'}
      sectionTitle="Informasi outlet"
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>{lead ? 'Simpan perubahan' : 'Simpan lead'}</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        {ai.notice}
        <div className="pw-fsdialog__fields">
          <Input label="Nama outlet" value={form.name || ''} {...ai.field('name')} onChange={set('name')} required error={errors.name} />
          <Input label="Area" value={form.area || ''} {...ai.field('area')} onChange={set('area')} placeholder="mis. Tangerang Selatan" error={errors.area} />
          <Input label="Alamat" value={form.address || ''} {...ai.field('address')} onChange={set('address')} error={errors.address} />
          {canViewAll ? <Select label="PIC sales" value={form.ownerUserId || ''} {...ai.field('ownerUserId')} onChange={set('ownerUserId')} options={accounts} dataOptions placeholder="Belum ada PIC" error={errors.ownerUserId} /> : null}
          <Input label="Latitude" value={form.latitude ?? ''} {...ai.field('latitude')} onChange={set('latitude')} inputMode="decimal" hint="Opsional, untuk tombol Maps" error={errors.latitude} />
          <Input label="Longitude" value={form.longitude ?? ''} {...ai.field('longitude')} onChange={set('longitude')} inputMode="decimal" hint="Opsional" error={errors.longitude} />
        </div>
        {!lead ? <Textarea label="Catatan" rows={2} value={form.notes || ''} {...ai.field('notes')} onChange={set('notes')} error={errors.notes} /> : null}
      </form>
    </FullScreenDialog>
  );
}

function VisitFormModal({ open, lead, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setErrors({}); setForm({ visitDate: todayIso(), checkIn: '', checkOut: '', summary: '', isPlanned: 'no' }); } }, [open]);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  // Prakasa AI may fill the visit report; the user reviews it and presses
  // "Simpan kunjungan" (docs/prakasa-ai-rencana.md §9.8).
  const ai = usePrakasaAIForm({
    id: 'sales-visit',
    title: 'Catatan kunjungan lead',
    permission: 'sales.customer.manage',
    submitLabel: 'Simpan kunjungan',
    enabled: open,
    initialValues: { visitDate: todayIso(), checkIn: '', checkOut: '', summary: '', isPlanned: 'no' },
    fields: [
      { name: 'visitDate', label: 'Tanggal', type: 'date', required: true },
      { name: 'isPlanned', label: 'Jadwal', type: 'select', options: VISIT_PLANNED },
      { name: 'checkIn', label: 'Jam datang', type: 'time' },
      { name: 'checkOut', label: 'Jam pulang', type: 'time' },
      { name: 'summary', label: 'Hasil kunjungan', type: 'textarea', hint: 'mis. Owner tertarik, minta sampel minggu depan' },
    ],
    getValues: () => form,
    setValues: (patch) => {
      setForm((f) => ({ ...f, ...patch }));
      setErrors((x) => ({ ...x, ...Object.fromEntries(Object.keys(patch).map((key) => [key, undefined])) }));
    },
    validate: (next) => {
      if (!next.visitDate) return { visitDate: 'Isi tanggal kunjungan' };
      if (next.checkIn && next.checkOut && next.checkOut < next.checkIn) return { checkOut: 'Jam pulang harus setelah jam datang.' };
      return {};
    },
  });
  const submit = async (e) => {
    e.preventDefault();
    if (!form.visitDate) { setErrors({ visitDate: 'Isi tanggal kunjungan' }); return; }
    setSaving(true);
    try {
      await api.post(`/sales/leads/${lead.id}/visits`, {
        visitDate: form.visitDate, checkIn: form.checkIn || null, checkOut: form.checkOut || null,
        summary: form.summary || null, isPlanned: form.isPlanned === 'yes',
      });
      toast('Kunjungan dicatat', 'success');
      salesChanged();
      onSaved?.();
      onClose();
    } catch (err) {
      const { fields, message } = splitServerErrors(err, ['visitDate', 'isPlanned', 'checkIn', 'checkOut', 'summary'], { fallback: 'Kunjungan gagal disimpan' });
      setErrors(fields);
      if (message) toast(message, 'error');
    } finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={<Mixed parts={['Catat kunjungan', data(lead?.name)]} />}>
      <form className="pw-stack" onSubmit={submit} noValidate>
        {ai.notice}
        <div className="pw-form-grid">
          <DateInput label="Tanggal" value={form.visitDate || ''} {...ai.field('visitDate')} onChange={set('visitDate')} required error={errors.visitDate} />
          <Select label="Jadwal" value={form.isPlanned || 'no'} {...ai.field('isPlanned')} onChange={set('isPlanned')} options={VISIT_PLANNED} error={errors.isPlanned} />
          <DateInput type="time" label="Jam datang" value={form.checkIn || ''} {...ai.field('checkIn')} onChange={set('checkIn')} error={errors.checkIn} />
          <DateInput type="time" label="Jam pulang" value={form.checkOut || ''} {...ai.field('checkOut')} onChange={set('checkOut')} error={errors.checkOut} />
        </div>
        <Textarea label="Hasil kunjungan" rows={3} value={form.summary || ''} {...ai.field('summary')} onChange={set('summary')} placeholder="mis. Owner tertarik, minta sampel minggu depan" error={errors.summary} />
        <FormActions>
          <Button variant="text" type="button" onClick={onClose}>Batal</Button>
          <Button type="submit" loading={saving}>Simpan kunjungan</Button>
        </FormActions>
      </form>
    </Modal>
  );
}

// The SimpliDOTS "DailyVisits" export: outlets become leads, visits attach to
// them, and re-uploading the same file updates instead of duplicating.
function ImportSimplidotsModal({ open, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0); // remounting the field clears a file input
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setFile(null); setError(''); setFileKey((k) => k + 1); } }, [open]);
  const submit = async (e) => {
    e.preventDefault();
    if (!file) { setError('Pilih file export dulu'); return; }
    setSaving(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const r = await api.post('/sales/visits/import', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      const s = r.data.data.stats;
      toast(`${s.visits} kunjungan diproses (${s.newVisits} baru) dari ${s.outlets} outlet`, 'success');
      salesChanged();
      onSaved?.();
      onClose();
    } catch (err) {
      setError(apiError(err, 'Impor gagal'));
    } finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Impor kunjungan SimpliDOTS" size="sm">
      <form className="pw-stack" onSubmit={submit} noValidate>
        <p className="pw-text-sm">
          Unggah export &quot;DailyVisits&quot; dari SimpliDOTS (.xlsx / .xlsm). Outlet baru menjadi lead;
          kunjungan yang sama tidak tercatat dua kali, jadi aman mengunggah ulang file yang sama.
        </p>
        <Input
          key={fileKey}
          label="File export"
          type="file"
          accept=".xlsx,.xlsm"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setError(''); }}
          hint="Makro di file tidak dijalankan; hanya isi selnya yang dibaca."
          error={error}
        />
        <FormActions>
          <Button variant="text" type="button" onClick={onClose}>Batal</Button>
          <Button type="submit" icon="cloud_upload" loading={saving}>Impor kunjungan</Button>
        </FormActions>
      </form>
    </Modal>
  );
}

// The dialogs of a lead's page share one `modal` state. The form in the page itself
// ("Hubungkan ke pelanggan") is not one of them: a dialog does not replace it.
const LEAD_DIALOG_FORMS = ['sales-lead-edit', 'sales-visit', 'sales-customer-convert'];

// One lead as a detail page (docs/ui-guideline.md §3.2): header with the
// record's actions, visit history, the link to an existing customer.
// `openVisit`: the visit form opens by URL (?lead=ID&kunjungan=1 — a link, or
// Prakasa AI's buka_halaman); `onVisitOpened` removes the parameter.
function LeadDetail({ leadId, listTo, canManage, onChanged, openVisit = false, onVisitOpened }) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [modal, setModal] = useState('');
  const ready = Boolean(state.data);
  useEffect(() => {
    if (!openVisit || !ready) return;
    // One `modal` for the visit, edit and convert dialogs: an unsaved one is never replaced by a link.
    if (canManage && !hasUnsavedForm(LEAD_DIALOG_FORMS)) setModal('visit');
    onVisitOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openVisit, ready, canManage]);
  const [linkTo, setLinkTo] = useState(null);
  const [linkLabel, setLinkLabel] = useState('');
  const [saving, setSaving] = useState('');
  // "Ubah lead" and "Jadikan pelanggan" open by URL too (?lead=ID&form=ubah | pelanggan).
  useOpenFromUrl('form', (name) => {
    if (!canManage) return;
    if (name === 'ubah') setModal('edit');
    if (name === 'pelanggan' && !state.data.lead.customerId) setModal('convert');
  }, { enabled: ready, keepUnsaved: LEAD_DIALOG_FORMS });
  // The picker's own search; what it found is kept so the chosen customer shows by name.
  const foundCustomers = useRef(new Map());
  const searchCustomer = useCallback(async (text) => {
    const rows = await fetchCustomers(text);
    rows.forEach((c) => foundCustomers.current.set(c.id, c));
    return customerOptions(rows);
  }, []);
  const linkable = ready && canManage && !state.data.lead.customerId;
  const ai = usePrakasaAIForm(AI_LEAD_LINK, {
    enabled: linkable,
    record: { type: 'sales_lead', id: leadId },
    values: { customerId: linkTo },
    setters: {
      customerId: (id) => { setLinkTo(id || null); setLinkLabel(customerLabel(foundCustomers.current.get(id))); },
    },
    initialValues: { customerId: null },
    context: { searchCustomer, labelOf: () => linkLabel },
  });

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/sales/leads/${leadId}`);
      setState({ loading: false, error: '', data: r.data.data });
      setLinkTo(r.data.data.lead.customerId || null);
    } catch (err) {
      setState({ loading: false, error: apiError(err, 'Lead tidak ditemukan'), data: null });
    }
  }, [leadId]);
  useEffect(() => { setState({ loading: true, error: '', data: null }); load(); }, [load]);
  const retry = () => { setState({ loading: true, error: '', data: null }); load(); };

  const changed = () => { load(); onChanged(); };
  const patch = async (key, body, message) => {
    setSaving(key);
    try {
      await api.patch(`/sales/leads/${leadId}`, body);
      toast(message, 'success');
      changed();
    } catch (err) {
      toast(apiError(err, 'Lead gagal disimpan'), 'error');
    } finally { setSaving(''); }
  };

  if (state.loading) return <Page><LoadingState label="Memuat lead…" /></Page>;
  if (state.error) {
    return (
      <Page>
        <EmptyState tone="error" title="Lead belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={retry}>Coba lagi</Button>} />
      </Page>
    );
  }
  const { lead, visits } = state.data;
  const hasMap = Boolean(lead.latitude && lead.longitude);
  const leadStatus = lead.customerId ? 'converted' : (lead.status === 'dropped' ? 'dropped' : 'open');
  const menu = [
    hasMap ? { label: 'Buka di Maps', icon: 'location_on', onClick: () => window.open(mapsUrl(lead), '_blank', 'noopener') } : null,
    canManage && !lead.customerId && lead.status === 'dropped' ? { label: 'Buka lagi', icon: 'replay', onClick: () => patch('status', { status: 'open' }, 'Lead dibuka lagi') } : null,
    canManage && !lead.customerId && lead.status !== 'dropped' ? { label: 'Tandai tidak berminat', icon: 'block', onClick: () => patch('status', { status: 'dropped' }, 'Ditandai tidak berminat') } : null,
  ].filter(Boolean);

  return (
    <Page>
      <PageHeader
        eyebrow="Lead"
        dataTitle
        title={lead.name}
        description={(
          <span className="pw-row">
            <StatusBadge status={leadStatus} label={leadStatus === 'open' ? 'Belum order' : (lead.customerId ? 'Sudah jadi pelanggan' : undefined)} />
            <span data-no-translate="">{[lead.outletCode, lead.area, lead.salesPersonName].filter(Boolean).join(' · ')}</span>
            <Link to={listTo}>Semua leads</Link>
          </span>
        )}
        actions={(
          <>
            {canManage ? <Button variant="secondary" icon="edit" onClick={() => setModal('edit')}>Ubah lead</Button> : null}
            {canManage && !lead.customerId ? <Button variant="secondary" icon="how_to_reg" onClick={() => setModal('convert')}>Jadikan pelanggan</Button> : null}
            {canManage ? <Button icon="edit_calendar" onClick={() => setModal('visit')}>Catat kunjungan</Button> : null}
            <ActionMenu items={menu} />
          </>
        )}
      />

      <div className="pw-cols-sidebar">
        <div className="pw-stack pw-stack--lg">
          <DataGrid
            title={`Riwayat kunjungan (${formatCount(visits.length)})`}
            columns={VISIT_COLUMNS}
            rows={visits}
            searchable={false}
            exportName={`kunjungan-lead-${lead.id}`}
            empty="Belum ada kunjungan"
          />
          {canManage && !lead.customerId ? (
            <Card title="Sudah jadi pelanggan?" subtitle="Kalau outlet ini ternyata pelanggan yang sudah terdaftar, hubungkan di sini.">
              <form
                className="pw-stack"
                onSubmit={(e) => { e.preventDefault(); patch('link', { customerId: linkTo }, 'Lead dihubungkan ke pelanggan'); }}
              >
                {ai.notice}
                <CustomerPicker label="Pelanggan" value={linkTo} initialLabel={linkLabel} {...ai.field('customerId')} onChange={(id) => { setLinkTo(id); setLinkLabel(''); }} />
                <FormActions>
                  <Button type="submit" loading={saving === 'link'} disabled={!linkTo}>Hubungkan ke pelanggan</Button>
                </FormActions>
              </form>
            </Card>
          ) : null}
        </div>
        <aside className="pw-stack pw-stack--lg">
          <Card title="Ringkasan">
            <KeyValue items={[
              { label: 'Kode outlet', value: lead.outletCode },
              { label: 'Sales', value: lead.salesPersonName },
              { label: 'Alamat', value: lead.address },
              { label: 'Area', value: lead.area },
              { label: 'Kunjungan pertama', value: lead.firstVisitDate ? formatDate(lead.firstVisitDate) : null },
              { label: 'Kunjungan terakhir', value: lead.lastVisitDate ? formatDate(lead.lastVisitDate) : null },
              { label: 'Pelanggan', value: lead.customerId ? <Link data-no-translate="" to={`/sales/customers/${lead.customerId}`}>{lead.customerName}</Link> : null },
              { label: 'Lokasi', value: hasMap ? <a href={mapsUrl(lead)} target="_blank" rel="noreferrer">Buka di Maps</a> : null, translate: true },
            ]}
            />
          </Card>
        </aside>
      </div>

      <VisitFormModal open={modal === 'visit'} lead={lead} onClose={() => setModal('')} onSaved={changed} />
      <LeadFormDialog open={modal === 'edit'} lead={lead} onClose={() => setModal('')} onSaved={changed} />
      <CustomerFormModal open={modal === 'convert'} mode="convert" lead={lead} onClose={() => setModal('')} onSaved={changed} />
    </Page>
  );
}

export default function SalesLeads() {
  const { user } = useAuth();
  const canManage = (user?.permissions || []).includes('sales.customer.manage');
  const canImport = (user?.permissions || []).includes('sales.master.manage');
  const [importOpen, setImportOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const leadParam = Number(params.get('lead')) || null;
  const filter = LEAD_FILTERS.some((f) => f.key === params.get('status')) ? params.get('status') : 'open';
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useSalesList('/sales/leads', { status: filter, q });
  // "Tambah lead" opens by URL too (/sales/leads?baru=1 — a link, or Prakasa
  // AI's buka_halaman); the parameter is removed once the form is open.
  const createParam = params.get('baru') === '1';
  useEffect(() => {
    if (!createParam) return;
    if (canManage && !leadParam) setCreating(true);
    setParams((p) => { const next = new URLSearchParams(p); next.delete('baru'); return next; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createParam]);

  const setParam = (key, value, replace = true) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace });
  // Opening a lead is a step forward: the browser's back returns to the list.
  const openLead = (id) => setParam('lead', String(id), false);
  const counts = list.meta.counts || {};

  if (leadParam) {
    // The way back to the list the lead was opened from (its status filter kept).
    const rest = new URLSearchParams(params);
    rest.delete('lead');
    rest.delete('kunjungan');
    const listTo = `/sales/leads${rest.toString() ? `?${rest}` : ''}`;
    return (
      <LeadDetail
        key={leadParam}
        leadId={leadParam}
        listTo={listTo}
        canManage={canManage}
        onChanged={list.reload}
        openVisit={params.get('kunjungan') === '1'}
        onVisitOpened={() => setParam('kunjungan', '')}
      />
    );
  }

  return (
    <Page>
      <PageHeader
        title="Leads"
        description="Outlet yang dikunjungi sales tapi belum menjadi pelanggan, dari kunjungan SimpliDOTS dan yang dicatat di sini."
        actions={(canManage || canImport) ? (
          <>
            {canImport ? <Button variant="secondary" icon="cloud_upload" onClick={() => setImportOpen(true)}>Impor SimpliDOTS</Button> : null}
            {canManage ? <Button icon="add" onClick={() => setCreating(true)}>Tambah lead</Button> : null}
          </>
        ) : null}
      />
      <SalesScopeBanner />
      <DataGrid
        title="Lead"
        columns={COLUMNS}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        onPageChange={list.setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Cari nama outlet, kode, area, atau sales"
        filters={LEAD_FILTERS.map((f) => (
          <Chip key={f.key} selected={filter === f.key} onClick={() => setParam('status', f.key)}>
            {f.label} ({formatCount(counts[f.key] ?? 0)})
          </Chip>
        ))}
        exportName={`sales-leads-${filter}`}
        rowActions={(r) => (
          <>
            <IconButton size="sm" icon="visibility" label="Lihat detail" onClick={() => openLead(r.id)} />
            {r.latitude && r.longitude ? (
              <IconButton size="sm" icon="location_on" label="Buka di Maps" href={mapsUrl(r)} target="_blank" rel="noreferrer" />
            ) : null}
          </>
        )}
        empty={q ? 'Tidak ada lead yang cocok dengan pencarian' : 'Tidak ada lead untuk filter ini'}
      />
      {filter === 'needs_visit' ? (
        <p className="pw-text-helper">Belum jadi customer dan belum dikunjungi lagi {list.meta.followupDays || 14} hari atau lebih.</p>
      ) : null}
      <ImportSimplidotsModal open={importOpen} onClose={() => setImportOpen(false)} onSaved={list.reload} />
      <LeadFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(created) => { list.reload(); if (created?.id) openLead(created.id); }}
      />
    </Page>
  );
}
