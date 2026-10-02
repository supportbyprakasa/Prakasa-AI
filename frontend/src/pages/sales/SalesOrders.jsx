import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import TabBar from '../../components/TabBar';
import Textarea from '../../components/Textarea';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDate } from '../../components/format';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import {
  DOCUMENT_TABS, INVOICE_STATUS_FILTERS, ORDER_STATUS_FILTERS, PERIOD_OPTIONS, apiError, formatRupiahShort,
  periodRange, soldQty, splitServerErrors,
} from './salesModel';
import SalesScopeBanner, { AccurateHoldBanner, useAccurateSource, useNumbersFromAccurate, useSalesScope } from './SalesScopeBanner';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import useSalesList from './useSalesList';
import { AccurateBatchList } from './SalesAccurateBatch';
import FilterMenuChip from './FilterMenuChip';
import SalesAging from './SalesAging';
import SalesExchanges from './SalesExchanges';
import './sales.css';

// Data Sales: sales orders with their surat jalan and invoice, and the SKU
// list. Entered and processed here; every list pages on the server. Owner's
// rule for Sales: rows are not clickable, a row opens through "Lihat detail".

const money = (key, header) => ({ key, header, type: 'money' });

const paidBadge = (r) => (Number(r.outstandingAmount) > 0 ? <StatusBadge status="unpaid" /> : <StatusBadge status="paid" label="Lunas" />);
const paidText = (r) => (Number(r.outstandingAmount) > 0 ? 'Belum lunas' : 'Lunas');
const PAID_COLUMN = { key: 'paid', header: 'Status', render: paidBadge, exportValue: paidText, nowrap: true };
const activeColumn = {
  key: 'isActive', header: 'Status', nowrap: true,
  render: (r) => (r.isActive ? <StatusBadge status="active" label="Aktif" /> : <StatusBadge status="inactive" />),
  exportValue: (r) => (r.isActive ? 'Aktif' : 'Nonaktif'),
};

const ORDER_COLUMNS = [
  { key: 'orderNumber', header: 'No. SO', nowrap: true },
  { key: 'transactionDate', header: 'Tanggal', type: 'date' },
  { key: 'customerName', header: 'Pelanggan' },
  { key: 'channel', header: 'Channel' },
  { key: 'salesPersonName', header: 'Sales' },
  { key: 'doNumbers', header: 'Surat jalan', nowrap: true },
  { key: 'invoiceNumbers', header: 'Invoice', nowrap: true },
  money('totalAmount', 'Total'),
  money('outstandingAmount', 'Piutang'),
  {
    key: 'dueDate', header: 'Jatuh tempo', nowrap: true,
    render: (r) => {
      if (!r.dueDate) return '';
      return r.daysOverdue ? <StatusBadge status="overdue" label={`Terlambat ${r.daysOverdue} hari`} /> : formatDate(r.dueDate);
    },
    exportValue: (r) => r.dueDate || '',
  },
  PAID_COLUMN,
];

const documentColumns = (label) => [
  { key: 'number', header: label, nowrap: true },
  { key: 'date', header: 'Tanggal', type: 'date' },
  { key: 'orderNumbers', header: 'No. SO' },
  { key: 'customerName', header: 'Pelanggan' },
  { key: 'channel', header: 'Channel' },
  { key: 'lineCount', header: 'Baris', type: 'number' },
  money('totalAmount', 'Total'),
  money('outstandingAmount', 'Piutang'),
  PAID_COLUMN,
];

const PRODUCT_COLUMNS = [
  { key: 'name', header: 'Produk' },
  { key: 'skuCode', header: 'SKU', nowrap: true },
  { key: 'category', header: 'Kategori' },
  { key: 'unit', header: 'Satuan' },
  money('price', 'Harga jual'),
  money('costPrice', 'Harga pokok'),
  activeColumn,
];

const TABS = [...DOCUMENT_TABS, { key: 'products', label: 'Produk' }];

