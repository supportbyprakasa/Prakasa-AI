import Banner from '../../../components/Banner';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import EmptyState, { LoadingState } from '../../../components/EmptyState';
import KeyValue from '../../../components/KeyValue';
import StatusBadge from '../../../components/StatusBadge';
import DataGrid from '../../../components/datagrid/DataGrid';
import { formatCount, formatRupiahShort } from '../../sales/salesModel';
import {
  RECEIVABLE_AGING_LINK, dayMonth, daysText, dueSourceText, normalizeSalesFlow, pendingText, relevantPending, shareText, shortDate, stepGapText,
} from '../managementFlowModel';
import PeriodBar from './PeriodBar';
import StepCard from './StepCard';
import useFlowData from './useFlowData';
import useLinkAction from './useLinkAction';

// Pesanan → terkirim → ditagih → lunas, from approved Accurate data. Shipping
// state is the Warehouse promise (wh_so_fulfilment_accurate): late SOs are
// escalated once, by Warehouse ("SO lewat janji kirim"), never from here.
const soCell = (r) => (
  <span className="pw-cell">
    <span data-no-translate="" className="pw-cell__title pw-nowrap">{r.soNumber}</span>
    {r.customerName ? <span data-no-translate="" className="pw-cell__meta">{r.customerName}</span> : null}
  </span>
);

function lateColumns(otifFrom) {
  return [
    { key: 'soNumber', header: 'SO', render: soCell, exportValue: (r) => `${r.soNumber} · ${r.customerName || ''}` },
    {
      key: 'dueOn', header: 'Janji kirim',
      render: (r) => (
        <span className="pw-cell">
          <span className="pw-nowrap">{shortDate(r.dueOn)}</span>
          <span data-translate="" className="pw-cell__meta">{dueSourceText(r)}</span>
        </span>
      ),
      exportValue: (r) => r.dueOn,
    },
    { key: 'daysLate', header: 'Terlambat', align: 'end', translate: true, render: (r) => daysText(r.daysLate), exportValue: (r) => r.daysLate },
    { key: 'percentShipped', header: 'Terkirim', align: 'end', render: (r) => `${formatCount(r.percentShipped ?? 0)}%`, exportValue: (r) => r.percentShipped },
    {
      key: 'escalated', header: 'Tindak lanjut',
      render: (r) => (r.escalated
        ? <StatusBadge status="flow_so_late" label="Dieskalasi ke Warehouse" />
        : <StatusBadge status="flow_so_legacy" label={`SO lama (sebelum ${dayMonth(otifFrom)}) — tutup di Accurate`} />),
      exportValue: (r) => (r.escalated ? 'Dieskalasi ke Warehouse' : 'SO lama — tutup di Accurate'),
    },
  ];
}

const BILL_COLUMNS = [
  { key: 'soNumber', header: 'SO', render: soCell, exportValue: (r) => `${r.soNumber} · ${r.customerName || ''}` },
  { key: 'deliveredOn', header: 'Surat jalan', render: (r) => <span className="pw-nowrap">{shortDate(r.deliveredOn)}</span>, exportValue: (r) => r.deliveredOn },
  { key: 'daysLate', header: 'Lewat tenggat', align: 'end', translate: true, render: (r) => daysText(r.daysLate), exportValue: (r) => r.daysLate },
  {
    key: 'escalated', header: 'Tindak lanjut',
    render: (r) => (r.escalated ? <StatusBadge status="flow_not_billed" label="Dieskalasi ke Sales" /> : <StatusBadge status="flow_not_billed_old" />),
    exportValue: (r) => (r.escalated ? 'Dieskalasi ke Sales' : 'Lama, belum difaktur'),
  },
];

const DIVISION_COLUMNS = [
  { key: 'departmentName', header: 'Divisi', translate: true },
  { key: 'total', header: 'SO', align: 'end', render: (r) => formatCount(r.total), exportValue: (r) => r.total },
  { key: 'shippedFull', header: 'Terkirim lengkap', align: 'end', render: (r) => formatCount(r.shippedFull), exportValue: (r) => r.shippedFull },
  { key: 'billed', header: 'Ditagih', align: 'end', render: (r) => formatCount(r.billed), exportValue: (r) => r.billed },
  { key: 'paid', header: 'Lunas', align: 'end', render: (r) => formatCount(r.paid), exportValue: (r) => r.paid },
];

