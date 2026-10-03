import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import TabBar from '../../components/TabBar';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatNumber } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import { useInnerTabs } from '../warehouse/WarehousePages';
import { RECEIVABLE_COLUMNS, SHIPMENT_COLUMNS } from './retailColumns';
import './retail.css';

// /retail-commerce/pending — what the marketplaces still owe the company:
// SOs waiting to ship and invoices not yet paid out, from the approved
// Accurate mirror (owner, 3 Oct 2026: a page of its own next to the
// dashboard). Read-only; needs retail.insight.view.
const TABS = [
  { k: 'shipments', l: 'SO belum dikirim', permission: 'retail.insight.view' },
  { k: 'receivables', l: 'Faktur belum cair', permission: 'retail.insight.view' },
];
const errorMessage = (error, fallback) => error?.response?.data?.error?.message || fallback;

export default function RetailPending() {
  const { user } = useAuth();
  const { tabs, tab, setTab } = useInnerTabs(TABS, user?.permissions || []);
  const [shipments, setShipments] = useState(null);
  const [receivables, setReceivables] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [s, r] = await Promise.all([api.get('/retail-commerce/pending-shipments'), api.get('/retail-commerce/receivables')]);
      setShipments(s.data.data);
      setReceivables(r.data.data);
    } catch (e) {
      setError(errorMessage(e, 'Periksa koneksi, lalu coba lagi.'));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = { shipments: shipments?.total, receivables: receivables?.total };
  const tabsWithCounts = tabs.map((t) => ({ ...t, count: counts[t.k] ?? undefined }));
  return (
    <Page>
      <PageHeader
        eyebrow="Retail Commerce"
        title="Pesanan & piutang"
        description="SO marketplace yang belum dikirim dan faktur rekap yang belum cair, dari data Accurate yang sudah disetujui."
        actions={<Button variant="secondary" icon="refresh" loading={loading} onClick={load}>Muat ulang</Button>}
      />
      <TabBar tabs={tabsWithCounts} value={tab} onChange={setTab} label="Pesanan & piutang" idPrefix="rc-pending-tab" panelId="rc-pending-panel" />
      <div id="rc-pending-panel" role="tabpanel" aria-labelledby={`rc-pending-tab-${tab}`} className="pw-stack">
        {error && !shipments ? <EmptyState tone="error" title="Data marketplace belum bisa dimuat" description={error} action={<Button variant="secondary" onClick={load}>Coba lagi</Button>} /> : null}
        {tab === 'shipments' ? (
          <>
            <DataGrid
              title={`SO belum dikirim${shipments?.total ? ` (${formatNumber(shipments.total)})` : ''}`}
              columns={SHIPMENT_COLUMNS}
              rows={shipments?.rows || []}
              loading={loading && !shipments}
              error={error && shipments ? error : ''}
              onRetry={load}
              searchPlaceholder="Cari nomor SO"
              exportName="retail-commerce-so-belum-dikirim"
              exportNote={shipments?.total > shipments?.rows?.length ? `${formatNumber(shipments.rows.length)} SO tertua dari ${formatNumber(shipments.total)}` : ''}
              empty="Semua SO marketplace sudah terkirim"
            />
            {shipments?.total > shipments?.rows?.length ? (
              <p className="pw-text-helper">{`Menampilkan ${formatNumber(shipments.rows.length)} SO tertua dari ${formatNumber(shipments.total)}.`}</p>
            ) : null}
          </>
        ) : null}
        {tab === 'receivables' ? (
          <>
            <DataGrid
              title="Faktur marketplace belum cair"
              columns={RECEIVABLE_COLUMNS}
              rows={receivables?.rows || []}
              loading={loading && !receivables}
              error={error && receivables ? error : ''}
              onRetry={load}
              searchPlaceholder="Cari nomor faktur"
              exportName="retail-commerce-piutang"
              exportNote={receivables?.total > receivables?.rows?.length ? `${formatNumber(receivables.rows.length)} faktur terlama dari ${formatNumber(receivables.total)}` : ''}
              empty="Tidak ada faktur marketplace yang belum cair"
            />
            {receivables?.total > receivables?.rows?.length ? (
              <p className="pw-text-helper">{`Menampilkan ${formatNumber(receivables.rows.length)} faktur dengan jatuh tempo terlama dari ${formatNumber(receivables.total)}.`}</p>
            ) : null}
          </>
        ) : null}
      </div>
    </Page>
  );
}
