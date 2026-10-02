import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import IconButton from '../../components/IconButton';
import KeyValue from '../../components/KeyValue';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import TabBar from '../../components/TabBar';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDate, formatNumber } from '../../components/format';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import {
  CUSTOMER_STATUS_LABEL, apiError, daysAgoText, formatRupiahShort, soldQty,
} from './salesModel';
import { CustomerFormModal } from './SalesForms';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import { AccurateHoldBanner, useAccurateSource } from './SalesScopeBanner';
import useSalesList from './useSalesList';
import SalesAging from './SalesAging';
import './sales.css';
import { Mixed, data } from '../../i18n/NoTranslate';

const TABS = [
  { key: 'overview', label: 'Ikhtisar' },
  { key: 'orders', label: 'Order' },
  { key: 'visits', label: 'Kunjungan' },
  { key: 'activity', label: 'Aktivitas' },
];

const ORDER_COLUMNS = [
  { key: 'orderNumber', header: 'No. SO', nowrap: true },
  { key: 'transactionDate', header: 'Tanggal', type: 'date' },
  { key: 'channel', header: 'Channel' },
  { key: 'doNumbers', header: 'Surat jalan', nowrap: true },
  { key: 'invoiceNumbers', header: 'Invoice', nowrap: true },
  { key: 'totalAmount', header: 'Total', type: 'money' },
  {
    key: 'outstandingAmount', header: 'Status', nowrap: true,
    render: (o) => (Number(o.outstandingAmount) > 0 ? <StatusBadge status="unpaid" /> : <StatusBadge status="paid" label="Lunas" />),
    exportValue: (o) => (Number(o.outstandingAmount) > 0 ? 'Belum lunas' : 'Lunas'),
  },
];

const VISIT_COLUMNS = [
  { key: 'visitDate', header: 'Tanggal', type: 'date' },
  { key: 'checkInTime', header: 'Jam', nowrap: true },
  { key: 'salesPersonName', header: 'Sales' },
  { key: 'summary', header: 'Hasil kunjungan', render: (v) => <span className="sales-note">{v.summary || ''}</span>, exportValue: (v) => v.summary || '' },
];

const ACTIVITY_LABEL = {
  'sales_customer.create': 'Pelanggan dibuat',
  'sales_customer.update': 'Pelanggan diubah',
  'sales_order.create': 'Sales order dibuat',
  'sales_order.update': 'Sales order diubah',
  'sales_order.cancel': 'Sales order dibatalkan',
  'sales_order.delivery': 'Surat jalan dibuat',
  'sales_order.invoice': 'Invoice dibuat',
  'sales_order.payment': 'Pembayaran dicatat',
};
const ACTIVITY_COLUMNS = [
  { key: 'createdAt', header: 'Waktu', type: 'datetime' },
  { key: 'action', header: 'Aktivitas', translate: true, render: (a) => ACTIVITY_LABEL[a.action] || a.action, exportValue: (a) => ACTIVITY_LABEL[a.action] || a.action },
  { key: 'userName', header: 'Oleh' },
];

// Best sellers for one customer, in base units once Accurate's units are in.
const TOP_PRODUCT_COLUMNS = [
  {
    key: 'name', header: 'Produk',
    render: (p) => <span className="pw-cell"><span className="pw-cell__title">{p.name}</span><span className="pw-cell__meta">{p.code}</span></span>,
    exportValue: (p) => p.name,
  },
  {
    key: 'qty', header: 'Terjual', align: 'end',
    render: (p) => { const q = soldQty(p); return q.detail ? <span className="pw-cell"><span className="pw-cell__title">{q.main}</span><span className="pw-cell__meta">{q.detail}</span></span> : q.main; },
    exportValue: (p) => soldQty(p).main,
  },
  { key: 'revenue', header: 'Omzet', align: 'end', translate: true, render: (p) => formatRupiahShort(p.revenue), exportValue: (p) => p.revenue },
];

const rupiahShort = (value) => formatRupiahShort(value) || 'Rp 0';

// One tab's list, paged on the server; the grid is its own panel.
function PagedGrid({ title, path, params, columns, exportName, empty, rowActions }) {
  const list = useSalesList(path, params);
  return (
    <DataGrid
      title={title}
      columns={columns}
      rows={list.rows}
      loading={list.loading}
      error={list.error}
      onRetry={list.reload}
      meta={list.meta}
      onPageChange={list.setPage}
      searchable={false}
      exportName={exportName}
      rowActions={rowActions}
      empty={empty}
    />
  );
}

