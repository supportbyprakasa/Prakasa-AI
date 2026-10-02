import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import DataGrid from '../../components/datagrid/DataGrid';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import KeyValue from '../../components/KeyValue';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/StatusBadge';
import { formatDateTime } from '../../components/format';
import { toast } from '../../components/Toast';
import { NoTranslate } from '../../i18n/NoTranslate';
import { useAuth } from '../../context/AuthContext';
import { usePublishPrakasaAIContext } from '../../context/PrakasaAIToolContext';
import { AccurateNotice, MovementStatusChip } from './WarehouseMovements';
import WarehouseReasonDialog from '../../components/ReasonDialog';
import { reconCardText, reconStatusKey, reconUrl } from './warehouseReconModel';
import { dayText } from './warehouseStockModel';
import {
  MOVEMENT_TYPE_COPY,
  canCancelMovement,
  canEditMovement,
  formatQuantity,
  nextActorText,
} from './warehouseMovementModel';
import './warehouse-movements.css';

const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

const STEP_STATUS = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak', skipped: 'Dilewati' };
const AUDIT_LABELS = {
  'warehouse.movement.create': 'Draft dibuat',
  'warehouse.movement.update': 'Draft diubah',
  'warehouse.movement.submit': 'Diajukan untuk review',
  'warehouse.movement.revision_requested': 'Supervisor meminta revisi',
  'warehouse.movement.approved': 'Disetujui Supervisor',
  'warehouse.movement.rejected': 'Ditolak Supervisor',
  'warehouse.movement.cancel': 'Dibatalkan Warehouse Head',
  'warehouse.movement.decision_denied': 'Percobaan keputusan ditolak sistem',
};

// The Supervisor's three decisions, each confirmed in the reason dialog.
const DECISIONS = {
  approve: {
    title: 'Setujui pergerakan ini?', confirm: 'Setujui', done: 'Pergerakan disetujui', required: false, tone: 'primary',
  },
  request_revision: {
    title: 'Minta revisi?', confirm: 'Minta revisi', done: 'Revisi diminta', required: true, tone: 'primary',
  },
  reject: {
    title: 'Tolak pergerakan ini?', confirm: 'Tolak', done: 'Pergerakan ditolak', required: true, tone: 'danger',
  },
};

// Where this approved movement stands against Accurate (program 3.2). An
// extra card: it stays hidden when the check cannot be loaded.
function ReconCard({ type, id }) {
  const [recon, setRecon] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get(`/warehouse/recon/movement/${type}/${id}`).then((r) => { if (alive) setRecon(r.data.data || null); }).catch(() => {});
    return () => { alive = false; };
  }, [type, id]);
  if (!recon) return null;
  return (
    <Card title="Pencocokan Accurate">
      {recon.inScope ? (
        <div className="pw-stack pw-stack--sm">
          {recon.status ? <StatusBadge status={reconStatusKey(recon)} /> : null}
          <div>{reconCardText(recon)}</div>
          <Link className="pw-link" to={recon.link || reconUrl(recon.direction, recon.groupKey)}>Buka pencocokan</Link>
        </div>
      ) : (
        <div className="pw-muted">{reconCardText(recon)}</div>
      )}
    </Card>
  );
}

