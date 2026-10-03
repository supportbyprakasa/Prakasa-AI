import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Banner from '../../components/Banner';
import Chip from '../../components/Chip';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import SideSheet from '../../components/SideSheet';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { statusLabel } from '../../components/statusTone';
import useSalesList, { useDebouncedValue } from '../sales/useSalesList';
import {
  PO_STATUS, REORDER_STATUS, REORDER_URGENCIES, coverDaysText, dailyOutText, formatDate, isReorderUrgency, leadTimeText, onOrderMeta,
  qtyText, reorderChipLabel, reorderEmptyText, reorderNotice, reorderRulesText, rupiah, suggestionMeta, suggestionText,
} from './procurementModel';
import { usePublishPrakasaAIContext } from '../../context/PrakasaAIToolContext';
import { Mixed, Translate, data as dataPart } from '../../i18n/NoTranslate';

// Saran pesan ulang (program 3.1): which items run out before a new order could
// arrive and how much to order, from approved Accurate stock and POs. Total
// stock and days of cover only (D2 extended: Procurement Supervisor/Head and
// the Management Office); last purchase price only for procurement.price.view.
const dateExport = (value) => (value ? String(value).slice(0, 10) : '');
const cell = (title, meta) => (
  <span className="pw-cell">
    <span className="pw-cell__title">{title}</span>
    {meta ? <span className="pw-cell__meta">{meta}</span> : null}
  </span>
);
const stockText = (r) => r.stock.qtyAllUnits || qtyText(r.stock.qty, r.baseUnit);
// Language switch: record parts (PO number, vendor, units from Accurate) stay
// data; only the labels the app writes itself are wrapped in <Translate>.
const vendorMeta = (r) => (r.lastPo ? <>{`${r.lastPo.number} · ${formatDate(r.lastPo.date)}`}{r.vendor && !r.vendor.active ? <Translate>{' · nonaktif'}</Translate> : null}</> : '');
const ui = (text) => (text ? <Translate>{text}</Translate> : '');
// Each part in its own text node, so every part meets its own translation.
const dots = (parts) => {
  const shown = parts.filter(Boolean);
  return shown.length ? shown.map((part, index) => <span key={part}>{index ? ' · ' : ''}{part}</span>) : '';
};
const suggestionNode = (s) => (s ? suggestionText(s) : ui(suggestionText(s)));
const lastPriceNode = (price, unit) => <>{`${rupiah(price)}/`}{unit || <Translate>satuan</Translate>}</>;

const onOrderLine = (r) => dots([r.onOrder.qty ? `PO berjalan ${qtyText(r.onOrder.qty, r.baseUnit)}` : '', onOrderMeta(r.onOrder)]);
const coverLine = (r) => dots([dailyOutText(r.dailyOut, r.baseUnit), `datang ${r.leadTime.days} hari`]);
const suggestionNote = (s, baseUnit) => dots(suggestionMeta(s, baseUnit).split(' · '));
const poLink = (order) => <Link data-no-translate="" className="pw-link" to={`/procurement/orders?po=${order.id}`}>{order.number}</Link>;

