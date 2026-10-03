import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import IconButton from '../../components/IconButton';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { useAuth } from '../../context/AuthContext';
import { CUSTOMER_STATUS_LABEL, daysAgoText } from './salesModel';
import SalesPeopleDialog from './SalesPeopleDialog';
import SalesScopeBanner, { AccurateHoldBanner, resetSalesScope } from './SalesScopeBanner';
import { CustomerFormModal } from './SalesForms';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import useSalesList from './useSalesList';
import FilterMenuChip from './FilterMenuChip';

const STATUS_FILTERS = [
  { key: '', label: 'Semua' },
  { key: 'aktif', label: 'Aktif' },
  { key: 'dormant', label: 'Dormant' },
  { key: 'lost', label: 'Lost' },
];

const COLUMNS = [
  { key: 'name', header: 'Pelanggan' },
  { key: 'code', header: 'ID pelanggan', nowrap: true },
  { key: 'channel', header: 'Channel' },
  { key: 'salesPersonName', header: 'Sales', render: (r) => r.salesPersonName || r.ownerName || '', exportValue: (r) => r.salesPersonName || r.ownerName || '' },
  { key: 'lastOrderDate', header: 'Order terakhir', type: 'date' },
  {
    // Interface text ("12 hari lalu", "Belum pernah"), not record data.
    key: 'daysSinceOrder', header: 'Sejak order', align: 'end', translate: true,
    render: (r) => (r.lastOrderDate ? daysAgoText(r.daysSinceOrder) : 'Belum pernah'),
    sortValue: (r) => r.daysSinceOrder ?? 1e9, exportValue: (r) => r.daysSinceOrder ?? '',
  },
  {
    key: 'status', header: 'Status', nowrap: true,
    render: (r) => <StatusBadge status={r.status} label={CUSTOMER_STATUS_LABEL[r.status]} />,
    exportValue: (r) => CUSTOMER_STATUS_LABEL[r.status] || r.status,
  },
];

export default function SalesCustomers() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const canManage = permissions.includes('sales.customer.manage');
  const canSeeOrders = permissions.includes('sales.order.view');
  const canMapPeople = permissions.includes('sales.master.manage');
  const [params, setParams] = useSearchParams();
  const status = STATUS_FILTERS.some((f) => f.key === params.get('status')) ? params.get('status') : '';
  const channel = params.get('channel') || '';
  const [q, setQ] = useState(params.get('q') || '');
  const [open, setOpen] = useState(false);
  // "Tambah pelanggan" opens by URL too (/sales/customers?baru=1 — a link, or Prakasa AI's buka_halaman).
  useOpenFromUrl('baru', () => { if (canManage) setOpen(true); });

  const list = useSalesList('/sales/customers', { status, channel, q });

  const setFilter = (key, value) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });

  const channels = list.meta.channels || [];

  return (
    <Page>
      <PageHeader
        title="Pelanggan"
        description="Semua pelanggan Prakasa. Status Aktif, Dormant, dan Lost dihitung otomatis dari order terakhir."
        actions={(canManage || canMapPeople) ? (
          <>
            {canMapPeople ? <Button variant="secondary" icon="manage_accounts" onClick={() => setFilter('pemetaan', '1')}>Pemetaan sales</Button> : null}
            {canManage ? <Button icon="add" onClick={() => setOpen(true)}>Tambah pelanggan</Button> : null}
          </>
        ) : null}
      />
      <SalesScopeBanner />
      <AccurateHoldBanner />
      <DataGrid
        title="Pelanggan"
        columns={COLUMNS}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        onPageChange={list.setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Cari nama, ID pelanggan, telepon, atau sales"
        filters={(
          <>
            {STATUS_FILTERS.map((f) => (
              <Chip key={f.key || 'all'} selected={status === f.key} onClick={() => setFilter('status', f.key)}>{f.label}</Chip>
            ))}
            <FilterMenuChip
              label="Channel"
              icon="storefront"
              value={channel}
              options={[{ value: '', label: 'Semua', translate: true }, ...channels.map((c) => ({ value: c, label: c }))]}
              dataOptions
              onChange={(value) => setFilter('channel', value)}
            />
          </>
        )}
        exportName="sales-customers"
        rowActions={(r) => (
          <>
            <IconButton size="sm" icon="visibility" label="Lihat detail" to={`/sales/customers/${r.id}`} />
            {canSeeOrders ? <IconButton size="sm" icon="receipt_long" label="Lihat order" to={`/sales/customers/${r.id}?tab=orders`} /> : null}
          </>
        )}
        empty={q ? 'Tidak ada pelanggan yang cocok dengan pencarian' : 'Tidak ada pelanggan untuk filter ini'}
      />

      <CustomerFormModal open={open} mode="create" channels={channels} onClose={() => setOpen(false)} onSaved={list.reload} />
      <SalesPeopleDialog
        open={canMapPeople && params.get('pemetaan') === '1'}
        onClose={() => setFilter('pemetaan', '')}
        onSaved={() => { resetSalesScope(); list.reload(); }}
      />
    </Page>
  );
}
