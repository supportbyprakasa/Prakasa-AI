import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import EmptyState from '../../components/EmptyState';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import TabBar from '../../components/TabBar';
import { useAuth } from '../../context/AuthContext';
import { AccurateBatchList } from '../sales/SalesAccurateBatch';
import { formatDateTime } from '../../components/format';
import ProcurementToday from './ProcurementToday';
import ProcurementOrders from './ProcurementOrders';
import ProcurementVendors from './ProcurementVendors';
import ProcurementPrices from './ProcurementPrices';
import ProcurementReorder from './ProcurementReorder';
import './procurement.css';

// Procurement (program 2.1): POs, vendors and incoming goods from approved
// Accurate data. Read-only; Accurate is only ever read.
const TABS = [
  { k: 'today', l: 'Hari ini', permission: 'procurement.view' },
  { k: 'reorder', l: 'Saran pesan ulang', permission: 'procurement.reorder.view' },
  { k: 'orders', l: 'Purchase order', permission: 'procurement.view' },
  { k: 'vendors', l: 'Pemasok', permission: 'procurement.view' },
  { k: 'prices', l: 'Harga beli', permission: 'procurement.price.view' },
  { k: 'accurate', l: 'Data Accurate', permission: ['accurate.batch.view', 'procurement.accurate.sync'] },
];

export default function ProcurementDashboard() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const [searchParams, setSearchParams] = useSearchParams();
  const can = (code) => (Array.isArray(code) ? code.some((c) => permissions.includes(c)) : permissions.includes(code));
  const tabs = TABS.filter((t) => can(t.permission));
  const requested = searchParams.get('tab');
  const tab = tabs.some((t) => t.k === requested) ? requested : tabs[0]?.k;
  const denied = requested && !tabs.some((t) => t.k === requested) ? TABS.find((t) => t.k === requested) : null;
  const setTab = (next) => setSearchParams({ tab: next }, { replace: true });
  // Readiness and the price flag for every tab. A failed read leaves the
  // member view (no prices); each tab shows its own load error.
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (!tabs.length) return undefined;
    let alive = true;
    api.get('/procurement/accurate/status').then((r) => { if (alive) setStatus(r.data.data || null); }).catch(() => {});
    return () => { alive = false; };
  }, [tabs.length]);
  const asOf = status?.asOf;

  return (
    <Page>
      <PageHeader
        title="Procurement"
        description={asOf
          ? `Dari Accurate · ditarik ${formatDateTime(asOf.pulledAt)} · disetujui ${asOf.approvedBy || '—'} (${formatDateTime(asOf.approvedAt)})`
          : 'PO, pemasok, dan barang datang dari Accurate, setelah disetujui Head Procurement.'}
      />
      {tabs.length ? <TabBar tabs={tabs} value={tab} onChange={setTab} label="Menu Procurement" idPrefix="pc-tab" panelId="pc-tabpanel" /> : null}
      {denied ? <Banner tone="warning" title={`Anda tidak punya akses ke tab ${denied.l}`}>Yang ditampilkan adalah tab lain yang boleh Anda buka.</Banner> : null}
      <div id="pc-tabpanel" role="tabpanel" aria-labelledby={tab ? `pc-tab-${tab}` : undefined}>
        {!tab && <EmptyState title="Belum ada akses" description="Anda belum memiliki akses ke menu Procurement." />}
        {tab === 'today' && <ProcurementToday status={status} canSeeReorder={permissions.includes('procurement.reorder.view')} />}
        {tab === 'reorder' && <ProcurementReorder status={status} />}
        {tab === 'orders' && <ProcurementOrders status={status} canSeeReceipts={permissions.includes('warehouse.stock.view')} />}
        {tab === 'vendors' && <ProcurementVendors status={status} />}
        {tab === 'prices' && <ProcurementPrices />}
        {tab === 'accurate' && (
          <AccurateBatchList
            detailBase="/data-accurate"
            division="procurement"
            canPull={can('procurement.accurate.sync')}
            syncEndpoint="/procurement/accurate/sync"
            note="Data PO dan pemasok dari Accurate baru dipakai di aplikasi setelah disetujui Head Procurement (pengganti: Head Management Office). Kontak, NPWP, KTP, dan rekening pemasok tidak pernah diambil."
          />
        )}
      </div>
    </Page>
  );
}