// Tahap B (approved Accurate data): every document Accurate has for Sales.
const ACCURATE_TABS = [
  { key: 'orders', label: 'Sales order' },
  { key: 'do', label: 'Surat jalan' },
  { key: 'invoice', label: 'Faktur' },
  { key: 'receipt', label: 'Penerimaan' },
  { key: 'return', label: 'Retur' },
  { key: 'aging', label: 'Umur piutang' },
  { key: 'exchange', label: 'Tukar faktur' },
  { key: 'products', label: 'Produk' },
];
const numberCell = (label) => ({ key: 'number', header: label, nowrap: true });
const ACCURATE_COLUMNS = {
  do: [
    numberCell('No. surat jalan'), { key: 'date', header: 'Tanggal', type: 'date' }, { key: 'orderNumbers', header: 'No. SO' },
    { key: 'customerName', header: 'Pelanggan' }, { key: 'channel', header: 'Channel' }, { key: 'status', header: 'Status Accurate' },
  ],
  invoice: [
    {
      key: 'number', header: 'No. faktur',
      render: (r) => (
        <span className="pw-cell">
          <span data-no-translate="" className="pw-cell__title pw-nowrap">{r.number}</span>
          {r.orderNumbers ? <span className="pw-cell__meta">{r.orderNumbers}</span> : null}
        </span>
      ),
      exportValue: (r) => (r.orderNumbers ? `${r.number} (SO ${r.orderNumbers})` : r.number),
    },
    { key: 'date', header: 'Tanggal', type: 'date' }, { key: 'dueDate', header: 'Jatuh tempo', type: 'date' },
    {
      key: 'customerName', header: 'Pelanggan',
      render: (r) => (
        <span className="pw-cell">
          <span data-no-translate="" className="pw-cell__title">{r.customerName}</span>
          {r.salesPersonName ? <span className="pw-cell__meta">Sales: {r.salesPersonName}</span> : null}
        </span>
      ),
      exportValue: (r) => (r.salesPersonName ? `${r.customerName} (Sales: ${r.salesPersonName})` : r.customerName),
    },
    money('dppAmount', 'Omzet'), money('outstandingAmount', 'Sisa'),
    PAID_COLUMN,
  ],
  receipt: [
    numberCell('No. penerimaan'), { key: 'date', header: 'Tanggal', type: 'date' }, { key: 'customerName', header: 'Pelanggan' },
    { key: 'invoiceNumbers', header: 'Faktur dibayar' }, { key: 'bank', header: 'Kas/bank' }, money('totalAmount', 'Jumlah'),
  ],
  return: [
    numberCell('No. retur'), { key: 'date', header: 'Tanggal', type: 'date' }, { key: 'customerName', header: 'Pelanggan' },
    { key: 'channel', header: 'Channel' }, money('dppAmount', 'Nilai (sebelum PPN)'), money('totalAmount', 'Total'),
  ],
  products: [
    { key: 'name', header: 'Produk' },
    { key: 'skuCode', header: 'Kode Accurate', nowrap: true },
    { key: 'category', header: 'Kategori' },
    // No "Harga jual": Accurate keeps selling prices in price categories, and
    // every item's default price is 0 there.
    {
      key: 'qty', header: 'Terjual (periode)', align: 'end',
      render: (r) => {
        const s = soldQty(r);
        return s.detail ? <span className="pw-cell"><span className="pw-cell__title pw-nowrap">{s.main}</span><span className="pw-cell__meta">{s.detail}</span></span> : s.main;
      },
      exportValue: (r) => soldQty(r).main,
    },
    money('revenue', 'Omzet periode (sebelum PPN)'),
    activeColumn,
  ],
};
// Data Accurate waiting for approval: only for those who may decide on it.
const ACCURATE_TAB = { key: 'accurate', label: 'Data Accurate' };

const SEARCH_PLACEHOLDER = { products: 'Cari kode atau nama produk' };

const emptyProduct = (product) => ({
  skuCode: product?.skuCode || '', name: product?.name || '', category: product?.category || '', unit: product?.unit || 'Pcs',
  price: product?.price ?? '', costPrice: product?.costPrice ?? '', isActive: product ? (product.isActive ? 'yes' : 'no') : 'yes',
});