export default function WarehouseMovementDetail() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const copy = MOVEMENT_TYPE_COPY[type];

  const [state, setState] = useState({ loading: true, error: '', movement: null });
  const [busy, setBusy] = useState('');
  const [decision, setDecision] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [audit, setAudit] = useState({ open: false, loading: false, rows: [], error: '' });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const response = await api.get(`/warehouse/movements/${type}/${id}`);
      setState({ loading: false, error: '', movement: response.data.data });
    } catch (error) {
      setState({ loading: false, error: errorMessage(error, 'Pergerakan barang tidak dapat dimuat.'), movement: null });
    }
  }, [type, id]);

  useEffect(() => { load(); }, [load]);

  const movement = state.movement;
  const can = movement?.permissions || {};

  // Status and version let the assistant refresh its context when the record changes.
  usePublishPrakasaAIContext({
    toolKey: 'warehouse',
    subjectType: 'warehouse_movement',
    subjectId: movement ? `${type}:${movement.id}` : null,
    visibleState: movement ? { status: movement.status, version: movement.version } : null,
  });

  const submit = async () => {
    setBusy('submit');
    try {
      await api.post(`/warehouse/movements/${type}/${id}/submit`, { version: movement.version });
      toast('Pergerakan diajukan ke Warehouse Supervisor', 'success');
      await load();
    } catch (error) {
      toast(errorMessage(error, 'Gagal mengajukan pergerakan'), 'error');
      if (error.response?.status === 409) await load();
    } finally {
      setBusy('');
    }
  };

  const decide = async (note) => {
    try {
      await api.post(`/approvals/${movement.approvalRequestId}/decide`, { action: decision, note: note || null });
      toast(DECISIONS[decision].done, 'success');
      setDecision(null);
      await load();
    } catch (error) {
      toast(errorMessage(error, 'Keputusan gagal disimpan'), 'error');
      await load();
    }
  };

  const cancelMovement = async (reason) => {
    try {
      await api.post(`/warehouse/movements/${type}/${id}/cancel`, { reason, version: movement.version });
      toast('Pergerakan dibatalkan', 'success');
      setCancelOpen(false);
      await load();
    } catch (error) {
      toast(errorMessage(error, 'Pembatalan gagal'), 'error');
    }
  };

  const loadAudit = async () => {
    setAudit({ open: true, loading: true, rows: [], error: '' });
    try {
      const response = await api.get(`/warehouse/movements/${type}/${id}/audit`);
      setAudit({ open: true, loading: false, rows: response.data.data || [], error: '' });
    } catch (error) {
      setAudit({ open: true, loading: false, rows: [], error: errorMessage(error, 'Riwayat audit tidak dapat dimuat.') });
    }
  };
  const toggleAudit = () => (audit.open ? setAudit((current) => ({ ...current, open: false })) : loadAudit());

  if (!copy) {
    return (
      <Page>
        <EmptyState tone="error" title="Jenis pergerakan tidak dikenal" description="Buka pergerakan dari daftar Barang masuk atau Barang keluar." />
      </Page>
    );
  }

  if (state.loading && !movement) {
    return <Page><LoadingState label="Memuat pergerakan…" /></Page>;
  }

  if (state.error) {
    return (
      <Page>
        <PageHeader eyebrow={copy.label} title={`#${id}`} />
        <EmptyState
          tone="error"
          title="Pergerakan tidak dapat dibuka"
          description={state.error}
          action={<Button variant="secondary" icon="refresh" onClick={load}>Coba lagi</Button>}
        />
      </Page>
    );
  }

  // Header actions (§3.2): one primary, up to two secondary, the rest in ⋮.
  const canSubmit = can.canSubmit && permissions.includes('warehouse.movement.submit');
  const primary = can.canDecide
    ? <Button icon="check" onClick={() => setDecision('approve')}>Setujui</Button>
    : canSubmit ? <Button icon="send" onClick={submit} loading={busy === 'submit'}>Ajukan ke Supervisor</Button> : null;
  const secondary = [
    can.canDecide ? { label: 'Minta revisi', icon: 'undo', onClick: () => setDecision('request_revision') } : null,
    can.canDecide ? { label: 'Tolak', icon: 'close', onClick: () => setDecision('reject') } : null,
    canEditMovement(user, movement) ? { label: 'Ubah draft', icon: 'edit', onClick: () => navigate(`/warehouse/movements/${type}/${id}/edit`) } : null,
    canCancelMovement(user, movement) ? { label: 'Batalkan pergerakan', icon: 'block', danger: true, onClick: () => setCancelOpen(true) } : null,
  ].filter(Boolean);
  const shown = secondary.slice(0, 2);
  const overflow = secondary.slice(2);
  const actions = (primary || secondary.length) ? (
    <>
      {shown.map((action) => (
        <Button key={action.label} variant={action.danger ? 'danger' : 'secondary'} icon={action.icon} onClick={action.onClick}>{action.label}</Button>
      ))}
      {primary}
      {overflow.length ? (
        <ActionMenu items={overflow.map((action) => ({ label: action.label, icon: action.icon, onClick: action.onClick, tone: action.danger ? 'danger' : undefined }))} />
      ) : null}
    </>
  ) : null;

  const decisionCopy = decision ? DECISIONS[decision] : null;
  const itemColumns = [
    { key: 'sku', header: 'SKU' },
    { key: 'product', header: 'Produk' },
    { key: 'quantity', header: 'Jumlah', translateContext: 'quantity', align: 'end', render: (item) => `${formatQuantity(item.quantity)} ${item.unit}`, exportValue: (item) => `${item.quantity} ${item.unit}` },
    { key: 'batchNo', header: 'Batch' },
    { key: 'expiresOn', header: 'Kedaluwarsa', translateContext: 'expiry', render: (item) => (item.expiresOn ? dayText(item.expiresOn) : ''), exportValue: (item) => item.expiresOn || '' },
    { key: 'location', header: 'Lokasi' },
    { key: 'note', header: 'Catatan' },
  ];
  const itemRows = movement.items.map((item, index) => ({ ...item, rowKey: `${item.sku || 'item'}-${index}` }));
  const blocked = movement.status === 'pending_approval' && !can.canDecide && can.decideBlockedReason && permissions.includes('warehouse.movement.approve');

  return (
    <Page>
      <PageHeader
        eyebrow={copy.label}
        dataTitle
        title={movement.referenceNo || `#${movement.id}`}
        description={<><MovementStatusChip status={movement.status} /> · {dayText(movement.movementDate)}</>}
        actions={actions}
      />

      {blocked ? <Banner tone="info">{can.decideBlockedReason}</Banner> : null}
      <AccurateNotice />

      <div className="pw-cols-sidebar">
        <div className="pw-stack">
          <Card title="Informasi transaksi">
            <KeyValue
              columns={2}
              items={[
                { label: 'Tanggal', value: dayText(movement.movementDate) },
                { label: 'Referensi', value: movement.referenceNo },
                { label: copy.partyLabel, value: movement.party },
                { label: 'Versi data', value: movement.version },
                movement.notes ? { label: 'Catatan', value: <span data-no-translate="" className="wm-notes">{movement.notes}</span> } : null,
              ]}
            />
          </Card>

          <DataGrid
            title={`Barang (${movement.items.length})`}
            exportName={`pergerakan-${type}-${movement.id}-barang`}
            columns={itemColumns}
            rows={itemRows}
            idKey="rowKey"
            searchable={false}
            empty="Belum ada barang"
          />
        </div>

        <aside className="pw-stack">
          <Card title="Ringkasan">
            <div className="pw-stack">
              <div className="pw-strong">{nextActorText(movement)}</div>
              <KeyValue items={[
                { label: 'Status', value: <MovementStatusChip status={movement.status} /> },
                { label: 'Dibuat oleh', value: movement.createdByName },
                { label: 'Diajukan oleh', value: movement.submittedByName ? `${movement.submittedByName} · ${formatDateTime(movement.submittedAt)}` : null },
                movement.approvedByName ? { label: 'Disetujui oleh', value: `${movement.approvedByName} · ${formatDateTime(movement.approvedAt)}` } : null,
                movement.cancellationReason ? { label: 'Alasan pembatalan', value: movement.cancellationReason } : null,
                movement.decisionNote ? { label: 'Catatan reviewer', value: movement.decisionNote } : null,
              ]}
              />
            </div>
          </Card>

          {movement.approval && (
            <Card title="Alur approval">
              <ol className="wm-timeline">
                <li>
                  <span className="wm-timeline__dot is-done" aria-hidden="true" />
                  <div>
                    <div className="pw-strong">Diajukan</div>
                    <div className="pw-text-meta"><NoTranslate>{movement.submittedByName || '—'}</NoTranslate> · {formatDateTime(movement.submittedAt)}</div>
                  </div>
                </li>
                {movement.approval.steps.map((step) => (
                  <li key={step.id}>
                    <span className={`wm-timeline__dot${step.status === 'pending' ? '' : ' is-done'}`} aria-hidden="true" />
                    <div>
                      <div className="pw-strong">{step.approverRoleName || 'Penyetuju'} — {STEP_STATUS[step.status] || step.status}</div>
                      <div className="pw-text-meta">
                        {step.decidedByName ? <><NoTranslate>{step.decidedByName}</NoTranslate>{' · '}{formatDateTime(step.decidedAt)}</> : step.activatedAt ? `Aktif sejak ${formatDateTime(step.activatedAt)}` : 'Belum aktif'}
                        {step.escalatedToRoleName ? ` · Dieskalasi ke ${step.escalatedToRoleName}` : ''}
                      </div>
                      {step.note && <div className="wm-timeline__note" data-no-translate="">{step.note}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {permissions.includes('warehouse.recon.view') && movement.status === 'approved' ? <ReconCard type={type} id={id} /> : null}
          {permissions.includes('warehouse.movement.audit.view') && (
            <Card
              title="Riwayat audit"
              actions={(
                <Button variant="text" icon="history" onClick={toggleAudit} aria-expanded={audit.open}>
                  {audit.open ? 'Sembunyikan' : 'Tampilkan'}
                </Button>
              )}
            >
              {audit.open && audit.loading && <LoadingState compact label="Memuat riwayat…" />}
              {audit.open && audit.error && (
                <EmptyState compact tone="error" title="Riwayat audit tidak dapat dimuat" description={audit.error} action={<Button variant="text" onClick={loadAudit}>Coba lagi</Button>} />
              )}
              {audit.open && !audit.loading && !audit.error && (
                audit.rows.length ? (
                  <ol className="wm-timeline wm-timeline--plain">
                    {audit.rows.map((row) => (
                      <li key={row.id}>
                        <div>
                          <div className="pw-strong">{AUDIT_LABELS[row.action] || 'Aktivitas lain'}</div>
                          <div className="pw-text-meta"><span data-no-translate={row.actorName ? '' : undefined}>{row.actorName || 'Sistem'}</span> · {formatDateTime(row.createdAt)}</div>
                          {row.metadata?.reason && <div className="wm-timeline__note" data-no-translate="">{row.metadata.reason}</div>}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : <EmptyState compact title="Belum ada catatan audit" />
              )}
            </Card>
          )}
        </aside>
      </div>

      <WarehouseReasonDialog
        open={Boolean(decisionCopy)}
        title={decisionCopy?.title}
        description="Periksa barang dan referensi sebelum memutuskan. Keputusan tercatat atas nama Anda."
        label="Catatan"
        required={Boolean(decisionCopy?.required)}
        hint={decisionCopy?.required ? 'Wajib untuk revisi atau penolakan.' : 'Opsional, mis. jumlah sesuai surat jalan.'}
        confirmLabel={decisionCopy?.confirm}
        tone={decisionCopy?.tone}
        onClose={() => setDecision(null)}
        onConfirm={decide}
      />

      <WarehouseReasonDialog
        open={cancelOpen}
        title="Batalkan pergerakan yang disetujui?"
        description={`Pergerakan ${movement.referenceNo || `#${movement.id}`} akan dibatalkan. Pembatalan tidak menghapus data; alasannya tersimpan di riwayat audit.`}
        label="Alasan pembatalan"
        confirmLabel="Batalkan pergerakan"
        cancelLabel="Kembali"
        tone="danger"
        onClose={() => setCancelOpen(false)}
        onConfirm={cancelMovement}
      />
    </Page>
  );
}