function reorderColumns(prices) {
  return [
    { key: 'name', header: 'Barang', render: (r) => cell(r.name, r.itemNo), exportValue: (r) => r.name },
    {
      key: 'urgency', header: 'Status', translate: true,
      render: (r) => cell(<StatusBadge status={REORDER_STATUS[r.urgency]} />, r.stock.negative ? 'Stok minus di Accurate' : ''),
      exportValue: (r) => statusLabel(REORDER_STATUS[r.urgency]),
    },
    { key: 'stock', header: 'Stok total', align: 'end', render: (r) => cell(stockText(r), ui(onOrderLine(r))), exportValue: (r) => r.stock.qty },
    { key: 'coverDays', header: 'Cukup', translateContext: 'cover', align: 'end', translate: true, render: (r) => cell(coverDaysText(r.coverDays, r.coverReason), coverLine(r)), exportValue: (r) => r.coverDays },
    { key: 'suggestion', header: 'Saran pesan', align: 'end', render: (r) => cell(suggestionNode(r.suggestion), ui(suggestionNote(r.suggestion, r.baseUnit))), exportValue: (r) => r.suggestion?.units ?? '' },
    { key: 'vendor', header: 'Pemasok terakhir', render: (r) => cell(r.vendor?.name || <Translate>Belum pernah di-PO</Translate>, vendorMeta(r)), exportValue: (r) => r.vendor?.name || '' },
    ...(prices ? [{
      key: 'estimatedValue', header: 'Perkiraan nilai', align: 'end',
      render: (r) => cell(rupiah(r.estimatedValue), r.lastPrice ? <>{'@ '}{lastPriceNode(r.lastPrice.netPrice, r.suggestion?.unit || r.lastPo?.unit)}</> : ''),
      exportValue: (r) => r.estimatedValue ?? '',
    }] : []),
  ];
}

const openColumns = [
  { key: 'number', header: 'PO', render: poLink, exportValue: (o) => o.number },
  { key: 'date', header: 'Tanggal', render: (o) => formatDate(o.date), exportValue: (o) => dateExport(o.date) },
  { key: 'state', header: 'Status', render: (o) => <StatusBadge status={PO_STATUS[o.state]} />, exportValue: (o) => statusLabel(PO_STATUS[o.state]) },
  { key: 'remainingQty', header: 'Sisa', align: 'end', render: (o) => qtyText(o.remainingQty, o.unit), exportValue: (o) => o.remainingQty },
  { key: 'counted', header: 'Dihitung', translate: true, render: (o) => (o.counted ? 'Ya' : 'Tidak — PO lama'), exportValue: (o) => (o.counted ? 'Ya' : 'Tidak') },
];

// How the suggestion was counted: a computed drill-down (§2.2) in a side sheet.
function ReorderSheet({ row, prices, rules, readiness, onClose }) {
  const s = row?.suggestion;
  return (
    <SideSheet open={Boolean(row)} onClose={onClose} title={row ? <Mixed parts={[dataPart(row.name), 'hitungan saran']} /> : 'Hitungan saran'}>
      {row ? (
        <div className="pw-stack pw-stack--lg">
          <KeyValue items={[
            { label: 'Stok total', value: <>{stockText(row)}{row.stock.negative ? <Translate>{' — minus di Accurate, dihitung 0'}</Translate> : null}</> },
            { label: 'Keluar per hari', value: dailyOutText(row.dailyOut, row.baseUnit) || coverDaysText(null, row.coverReason), translate: true },
            { label: 'PO berjalan', value: <>{row.onOrder.qty ? qtyText(row.onOrder.qty, row.baseUnit) : '—'}{onOrderMeta(row.onOrder) ? <>{' · '}{ui(onOrderMeta(row.onOrder))}</> : null}</> },
            { label: 'Cukup dengan PO', value: coverDaysText(row.coverDays, row.coverReason), translate: true },
            { label: 'Cukup stok saja', value: coverDaysText(row.stockCoverDays, row.coverReason), translate: true },
            { label: 'Waktu datang', value: leadTimeText(row.leadTime), translate: true },
            { label: 'Stok pengaman', value: rules ? `${rules.safetyDays} hari` : '—', translate: true },
            { label: 'Siklus pesan', value: rules ? `${rules.orderCycleDays} hari` : '—', translate: true },
            { label: 'Saran pesan', value: <>{suggestionNode(s)}{suggestionMeta(s, row.baseUnit) ? <> ({ui(suggestionNote(s, row.baseUnit))})</> : null}</> },
            { label: 'Pemasok terakhir', value: row.vendor ? <>{row.vendor.name || row.vendor.vendorNo}{row.vendor.active ? null : <Translate>{' · nonaktif'}</Translate>}</> : <Translate>Belum pernah di-PO</Translate> },
            row.lastPo ? {
              label: 'PO terakhir',
              value: cell(poLink(row.lastPo), `${formatDate(row.lastPo.date)} · ${qtyText(row.lastPo.qty, row.lastPo.unit)}`),
            } : null,
            ...(prices ? [
              { label: 'Harga terakhir (bersih, sebelum PPN)', value: row.lastPrice ? lastPriceNode(row.lastPrice.netPrice, row.lastPo?.unit) : '—' },
              { label: 'Perkiraan nilai (sebelum PPN)', value: rupiah(row.estimatedValue) },
            ] : []),
          ]}
          />
          <DataGrid
            title="PO yang masih berjalan"
            columns={openColumns}
            rows={row.openOrders}
            searchable={false}
            exportName={`po-berjalan-${row.itemNo}`}
            empty="Tidak ada PO yang masih menunggu barang untuk barang ini."
          />
          <div className="pw-text-helper">{reorderRulesText(rules, readiness)}</div>
        </div>
      ) : null}
    </SideSheet>
  );
}

