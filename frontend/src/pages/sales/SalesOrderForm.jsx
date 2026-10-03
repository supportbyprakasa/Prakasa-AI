import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import DateInput from '../../components/DateInput';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import Select from '../../components/Select';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import {
  ORDER_CHANNELS, apiError, formatRupiah, orderChannelFor, orderTotals, splitServerErrors, todayIso,
} from './salesModel';
import {
  CustomerPicker, ProductPicker, fetchCustomers, fetchProducts, useCanViewAll, useSalesAccounts,
} from './SalesForms';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import {
  customerLabel, customerOptions, linesForAI, linesFromAI, productOptions, productTokenName,
} from './salesAiModel';
import { salesChanged } from '../../components/useSalesActionBadge';
import { useAccurateSource } from './SalesScopeBanner';
import './sales.css';

// Create or edit a sales order: a long form, shown like the admin console's
// "Add new user" full-screen dialog (docs/ui-guideline.md §3.3) on its own
// route; the X or Batal goes back where the user came from. The SO number is
// suggested from the format the team already uses and can be changed; totals
// are previewed with the same rule the server applies.

const emptyLine = () => ({ key: Math.random().toString(36).slice(2), skuCode: '', productName: '', qty: '1', unitPrice: '', taxable: false });

// Prakasa AI may fill the order: the customer and the products through the
// page's own two searches (exactly one match is set, anything else goes back
// to the user as candidates), dates, channel, quantities and the note. No. SO,
// price, PPN and ongkos kirim stay with the user — a line the AI adds has no
// price until the user types it. The user presses "Simpan sales order"
// (docs/prakasa-ai-rencana.md §9.9).
const MAX_AI_LINES = 30;
const orderFields = ({ editing, searchCustomer, searchProduct, customerLabelOf, accounts, canViewAll, getLines, setLines }) => [
  editing
    ? f.readOnly('customer', 'Pelanggan')
    : f.lookup('customer', 'Pelanggan', searchCustomer, { required: true, emptyValue: null, labelOf: customerLabelOf, hint: 'Nama atau ID pelanggan.' }),
  editing ? f.readOnly('orderNumber', 'No. SO') : f.userOnly('orderNumber', 'No. SO'),
  f.date('orderDate', 'Tanggal order', { required: true }),
  f.date('deliveryDate', 'Tanggal kirim (ETD)'),
  f.select('channel', 'Channel', ORDER_CHANNELS.map((c) => ({ value: c, label: c }))),
  ...(canViewAll ? [f.select('ownerUserId', 'PIC sales', accounts)] : []),
  f.rows('lines', 'Barang', [
    f.lookup('product', 'Produk', searchProduct, { required: true, labelOf: productTokenName, hint: 'SKU atau nama produk.' }),
    f.number('qty', 'Qty', { required: true, min: 0.01 }),
    f.userOnly('unitPrice', 'Harga', 'number'),
    f.userOnly('taxable', 'PPN', 'checkbox'),
  ], { required: true, maxRows: MAX_AI_LINES, emptyRow: emptyLine, getRows: getLines, setRows: setLines }),
  f.userOnly('deliveryFee', 'Ongkos kirim', 'number'),
  f.textarea('notes', 'Catatan order', { maxLength: 2000 }),
];
const AI_ORDER = defineAIForm({
  id: 'sales-order', title: 'Sales order', permission: 'sales.order.manage', submitLabel: 'Simpan sales order', fields: orderFields,
});
const AI_ORDER_EDIT = defineAIForm({
  id: 'sales-order-edit', title: 'Ubah sales order', permission: 'sales.order.manage', submitLabel: 'Simpan perubahan', mode: 'edit', fields: orderFields,
});

// Line problems, keyed by line: qty must be above 0 and a price given.
function lineErrors(lines) {
  const errors = {};
  for (const l of lines) {
    if (!l.productName.trim()) continue;
    const e = {};
    if (!(Number(l.qty) > 0)) e.qty = 'Lebih dari 0';
    if (l.unitPrice === '' || Number(l.unitPrice) < 0) e.unitPrice = 'Isi harga';
    if (Object.keys(e).length) errors[l.key] = e;
  }
  return errors;
}

