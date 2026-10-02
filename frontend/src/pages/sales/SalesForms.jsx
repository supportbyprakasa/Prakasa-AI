import { useEffect, useId, useMemo, useState } from 'react';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import api from '../../api/client';
import Button from '../../components/Button';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import Input from '../../components/Input';
import Select from '../../components/Select';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { splitServerErrors } from './salesModel';
import { EMPTY_CUSTOMER, customerFormErrors, customerFormValues } from './salesAiModel';
import { useDebouncedValue } from './useSalesList';
import './sales.css';

// Form pieces shared by the Sales pages: the customer form (create, edit, and
// "jadikan customer" from a lead), a customer picker and a product picker that
// search on the server, and the list of accounts that can be PIC.

const LEGAL_FORMS = [
  { value: 'PR', label: 'PR — perorangan' },
  { value: 'PT', label: 'PT' },
  { value: 'CV', label: 'CV' },
  { value: 'IN', label: 'IN — marketplace / institusi' },
];
const DEFAULT_CHANNELS = ['GT', 'MT', 'FoodService', 'Shopee', 'TokoPedia', 'GRAB', 'GOJEK', 'Export'];

export function useCanViewAll() {
  const { user } = useAuth();
  return (user?.permissions || []).includes('sales.data.view_all');
}

let accountsCache = null;
export function useSalesAccounts(enabled = true) {
  const [accounts, setAccounts] = useState(accountsCache || []);
  useEffect(() => {
    if (!enabled || accountsCache) return;
    api.get('/sales/accounts').then((r) => { accountsCache = r.data.data || []; setAccounts(accountsCache); }).catch(() => {});
  }, [enabled]);
  return useMemo(() => accounts.map((a) => ({ value: String(a.id), label: `${a.name} · ${a.departmentName}` })), [accounts]);
}

// The two searches of the Sales pickers. Prakasa AI's lookups call the same
// two (same endpoint, same parameters: the user's own permission and scope).
export const fetchCustomers = (q) => api.get('/sales/customers', { params: { q: q || undefined, limit: 20 } }).then((r) => r.data.data || []);
export const fetchProducts = (q, customerId) => api.get('/sales/products', { params: { q, limit: 15, customerId: customerId || undefined } }).then((r) => r.data.data || []);

// Prakasa AI may fill the customer form; the user reviews it and presses the
// form's own button (docs/prakasa-ai-rencana.md §9.9). Phone numbers stay with
// the user. One component, three forms: new, edit, and "jadikan pelanggan".
const customerFields = ({ mode, channelOptions, accounts, canViewAll }) => [
  f.text('name', 'Nama pelanggan', { required: true, maxLength: 190 }),
  f.select('channel', 'Channel', channelOptions),
  f.select('legalForm', 'Bentuk usaha', LEGAL_FORMS),
  ...(mode !== 'edit'
    ? [f.text('cityCode', 'Kode kota', { required: true, maxLength: 3, hint: '3 huruf, mis. JKT, TGR, BKS, DPK, BGR' })]
    : [f.readOnly('customerCode', 'ID pelanggan')]),
  ...(canViewAll ? [f.select('ownerUserId', 'PIC sales', accounts)] : []),
  f.text('contactPerson', 'Kontak', { maxLength: 150 }),
  f.userOnly('phone', 'Handphone'),
  f.userOnly('businessPhone', 'Telp. bisnis'),
  f.text('email', 'Email', { maxLength: 190 }),
  f.text('address', 'Alamat pengiriman', { maxLength: 500 }),
  f.text('city', 'Kota', { maxLength: 100 }),
  f.textarea('notes', 'Catatan', { maxLength: 2000 }),
];
const AI_CUSTOMER = defineAIForm({
  id: 'sales-customer', title: 'Pelanggan baru', permission: 'sales.customer.manage', submitLabel: 'Simpan pelanggan', fields: customerFields,
});
const AI_CUSTOMER_CONVERT = defineAIForm({
  id: 'sales-customer-convert', title: 'Jadikan pelanggan', permission: 'sales.customer.manage', submitLabel: 'Simpan pelanggan', fields: customerFields,
});
const AI_CUSTOMER_EDIT = defineAIForm({
  id: 'sales-customer-edit', title: 'Ubah pelanggan', permission: 'sales.customer.manage', submitLabel: 'Simpan perubahan', mode: 'edit', fields: customerFields,
});
const AI_CUSTOMER_FORMS = { create: AI_CUSTOMER, convert: AI_CUSTOMER_CONVERT, edit: AI_CUSTOMER_EDIT };

