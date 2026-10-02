import { useSearchParams } from 'react-router-dom';
import Banner from '../../components/Banner';
import EmptyState from '../../components/EmptyState';
import Page from '../../components/Page';
import TabBar from '../../components/TabBar';
import { useAuth } from '../../context/AuthContext';
import { DEFAULT_PRESET, FLOW_TABS, flowTabs, isPreset } from './managementFlowModel';
import FlowSales from './flow/FlowSales';
import FlowPurchase from './flow/FlowPurchase';
import MarginEstimate from './flow/MarginEstimate';
import SlowMovers from './flow/SlowMovers';
import './management-flow.css';

// Alur & Margin (program 3.3): the order-to-cash and purchase flows, the
// margin estimate from PO prices and slow movers — from approved Accurate data,
// for management only. Read-only. This page publishes no Prakasa AI context:
// the AI never reads the margin, purchase prices or stock values.
export default function ManagementFlow() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabs = flowTabs(user?.permissions);
  const requested = searchParams.get('tab');
  const tab = tabs.some((t) => t.k === requested) ? requested : tabs[0]?.k;
  const denied = requested && !tabs.some((t) => t.k === requested) ? FLOW_TABS.find((t) => t.k === requested) : null;
  const preset = isPreset(searchParams.get('period')) ? searchParams.get('period') : DEFAULT_PRESET;
  const setParams = (patch) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    return next;
  }, { replace: true });
  const onPreset = (key) => setParams({ period: key === DEFAULT_PRESET ? '' : key });

  return (
    <Page
      title="Alur & margin"
      description="Dari pesanan sampai lunas, dari PO sampai barang datang, perkiraan margin, dan barang lambat laku — data Accurate yang sudah disetujui. Khusus manajemen."
    >
      <TabBar tabs={tabs} value={tab} onChange={(k) => setParams({ tab: k })} label="Menu Alur & Margin" idPrefix="mflow-tab" panelId="mflow-tabpanel" />
      {denied ? <Banner tone="warning" title={`Anda tidak punya akses ke tab ${denied.l}`}>Yang ditampilkan adalah tab lain yang boleh Anda buka.</Banner> : null}
      <div id="mflow-tabpanel" role="tabpanel" aria-labelledby={tab ? `mflow-tab-${tab}` : undefined}>
        {!tab && <EmptyState icon="lock" title="Belum ada akses" description="Halaman ini khusus manajemen." />}
        {tab === 'sales' && <FlowSales preset={preset} onPreset={onPreset} />}
        {tab === 'purchase' && <FlowPurchase preset={preset} onPreset={onPreset} />}
        {tab === 'margin' && <MarginEstimate preset={preset} onPreset={onPreset} />}
        {tab === 'slow' && <SlowMovers />}
      </div>
    </Page>
  );
}