export default function SalesCustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const canManage = permissions.includes('sales.customer.manage');
  const canSeeOrders = permissions.includes('sales.order.view');
  const canCreateOrder = permissions.includes('sales.order.manage');
  const accurate = useAccurateSource();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const setTab = (key) => setSearchParams(key === 'overview' ? {} : { tab: key }, { replace: true });
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [editOpen, setEditOpen] = useState(false);
  // "Ubah pelanggan" opens by URL too (/sales/customers/<id>?ubah=1), once the customer has loaded.
  useOpenFromUrl('ubah', () => { if (canManage) setEditOpen(true); }, { enabled: Boolean(state.data) });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/sales/customers/${id}`);
      setState({ loading: false, error: '', data: r.data.data });
    } catch (err) {
      setState({ loading: false, error: apiError(err, 'Pelanggan tidak ditemukan'), data: null });
    }
  }, [id]);
  useEffect(() => { setState({ loading: true, error: '', data: null }); load(); }, [load]);
  const retry = () => { setState({ loading: true, error: '', data: null }); load(); };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/sales/customers/${id}`);
      toast('Pelanggan dihapus', 'success');
      nav('/sales/customers');
    } catch (err) {
      toast(apiError(err, 'Pelanggan gagal dihapus'), 'error');
      setDeleteOpen(false);
    } finally { setDeleting(false); }
  };

  if (state.loading) return <Page><LoadingState label="Memuat pelanggan…" /></Page>;
  if (state.error) {
    return (
      <Page>
        <EmptyState tone="error" title="Pelanggan belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={retry}>Coba lagi</Button>} />
      </Page>
    );
  }

  const { customer, summary } = state.data;
  const statusLabel = CUSTOMER_STATUS_LABEL[customer.status];
  const orders = summary.orders;
  const profile = orders?.profile;
  const tabs = TABS.filter((t) => t.key !== 'orders' || canSeeOrders);
  const canOrder = canCreateOrder && !accurate;
  const menu = [
    canManage && !(orders?.count > 0) ? { label: 'Hapus pelanggan', icon: 'delete', tone: 'danger', onClick: () => setDeleteOpen(true) } : null,
  ].filter(Boolean);
  const lastOrder = customer.last_order_date
    ? `Order terakhir ${formatDate(customer.last_order_date)} (${daysAgoText(customer.daysSinceOrder).toLowerCase()})`
    : 'Belum pernah order';

  return (
    <Page>
      <PageHeader
        eyebrow="Pelanggan"
        dataTitle
        title={customer.name}
        description={(
          <span className="pw-row">
            {statusLabel ? <StatusBadge status={customer.status} label={statusLabel} /> : null}
            <span><Mixed parts={[data(customer.customer_code), data(customer.channel), lastOrder]} /></span>
          </span>
        )}
        actions={(canManage || canOrder) ? (
          <>
            {canManage ? <Button variant="secondary" icon="edit" onClick={() => setEditOpen(true)}>Ubah pelanggan</Button> : null}
            {canOrder && orders?.lastOrderId ? (
              <Button variant="secondary" icon="repeat" to={`/sales/orders/new?customer=${customer.id}&dari=${orders.lastOrderId}`}>Order lagi</Button>
            ) : null}
            {canOrder ? <Button icon="add" to={`/sales/orders/new?customer=${customer.id}`}>Buat sales order</Button> : null}
            <ActionMenu items={menu} />
          </>
        ) : null}
      />
      <AccurateHoldBanner />

      <div className="pw-cols-sidebar">
        <div className="pw-stack pw-stack--lg">
          <TabBar tabs={tabs} value={tab} onChange={setTab} label="Bagian pelanggan" idPrefix="customer-tab" panelId="customer-tab-panel" />
          <div id="customer-tab-panel" role="tabpanel" aria-labelledby={`customer-tab-${tab}`} className="pw-stack pw-stack--lg">
            {tab === 'overview' && !profile ? (
              <div className="pw-cols-2">
                {orders ? <StatCard label="Sales order" value={formatNumber(orders.count)} /> : null}
                {orders ? <StatCard label="Total order" value={rupiahShort(orders.total)} /> : null}
                {orders ? <StatCard label="Piutang" value={rupiahShort(orders.outstanding)} /> : null}
                <StatCard label="Kunjungan" value={formatNumber(summary.visits)} />
              </div>
            ) : null}
            {/* Program 2.3: the customer's profile from approved Accurate data. */}
            {tab === 'overview' && profile ? (
              <>
                <div className="pw-cols-2">
                  <StatCard label="Omzet 12 bulan (bersih retur)" value={rupiahShort(profile.revenue12m)} />
                  <StatCard label="Faktur 12 bulan" value={formatNumber(profile.invoices12m)} />
                  <StatCard label="Piutang" value={rupiahShort(profile.owed)} />
                  <StatCard label="Lewat jatuh tempo" value={rupiahShort(profile.overdue)} alert={Number(profile.overdue) > 0} note={Number(profile.overdue) > 0 ? 'Perlu ditagih' : undefined} />
                </div>
                <Card title="Pembelian dan pembayaran">
                  <KeyValue columns={2} items={[
                    { label: 'Faktur terakhir', value: profile.lastInvoiceDate ? formatDate(profile.lastInvoiceDate) : null },
                    { label: 'Pembayaran terakhir', value: profile.lastReceiptDate ? formatDate(profile.lastReceiptDate) : null },
                    { label: 'Syarat bayar rata-rata', value: profile.termDays === null ? null : (profile.termDays ? `${profile.termDays} hari` : 'Tunai'), translate: true },
                    { label: 'Retur 12 bulan', translate: true, value: rupiahShort(profile.returns12m) },
                    { label: 'Kunjungan', value: formatNumber(summary.visits) },
                  ]}
                  />
                </Card>
                <DataGrid
                  title="Produk teratas (12 bulan)"
                  columns={TOP_PRODUCT_COLUMNS}
                  rows={profile.topProducts.map((p) => ({ ...p, id: p.code }))}
                  searchable={false}
                  exportName={`produk-${customer.customer_code || customer.id}`}
                  empty="Belum ada pembelian 12 bulan terakhir"
                />
                <SalesAging customerId={customer.id} label="Umur piutang" />
              </>
            ) : null}

            {tab === 'orders' ? (
              <PagedGrid
                title="Sales order"
                path="/sales/orders"
                params={{ customerId: customer.id }}
                columns={ORDER_COLUMNS}
                exportName={`order-${customer.customer_code || customer.id}`}
                empty="Belum ada sales order"
                rowActions={(o) => (o.source === 'accurate' ? null : <IconButton size="sm" icon="visibility" label="Lihat detail" to={`/sales/orders/${o.id}`} />)}
              />
            ) : null}
            {tab === 'visits' ? (
              <PagedGrid title="Kunjungan" path={`/sales/customers/${customer.id}/visits`} params={{}} columns={VISIT_COLUMNS} exportName={`kunjungan-${customer.id}`} empty="Belum ada kunjungan" />
            ) : null}
            {tab === 'activity' ? (
              <PagedGrid title="Aktivitas" path={`/sales/customers/${customer.id}/activity`} params={{}} columns={ACTIVITY_COLUMNS} exportName={`aktivitas-${customer.id}`} empty="Belum ada aktivitas" />
            ) : null}
          </div>
        </div>

        <aside className="pw-stack pw-stack--lg">
          <Card title="Ringkasan">
            <KeyValue items={[
              { label: 'ID pelanggan', value: customer.customer_code },
              { label: 'Channel', value: customer.channel },
              { label: 'Bentuk usaha', value: customer.legal_form },
              { label: 'PIC sales', value: customer.ownerName || customer.sales_person_name },
              { label: 'Order pertama (NOO)', value: customer.noo_date ? formatDate(customer.noo_date) : null },
              { label: 'Order terakhir', value: customer.last_order_date ? formatDate(customer.last_order_date) : null },
              { label: 'Kontak', value: customer.contact_person },
              { label: 'Handphone', value: customer.phone },
              { label: 'Telp. bisnis', value: customer.business_phone },
              { label: 'Email', value: customer.email },
              { label: 'Alamat', value: customer.address },
              { label: 'Kota', value: customer.city },
              { label: 'Catatan', value: customer.notes },
            ]}
            />
          </Card>
        </aside>
      </div>

      <CustomerFormModal open={editOpen} mode="edit" customer={customer} onClose={() => setEditOpen(false)} onSaved={load} />
      <ConfirmDialog
        open={deleteOpen}
        title="Hapus pelanggan?"
        message={`Pelanggan "${customer.name}" akan dihapus. Riwayat aktivitasnya tetap tersimpan.`}
        confirmLabel="Hapus pelanggan"
        tone="danger"
        loading={deleting}
        onConfirm={doDelete}
        onClose={() => { if (!deleting) setDeleteOpen(false); }}
      />
    </Page>
  );
}
