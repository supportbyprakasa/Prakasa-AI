import { useSearchParams } from 'react-router-dom';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import TabBar from '../../components/TabBar';
import { useAuth } from '../../context/AuthContext';
import { AccurateBatchList } from '../sales/SalesAccurateBatch';
import AccurateQuality from './AccurateQuality';

const VIEWS = [
  { k: 'batches', l: 'Batch' },
  { k: 'quality', l: 'Perlu dibereskan di Accurate' },
];

// "Data Accurate" for every division that receives Accurate data (Sales,
// Retail Commerce, Warehouse, Procurement, Finance): each Supervisor/Head sees
// and decides their own division's batches; the Management Office Head oversees.
export default function DataAccurate() {
  const { user } = useAuth();
  const canPull = (user?.permissions || []).includes('sales.master.manage');
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'perlu-dibereskan' ? 'quality' : 'batches';
  const show = (next) => setParams(next === 'quality' ? { view: 'perlu-dibereskan' } : {}, { replace: true });
  return (
    <Page>
      <PageHeader
        title="Data Accurate"
        description="Data dari Accurate yang menunggu atau sudah diputuskan divisi Anda. Hanya dibaca dari Accurate; tidak ada data yang diubah atau dihapus."
      />
      <TabBar tabs={VIEWS} value={view} onChange={show} label="Tampilan" idPrefix="data-accurate" panelId="data-accurate-panel" />
      <div id="data-accurate-panel" role="tabpanel" aria-labelledby={`data-accurate-${view}`}>
        {view === 'quality' ? <AccurateQuality /> : <AccurateBatchList detailBase="/data-accurate" canPull={canPull} />}
      </div>
    </Page>
  );
}
