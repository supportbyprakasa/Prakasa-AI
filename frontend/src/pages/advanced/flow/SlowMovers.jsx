import { useState } from 'react';
import Banner from '../../../components/Banner';
import Button from '../../../components/Button';
import Chip from '../../../components/Chip';
import EmptyState, { LoadingState } from '../../../components/EmptyState';
import StatCard from '../../../components/StatCard';
import StatusBadge from '../../../components/StatusBadge';
import DataGrid from '../../../components/datagrid/DataGrid';
import { formatMoney } from '../../../components/format';
import { formatCount, formatRupiahShort } from '../../sales/salesModel';
import {
  SLOW_FILTERS, filterSlow, normalizeSlowMovers, pendingText, relevantPending, shortDate, slowChipLabel, slowCounts,
} from '../managementFlowModel';
import useFlowData from './useFlowData';
import { Translate } from '../../../i18n/NoTranslate';

// Barang lambat laku (program 3.3): items with Accurate stock and no approved
// sale for 60 / 90 days, for management with warehouse.stock.view (D2). The
// rupiah value only for price viewers (P1). Items never sold since the sales
// history starts are listed apart: mostly old item codes to check in Accurate.
function columns(prices) {
  return [
    {
      key: 'itemName', header: 'Barang',
      render: (r) => <span className="pw-cell"><span data-no-translate="" className="pw-cell__title">{r.itemName}</span><span data-no-translate="" className="pw-cell__meta">{r.itemNo}</span></span>,
      exportValue: (r) => `${r.itemName} (${r.itemNo})`,
    },
    {
      key: 'qty', header: 'Stok', align: 'end',
      render: (r) => <span className="pw-cell"><span>{formatCount(r.qty)}</span>{r.qtyAllUnits ? <span className="pw-cell__meta">{r.qtyAllUnits}</span> : null}</span>,
      exportValue: (r) => r.qty,
    },
    { key: 'lastSoldOn', header: 'Terakhir terjual', render: (r) => (r.lastSoldOn ? <span className="pw-nowrap">{shortDate(r.lastSoldOn)}</span> : <Translate>Belum pernah</Translate>), exportValue: (r) => r.lastSoldOn || '' },
    { key: 'idleSince', header: 'Diam sejak', render: (r) => <span className="pw-nowrap">{shortDate(r.idleSince)}</span>, exportValue: (r) => r.idleSince },
    { key: 'idleDays', header: 'Hari', align: 'end', render: (r) => formatCount(r.idleDays), exportValue: (r) => r.idleDays },
    { key: 'out30d', header: 'Keluar 30 hari', align: 'end', render: (r) => (r.out30d === null ? null : formatCount(r.out30d)), exportValue: (r) => r.out30d },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
    ...(prices ? [{ key: 'value', header: 'Nilai perkiraan', align: 'end', render: (r) => (r.value === null ? null : formatMoney(r.value)), exportValue: (r) => r.value }] : []),
  ];
}

export default function SlowMovers() {
  const [filter, setFilter] = useState('all');
  const { loading, error, data, reload } = useFlowData('/management-dashboard/slow-movers', {});
  const s = normalizeSlowMovers(data);
  const pending = pendingText(relevantPending(s.pending, 'slow'));
  const counts = slowCounts(s.items);
  const items = filterSlow(s.items, filter);
  const start = shortDate(s.horizon.dataStart);
  const value = (key) => (s.valueTotals && s.valueTotals[key] !== null ? `nilai perkiraan ${formatRupiahShort(s.valueTotals[key])} (harga beli terakhir)` : null);
  if (loading && !data) return <LoadingState label="Memuat barang lambat laku…" />;
  if (error) return <EmptyState tone="error" title="Barang lambat laku belum bisa dimuat" description={error} action={<Button variant="secondary" onClick={reload}>Coba lagi</Button>} />;
  if (!s.ready) {
    return (
      <div className="pw-stack">
        {pending ? <Banner tone="info">{pending}</Banner> : null}
        <EmptyState icon="hourglass_empty" title="Menunggu stok dari Accurate dan riwayat penjualan" description="Daftar ini tampil setelah stok Accurate disetujui Warehouse dan ada faktur penjualan yang disetujui." />
      </div>
    );
  }
  return (
    <div className="pw-stack pw-stack--lg">
      {pending ? <Banner tone="info">{pending}</Banner> : null}
      <Banner tone="info">
        {`Riwayat penjualan tersedia sejak ${start}. Barang yang belum pernah terjual sejak itu kebanyakan kode barang lama — cek di Accurate apakah stoknya sudah dipindah ke kode baru.`}
      </Banner>
      <div className="pw-cols-3 mflow-kpis">
        <StatCard label={`Pernah laku, tidak laku ≥ ${s.horizon.deadDays} hari`} value={`${formatCount(counts.dead)} barang`} note={value('dead')} />
        <StatCard label={`Lambat laku ${s.horizon.slowDays}–${s.horizon.deadDays - 1} hari`} value={`${formatCount(counts.slow)} barang`} note={value('slow')} />
        <StatCard label={`Belum pernah terjual sejak ${start} (cek kode lama)`} value={`${formatCount(counts.never)} barang`} note={value('neverSold')} />
      </div>
      <div className="pw-stack pw-stack--sm">
        <DataGrid
          key={filter}
          title="Barang"
          columns={columns(s.prices)}
          rows={items.map((r) => ({ ...r, id: r.itemId ?? r.itemNo }))}
          filters={SLOW_FILTERS.map((f) => (
            <Chip key={f.key} selected={filter === f.key} onClick={() => setFilter(f.key)}>{slowChipLabel(f.key, counts, s.horizon)}</Chip>
          ))}
          exportName="barang-lambat-laku"
          empty="Tidak ada barang untuk saringan ini"
        />
        <p className="pw-text-helper mflow-note-text">
          {`Dari ${formatCount(s.stockItems)} barang berstok di Accurate (disetujui Warehouse) dan faktur penjualan yang disetujui, tanpa uang muka. `}
          Barang yang belum pernah terjual dihitung sejak PO pertamanya (barang baru tidak dianggap diam sebelum datang). “Keluar 30 hari” tampil setelah 7 hari riwayat stok.
          {s.prices ? ' Nilai = stok × harga beli terakhir per satuan dasar (sebelum PPN), perkiraan.' : ''}
        </p>
      </div>
    </div>
  );
}
