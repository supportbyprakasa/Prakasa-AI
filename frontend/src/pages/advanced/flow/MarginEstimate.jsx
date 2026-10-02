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
  PRODUCT_FILTERS, coverageWarning, filterProducts, monthText, normalizeMargin, pctText, pendingText,
  productCounts, productStatus, qtyText, relevantPending,
} from '../managementFlowModel';
import PeriodBar from './PeriodBar';
import useFlowData from './useFlowData';
import { Translate } from '../../../i18n/NoTranslate';

// Perkiraan margin (harga PO), program 3.3: only for management with
// procurement.price.view. An estimate from PO prices — not Accurate's
// accounting HPP, and without principal rebates or programmes outside the PO.
// Prakasa AI never reads it (no AI context is published from this page).
export const MARGIN_CAVEAT = 'Tidak termasuk rebate/program prinsipal di luar PO; bukan HPP akuntansi Accurate.';

// A missing amount stays empty: the grid shows its muted dash, never Rp 0.
const rp = (v) => (v === null || v === undefined ? null : formatMoney(v));
const MONTH_COLUMNS = [
  { key: 'month', header: 'Bulan', translate: true, render: (r) => monthText(r.month), exportValue: (r) => r.month },
  { key: 'revenue', header: 'Omzet', align: 'end', render: (r) => rp(r.revenue), exportValue: (r) => r.revenue },
  { key: 'costedRevenue', header: 'Omzet terhitung', align: 'end', render: (r) => rp(r.costedRevenue), exportValue: (r) => r.costedRevenue },
  { key: 'cost', header: 'Perkiraan HPP (harga PO)', align: 'end', render: (r) => rp(r.cost), exportValue: (r) => r.cost },
  { key: 'margin', header: 'Perkiraan margin', align: 'end', render: (r) => rp(r.margin), exportValue: (r) => r.margin },
  { key: 'marginPct', header: 'Margin %', align: 'end', render: (r) => pctText(r.marginPct), exportValue: (r) => r.marginPct },
  { key: 'coveragePct', header: 'Cakupan', align: 'end', render: (r) => pctText(r.coveragePct), exportValue: (r) => r.coveragePct },
];
const DIVISION_COLUMNS = [
  { key: 'departmentName', header: 'Divisi', translate: true },
  ...MONTH_COLUMNS.slice(1),
];
const PRODUCT_COLUMNS = [
  {
    key: 'itemName', header: 'Barang',
    render: (r) => <span className="pw-cell"><span data-no-translate="" className="pw-cell__title">{r.itemName}</span><span className="pw-cell__meta">{r.itemCode || <Translate>tanpa kode</Translate>}</span></span>,
    exportValue: (r) => `${r.itemName} (${r.itemCode || '-'})`,
  },
  { key: 'revenue', header: 'Omzet', align: 'end', render: (r) => rp(r.revenue), exportValue: (r) => r.revenue },
  { key: 'qty', header: 'Jumlah terjual', sortable: false, render: (r) => qtyText(r), exportValue: (r) => qtyText(r) },
  { key: 'cost', header: 'Perkiraan HPP', align: 'end', render: (r) => (r.costedRevenue ? rp(r.cost) : null), exportValue: (r) => r.cost },
  { key: 'margin', header: 'Perkiraan margin', align: 'end', render: (r) => rp(r.margin), exportValue: (r) => r.margin },
  { key: 'marginPct', header: 'Margin %', align: 'end', render: (r) => pctText(r.marginPct), exportValue: (r) => r.marginPct },
  {
    key: 'status', header: 'Keterangan',
    render: (r) => { const s = productStatus(r); return s ? <StatusBadge status={s} /> : null; },
    exportValue: (r) => productStatus(r) || '',
  },
];

