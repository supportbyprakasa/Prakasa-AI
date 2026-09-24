import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, CheckCircle2, ExternalLink, History, Pencil, RefreshCw, Send, Undo2, XCircle } from 'lucide-react';
import api from '../../api/client';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import Modal from '../../components/Modal';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { usePublishPrakasaAIContext } from '../../context/PrakasaAIToolContext';
import { AccurateNotice, MovementStatusChip } from './WarehouseMovements';
import {
  MOVEMENT_TYPE_COPY,
  canCancelMovement,
  canEditMovement,
  formatQuantity,
  nextActorText,
} from './warehouseMovementModel';
import './warehouse-movements.css';

const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDay(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

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

export default function WarehouseMovementDetail() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const copy = MOVEMENT_TYPE_COPY[type];

  const [state, setState] = useState({ loading: true, error: '', movement: null });
  const [busy, setBusy] = useState('');
  const [decision, setDecision] = useState({ action: null, note: '' });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
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

  const decide = async () => {
    const { action, note } = decision;
    setBusy('decide');
    try {
      await api.post(`/approvals/${movement.approvalRequestId}/decide`, { action, note: note.trim() || null });
      const done = { approve: 'Pergerakan disetujui', request_revision: 'Revisi diminta', reject: 'Pergerakan ditolak' }[action];
      toast(done, 'success');
      setDecision({ action: null, note: '' });
      await load();
    } catch (error) {
      toast(errorMessage(error, 'Keputusan gagal disimpan'), 'error');
      await load();
    } finally {
      setBusy('');
    }
  };

  const cancelMovement = async () => {
    setBusy('cancel');
    try {
      await api.post(`/warehouse/movements/${type}/${id}/cancel`, { reason: cancelReason.trim(), version: movement.version });
      toast('Pergerakan dibatalkan', 'success');
      setCancelOpen(false);
      setCancelReason('');
      await load();
    } catch (error) {
      toast(errorMessage(error, 'Pembatalan gagal'), 'error');
    } finally {
      setBusy('');
    }
  };

  const toggleAudit = async () => {
    if (audit.open) { setAudit((current) => ({ ...current, open: false })); return; }
    setAudit({ open: true, loading: true, rows: [], error: '' });
    try {
      const response = await api.get(`/warehouse/movements/${type}/${id}/audit`);
      setAudit({ open: true, loading: false, rows: response.data.data || [], error: '' });
    } catch (error) {
      setAudit({ open: true, loading: false, rows: [], error: errorMessage(error, 'Riwayat audit tidak dapat dimuat.') });
    }
  };

  if (!copy) {
    return <div className="wm-state wm-state--error" role="alert"><strong>Jenis pergerakan tidak dikenal.</strong></div>;
  }

  if (state.loading && !movement) {
    return <div className="wm-page"><SkeletonCard lines={4} /><SkeletonCard lines={6} /></div>;
  }

  if (state.error) {
    return (
      <div className="wm-page">
        <Link to="/warehouse" className="wm-back"><ArrowLeft size={18} aria-hidden="true" /> Warehouse</Link>
        <div className="wm-state wm-state--error" role="alert">
          <strong>Pergerakan tidak dapat dibuka</strong>
          <span>{state.error}</span>
          <Button variant="secondary" onClick={load}><RefreshCw size={16} aria-hidden="true" /> Coba lagi</Button>
        </div>
      </div>
    );
  }

  const decisionCopy = {
    approve: { title: 'Setujui pergerakan ini?', confirm: 'Setujui', tone: 'primary', needsNote: false },
    request_revision: { title: 'Minta revisi?', confirm: 'Minta revisi', tone: 'warning', needsNote: true },
    reject: { title: 'Tolak pergerakan ini?', confirm: 'Tolak', tone: 'danger', needsNote: true },
  }[decision.action];

  const tab = type === 'inbound' ? 'inbound' : 'outbound';

  return (
    <div className="wm-page">
      <Link to={`/warehouse?tab=${tab}`} className="wm-back"><ArrowLeft size={18} aria-hidden="true" /> {copy.label}</Link>

      <header className="wm-detail-header">
        <div className="wm-detail-header__title">
          <span className="wm-eyebrow">{copy.label}</span>
          <h1>{movement.referenceNo || `#${movement.id}`}</h1>
          <MovementStatusChip status={movement.status} />
        </div>
        <div className="wm-detail-header__actions">
          {canEditMovement(user, movement) && (
            <Button variant="secondary" onClick={() => navigate(`/warehouse/movements/${type}/${id}/edit`)}>
              <Pencil size={16} aria-hidden="true" /> Ubah
            </Button>
          )}
          {can.canSubmit && permissions.includes('warehouse.movement.submit') && (
            <Button onClick={submit} loading={busy === 'submit'}>
              <Send size={16} aria-hidden="true" /> Ajukan ke Supervisor
            </Button>
          )}
          {canCancelMovement(user, movement) && (
            <Button variant="danger" onClick={() => setCancelOpen(true)}>
              <Ban size={16} aria-hidden="true" /> Batalkan
            </Button>
          )}
          {movement.approvalRequestId && (
            <Button variant="text" onClick={() => navigate(`/approvals/${movement.approvalRequestId}`)}>
              <ExternalLink size={16} aria-hidden="true" /> Lihat approval
            </Button>
          )}
        </div>
      </header>

      <div className="wm-status-panel">
        <p className="wm-status-panel__next">{nextActorText(movement)}</p>
        <dl className="wm-meta">
          <div><dt>Dibuat oleh</dt><dd>{movement.createdByName || '—'}</dd></div>
          <div><dt>Diajukan oleh</dt><dd>{movement.submittedByName ? `${movement.submittedByName} · ${formatDateTime(movement.submittedAt)}` : '—'}</dd></div>
          {movement.approvedByName && <div><dt>Disetujui oleh</dt><dd>{movement.approvedByName} · {formatDateTime(movement.approvedAt)}</dd></div>}
          {movement.cancellationReason && <div><dt>Alasan pembatalan</dt><dd>{movement.cancellationReason}</dd></div>}
        </dl>
        {movement.decisionNote && (
          <p className="wm-decision-note"><strong>Catatan reviewer:</strong> {movement.decisionNote}</p>
        )}
        {movement.status === 'pending_approval' && !can.canDecide && can.decideBlockedReason && permissions.includes('warehouse.movement.approve') && (
          <p className="wm-decision-blocked">{can.decideBlockedReason}</p>
        )}
      </div>

      {can.canDecide && (
        <section className="wm-card wm-decision" aria-labelledby="wm-decision-title">
          <h2 id="wm-decision-title">Keputusan Supervisor</h2>
          <p>Periksa barang dan referensi sebelum memutuskan. Catatan wajib untuk revisi atau penolakan.</p>
          <label className="pw-field">
            <span className="pw-field__label">Catatan</span>
            <textarea
              className="pw-field__input"
              rows={3}
              value={decision.note}
              onChange={(event) => setDecision((current) => ({ ...current, note: event.target.value }))}
              placeholder="Contoh: jumlah sesuai surat jalan"
            />
          </label>
          <div className="wm-decision__actions">
            <Button onClick={() => setDecision((current) => ({ ...current, action: 'approve' }))}>
              <CheckCircle2 size={16} aria-hidden="true" /> Setujui
            </Button>
            <Button variant="tonal" disabled={!decision.note.trim()} onClick={() => setDecision((current) => ({ ...current, action: 'request_revision' }))}>
              <Undo2 size={16} aria-hidden="true" /> Minta revisi
            </Button>
            <Button variant="text" disabled={!decision.note.trim()} onClick={() => setDecision((current) => ({ ...current, action: 'reject' }))}>
              <XCircle size={16} aria-hidden="true" /> Tolak
            </Button>
          </div>
        </section>
      )}

      <AccurateNotice />

      <section className="wm-card" aria-labelledby="wm-info-title">
        <h2 id="wm-info-title">Informasi transaksi</h2>
        <dl className="wm-meta wm-meta--grid">
          <div><dt>Tanggal</dt><dd>{formatDay(movement.movementDate)}</dd></div>
          <div><dt>Referensi</dt><dd>{movement.referenceNo || '—'}</dd></div>
          <div><dt>{copy.partyLabel}</dt><dd>{movement.party || '—'}</dd></div>
          <div><dt>Versi data</dt><dd>{movement.version}</dd></div>
        </dl>
        {movement.notes && <p className="wm-notes">{movement.notes}</p>}
      </section>

      <section className="wm-card" aria-labelledby="wm-items-title">
        <h2 id="wm-items-title">Barang <span className="wm-count">{movement.items.length}</span></h2>
        <div className="wm-items-view">
          <div className="wm-items-view__head" aria-hidden="true">
            <span>SKU</span><span>Produk</span><span>Jumlah</span><span>Batch</span><span>Kedaluwarsa</span><span>Lokasi</span><span>Catatan</span>
          </div>
          {movement.items.map((item, index) => (
            <div className="wm-items-view__row" key={`${item.sku || 'item'}-${index}`}>
              <span data-label="SKU">{item.sku || '—'}</span>
              <span data-label="Produk" className="wm-strong">{item.product}</span>
              <span data-label="Jumlah">{formatQuantity(item.quantity)} {item.unit}</span>
              <span data-label="Batch">{item.batchNo || '—'}</span>
              <span data-label="Kedaluwarsa">{item.expiresOn || '—'}</span>
              <span data-label="Lokasi">{item.location || '—'}</span>
              <span data-label="Catatan">{item.note || '—'}</span>
            </div>
          ))}
        </div>
      </section>

      {movement.approval && (
        <section className="wm-card" aria-labelledby="wm-approval-title">
          <h2 id="wm-approval-title">Alur approval</h2>
          <ol className="wm-timeline">
            <li>
              <span className="wm-timeline__dot is-done" aria-hidden="true" />
              <div><strong>Diajukan</strong><small>{movement.submittedByName || '—'} · {formatDateTime(movement.submittedAt)}</small></div>
            </li>
            {movement.approval.steps.map((step) => (
              <li key={step.id}>
                <span className={`wm-timeline__dot${step.status === 'pending' ? '' : ' is-done'}`} aria-hidden="true" />
                <div>
                  <strong>{step.approverRoleName || 'Approver'} — {STEP_STATUS[step.status] || step.status}</strong>
                  <small>
                    {step.decidedByName ? `${step.decidedByName} · ${formatDateTime(step.decidedAt)}` : step.activatedAt ? `Aktif sejak ${formatDateTime(step.activatedAt)}` : 'Belum aktif'}
                    {step.escalatedToRoleName ? ` · Dieskalasi ke ${step.escalatedToRoleName}` : ''}
                  </small>
                  {step.note && <p>{step.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {permissions.includes('warehouse.movement.audit.view') && (
        <section className="wm-card" aria-labelledby="wm-audit-title">
          <div className="wm-card__header">
            <h2 id="wm-audit-title">Riwayat audit</h2>
            <Button variant="text" onClick={toggleAudit} aria-expanded={audit.open}>
              <History size={16} aria-hidden="true" /> {audit.open ? 'Sembunyikan' : 'Tampilkan'}
            </Button>
          </div>
          {audit.open && audit.loading && <p className="wm-muted">Memuat riwayat…</p>}
          {audit.open && audit.error && <p className="wm-decision-blocked" role="alert">{audit.error}</p>}
          {audit.open && !audit.loading && !audit.error && (
            <ol className="wm-audit">
              {audit.rows.map((row) => (
                <li key={row.id}>
                  <strong>{AUDIT_LABELS[row.action] || row.action}</strong>
                  <small>{row.actorName || 'Sistem'} · {formatDateTime(row.createdAt)}</small>
                  {row.metadata?.reason && <p>{row.metadata.reason}</p>}
                </li>
              ))}
              {!audit.rows.length && <li className="wm-muted">Belum ada catatan audit.</li>}
            </ol>
          )}
        </section>
      )}

      <ConfirmDialog
        open={Boolean(decisionCopy)}
        title={decisionCopy?.title}
        message={decision.note.trim() ? `Catatan: ${decision.note.trim()}` : 'Keputusan akan tercatat atas nama Anda.'}
        confirmLabel={decisionCopy?.confirm}
        tone={decisionCopy?.tone}
        loading={busy === 'decide'}
        onConfirm={decide}
        onClose={() => setDecision((current) => ({ ...current, action: null }))}
      />

      <Modal
        open={cancelOpen}
        onClose={() => { if (busy !== 'cancel') setCancelOpen(false); }}
        title="Batalkan pergerakan yang disetujui"
        maxWidth={520}
        footer={(
          <>
            <Button variant="text" onClick={() => setCancelOpen(false)} disabled={busy === 'cancel'}>Kembali</Button>
            <Button variant="danger" onClick={cancelMovement} loading={busy === 'cancel'} disabled={!cancelReason.trim()}>Batalkan pergerakan</Button>
          </>
        )}
      >
        <p style={{ margin: '0 0 16px', color: 'var(--pw-on-surface-variant)', fontSize: 14, lineHeight: 1.5 }}>
          Pembatalan tidak menghapus data. Alasan akan tersimpan di riwayat audit.
        </p>
        <label className="pw-field">
          <span className="pw-field__label">Alasan pembatalan</span>
          <textarea className="pw-field__input" rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
        </label>
      </Modal>
    </div>
  );
}
