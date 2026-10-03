import Banner from '../../../components/Banner';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import EmptyState, { LoadingState } from '../../../components/EmptyState';
import KeyValue from '../../../components/KeyValue';
import StatusBadge from '../../../components/StatusBadge';
import { statusLabel } from '../../../components/statusTone';
import { formatCount } from '../../sales/salesModel';
import {
  PO_FLOW_STATES, PURCHASE_TARGET_LINK, normalizePurchaseFlow, pctText, pendingText, relevantPending, shareText, shortDate, stepGapText,
} from '../managementFlowModel';
import PeriodBar from './PeriodBar';
import StepCard from './StepCard';
import useFlowData from './useFlowData';
import useLinkAction from './useLinkAction';

// PO → barang pertama datang → diterima lengkap, from approved Accurate data.
// Quantities and dates only, never a price. Receiving in Accurate books the
// goods into stock at once, so stock is not a separate step.
const STUCK_LABELS = { late: 'Terlambat datang', partial: 'Sebagian datang', legacy: 'PO lama belum ditutup' };

export default function FlowPurchase({ preset, onPreset }) {
  const { loading, error, data, reload } = useFlowData('/management-dashboard/flow/purchase', { preset });
  const linkAction = useLinkAction();
  const flow = normalizePurchaseFlow(data);
  const pending = pendingText(relevantPending(flow.pending, 'purchase'));
  const step = (key) => flow.steps.find((s) => s.key === key);
  return (
    <div className="pw-stack pw-stack--lg">
      <PeriodBar value={preset} onChange={onPreset} period={flow.period} />
      {loading && !data ? <LoadingState label="Memuat alur pembelian…" /> : null}
      {error ? <EmptyState tone="error" title="Alur pembelian belum bisa dimuat" description={error} action={<Button variant="secondary" onClick={reload}>Coba lagi</Button>} /> : null}
      {data && !flow.ready ? <EmptyState icon="hourglass_empty" title="Menunggu data PO disetujui Head Procurement" description="Alur pembelian tampil setelah data PO dari Accurate disetujui." /> : null}
      {data && flow.ready ? (
        <>
          {pending ? <Banner tone="info">{pending}</Banner> : null}
          {!flow.receiptsReady ? <Banner tone="info">Waktu datang terisi setelah dokumen penerimaan barang disetujui Warehouse.</Banner> : null}
          <div className="pw-cols-3 mflow-kpis">
            <StepCard title="PO dibuat" count={formatCount(flow.total)} sub="PO dengan tanggal di periode ini" />
            <StepCard
              title="Barang pertama datang"
              count={flow.receiptsReady ? formatCount(step('po_to_first')?.count || 0) : '—'}
              share={flow.receiptsReady ? `${shareText(step('po_to_first')?.count || 0, flow.total)} dari PO` : null}
              gapLabel="PO → barang pertama datang:"
              gap={stepGapText(step('po_to_first'), 'PO')}
            />
            <StepCard
              title="Diterima lengkap"
              count={formatCount(flow.stages.received)}
              share={`${shareText(flow.stages.received, flow.total)} dari PO`}
              sub="Barang yang diterima langsung menambah stok Accurate"
              gapLabel="PO → diterima lengkap:"
              gap={stepGapText(step('po_to_complete'), 'PO')}
            />
          </div>
          <Card title="Status PO di periode ini">
            <div className="pw-row mflow-states">
              {PO_FLOW_STATES.map((s) => (
                <StatusBadge key={s} status={`po_${s}`} label={`${statusLabel(`po_${s}`)} · ${formatCount(flow.stages[s])}`} />
              ))}
            </div>
          </Card>
          <Card title="Lengkap tepat waktu (PO yang sudah lengkap)" actions={linkAction(PURCHASE_TARGET_LINK, 'Target “PO datang tepat waktu”')}>
            <div className="pw-stack">
              <KeyValue items={[
                { label: 'Tepat waktu', value: flow.onTime.pct === null ? null : `${pctText(flow.onTime.pct)} · ${formatCount(flow.onTime.onTime)} dari ${formatCount(flow.onTime.completed)} PO`, translate: true },
              ]}
              />
              <p className="pw-text-helper mflow-note-text">
                Hanya PO periode ini yang sudah diterima lengkap. Angka resmi untuk target adalah metrik Procurement “PO datang tepat waktu”, yang juga menghitung PO terbuka yang lewat jatuh tempo.
              </p>
            </div>
          </Card>
          <Card title="Tertahan sekarang">
            <div className="pw-stack">
              <KeyValue columns={2} items={flow.stuck.map((s) => ({
                label: STUCK_LABELS[s.state],
                value: linkAction(s.link, `${formatCount(s.count)} PO`) || `${formatCount(s.count)} PO`,
              }))}
              />
              <p className="pw-text-helper mflow-note-text">Tidak terikat periode. PO terlambat dieskalasi oleh Procurement; PO sebelum {shortDate(data?.lateFrom)} adalah PO lama.</p>
            </div>
          </Card>
          <p className="pw-text-helper mflow-note-text">
            Dari PO Accurate yang disetujui Head Procurement dan penerimaan barang yang disetujui Warehouse. Jatuh tempo = Tgl kirim di PO bila setelah tanggal PO, selain itu 14 hari dari tanggal PO. Jumlah dan tanggal saja, tanpa harga.
          </p>
        </>
      ) : null}
    </div>
  );
}
