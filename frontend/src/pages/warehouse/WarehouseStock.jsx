import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import KeyValue from '../../components/KeyValue';
import Select from '../../components/Select';
import SideSheet from '../../components/SideSheet';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDateTime } from '../../components/format';
import { statusLabel } from '../../components/statusTone';
import { useAuth } from '../../context/AuthContext';
import useSalesList from '../sales/useSalesList';
import { apiError } from '../sales/salesModel';
import {
  STOCK_FILTERS, STOCK_STATUS, asOfText, chipLabel, coverReasonText, coverText, dateOnly, dayText, lineQtyText, movementDirectionText,
  movementTypeLabel, perWarehouseText, stockText, unitsText,
} from './warehouseStockModel';
import { usePublishPrakasaAIContext } from '../../context/PrakasaAIToolContext';
import { NoTranslate, Translate } from '../../i18n/NoTranslate';

// Stock from Accurate (Warehouse stage 1): Accurate's own quantities, as of the
// last pull the Warehouse Supervisor or Head approved. Quantities only — no
// price or cost exists here. Nothing on this tab changes any data.

const cell = (title, meta) => (
  <span className="pw-cell">
    <span className="pw-cell__title">{title}</span>
    {meta ? <span className="pw-cell__meta">{meta}</span> : null}
  </span>
);

// With a gudang chosen, "Stok" is that gudang's quantity (0 when it holds none).
const stockColumns = (warehouse) => [
  { key: 'name', header: 'Barang', render: (r) => cell(r.name, r.itemNo), exportValue: (r) => `${r.name} (${r.itemNo})` },
  { key: 'category', header: 'Kategori' },
  {
    key: 'qty', header: warehouse ? `Stok di ${warehouse.name}` : 'Stok', align: 'end',
    render: (r) => {
      const here = warehouse ? r.warehouses.find((w) => w.warehouseId === warehouse.id) : null;
      return warehouse ? stockText(here?.qty ?? 0, here?.qtyAllUnits) : stockText(r.qty, r.qtyAllUnits);
    },
    exportValue: (r) => (warehouse ? (r.warehouses.find((w) => w.warehouseId === warehouse.id)?.qty ?? 0) : r.qty),
  },
  { key: 'daysCover', header: 'Cukup untuk', align: 'end', translate: true, render: (r) => coverText(r.daysCover), exportValue: (r) => r.daysCover },
  { key: 'warehouses', header: 'Per gudang', render: (r) => <span className="pw-cell__meta">{perWarehouseText(r.warehouses)}</span>, exportValue: (r) => perWarehouseText(r.warehouses) },
  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={STOCK_STATUS[r.status]} />, exportValue: (r) => statusLabel(STOCK_STATUS[r.status]) },
];

// "Masuk" / "Keluar" are interface labels; "Pindah A → B" names gudang and stays data.
const directionCell = (m) => (m.direction === 'move' ? movementDirectionText(m) : <Translate context="direction">{movementDirectionText(m)}</Translate>);

// The stock card: which approved documents moved the item (each in its own unit).
const MOVEMENT_COLUMNS = [
  { key: 'date', header: 'Tanggal', render: (m) => dayText(m.date), exportValue: (m) => dateOnly(m.date) },
  { key: 'number', header: 'Dokumen', render: (m) => cell(m.number, <Translate>{movementTypeLabel(m.type)}</Translate>), exportValue: (m) => m.number },
  { key: 'direction', header: 'Arah', render: directionCell, exportValue: movementDirectionText },
  { key: 'qty', header: 'Jumlah', translateContext: 'quantity', align: 'end', render: lineQtyText, exportValue: (m) => m.qty },
  { key: 'warehouse', header: 'Gudang', render: (m) => m.warehouse || '—' },
];