// Prakasa AI may fill a product's SKU, name, category and unit; both prices
// and the status stay with the user, who presses "Simpan produk"
// (docs/prakasa-ai-rencana.md §9.9).
const productFields = ({ editing }) => [
  editing ? f.readOnly('skuCode', 'SKU') : f.text('skuCode', 'SKU', { required: true, maxLength: 60, hint: 'mis. FOD-GLO-250G-005' }),
  f.text('name', 'Nama produk', { required: true, maxLength: 255 }),
  f.text('category', 'Kategori', { maxLength: 20, hint: 'mis. FOD, BEV, DAI' }),
  f.text('unit', 'Satuan', { maxLength: 20 }),
  f.userOnly('price', 'Harga jual', 'number'),
  f.userOnly('costPrice', 'Harga pokok', 'number'),
  ...(editing ? [f.userOnly('isActive', 'Status', 'select')] : []),
];
const AI_PRODUCT = defineAIForm({
  id: 'sales-product', title: 'Produk baru', permission: 'sales.master.manage', submitLabel: 'Simpan produk', fields: productFields,
});
const AI_PRODUCT_EDIT = defineAIForm({
  id: 'sales-product-edit', title: 'Ubah produk', permission: 'sales.master.manage', submitLabel: 'Simpan produk', mode: 'edit', fields: productFields,
});

// Company details on the printed documents: Prakasa AI may fill the name,
// address, email, terms and the two notes. Rekening pembayaran, NPWP and the
// phone number stay with the user, who presses "Simpan pengaturan".
const AI_DOCUMENT_SETTINGS = defineAIForm({
  id: 'sales-document-settings', title: 'Pengaturan dokumen sales', permission: 'sales.master.manage', submitLabel: 'Simpan pengaturan', mode: 'edit',
  fields: [
    f.text('companyName', 'Nama perusahaan', { maxLength: 190 }),
    f.userOnly('npwp', 'NPWP'),
    f.userOnly('phone', 'Telepon'),
    f.text('email', 'Email', { maxLength: 190 }),
    f.textarea('address', 'Alamat', { maxLength: 500 }),
    f.number('paymentTermsDays', 'Jatuh tempo invoice (hari)', { min: 0, max: 365, step: 1, hint: 'Kosongkan bila tidak ada jatuh tempo' }),
    f.userOnly('bankAccounts', 'Rekening pembayaran (di invoice)', 'textarea'),
    f.textarea('invoiceNote', 'Catatan invoice', { maxLength: 2000 }),
    f.textarea('deliveryNote', 'Catatan surat jalan', { maxLength: 2000 }),
  ],
});

function ProductFormDialog({ open, product, onClose, onSaved }) {
  const formId = useId();
  const [form, setForm] = useState(emptyProduct(null));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm(emptyProduct(product));
    setErrors({});
    setTouched(false);
  }, [open, product]);
  const set = (k) => (e) => { setTouched(true); setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const opened = useMemo(() => emptyProduct(product), [product]);
  const ai = usePrakasaAIForm(product ? AI_PRODUCT_EDIT : AI_PRODUCT, {
    enabled: open,
    record: { type: 'sales_product', id: product?.id },
    values: form,
    setValues: setForm,
    setErrors,
    onFill: () => setTouched(true),
    initialValues: opened,
    context: { editing: Boolean(product) },
  });
  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!product && !form.skuCode.trim()) next.skuCode = 'Isi SKU produk';
    if (!form.name.trim()) next.name = 'Isi nama produk';
    setErrors(next);
    if (Object.keys(next).length) return;
    const body = {
      name: form.name.trim(), category: form.category || null, unit: form.unit || null,
      price: num(form.price), costPrice: num(form.costPrice),
    };
    setSaving(true);
    try {
      if (product) await api.patch(`/sales/products/${product.id}`, { ...body, isActive: form.isActive === 'yes' });
      else await api.post('/sales/products', { ...body, skuCode: form.skuCode.trim() });
      toast(product ? 'Produk diperbarui' : 'Produk ditambahkan', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      const visible = ['skuCode', 'name', 'category', 'unit', 'price', 'costPrice'];
      if (product) visible.push('isActive');
      const { fields, message } = splitServerErrors(err, visible, { fallback: 'Produk gagal disimpan' });
      setErrors(fields);
      if (message) toast(message, 'error');
    } finally { setSaving(false); }
  };
  return (
    <FullScreenDialog
      open={open}
      onClose={onClose}
      dirty={touched && !saving}
      title={product ? 'Ubah produk' : 'Tambah produk'}
      sectionTitle="Informasi produk"
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>Simpan produk</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        {ai.notice}
        <div className="pw-fsdialog__fields">
          <Input label="SKU" value={form.skuCode} {...ai.field('skuCode')} onChange={set('skuCode')} disabled={Boolean(product)} required error={errors.skuCode} placeholder="mis. FOD-GLO-250G-005" mono />
          <Input label="Nama produk" value={form.name} {...ai.field('name')} onChange={set('name')} required error={errors.name} />
          <Input label="Kategori" value={form.category} {...ai.field('category')} onChange={set('category')} placeholder="mis. FOD, BEV, DAI" error={errors.category} />
          <Input label="Satuan" value={form.unit} {...ai.field('unit')} onChange={set('unit')} error={errors.unit} />
          <Input label="Harga jual" type="number" min="0" value={form.price} onChange={set('price')} error={errors.price} hint="Rupiah, sebelum PPN" />
          <Input label="Harga pokok" type="number" min="0" value={form.costPrice} onChange={set('costPrice')} error={errors.costPrice} hint="Rupiah" />
          {product ? <Select label="Status" value={form.isActive} onChange={set('isActive')} options={[{ value: 'yes', label: 'Aktif' }, { value: 'no', label: 'Nonaktif' }]} error={errors.isActive} /> : null}
        </div>
      </form>
    </FullScreenDialog>
  );
}