export default function SalesOrderForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const formId = useId();
  const canViewAll = useCanViewAll();
  const accurate = useAccurateSource();
  const accounts = useSalesAccounts(canViewAll);
  const [state, setState] = useState({ loading: editing, error: '', locked: false });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({ lines: {} });
  const [customer, setCustomer] = useState({ id: Number(params.get('customer')) || null, label: '', channel: '' });
  const [form, setForm] = useState({
    orderNumber: '', orderDate: todayIso(), deliveryDate: '', channel: '', ownerUserId: '', deliveryFee: '', notes: '',
  });
  const [lines, setLines] = useState([emptyLine()]);
  // The form as it opened (new: today's date; edit: the loaded order).
  const [opened, setOpened] = useState(() => ({ customer: null, orderDate: todayIso(), deliveryDate: '', channel: '', ownerUserId: '', notes: '' }));
  const [numberTouched, setNumberTouched] = useState(false);
  // Anything the user typed or picked: closing then asks before discarding.
  const [touched, setTouched] = useState(false);

  // Back to the page the user came from; a direct visit goes to Data Sales.
  const close = useCallback(() => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate(editing ? `/sales/orders/${id}` : '/sales/orders');
  }, [navigate, editing, id]);

  // Editing: load the order; it must still be editable.
  const loadOrder = useCallback(() => {
    if (!editing) return;
    setState({ loading: true, error: '', locked: false });
    api.get(`/sales/orders/${id}`).then((r) => {
      const { order, lines: rows } = r.data.data;
      if (!order.editable) { setState({ loading: false, error: '', locked: true }); return; }
      setCustomer({ id: order.customerId, label: order.customerName, channel: '' });
      const loaded = {
        orderNumber: order.orderNumber, orderDate: String(order.orderDate || '').slice(0, 10),
        deliveryDate: order.deliveryDate ? String(order.deliveryDate).slice(0, 10) : '', channel: order.channel || '',
        ownerUserId: order.ownerUserId ? String(order.ownerUserId) : '', deliveryFee: String(Number(order.deliveryFee) || ''), notes: order.notes || '',
      };
      setForm(loaded);
      setOpened({ ...loaded, customer: order.customerName });
      setLines(rows.map((l) => ({
        key: String(l.lineNo), skuCode: l.skuCode || '', productName: l.productName || '', qty: String(l.qty), unitPrice: String(Number(l.unitPrice)), taxable: l.taxable,
      })));
      setState({ loading: false, error: '', locked: false });
    }).catch((err) => setState({ loading: false, error: apiError(err, 'Sales order tidak ditemukan'), locked: false }));
  }, [editing, id]);
  useEffect(() => { loadOrder(); }, [loadOrder]);

  // "Order lagi": start from the lines of an earlier order, at the prices this
  // customer paid then.
  const repeatFrom = params.get('dari');
  useEffect(() => {
    if (editing || !repeatFrom) return;
    api.get(`/sales/orders/${repeatFrom}`).then((r) => {
      const { order, lines: rows } = r.data.data;
      setLines(rows.map((l) => ({
        key: `r${l.lineNo}`, skuCode: l.skuCode || '', productName: l.productName || '', qty: String(Number(l.qty)),
        unitPrice: String(Number(l.unitPrice)), taxable: l.taxable,
      })));
      setForm((f) => ({ ...f, deliveryFee: Number(order.deliveryFee) ? String(Number(order.deliveryFee)) : f.deliveryFee, channel: f.channel || order.channel || '' }));
      toast(`Barang disalin dari ${order.orderNumber}. Periksa qty dan harga sebelum menyimpan.`, 'info');
    }).catch(() => {});
  }, [editing, repeatFrom]);

  // Prefill from a customer given in the URL (Detail customer → Buat sales order).
  useEffect(() => {
    if (editing || !customer.id || customer.label) return;
    api.get(`/sales/customers/${customer.id}`).then((r) => {
      const c = r.data.data.customer;
      setCustomer({ id: c.id, label: c.customer_code ? `${c.name} — ${c.customer_code}` : c.name, channel: c.channel });
      setForm((f) => ({ ...f, channel: f.channel || orderChannelFor(c.channel), ownerUserId: f.ownerUserId || (c.owner_user_id ? String(c.owner_user_id) : '') }));
    }).catch(() => {});
  }, [editing, customer.id, customer.label]);

  // Suggested SO number, until the user types their own.
  const numberDate = form.deliveryDate || form.orderDate;
  useEffect(() => {
    if (editing || numberTouched || !numberDate) return;
    api.get('/sales/orders/next-number', { params: { date: numberDate, channel: form.channel || undefined } })
      .then((r) => setForm((f) => ({ ...f, orderNumber: r.data.data.orderNumber }))).catch(() => {});
  }, [editing, numberTouched, numberDate, form.channel]);

  const totals = useMemo(() => orderTotals(lines, form.deliveryFee), [lines, form.deliveryFee]);
  const set = (k) => (e) => { setTouched(true); setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const setLine = (key, patch) => {
    setTouched(true);
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setErrors((x) => ({ ...x, items: undefined, lines: { ...x.lines, [key]: undefined } }));
  };

  // Price: what this customer last paid for it, else the list price.
  const pickProduct = (p) => {
    setTouched(true);
    setErrors((x) => ({ ...x, items: undefined }));
    setLines((ls) => {
      const blank = ls.find((l) => !l.productName);
      const price = p.lastPrice ?? p.price;
      const filled = { skuCode: p.skuCode, productName: p.name, unitPrice: price !== null && price !== undefined ? String(price) : '' };
      return blank ? ls.map((l) => (l === blank ? { ...l, ...filled } : l)) : [...ls, { ...emptyLine(), ...filled }];
    });
  };

  // Picking a customer (the picker, or Prakasa AI through the same search)
  // also sets the order's channel and PIC from that customer.
  const chooseCustomer = (cid, c) => {
    setTouched(true);
    setErrors((x) => ({ ...x, customer: undefined }));
    setCustomer({ id: cid, label: customerLabel(c), channel: c?.channel || '' });
    if (c) setForm((current) => ({ ...current, channel: orderChannelFor(c.channel), ownerUserId: c.ownerUserId ? String(c.ownerUserId) : current.ownerUserId }));
  };
  // Channel and PIC the form took from a customer Prakasa AI picked: not the
  // user's typing, so they go back with "Urungkan isian AI" and may still be changed by the AI.
  const [fromAiCustomer, setFromAiCustomer] = useState(null);
  const chooseCustomerForAI = (cid) => {
    const c = cid ? foundCustomers.current.get(cid) : null;
    if (c) {
      const taken = { channel: orderChannelFor(c.channel), ...(c.ownerUserId ? { ownerUserId: String(c.ownerUserId) } : {}) };
      setFromAiCustomer({ taken, before: { channel: form.channel, ownerUserId: form.ownerUserId } });
      chooseCustomer(cid, c);
      return;
    }
    chooseCustomer(null);
    if (fromAiCustomer) {
      const { taken, before } = fromAiCustomer;
      setForm((current) => ({
        ...current,
        ...Object.fromEntries(Object.keys(taken).filter((key) => current[key] === taken[key]).map((key) => [key, before[key]])),
      }));
    }
    setFromAiCustomer(null);
  };
  const foundCustomers = useRef(new Map());
  const searchCustomer = useCallback(async (text) => {
    const rows = await fetchCustomers(text);
    rows.forEach((c) => foundCustomers.current.set(c.id, c));
    return customerOptions(rows);
  }, []);
  const searchProduct = useCallback(async (text) => productOptions(await fetchProducts(text, customer.id)), [customer.id]);
  const ready = !state.loading && !state.error && !state.locked;
  const ai = usePrakasaAIForm(editing ? AI_ORDER_EDIT : AI_ORDER, {
    enabled: ready && !accurate,
    record: { type: 'sales_order', id: editing ? id : undefined },
    values: { ...form, customer: editing ? customer.label : customer.id },
    setValues: setForm,
    setters: { customer: chooseCustomerForAI },
    setErrors,
    onFill: () => setTouched(true),
    initialValues: fromAiCustomer ? { ...opened, ...fromAiCustomer.taken } : opened,
    context: {
      editing, searchCustomer, searchProduct, accounts, canViewAll,
      customerLabelOf: () => customer.label,
      getLines: () => linesForAI(lines),
      setLines: (rows) => { setTouched(true); setLines(linesFromAI(rows)); },
    },
  });

  const submit = async (e) => {
    e.preventDefault();
    const cleanLines = lines.filter((l) => l.productName.trim());
    const next = { lines: lineErrors(lines) };
    if (!customer.id) next.customer = 'Pilih pelanggan';
    if (!form.orderDate) next.orderDate = 'Isi tanggal order';
    if (!cleanLines.length) next.items = 'Isi minimal satu barang.';
    setErrors(next);
    if (next.customer || next.orderDate || next.items || Object.keys(next.lines).length) return;
    const body = {
      orderDate: form.orderDate,
      deliveryDate: form.deliveryDate || null,
      channel: form.channel || null,
      deliveryFee: Number(form.deliveryFee) || 0,
      notes: form.notes || null,
      ...(canViewAll && form.ownerUserId ? { ownerUserId: Number(form.ownerUserId) } : {}),
      lines: cleanLines.map((l) => ({
        skuCode: l.skuCode || null, productName: l.productName.trim(), qty: Number(l.qty), unitPrice: Number(l.unitPrice), taxable: Boolean(l.taxable),
      })),
    };
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/sales/orders/${id}`, body);
        toast('Sales order diperbarui', 'success');
        salesChanged();
        navigate(`/sales/orders/${id}`, { replace: true });
      } else {
        const r = await api.post('/sales/orders', { ...body, customerId: customer.id, ...(form.orderNumber ? { orderNumber: form.orderNumber.trim() } : {}) });
        toast(`Sales order ${r.data.data.orderNumber} dibuat`, 'success');
        salesChanged();
        navigate(`/sales/orders/${r.data.data.id}`, { replace: true });
      }
    } catch (err) {
      // customerId → the customer picker, lines → the Barang section; a key
      // with no field on screen still reaches the user as a toast.
      const visible = ['orderNumber', 'orderDate', 'deliveryDate', 'channel', 'deliveryFee', 'notes', 'items'];
      if (!editing) visible.push('customer');
      if (canViewAll) visible.push('ownerUserId');
      const { fields, message } = splitServerErrors(err, visible, { aliases: { customerId: 'customer', lines: 'items' }, fallback: 'Sales order gagal disimpan' });
      setErrors((x) => ({ ...x, ...fields }));
      if (message) toast(message, 'error');
    } finally { setSaving(false); }
  };

  // Transactions live in Accurate: nothing to enter here (PageTrail leads back).
  if (accurate) {
    return (
      <Page>
        <PageHeader eyebrow="Data Sales" title="Input di Accurate" />
        <Banner tone="info" title="Sales order dicatat di Accurate">
          Buat SO, surat jalan, invoice, dan pembayaran di Accurate; datanya tampil di aplikasi ini.
          Form input di sini dinonaktifkan supaya tidak ada dua versi pembukuan.
        </Banner>
      </Page>
    );
  }

  const title = editing ? `Ubah ${form.orderNumber || 'sales order'}` : (repeatFrom ? 'Order lagi' : 'Buat sales order');
  let content;
  if (state.loading) content = <FullScreenSection><LoadingState label="Memuat sales order…" /></FullScreenSection>;
  else if (state.error) {
    content = (
      <FullScreenSection>
        <EmptyState tone="error" title="Sales order belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={loadOrder}>Coba lagi</Button>} />
      </FullScreenSection>
    );
  } else if (state.locked) {
    content = (
      <FullScreenSection>
        <EmptyState
          icon="lock"
          title="Sales order ini tidak bisa diubah"
          description="Sales order yang sudah ditagih atau dibayar terkunci: barang dan nilainya tidak bisa diubah lagi."
          action={<Button variant="text" to={`/sales/orders/${id}`}>Lihat sales order</Button>}
        />
      </FullScreenSection>
    );
  } else {
    content = (
      <form id={formId} className="pw-stack pw-stack--lg" onSubmit={submit} noValidate>
        {ai.notice}
        <FullScreenSection title="Order">
          <div className="pw-fsdialog__fields">
            {editing ? <Input label="Pelanggan" value={customer.label} disabled /> : (
              <div className="sales-order-customer">
                <CustomerPicker
                  label="Pelanggan"
                  value={customer.id}
                  initialLabel={customer.label}
                  required
                  error={errors.customer}
                  {...ai.field('customer')}
                  onChange={(cid, c) => { setFromAiCustomer(null); chooseCustomer(cid, c); }}
                />
              </div>
            )}
            <Input
              label="No. SO"
              value={form.orderNumber}
              onChange={(e) => { setNumberTouched(true); set('orderNumber')(e); }}
              disabled={editing}
              hint={editing ? undefined : 'Otomatis; boleh diubah'}
              error={errors.orderNumber}
              mono
            />
            <DateInput label="Tanggal order" value={form.orderDate} {...ai.field('orderDate')} onChange={set('orderDate')} required error={errors.orderDate} />
            <DateInput label="Tanggal kirim (ETD)" value={form.deliveryDate} {...ai.field('deliveryDate')} onChange={set('deliveryDate')} error={errors.deliveryDate} />
            <Select label="Channel" value={form.channel} {...ai.field('channel')} onChange={set('channel')} options={ORDER_CHANNELS.map((c) => ({ value: c, label: c }))} dataOptions placeholder="Pilih channel" error={errors.channel} />
            {canViewAll ? <Select label="PIC sales" value={form.ownerUserId} {...ai.field('ownerUserId')} onChange={set('ownerUserId')} options={accounts} dataOptions placeholder="Ikut PIC pelanggan" error={errors.ownerUserId} /> : null}
          </div>
        </FullScreenSection>

        <FullScreenSection title={`Barang (${lines.filter((l) => l.productName).length})`}>
          <ProductPicker onPick={pickProduct} customerId={customer.id} />
          {errors.items ? <Banner tone="error">{errors.items}</Banner> : null}
          <div className="pw-stack">
            {lines.map((l, i) => (
              <div key={l.key} className={ai.rowClass('lines', i, 'sales-line')}>
                <Input label={`Produk ${i + 1}`} value={l.productName} {...ai.row('lines', i)} onChange={(e) => setLine(l.key, { productName: e.target.value })} fieldClassName="sales-line__name" />
                <Input label="SKU" value={l.skuCode} onChange={(e) => setLine(l.key, { skuCode: e.target.value })} mono />
                <Input label="Qty" type="number" min="0" step="any" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} error={errors.lines?.[l.key]?.qty} />
                <Input label="Harga" type="number" min="0" step="any" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} error={errors.lines?.[l.key]?.unitPrice} />
                <Select
                  label="PPN"
                  value={l.taxable ? 'yes' : 'no'}
                  onChange={(e) => setLine(l.key, { taxable: e.target.value === 'yes' })}
                  options={[{ value: 'no', label: 'Tidak' }, { value: 'yes', label: 'Ya' }]}
                />
                <span className="sales-line__total">{formatRupiah(totals.lines[i]?.lineTotal || 0)}</span>
                <IconButton
                  size="sm"
                  icon="delete"
                  label="Hapus baris"
                  tone="danger"
                  onClick={() => { setTouched(true); setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [emptyLine()])); }}
                />
              </div>
            ))}
          </div>
          <div>
            <Button variant="text" type="button" icon="add" onClick={() => { setTouched(true); setLines((ls) => [...ls, emptyLine()]); }}>Tambah baris</Button>
          </div>
        </FullScreenSection>

        <FullScreenSection title="Total dan catatan">
          <div className="pw-fsdialog__fields">
            <Input label="Ongkos kirim" type="number" min="0" value={form.deliveryFee} onChange={set('deliveryFee')} hint="Rupiah" error={errors.deliveryFee} />
          </div>
          <KeyValue columns={2} items={[
            { label: 'Subtotal barang', value: formatRupiah(totals.subtotal) },
            { label: 'Ongkos kirim', value: formatRupiah(totals.deliveryFee) },
            { label: 'Total', value: <span className="pw-strong">{formatRupiah(totals.totalAmount)}</span> },
            { label: 'PPN 11% (dicatat)', value: formatRupiah(totals.taxAmount) },
          ]}
          />
          <p className="pw-text-helper">Yang ditagih = barang + ongkos kirim; PPN 11% dicatat terpisah, sama seperti data sebelumnya.</p>
          <Textarea label="Catatan order" rows={3} value={form.notes} {...ai.field('notes')} onChange={set('notes')} error={errors.notes} />
        </FullScreenSection>
      </form>
    );
  }

  return (
    <FullScreenDialog
      open
      asPage
      onClose={close}
      dirty={touched && !saving}
      title={title}
      card={false}
      actions={(
        <>
          <Button variant="text" type="button" onClick={close}>Batal</Button>
          {ready ? <Button type="submit" form={formId} loading={saving}>{editing ? 'Simpan perubahan' : 'Simpan sales order'}</Button> : null}
        </>
      )}
    >
      {content}
    </FullScreenDialog>
  );
}
