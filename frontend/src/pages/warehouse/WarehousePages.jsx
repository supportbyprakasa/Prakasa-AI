import { Navigate, useSearchParams } from 'react-router-dom';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import TabBar from '../../components/TabBar';
import { useAuth } from '../../context/AuthContext';
import MovementList from './WarehouseMovements';
import WarehouseStock from './WarehouseStock';
import WarehouseToday from './WarehouseToday';
import WarehouseShipping from './WarehouseShipping';
import WarehouseAccurateDocs from './WarehouseAccurateDocs';
import WarehouseRecon from './WarehouseRecon';
import './warehouse-movements.css';

// Warehouse as a group of pages (owner, 3 Oct 2026): the former tabs of one
// /warehouse page are pages of their own, each with its old tab's permission.
// A page that still holds several views keeps a TabBar (?tab=…), and an old
// /warehouse?tab=… address is redirected by the shell (navigation.js LEGACY_TABS).
// Only quantities: never a price.

const can = (permissions, code) => (Array.isArray(code) ? code.some((c) => permissions.includes(c)) : permissions.includes(code));

// One page with inner tabs: the tabs this user may open, the one requested in
// the URL (or the first), and a note when a link asks for a tab they may not open.
export function useInnerTabs(tabs, permissions) {
  const [searchParams, setSearchParams] = useSearchParams();
  const allowed = tabs.filter((t) => can(permissions, t.permission));
  const requested = searchParams.get('tab');
  const tab = allowed.some((t) => t.k === requested) ? requested : allowed[0]?.k;
  const denied = requested && !allowed.some((t) => t.k === requested) ? tabs.find((t) => t.k === requested) : null;
  const setTab = (next) => setSearchParams((p) => {
    // Filters of the previous tab (status, q…) do not carry over.
    const q = new URLSearchParams();
    if (next !== allowed[0]?.k) q.set('tab', next);
    for (const [key, value] of p) if (['form', 'baru'].includes(key)) q.set(key, value);
    return q;
  }, { replace: true });
  return { tabs: allowed, tab, denied, setTab };
}

export function DeniedTabBanner({ denied }) {
  if (!denied) return null;
  return <Banner tone="warning" title={`Anda tidak punya akses ke tab ${denied.l}`}>Yang ditampilkan adalah tab lain yang boleh Anda buka.</Banner>;
}

export function NoAccess({ module }) {
  return <EmptyState title="Belum ada akses" description={`Anda belum memiliki akses ke ${module}.`} />;
}

// /warehouse — the day at a glance. Someone who only reads movements
// (Procurement, Retail Commerce) lands on the movements instead.
export function WarehouseTodayPage() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  if (!can(permissions, 'warehouse.stock.view')) return <Navigate to="/warehouse/movements" replace />;
  return (
    <Page>
      <PageHeader eyebrow="Warehouse" title="Hari ini" description="Barang datang, SO yang harus dikirim, dan yang perlu perhatian, dari data Accurate yang sudah disetujui. Hanya jumlah barang, tanpa harga." />
      <WarehouseToday />
    </Page>
  );
}

const MOVEMENT_TABS = [
  { k: 'inbound', l: 'Barang masuk', permission: 'warehouse.movement.view' },
  { k: 'outbound', l: 'Barang keluar', permission: 'warehouse.movement.view' },
  { k: 'approval', l: 'Approval Supervisor', permission: 'warehouse.movement.approve' },
  { k: 'history', l: 'Riwayat transaksi', permission: 'warehouse.movement.view' },
];

// /warehouse/movements — what the team records: inbound, outbound, the
// Supervisor's queue and the history. The create button follows the tab.
export function WarehouseMovementsPage() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const { tabs, tab, denied, setTab } = useInnerTabs(MOVEMENT_TABS, permissions);
  const create = can(permissions, 'warehouse.movement.create') && (tab === 'inbound' || tab === 'outbound')
    ? <Button icon="add" to={`/warehouse/movements/${tab}/new`}>{tab === 'inbound' ? 'Buat barang masuk' : 'Buat barang keluar'}</Button>
    : null;
  return (
    <Page>
      <PageHeader eyebrow="Warehouse" title="Pergerakan barang" description="Barang masuk dan keluar yang dicatat tim gudang, keputusan Supervisor, dan riwayatnya." actions={create} />
      {tabs.length ? <TabBar tabs={tabs} value={tab} onChange={setTab} label="Pergerakan barang" idPrefix="wh-move-tab" panelId="wh-move-panel" /> : null}
      <DeniedTabBanner denied={denied} />
      <div id="wh-move-panel" role="tabpanel" aria-labelledby={tab ? `wh-move-tab-${tab}` : undefined}>
        {tab ? <MovementList key={tab} mode={tab} /> : <NoAccess module="pergerakan barang" />}
      </div>
    </Page>
  );
}

const STOCK_TABS = [
  { k: 'stock', l: 'Stok', permission: 'warehouse.stock.view' },
  { k: 'documents', l: 'Dokumen Accurate', permission: 'warehouse.stock.view' },
  { k: 'recon', l: 'Cocokkan Accurate', permission: 'warehouse.recon.view' },
];

// /warehouse/stock — stock and documents from Accurate, and the reconciliation
// of the app's movements against them.
export function WarehouseStockPage() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const { tabs, tab, denied, setTab } = useInnerTabs(STOCK_TABS, permissions);
  return (
    <Page>
      <PageHeader eyebrow="Warehouse" title="Stok" description="Stok per gudang dan dokumen gudang dari Accurate yang sudah disetujui, serta pencocokan dengan pergerakan di aplikasi." />
      {tabs.length ? <TabBar tabs={tabs} value={tab} onChange={setTab} label="Stok" idPrefix="wh-stock-tab" panelId="wh-stock-panel" /> : null}
      <DeniedTabBanner denied={denied} />
      <div id="wh-stock-panel" role="tabpanel" aria-labelledby={tab ? `wh-stock-tab-${tab}` : undefined}>
        {tab === 'stock' ? <WarehouseStock /> : null}
        {tab === 'documents' ? <WarehouseAccurateDocs /> : null}
        {tab === 'recon' ? <WarehouseRecon /> : null}
        {!tab ? <NoAccess module="stok" /> : null}
      </div>
    </Page>
  );
}

// /warehouse/shipping — SOs to ship and whether stock covers them.
export function WarehouseShippingPage() {
  return (
    <Page>
      <PageHeader eyebrow="Warehouse" title="Jadwal kirim" description="SO yang harus dikirim, dari Accurate yang sudah disetujui, dan apakah stoknya cukup." />
      <WarehouseShipping />
    </Page>
  );
}