// Company details printed on the sales order, surat jalan, invoice and kwitansi.
function DocumentSettingsDialog({ open, onClose }) {
  const formId = useId();
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, error: '' });
  const [form, setForm] = useState(null);
  const [loaded, setLoaded] = useState(null);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const load = useCallback(async () => {
    setState({ loading: true, error: '' });
    try {
      const r = await api.get('/sales/document-settings');
      const s = r.data.data;
      const values = {
        companyName: s.companyName || s.entityName || '', address: s.address || '', phone: s.phone || '', email: s.email || '',
        npwp: s.npwp || '', bankAccounts: s.bankAccounts || '', paymentTermsDays: s.paymentTermsDays ?? '',
        invoiceNote: s.invoiceNote || '', deliveryNote: s.deliveryNote || '',
      };
      setForm(values);
      setLoaded(values);
      setState({ loading: false, error: '' });
    } catch (err) {
      setState({ loading: false, error: apiError(err) });
    }
  }, []);
  useEffect(() => { if (open) { setForm(null); setLoaded(null); setTouched(false); load(); } }, [open, load]);
  const set = (k) => (e) => { setTouched(true); setForm((current) => ({ ...current, [k]: e.target.value })); };
  // The settings are one record per company (entity): registered once they have loaded.
  const ai = usePrakasaAIForm(AI_DOCUMENT_SETTINGS, {
    enabled: open && Boolean(form) && Boolean(loaded),
    record: { type: 'sales_document_settings', id: user?.entityId },
    values: form || {},
    setValues: setForm,
    onFill: () => setTouched(true),
    initialValues: loaded || {},
  });
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/sales/document-settings', {
        ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v])),
        paymentTermsDays: form.paymentTermsDays === '' ? null : Number(form.paymentTermsDays),
      });
      toast('Pengaturan dokumen disimpan', 'success');
      onClose();
    } catch (err) {
      toast(apiError(err, 'Pengaturan gagal disimpan'), 'error');
    } finally { setSaving(false); }
  };
  let body;
  if (state.loading) body = <FullScreenSection><LoadingState label="Memuat pengaturan dokumen…" /></FullScreenSection>;
  else if (state.error) {
    body = (
      <FullScreenSection>
        <EmptyState tone="error" title="Pengaturan belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={load}>Coba lagi</Button>} />
      </FullScreenSection>
    );
  } else {
    body = (
      <form id={formId} className="pw-stack pw-stack--lg" onSubmit={submit}>
        {ai.notice}
        <FullScreenSection title="Perusahaan">
          <p className="pw-text-helper">
            Tampil di sales order, surat jalan, invoice, dan kwitansi. Isian yang kosong tidak dicetak. Bila divisi sudah mengunggah
            kop surat (menu Tanda tangan, lalu Cap surat), kop itu yang dipakai sebagai kepala dokumen.
          </p>
          <div className="pw-fsdialog__fields">
            <Input label="Nama perusahaan" value={form.companyName} {...ai.field('companyName')} onChange={set('companyName')} />
            <Input label="NPWP" value={form.npwp} onChange={set('npwp')} />
            <Input label="Telepon" value={form.phone} onChange={set('phone')} inputMode="tel" />
            <Input label="Email" type="email" value={form.email} {...ai.field('email')} onChange={set('email')} />
          </div>
          <Textarea label="Alamat" rows={2} value={form.address} {...ai.field('address')} onChange={set('address')} />
        </FullScreenSection>
        <FullScreenSection title="Invoice dan surat jalan">
          <div className="pw-fsdialog__fields">
            <Input label="Jatuh tempo invoice (hari)" type="number" min="0" max="365" value={form.paymentTermsDays} {...ai.field('paymentTermsDays')} onChange={set('paymentTermsDays')} hint="Kosongkan bila tidak ada jatuh tempo" />
          </div>
          <Textarea label="Rekening pembayaran (di invoice)" rows={3} value={form.bankAccounts} onChange={set('bankAccounts')} placeholder="mis. BCA 123-456-7890 a.n. PT …" />
          <Textarea label="Catatan invoice" rows={2} value={form.invoiceNote} {...ai.field('invoiceNote')} onChange={set('invoiceNote')} />
          <Textarea label="Catatan surat jalan" rows={2} value={form.deliveryNote} {...ai.field('deliveryNote')} onChange={set('deliveryNote')} placeholder="mis. Barang diterima dalam keadaan baik dan lengkap." />
        </FullScreenSection>
      </form>
    );
  }
  return (
    <FullScreenDialog
      open={open}
      onClose={onClose}
      dirty={touched && !saving}
      title="Pengaturan dokumen"
      card={false}
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose}>Batal</Button>
          <Button type="submit" form={formId} loading={saving} disabled={!form}>Simpan pengaturan</Button>
        </>
      )}
    >
      {body}
    </FullScreenDialog>
  );
}