export default function FlowSales({ preset, onPreset }) {
  const { loading, error, data, reload } = useFlowData('/management-dashboard/flow/sales', { preset });
  const linkAction = useLinkAction();
  const flow = normalizeSalesFlow(data);
  const pending = pendingText(relevantPending(flow.pending, 'sales'));
  const step = (key) => flow.steps.find((s) => s.key === key);
  const { stages, stuck } = flow;
  return (
    <div className="pw-stack pw-stack--lg">
      <PeriodBar value={preset} onChange={onPreset} period={flow.period} />
      {loading && !data ? <LoadingState label="Memuat alur penjualan…" /> : null}
      {error ? <EmptyState tone="error" title="Alur penjualan belum bisa dimuat" description={error} action={<Button variant="secondary" onClick={reload}>Coba lagi</Button>} /> : null}
      {data && !flow.ready ? <EmptyState icon="hourglass_empty" title="Menunggu data Sales dari Accurate" description="Alur pesanan tampil setelah data Sales dari Accurate disetujui." /> : null}
      {data && flow.ready ? (
        <>
          {pending ? <Banner tone="info">{pending}</Banner> : null}
          <div className="pw-cols-4 mflow-kpis">
            <StepCard
              title="Dipesan"
              count={formatCount(stages.total)}
              sub={`SO dengan tanggal di periode ini · ${formatCount(stages.ordered)} belum diproses · ${formatCount(stages.closed)} ditutup`}
            />
            <StepCard
              title="Terkirim lengkap"
              count={formatCount(stages.shippedFull)}
              share={`${shareText(stages.shippedFull, stages.total)} dari SO`}
              sub={`${formatCount(stages.started)} mulai dikirim: ${formatCount(flow.shippedBy.delivery)} lewat surat jalan · ${formatCount(flow.shippedBy.invoice)} langsung faktur`}
              gapLabel="SO → terkirim lengkap:"
              gap={stepGapText(step('order_to_full'))}
            />
            <StepCard
              title="Ditagih"
              count={formatCount(stages.billed)}
              share={`${shareText(stages.billed, stages.total)} dari SO`}
              sub="Punya faktur (tanpa faktur uang muka)"
              gapLabel="Surat jalan → faktur:"
              gap={stepGapText(step('ship_to_bill'))}
            />
            <StepCard
              title="Lunas"
              count={formatCount(stages.paid)}
              share={`${shareText(stages.paid, stages.total)} dari SO`}
              sub="Semua faktur lunas, SO terkirim lengkap atau ditutup"
              gapLabel="Faktur → lunas:"
              gap={stepGapText(step('bill_to_paid'))}
            />
          </div>
          <Card title="Waktu per langkah">
            <KeyValue columns={2} items={[
              { label: 'SO → mulai dikirim', value: stepGapText(step('order_to_start')), translate: true },
              { label: 'SO → terkirim lengkap', value: stepGapText(step('order_to_full')), translate: true },
              { label: 'Surat jalan → faktur', value: stepGapText(step('ship_to_bill')), translate: true },
              { label: 'Faktur → lunas', value: stepGapText(step('bill_to_paid')), translate: true },
              { label: 'SO → lunas', value: stepGapText(step('order_to_paid')), translate: true },
              { label: 'Faktur tanpa SO di periode ini', value: `${formatCount(flow.invoicesWithoutSo)} faktur`, translate: true },
            ]}
            />
          </Card>
          <DataGrid
            title="Per divisi"
            columns={DIVISION_COLUMNS}
            rows={flow.byDivision.map((r, i) => ({ ...r, id: r.departmentId ?? `none-${i}` }))}
            searchable={false}
            exportName="alur-penjualan-per-divisi"
            empty="Belum ada SO di periode ini"
          />
          <div className="pw-stack pw-stack--sm">
            <DataGrid
              title="SO lewat janji kirim, belum terkirim lengkap"
              columns={lateColumns(flow.otifFrom)}
              rows={stuck.notShipped.items.map((r) => ({ ...r, id: r.soId }))}
              searchable={false}
              exportName="so-belum-terkirim"
              toolbarActions={linkAction('/escalations?source=warehouse_so_late', 'Pusat Eskalasi')}
              empty="Tidak ada SO yang lewat janji kirim"
            />
            <p className="pw-text-helper mflow-note-text">
              Tidak terikat periode. Janji kirim dan eskalasinya milik Warehouse (satu eskalasi per SO, untuk SO sejak {shortDate(flow.otifFrom)}).
              {' '}{formatCount(stuck.notShipped.count)} SO · {formatCount(stuck.notShipped.escalated)} dieskalasi.
            </p>
          </div>
          <DataGrid
            title="Surat jalan belum difaktur"
            columns={BILL_COLUMNS}
            rows={stuck.notBilled.items.map((r) => ({ ...r, id: r.soId }))}
            searchable={false}
            exportName="surat-jalan-belum-difaktur"
            toolbarActions={linkAction('/escalations?source=flow_do_not_invoiced', 'Pusat Eskalasi')}
            empty={<EmptyState compact title="Tidak ada surat jalan yang menunggu faktur" description="Surat jalan tanpa faktur lebih dari 2 hari dieskalasi ke divisi Sales/Retail Commerce-nya." />}
          />
          <Card title="Piutang lewat jatuh tempo" actions={linkAction(RECEIVABLE_AGING_LINK, 'Umur piutang')}>
            <KeyValue items={[
              { label: 'Faktur', value: formatCount(stuck.overdue.count) },
              { label: 'Sisa tagihan', translate: true, value: stuck.overdue.amount === null ? null : formatRupiahShort(stuck.overdue.amount) },
            ]}
            />
          </Card>
          <p className="pw-text-helper mflow-note-text">
            Dari data Accurate yang disetujui. Dikelompokkan menurut tanggal SO. “Mulai dikirim” = surat jalan pertama, atau faktur bila tanpa surat jalan (Accurate mengirim lewat faktur).
            “Terkirim lengkap” = hari SO terkirim 100% — sama dengan metrik Warehouse “Rata-rata hari SO sampai terkirim lengkap”.
            “Lunas” = semua faktur SO lunas (tanggal penerimaan terakhir); faktur lunas tanpa penerimaan tidak masuk hitungan hari.
            Faktur uang muka tidak dihitung. Piutang dan PO terlambat dieskalasi oleh Sales dan Procurement, bukan dari halaman ini.
          </p>
        </>
      ) : null}
    </div>
  );
}
