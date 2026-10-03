import { useSearchParams } from 'react-router-dom';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import TabBar from '../../components/TabBar';
import { useAuth } from '../../context/AuthContext';
import { AccurateBatchList } from '../sales/SalesAccurateBatch';
import AccurateQuality from './AccurateQuality';
import { AccurateCustomerReconciliation, AccurateWriteRequestList } from './AccurateWriteRequests';

// view= in the URL → tab. "Pengajuan ke Accurate" and "Selisih pelanggan" are
// the write-back side (owner, 3 Oct 2026): proposals decided by the
// Supervisor/Head, never sent from here.
const VIEW_PARAM = { quality: 'perlu-dibereskan', requests: 'pengajuan', reconciliation: 'selisih' };
const ALL_VIEWS = [
  { k: 'batches', l: 'Batch', permission: ['accurate.batch.view', 'sales.master.manage', 'warehouse.accurate.sync', 'procurement.accurate.sync'] },
  { k: 'quality', l: 'Perlu dibereskan di Accurate', permission: ['accurate.batch.view', 'sales.master.manage', 'warehouse.accurate.sync', 'procurement.accurate.sync'] },
  { k: 'requests', l: 'Pengajuan ke Accurate', permission: ['accurate.write.request', 'accurate.batch.view'] },
  { k: 'reconciliation', l: 'Selisih pelanggan', permission: ['accurate.write.request', 'accurate.batch.view'] },
];

// "Data Accurate" for every division that receives Accurate data (Sales,
// Retail Commerce, Warehouse, Procurement, Finance): each Supervisor/Head sees
// and decides their own division's batches; the Management Office Head oversees.
export default function DataAccurate() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  // "Tarik sekarang" for the one scope this person may pull (owner, 3 Oct 2026:
  // the division pages lost their Data Accurate tab; the pull lives here).
  const pull = permissions.includes('sales.master.manage') ? { endpoint: '/sales/accurate/sync' }
    : permissions.includes('warehouse.accurate.sync') ? { endpoint: '/warehouse/accurate/sync' }
      : permissions.includes('procurement.accurate.sync') ? { endpoint: '/procurement/accurate/sync' }
        : null;
  const views = ALL_VIEWS.filter((v) => v.permission.some((p) => permissions.includes(p)));
  const [params, setParams] = useSearchParams();
  const fromUrl = Object.keys(VIEW_PARAM).find((k) => VIEW_PARAM[k] === params.get('view')) || 'batches';
  const view = views.some((v) => v.k === fromUrl) ? fromUrl : (views[0]?.k || 'batches');
  const show = (next) => setParams((p) => {
    const q = new URLSearchParams(p);
    q.delete('status');
    if (VIEW_PARAM[next]) q.set('view', VIEW_PARAM[next]); else q.delete('view');
    return q;
  }, { replace: true });
  return (
    <Page>
      <PageHeader
        title="Data Accurate"
        description="Data dari Accurate yang menunggu atau sudah diputuskan divisi Anda, dan pengajuan data dari aplikasi ke Accurate. Accurate tetap sumber kebenaran: tidak ada data Accurate yang diubah tanpa persetujuan Supervisor atau Head."
      />
      <TabBar tabs={views} value={view} onChange={show} label="Tampilan" idPrefix="data-accurate" panelId="data-accurate-panel" />
      <div id="data-accurate-panel" role="tabpanel" aria-labelledby={`data-accurate-${view}`}>
        {view === 'quality' ? <AccurateQuality /> : null}
        {view === 'requests' ? <AccurateWriteRequestList /> : null}
        {view === 'reconciliation' ? <AccurateCustomerReconciliation /> : null}
        {view === 'batches' ? <AccurateBatchList detailBase="/data-accurate" canPull={Boolean(pull)} syncEndpoint={pull?.endpoint} /> : null}
      </div>
    </Page>
  );
}