export default function SalesOrders() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const canManageOrders = permissions.includes('sales.order.manage');
  const canManageMaster = permissions.includes('sales.master.manage');
  const accurate = useAccurateSource();
  const [params, setParams] = useSearchParams();
  const fromAccurate = useNumbersFromAccurate();
  // Tahap B: SOs and invoices come from Accurate; delivery orders are not read from Accurate yet.
  const baseTabs = fromAccurate ? ACCURATE_TABS : TABS;
  const tabs = canManageMaster ? [...baseTabs, ACCURATE_TAB] : baseTabs;
  const tab = tabs.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'orders';
  const period = PERIOD_OPTIONS.some((p) => p.value === params.get('periode')) ? params.get('periode') : 'this_month';
  const status = ORDER_STATUS_FILTERS.some((f) => f.key === params.get('status')) ? params.get('status') : '';
  const invoiceStatus = INVOICE_STATUS_FILTERS.some((f) => f.key === params.get('status')) ? params.get('status') : '';
  const channel = params.get('channel') || '';
  // A link can open a tab already searched (?q=, e.g. "Surat jalan belum difaktur"
  // from Pusat Eskalasi, with the SO number): the search starts from it. Picking
  // another tab clears it; typing does not touch the URL. The grid debounces.
  const urlQ = params.get('q') || '';
  const [q, setQ] = useState(urlQ);
  const [productModal, setProductModal] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The scope says where transactions live; until it has loaded, no form opens from the URL.
  const scopeLoaded = Boolean(useSalesScope());

  // Compared with what was shown, not "skip the first run": React runs effects
  // twice on mount in development, and the URL's search must survive that.
  const shown = useRef({ tab, urlQ });
  useEffect(() => {
    if (shown.current.tab === tab && shown.current.urlQ === urlQ) return;
    shown.current = { tab, urlQ };
    setQ(urlQ);
  }, [tab, urlQ]);
  const range = useMemo(() => periodRange(period), [period]);
  const path = {
    orders: '/sales/orders', do: '/sales/documents', invoice: '/sales/documents', receipt: '/sales/documents', return: '/sales/documents', products: '/sales/products',
  }[tab];
  const accurateInvoices = fromAccurate && tab === 'invoice';
  const query = tab === 'products'
    ? { q, active: 'all', ...(fromAccurate ? { from: range.from, to: range.to } : {}) }
    : {
      q, from: range.from, to: range.to,
      ...(tab === 'orders' ? { channel, status } : { type: tab }),
      // The aging table links to the invoices past due.
      ...(accurateInvoices && invoiceStatus ? { status: invoiceStatus } : {}),
      // One customer's invoices (the aging on a customer page links here).
      ...(accurateInvoices && Number(params.get('customerId')) > 0 ? { customerId: params.get('customerId') } : {}),
    };
  const list = useSalesList(path || '/sales/orders', query, { enabled: !['accurate', 'aging', 'exchange'].includes(tab) });

  const setParam = (key, value) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });
  const setTab = (key) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (key === 'orders') next.delete('tab'); else next.set('tab', key);
    next.delete('q');
    return next;
  }, { replace: true });

  // The product form and the document settings open by URL too (a link, or
  // Prakasa AI's buka_halaman): ?tab=products&baru=1, ?tab=products&q=<SKU>&ubah=<id>,
  // ?form=pengaturan-dokumen. Only where the buttons themselves are offered.
  const mayEditMaster = canManageMaster && !accurate;
  useOpenFromUrl('baru', () => { if (mayEditMaster) setProductModal({}); }, { enabled: scopeLoaded && tab === 'products', keepUnsaved: true });
  // The product to change is looked up in the list once the product rows (not
  // the rows of the tab shown before) have arrived.
  const [wantedProduct, setWantedProduct] = useState(null);
  useOpenFromUrl('ubah', (productId) => { if (mayEditMaster) setWantedProduct(String(productId)); }, { enabled: scopeLoaded && tab === 'products', keepUnsaved: true });
  useEffect(() => {
    if (!wantedProduct) return undefined;
    const row = tab === 'products' && !list.loading ? list.rows.find((r) => String(r.id) === wantedProduct && r.skuCode !== undefined) : null;
    if (row) { setProductModal(row); setWantedProduct(null); return undefined; }
    const timer = setTimeout(() => setWantedProduct(null), 8000);
    return () => clearTimeout(timer);
  }, [wantedProduct, tab, list.loading, list.rows]);
  useOpenFromUrl('form', (name) => { if (name === 'pengaturan-dokumen' && mayEditMaster) setSettingsOpen(true); }, { enabled: scopeLoaded, keepUnsaved: true });

  const label = tabs.find((t) => t.key === tab).label;
  // The documents' own value (gross): "omzet" is net of returns, on the overview.
  // SO tab: the listed SOs' DPP and what their invoices still owe; invoice tab:
  // the listed invoices' value (nilai faktur) and their receivable.
  const values = tab === 'orders' || accurateInvoices
    ? (tab === 'orders'
      ? `Nilai SO ${formatRupiahShort(list.meta.revenue || 0)} (sebelum PPN) · piutang faktur dari SO ini ${formatRupiahShort(list.meta.outstanding || 0)}`
      : `Nilai faktur ${formatRupiahShort(list.meta.revenue || 0)} (sebelum PPN) · piutang ${formatRupiahShort(list.meta.outstanding || 0)}`)
    : (list.meta.sum ? `Total ${formatRupiahShort(list.meta.sum)}` : '');
  const productNote = accurate && tab === 'products'
    ? (fromAccurate ? 'Omzet per produk = bagian tiap baris faktur Accurate dari DPP fakturnya (sebelum PPN; diskon dan biaya di faktur dibagi rata ke produk), tanpa faktur uang muka.' : 'Master produk mengikuti Accurate.')
    : '';
  const footnote = list.loading ? '' : [values, productNote].filter(Boolean).join(' · ');

  const columns = (fromAccurate && ACCURATE_COLUMNS[tab]) || {
    orders: ORDER_COLUMNS,
    do: documentColumns('No. surat jalan'),
    invoice: documentColumns('No. invoice'),
    products: PRODUCT_COLUMNS,
  }[tab];

  const periodChip = tab !== 'products' || fromAccurate ? (
    <FilterMenuChip
      label="Periode"
      icon="date_range"
      value={period}
      defaultValue="this_month"
      options={PERIOD_OPTIONS}
      onChange={(value) => setParam('periode', value === 'this_month' ? '' : value)}
    />
  ) : null;
  const filters = (
    <>
      {periodChip}
      {tab === 'orders' ? (
        <>
          <FilterMenuChip
            label="Channel"
            icon="storefront"
            value={channel}
            options={[{ value: '', label: 'Semua', translate: true }, ...(list.meta.channels || []).map((c) => ({ value: c, label: c }))]}
            dataOptions
            onChange={(value) => setParam('channel', value)}
          />
          {ORDER_STATUS_FILTERS.map((f) => (
            <Chip key={f.key || 'all'} selected={status === f.key} onClick={() => setParam('status', f.key)}>{f.label}</Chip>
          ))}
        </>
      ) : null}
      {accurateInvoices ? INVOICE_STATUS_FILTERS.map((f) => (
        <Chip key={f.key || 'all'} selected={invoiceStatus === f.key} onClick={() => setParam('status', f.key)}>{f.label}</Chip>
      )) : null}
    </>
  );

  const rowActions = (r) => {
    if (tab === 'products') {
      return canManageMaster && !accurate
        ? <IconButton size="sm" icon="edit" label="Ubah produk" onClick={() => setProductModal(r)} />
        : null;
    }
    return (
      <>
        {r.source === 'accurate' ? null : (
          <IconButton size="sm" icon="visibility" label={tab === 'orders' ? 'Lihat detail' : 'Lihat SO'} to={`/sales/orders/${tab === 'orders' ? r.id : r.orderId}`} />
        )}
        {(tab === 'orders' || r.source === 'accurate') && r.customerId ? (
          <IconButton size="sm" icon="person" label="Lihat pelanggan" to={`/sales/customers/${r.customerId}`} />
        ) : null}
        {tab !== 'orders' && !accurate ? (
          <IconButton size="sm" icon="print" label="Cetak" href={`/print/sales/${tab}/${r.orderId}`} target="_blank" rel="noreferrer" />
        ) : null}
      </>
    );
  };

  let headerActions = null;
  if (!accurate) {
    const primary = tab === 'products'
      ? (canManageMaster ? <Button icon="add" onClick={() => setProductModal({})}>Tambah produk</Button> : null)
      : (canManageOrders ? <Button icon="add" to="/sales/orders/new">Buat sales order</Button> : null);
    const settings = canManageMaster
      ? <Button variant="secondary" icon="settings" onClick={() => setSettingsOpen(true)}>Pengaturan dokumen</Button>
      : null;
    headerActions = primary || settings ? <>{settings}{primary}</> : null;
  }

  return (
    <Page>
      <PageHeader
        title="Data Sales"
        description={accurate
          ? 'Sales order, surat jalan, invoice, dan pembayaran: dicatat di Accurate, dipantau di sini.'
          : 'Sales order, surat jalan, invoice, dan pembayaran, serta daftar produk.'}
        actions={headerActions}
      />
      <SalesScopeBanner />
      <AccurateHoldBanner />
      <TabBar tabs={tabs} value={tab} onChange={setTab} label="Jenis data" idPrefix="sales-data" panelId="sales-data-panel" />
      <div id="sales-data-panel" role="tabpanel" aria-labelledby={`sales-data-${tab}`} className="pw-stack">
        {tab === 'aging' ? <SalesAging /> : null}
        {tab === 'exchange' ? <SalesExchanges /> : null}
        {tab === 'accurate' ? <AccurateBatchList /> : null}
        {['aging', 'exchange', 'accurate'].includes(tab) ? null : (
          <>
            <DataGrid
              key={tab}
              title={label}
              columns={columns}
              rows={list.rows}
              idKey={['do', 'invoice', 'receipt', 'return'].includes(tab) ? 'number' : 'id'}
              loading={list.loading}
              error={list.error}
              onRetry={list.reload}
              meta={list.meta}
              onPageChange={list.setPage}
              search={q}
              onSearchChange={setQ}
              searchPlaceholder={SEARCH_PLACEHOLDER[tab] || 'Cari nomor dokumen atau pelanggan'}
              filters={filters}
              exportName={`sales-${tab}`}
              rowActions={rowActions}
              empty={q ? 'Tidak ada yang cocok dengan pencarian' : 'Tidak ada data di periode ini'}
            />
            {footnote ? <p className="pw-text-helper">{footnote}</p> : null}
          </>
        )}
      </div>
      <DocumentSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ProductFormDialog
        open={Boolean(productModal)}
        product={productModal?.id ? productModal : null}
        onClose={() => setProductModal(null)}
        onSaved={list.reload}
      />
    </Page>
  );
}