// A computed, read-only drill-down (§2.2): the item's stock per gudang, its
// stock card and its approved history, in a side sheet.
function StockItemSheet({ item: row, onClose }) {
  const [state, setState] = useState({ loading: true, error: '', item: null });
  const [attempt, setAttempt] = useState(0);
  const itemId = row?.itemId;
  useEffect(() => {
    if (!itemId) return undefined;
    let alive = true;
    setState({ loading: true, error: '', item: null });
    api.get(`/warehouse/stock/${itemId}`)
      .then((r) => { if (alive) setState({ loading: false, error: '', item: r.data.data }); })
      .catch((err) => { if (alive) setState({ loading: false, error: apiError(err), item: null }); });
    return () => { alive = false; };
  }, [itemId, attempt]);
  const { item } = state;
  return (
    <SideSheet open={Boolean(row)} onClose={onClose} dataTitle={Boolean(item?.name || row?.name)} title={item?.name || row?.name || 'Stok barang'}>
      {state.loading ? <LoadingState label="Memuat stok…" /> : null}
      {state.error ? (
        <EmptyState compact tone="error" title="Stok barang belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={() => setAttempt((n) => n + 1)}>Coba lagi</Button>} />
      ) : null}
      {item ? (
        <div className="pw-stack pw-stack--lg">
          <KeyValue items={[
            { label: 'Kode Accurate', value: item.itemNo },
            { label: 'Kategori', value: item.category },
            { label: 'Stok total', value: stockText(item.qty, item.qtyAllUnits) },
            { label: 'Satuan', value: unitsText(item.units) },
            { label: 'Cukup untuk', value: item.daysCover === null ? coverReasonText(item.coverReason) : coverText(item.daysCover), translate: true },
            { label: 'Status', value: <StatusBadge status={STOCK_STATUS[item.status]} /> },
          ]}
          />
          <section className="pw-stack">
            <h3 className="pw-title-section">Per gudang</h3>
            {item.warehouses.length ? (
              <KeyValue items={item.warehouses.map((w) => ({ key: w.warehouse, label: <NoTranslate>{w.warehouse}</NoTranslate>, value: stockText(w.qty, w.qtyAllUnits) }))} />
            ) : <EmptyState compact title="Tidak ada stok di gudang mana pun" />}
          </section>
          <section className="pw-stack">
            <h3 className="pw-title-section">Kartu stok</h3>
            {item.movements?.length ? (
              <DataGrid
                title="Kartu stok"
                showTitle={false}
                columns={MOVEMENT_COLUMNS}
                rows={item.movements.map((m, i) => ({ ...m, id: i }))}
                searchable={false}
                exportName={`kartu-stok-${item.itemNo}`}
              />
            ) : <EmptyState compact title="Belum ada dokumen gudang untuk barang ini" />}
            <div className="pw-text-helper">Dokumen gudang yang sudah disetujui.</div>
          </section>
          <section className="pw-stack">
            <h3 className="pw-title-section">Riwayat stok</h3>
            {item.history.length ? (
              <KeyValue items={item.history.map((h) => ({ key: `${h.version}-${h.approvedAt}`, label: formatDateTime(h.approvedAt), value: stockText(h.qty, h.qtyAllUnits) }))} />
            ) : <EmptyState compact title="Belum ada riwayat" />}
            <div className="pw-text-helper">Per tarikan Accurate yang disetujui.</div>
          </section>
        </div>
      ) : null}
    </SideSheet>
  );
}

export default function WarehouseStock() {
  const { user } = useAuth();
  const canSeeBatches = (user?.permissions || []).includes('accurate.batch.view');
  const [status, setStatus] = useState(null);
  const [q, setQ] = useState('');
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState(STOCK_FILTERS.some((f) => f.key === searchParams.get('status')) ? searchParams.get('status') : '');
  const [warehouseId, setWarehouseId] = useState(searchParams.get('warehouseId') || '');
  const [openItem, setOpenItem] = useState(null);
  const list = useSalesList('/warehouse/stock', { q, status: filter, warehouseId });
  usePublishPrakasaAIContext({ toolKey: 'warehouse', visibleState: { tab: 'stock', status: filter, q } });

  // Only the "as of" line and the banners come from here; the list shows its
  // own error.
  useEffect(() => {
    let alive = true;
    api.get('/warehouse/accurate/status')
      .then((r) => { if (alive) setStatus(r.data.data); })
      .catch(() => { if (alive) setStatus(null); });
    return () => { alive = false; };
  }, []);

  const asOf = asOfText(status);
  const warehouses = status?.warehouses || [];
  const selectedWarehouse = warehouses.find((w) => String(w.id) === warehouseId) || null;
  return (
    <div className="pw-stack">
      {status && !status.ready ? (
        <Banner tone="info" title="Stok dari Accurate belum tersedia">
          {status.pending
            ? `Data stok pertama menunggu persetujuan Supervisor atau Head Warehouse (batch #${status.pending.batchId}). Sampai disetujui, semua barang tampil 0.`
            : 'Belum ada data stok dari Accurate yang disetujui. Supervisor atau Head Warehouse dapat menariknya di tab Data Accurate.'}
        </Banner>
      ) : null}
      {status?.ready && status.pending ? (
        <Banner
          tone="warning"
          title="Ada pembaruan stok menunggu persetujuan"
          action={canSeeBatches ? <Button variant="text" to={`/data-accurate/${status.pending.batchId}`}>Buka batch #{status.pending.batchId}</Button> : null}
        >
          Angka di bawah masih dari tarikan terakhir yang disetujui.
        </Banner>
      ) : null}
      <DataGrid
        key={warehouseId || 'all'}
        title="Stok"
        showTitle={false}
        columns={stockColumns(selectedWarehouse)}
        rows={list.rows}
        idKey="itemId"
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        onPageChange={list.setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Kode, nama atau kategori barang"
        filters={(
          <>
            {STOCK_FILTERS.map((f) => (
              <Chip key={f.key || 'all'} selected={filter === f.key} onClick={() => setFilter(f.key)}>
                {chipLabel(f, list.meta.counts)}
              </Chip>
            ))}
            <Select
              label="Gudang"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              options={warehouses.map((w) => ({ value: String(w.id), label: w.name }))}
              dataOptions
              placeholder="Semua gudang"
              fieldClassName="wh-filter-select"
            />
          </>
        )}
        exportName="stok-gudang"
        onRowClick={setOpenItem}
      />
      <div className="pw-text-helper">{asOf || 'Jumlah saja, tanpa harga'}</div>
      <StockItemSheet item={openItem} onClose={() => setOpenItem(null)} />
    </div>
  );
}