export default function MarginEstimate({ preset, onPreset }) {
  const [departmentId, setDepartmentId] = useState(null);
  const [filter, setFilter] = useState('all');
  const { loading, error, data, reload } = useFlowData('/management-dashboard/margin', { preset, ...(departmentId ? { departmentId } : {}) });
  const m = normalizeMargin(data);
  const pending = pendingText(relevantPending(m.pending, 'margin'));
  const warning = coverageWarning(m.summary, m.lowCoveragePct);
  const counts = productCounts(m.products);
  const products = filterProducts(m.products, filter);
  const s = m.summary;
  return (
    <div className="pw-stack pw-stack--lg">
      <PeriodBar value={preset} onChange={onPreset} period={m.period}>
        {m.divisionOptions.length > 1 ? (
          <div className="pw-row" role="group" aria-label="Divisi">
            <Chip selected={departmentId === null} onClick={() => setDepartmentId(null)}>Semua divisi</Chip>
            {m.divisionOptions.map((o) => <Chip key={o.id} selected={departmentId === o.id} onClick={() => setDepartmentId(o.id)}>{o.name}</Chip>)}
          </div>
        ) : null}
      </PeriodBar>
      {loading && !data ? <LoadingState label="Menghitung perkiraan margin…" /> : null}
      {error ? <EmptyState tone="error" title="Perkiraan margin belum bisa dimuat" description={error} action={<Button variant="secondary" onClick={reload}>Coba lagi</Button>} /> : null}
      {data ? (
        <>
          {pending ? <Banner tone="info">{pending}</Banner> : null}
          {warning ? <Banner tone="warning" title="Cakupan harga beli rendah">{warning}</Banner> : null}
          <div className="pw-cols-4 mflow-kpis">
            <StatCard label="Omzet (sebelum PPN)" value={formatRupiahShort(s.revenue ?? 0)} note="tanpa faktur uang muka" />
            <StatCard
              label="Perkiraan margin (harga PO)"
              value={s.margin === null ? '—' : formatRupiahShort(s.margin)}
              note={`${pctText(s.marginPct)} dari omzet yang terhitung. ${MARGIN_CAVEAT}`}
              alert={s.margin !== null && s.margin < 0}
              empty={s.margin === null}
            />
            <StatCard label="Cakupan harga beli" value={pctText(s.coveragePct)} note={`${pctText(s.afterPricePct)} memakai harga PO sesudahnya`} />
            <StatCard label="Retur periode ini" value={formatRupiahShort(s.returns ?? 0)} note="tidak dialokasikan ke barang" />
          </div>
          <DataGrid
            title="Per bulan"
            columns={MONTH_COLUMNS}
            rows={m.months.map((r) => ({ ...r, id: r.month }))}
            searchable={false}
            exportName="perkiraan-margin-per-bulan"
            empty="Belum ada faktur di periode ini"
          />
          {departmentId === null && m.divisions.length > 1 ? (
            <DataGrid
              title="Per divisi"
              columns={DIVISION_COLUMNS}
              rows={m.divisions.map((r, i) => ({ ...r, id: r.departmentId ?? `none-${i}` }))}
              searchable={false}
              exportName="perkiraan-margin-per-divisi"
            />
          ) : null}
          <DataGrid
            key={filter}
            title="Per barang"
            columns={PRODUCT_COLUMNS}
            rows={products.map((r, i) => ({ ...r, id: r.itemCode || `tanpa-kode-${i}` }))}
            filters={PRODUCT_FILTERS.map((f) => (
              <Chip key={f.key} selected={filter === f.key} onClick={() => setFilter(f.key)}>{`${f.label} (${formatCount(counts[f.key])})`}</Chip>
            ))}
            exportName="perkiraan-margin"
            empty="Tidak ada barang untuk saringan ini"
          />
          <p className="pw-text-helper mflow-note-text">
            Perkiraan margin (harga PO). Omzet = baris faktur disesuaikan ke DPP faktur (diskon dan biaya di kepala faktur dibagi rata ke barang), tanpa faktur uang muka.
            Perkiraan HPP = jumlah dalam satuan dasar × harga beli per satuan dasar dari PO terakhir sebelum tanggal jual (sebelum PPN, setelah diskon PO, dari semua pemasok);
            bila belum ada PO sebelumnya, harga PO sesudahnya (ditandai). Margin % hanya dari omzet yang punya harga beli dan satuan yang diketahui; kode barang lama dan baru tidak dicocokkan.
            {' '}{MARGIN_CAVEAT}
          </p>
        </>
      ) : null}
    </div>
  );
}