export default function ProcurementReorder({ status }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = searchParams.get('urgency');
  const [urgency, setUrgency] = useState(isReorderUrgency(initial) ? initial : 'all');
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [vendor, setVendor] = useState(searchParams.get('vendor') || '');
  // "Belum ada PO": set by the escalation's link, so the page lists exactly the
  // items it counted; removing it also takes it out of the address.
  const [noPo, setNoPo] = useState(searchParams.get('noPo') === '1');
  const clearNoPo = () => {
    setNoPo(false);
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('noPo');
      return next;
    }, { replace: true });
  };
  const vendorSearch = useDebouncedValue(vendor);
  const [open, setOpen] = useState(null);
  const prices = Boolean(status?.prices);
  const list = useSalesList('/procurement/reorder', { urgency: urgency === 'all' ? '' : urgency, q, vendor: vendorSearch, noPo: noPo ? '1' : '' });
  // Only the filters: the AI reads stock through its own tool, never prices.
  usePublishPrakasaAIContext({ toolKey: 'procurement', visibleState: { tab: 'reorder', urgency: urgency === 'all' ? '' : urgency, q } });
  const { readiness, rules, counts } = list.meta;
  const notice = reorderNotice(readiness, rules);

  return (
    <div className="pw-stack">
      {notice ? <Banner tone={notice.tone} title={notice.title}>{notice.body}</Banner> : null}
      <DataGrid
        key={`${urgency}-${prices}`}
        title="Saran pesan ulang"
        showTitle={false}
        columns={reorderColumns(prices)}
        rows={list.rows.map((r) => ({ ...r, id: r.itemId }))}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        onPageChange={list.setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Kode atau nama barang"
        filters={(
          <>
            {REORDER_URGENCIES.map((u) => <Chip key={u.key} selected={urgency === u.key} onClick={() => setUrgency(u.key)}>{reorderChipLabel(u.key, counts, readiness, rules)}</Chip>)}
            {noPo ? <Chip selected icon="close" aria-label="Hapus filter Belum ada PO" onClick={clearNoPo}>Belum ada PO</Chip> : null}
            <Input label="Nama atau ID pemasok" value={vendor} onChange={(e) => setVendor(e.target.value)} fieldClassName="pc-filter-field" />
          </>
        )}
        exportName={`saran-pesan-ulang-${urgency}`}
        empty={reorderEmptyText(readiness, rules, urgency)}
        onRowClick={setOpen}
      />
      <div className="pw-text-helper">
        {reorderRulesText(rules, readiness)}
        {counts?.unknown ? ` · ${counts.unknown} barang dengan stok belum bisa dihitung (riwayat < ${rules?.minHistoryDays ?? 7} hari).` : ''}
      </div>
      <ReorderSheet row={open} prices={prices} rules={rules} readiness={readiness} onClose={() => setOpen(null)} />
    </div>
  );
}