// mode: 'create' | 'edit' | 'convert' (from a lead: POST /sales/leads/:id/convert)
export function CustomerFormModal({ open, mode = 'create', customer = null, lead = null, channels, onClose, onSaved }) {
  const formId = useId();
  const canViewAll = useCanViewAll();
  const accounts = useSalesAccounts(open && canViewAll);
  const [form, setForm] = useState(EMPTY_CUSTOMER);
  const [previewCode, setPreviewCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setTouched(false);
    setForm(customerFormValues(mode, customer, lead));
  }, [open, mode, customer, lead]);

  // The ID pelanggan a new customer will get, from the same rule the server uses.
  useEffect(() => {
    if (!open || mode === 'edit') return undefined;
    const t = setTimeout(() => {
      api.get('/sales/customers/next-code', { params: { legalForm: form.legalForm, channel: form.channel, cityCode: form.cityCode } })
        .then((r) => setPreviewCode(r.data.data.code)).catch(() => setPreviewCode(''));
    }, 250);
    return () => clearTimeout(t);
  }, [open, mode, form.legalForm, form.channel, form.cityCode]);

  const set = (key) => (e) => { setTouched(true); setForm((f) => ({ ...f, [key]: e.target.value })); setErrors((x) => ({ ...x, [key]: undefined })); };
  const channelOptions = [...new Set([...(channels || []), ...DEFAULT_CHANNELS])].map((c) => ({ value: c, label: c }));

  // What the form opened with: a value still equal to it was not typed by the user.
  const opened = useMemo(() => customerFormValues(mode, customer, lead), [mode, customer, lead]);
  const ai = usePrakasaAIForm(AI_CUSTOMER_FORMS[mode] || AI_CUSTOMER, {
    enabled: open && (mode !== 'edit' || Boolean(customer)) && (mode !== 'convert' || Boolean(lead)),
    record: { type: 'sales_customer', id: customer?.id },
    values: mode === 'edit' ? { ...form, customerCode: customer?.customer_code || '' } : form,
    setValues: setForm,
    setErrors,
    onFill: () => setTouched(true),
    validate: (next) => customerFormErrors(next, mode),
    initialValues: mode === 'edit' ? { ...opened, customerCode: customer?.customer_code || '' } : opened,
    context: { mode, channelOptions, accounts, canViewAll },
  });

  const submit = async (e) => {
    e.preventDefault();
    const next = customerFormErrors(form, mode);
    setErrors(next);
    if (Object.keys(next).length) return;
    const body = {
      name: form.name.trim(), legalForm: form.legalForm || null, channel: form.channel || null,
      contactPerson: form.contactPerson || null, phone: form.phone || null, businessPhone: form.businessPhone || null,
      email: form.email || null, address: form.address || null, city: form.city || null, notes: form.notes || null,
      ...(canViewAll ? { ownerUserId: form.ownerUserId ? Number(form.ownerUserId) : null } : {}),
      ...(mode !== 'edit' ? { cityCode: form.cityCode.toUpperCase() } : {}),
    };
    setSaving(true);
    try {
      let result;
      if (mode === 'edit') result = await api.patch(`/sales/customers/${customer.id}`, body);
      else if (mode === 'convert') result = await api.post(`/sales/leads/${lead.id}/convert`, body);
      else result = await api.post('/sales/customers', body);
      toast(mode === 'edit' ? 'Pelanggan diperbarui' : `Pelanggan dibuat · ${result.data.data.code}`, 'success');
      onSaved?.(result.data.data);
      onClose();
    } catch (err) {
      const visible = ['name', 'channel', 'legalForm', 'contactPerson', 'phone', 'businessPhone', 'email', 'address', 'city', 'notes'];
      if (mode !== 'edit') visible.push('cityCode');
      if (canViewAll) visible.push('ownerUserId');
      const { fields, message } = splitServerErrors(err, visible, { fallback: 'Pelanggan gagal disimpan' });
      setErrors(fields);
      if (message) toast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const title = { create: 'Tambah pelanggan', edit: 'Ubah pelanggan', convert: 'Jadikan pelanggan' }[mode];
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
          <Button type="submit" form={formId} loading={saving}>{mode === 'edit' ? 'Simpan perubahan' : 'Simpan pelanggan'}</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack pw-stack--lg" onSubmit={submit} noValidate>
        {ai.notice}
        <FullScreenSection title="Informasi pelanggan">
          <div className="pw-fsdialog__fields">
            <Input label="Nama pelanggan" value={form.name} {...ai.field('name')} onChange={set('name')} error={errors.name} required />
            <Select label="Channel" value={form.channel} {...ai.field('channel')} onChange={set('channel')} options={channelOptions} dataOptions error={errors.channel} />
            <Select label="Bentuk usaha" value={form.legalForm} {...ai.field('legalForm')} onChange={set('legalForm')} options={LEGAL_FORMS} error={errors.legalForm} />
            {mode !== 'edit' ? (
              <Input
                label="Kode kota"
                value={form.cityCode}
                {...ai.field('cityCode')}
                onChange={(e) => { setTouched(true); setForm((f) => ({ ...f, cityCode: e.target.value.toUpperCase().slice(0, 3) })); setErrors((x) => ({ ...x, cityCode: undefined })); }}
                error={errors.cityCode}
                hint={previewCode ? `ID pelanggan: ${previewCode}` : '3 huruf, mis. JKT, TGR, BKS, DPK, BGR'}
                required
              />
            ) : <Input label="ID pelanggan" value={customer?.customer_code || ''} disabled mono />}
            {canViewAll ? (
              <Select label="PIC sales" value={form.ownerUserId} {...ai.field('ownerUserId')} onChange={set('ownerUserId')} options={accounts} dataOptions placeholder="Belum ada PIC" error={errors.ownerUserId} />
            ) : null}
          </div>
        </FullScreenSection>
        <FullScreenSection title="Kontak dan alamat">
          <div className="pw-fsdialog__fields">
            <Input label="Kontak" value={form.contactPerson} {...ai.field('contactPerson')} onChange={set('contactPerson')} error={errors.contactPerson} />
            <Input label="Handphone" value={form.phone} onChange={set('phone')} inputMode="tel" error={errors.phone} />
            <Input label="Telp. bisnis" value={form.businessPhone} onChange={set('businessPhone')} inputMode="tel" error={errors.businessPhone} />
            <Input label="Email" type="email" value={form.email} {...ai.field('email')} onChange={set('email')} error={errors.email} />
            <Input label="Alamat pengiriman" value={form.address} {...ai.field('address')} onChange={set('address')} error={errors.address} />
            <Input label="Kota" value={form.city} {...ai.field('city')} onChange={set('city')} error={errors.city} />
          </div>
          <Textarea label="Catatan" rows={3} value={form.notes} {...ai.field('notes')} onChange={set('notes')} error={errors.notes} />
        </FullScreenSection>
      </form>
    </FullScreenDialog>
  );
}

