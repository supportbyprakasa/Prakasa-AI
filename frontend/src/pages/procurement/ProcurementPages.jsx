import { useEffect, useState } from 'react';
import api from '../../api/client';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import TabBar from '../../components/TabBar';
import { formatDateTime } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import { DeniedTabBanner, NoAccess, useInnerTabs } from '../warehouse/WarehousePages';
import ProcurementToday from './ProcurementToday';
import ProcurementOrders from './ProcurementOrders';
import ProcurementVendors from './ProcurementVendors';
import ProcurementPrices from './ProcurementPrices';
import ProcurementReorder from './ProcurementReorder';
import './procurement.css';

// Procurement as a group of pages (owner, 3 Oct 2026): the former tabs of one
// /procurement page are pages of their own, with their old permissions. POs,
// vendors and incoming goods come from approved Accurate data; Accurate is
// only ever read here. An old /procurement?tab=… address is redirected by the
// shell (navigation.js LEGACY_TABS).

// Readiness and the price flag, read once per page. A failed read leaves the
// member view (no prices); each page shows its own load error.
function useProcurementStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/procurement/accurate/status').then((r) => { if (alive) setStatus(r.data.data || null); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return status;
}

const sourceText = (status) => (status?.asOf
  ? `Dari Accurate · ditarik ${formatDateTime(status.asOf.pulledAt)} · disetujui ${status.asOf.approvedBy || '—'} (${formatDateTime(status.asOf.approvedAt)})`
  : 'Dari Accurate, setelah disetujui Head Procurement.');

export function ProcurementTodayPage() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const status = useProcurementStatus();
  return (
    <Page>
      <PageHeader eyebrow="Procurement" title="Hari ini" description={`Barang datang hari ini, dijadwalkan datang, dan yang perlu perhatian. ${sourceText(status)}`} />
      <ProcurementToday status={status} canSeeReorder={permissions.includes('procurement.reorder.view')} />
    </Page>
  );
}

export function ProcurementOrdersPage() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const status = useProcurementStatus();
  return (
    <Page>
      <PageHeader eyebrow="Procurement" title="Purchase order" description={`Semua PO dengan status penerimaan barangnya. ${sourceText(status)}`} />
      <ProcurementOrders status={status} canSeeReceipts={permissions.includes('warehouse.stock.view')} />
    </Page>
  );
}

const VENDOR_TABS = [
  { k: 'vendors', l: 'Pemasok', permission: 'procurement.view' },
  { k: 'prices', l: 'Harga beli', permission: 'procurement.price.view' },
];

// Vendors and, for the Supervisor/Head and the Management Office, purchase prices (P1).
export function ProcurementVendorsPage() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const status = useProcurementStatus();
  const { tabs, tab, denied, setTab } = useInnerTabs(VENDOR_TABS, permissions);
  return (
    <Page>
      <PageHeader eyebrow="Procurement" title="Pemasok" description={`Kinerja pemasok: PO terbuka, terlambat, fill rate dan ketepatan waktu 90 hari. ${sourceText(status)}`} />
      {tabs.length > 1 ? <TabBar tabs={tabs} value={tab} onChange={setTab} label="Pemasok" idPrefix="pc-vendor-tab" panelId="pc-vendor-panel" /> : null}
      <DeniedTabBanner denied={denied} />
      <div id="pc-vendor-panel" role="tabpanel" aria-labelledby={tab ? `pc-vendor-tab-${tab}` : undefined}>
        {tab === 'vendors' ? <ProcurementVendors status={status} /> : null}
        {tab === 'prices' ? <ProcurementPrices /> : null}
        {!tab ? <NoAccess module="pemasok" /> : null}
      </div>
    </Page>
  );
}

export function ProcurementReorderPage() {
  const status = useProcurementStatus();
  return (
    <Page>
      <PageHeader eyebrow="Procurement" title="Saran pesan ulang" description={`Barang yang perlu dipesan: stok ditambah PO berjalan tidak cukup sampai barang baru datang. ${sourceText(status)}`} />
      <ProcurementReorder status={status} />
    </Page>
  );
}