// Pick one customer by typing part of its name or ID; searches on the server.
// `aiFilled`: Prakasa AI chose this customer (ai.field of the form that holds the picker).
export function CustomerPicker({ label = 'Pelanggan', value, initialLabel = '', onChange, required, error, aiFilled = false }) {
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q);
  const [options, setOptions] = useState([]);
  useEffect(() => {
    let alive = true;
    fetchCustomers(search)
      .then((rows) => alive && setOptions(rows.map((c) => ({
        value: String(c.id), label: c.code ? `${c.name} — ${c.code}` : c.name, customer: c,
      }))))
      .catch(() => {});
    return () => { alive = false; };
  }, [search]);
  const withCurrent = value && !options.some((o) => o.value === String(value))
    ? [{ value: String(value), label: initialLabel || `Pelanggan #${value}`, translate: !initialLabel }, ...options]
    : options;
  return (
    <div className="sales-picker">
      <Input label={`Cari ${label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} hint="Nama atau ID pelanggan" />
      <Select
        label={label}
        value={value ? String(value) : ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null, withCurrent.find((o) => o.value === e.target.value)?.customer)}
        options={withCurrent}
        dataOptions
        placeholder={options.length ? 'Pilih pelanggan' : 'Tidak ada hasil'}
        required={required}
        error={error}
        aiFilled={aiFilled}
      />
    </div>
  );
}

// Search the SKU list; picking one fills a line.
export function ProductPicker({ onPick, customerId = null }) {
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q);
  const [options, setOptions] = useState([]);
  useEffect(() => {
    if (!search) { setOptions([]); return undefined; }
    let alive = true;
    fetchProducts(search, customerId)
      .then((rows) => alive && setOptions(rows))
      .catch(() => {});
    return () => { alive = false; };
  }, [search, customerId]);
  return (
    <div className="sales-picker">
      <Input label="Cari produk" value={q} onChange={(e) => setQ(e.target.value)} placeholder="mis. abon, FOD-GLO" hint="SKU atau nama produk" />
      <Select
        label="Produk"
        value=""
        onChange={(e) => {
          const p = options.find((o) => String(o.id) === e.target.value);
          if (p) { onPick(p); setQ(''); }
        }}
        options={options.map((p) => ({
          value: String(p.id),
          label: `${p.name} — ${p.skuCode}${p.lastPrice !== null && p.lastPrice !== undefined ? ' · harga terakhir customer' : ''}`,
        }))}
        dataOptions
        placeholder={search ? (options.length ? `${options.length} hasil, pilih produk` : 'Tidak ada hasil') : 'Ketik di pencarian dulu'}
      />
    </div>
  );
}
