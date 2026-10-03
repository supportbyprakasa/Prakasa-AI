import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import ConfirmDialog from '../../components/ConfirmDialog';
import { LoadingState } from '../../components/EmptyState';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import DataGrid from '../../components/datagrid/DataGrid';
import { EMPTY, formatDateTime, formatMoney, formatQty } from '../../components/format';
import { statusLabel } from '../../components/statusTone';
import { useAuth } from '../../context/AuthContext';
import { NoTranslate } from '../../i18n/NoTranslate';
import './approval-inbox.css';

// /approvals is a closed route (decision K11): restyled only through the
// shared components.
const STATUS_OPTIONS = [
  { value: '', label: 'Semua status' },
  ...['pending', 'approved', 'rejected', 'revision_requested', 'cancelled'].map((value) => ({ value, label: statusLabel(value) })),
];
const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;
function formatAmount(amount, currency) {
  if (amount == null) return EMPTY;
  if (!currency || String(currency).toLowerCase() === 'idr') return formatMoney(amount);
  return `${currency} ${formatQty(amount)}`;
}
const approverLabel = (step) => step.approverUserName
  || step.approverRoleName
  || (step.approverUserId ? `Pengguna #${step.approverUserId}` : step.approverRoleId ? `Peran #${step.approverRoleId}` : 'Approver lama');

const WAREHOUSE_SUBJECTS = { warehouse_inbound: 'inbound', warehouse_outbound: 'outbound' };

export default function ApprovalInbox() {
  const { user } = useAuth();
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    requestType: '',
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [detail, setDetail] = useState(null);
  const [pendingSteps, setPendingSteps] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const [decidingStepId, setDecidingStepId] = useState(null);

  const canDecide = (user?.permissions || []).includes('approval.decide');

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await api.get('/approvals', {
        params: {
          page,
          limit: 20,
          status: filters.status || undefined,
          requestType: filters.requestType || undefined,
        },
      });
      setRows(response.data.data || []);
      setMeta({ page, limit: 20, total: 0, ...(response.data.meta || {}) });
    } catch (error) {
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page, filters.status, filters.requestType]);

  // Deep link from notifications and the Action Inbox: /approvals/:id opens that approval.
  useEffect(() => {
    if (routeId && Number(detail?.id) !== Number(routeId)) openDetail({ id: routeId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  const openDetail = async (row) => {
    setDetailLoading(true);
    setDetail(null);
    setPendingSteps([]);
    setNote('');
    setNoteError('');

    try {
      const [detailResponse, pendingResponse] = await Promise.all([
        api.get(`/approvals/${row.id}`),
        canDecide
          ? api
              .get(`/approvals/${row.id}/my-pending-steps`)
              .catch(() => ({ data: { data: [] } }))
          : Promise.resolve({ data: { data: [] } }),
      ]);

      setDetail(detailResponse.data.data);
      setPendingSteps(pendingResponse.data.data || []);
    } catch (error) {
      toast(errorMessage(error, 'Approval gagal dibuka'), 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async () => {
    if (!detail?.id) return;
    const currentId = detail.id;
    const [detailResponse, pendingResponse] = await Promise.all([
      api.get(`/approvals/${currentId}`),
      canDecide
        ? api
            .get(`/approvals/${currentId}/my-pending-steps`)
            .catch(() => ({ data: { data: [] } }))
        : Promise.resolve({ data: { data: [] } }),
    ]);
    setDetail(detailResponse.data.data);
    setPendingSteps(pendingResponse.data.data || []);
  };

  const decide = async (step, action) => {
    if (
      ['reject', 'skip', 'request_revision'].includes(action) &&
      !note.trim()
    ) {
      setNoteError('Catatan wajib diisi untuk menolak, melewati, atau meminta revisi.');
      return;
    }
    setNoteError('');

    setDecidingStepId(step.id);
    try {
      await api.post(`/approvals/${detail.id}/decide`, {
        stepId: step.id,
        action,
        note: note.trim() || null,
      });
      toast('Keputusan approval tersimpan', 'success');
      setNote('');
      await Promise.all([refreshDetail(), load()]);
    } catch (error) {
      toast(errorMessage(error, 'Keputusan gagal disimpan'), 'error');
    } finally {
      setDecidingStepId(null);
    }
  };

  const applyRequestType = (text) => {
    const value = text.trim();
    if (value === filters.requestType) return;
    setPage(1);
    setFilters((current) => ({ ...current, requestType: value }));
  };

  return (
    <Page
      title="Approval"
      description="Approval berurutan dan paralel, dengan penugasan, delegasi, eskalasi, dan tahap aktif dari server."
    >
      <DataGrid
        title="Approval"
        showTitle={false}
        loading={loading}
        error={loadError}
        onRetry={load}
        rows={rows}
        meta={meta || { page, limit: 20, total: rows.length }}
        onPageChange={setPage}
        onRowClick={openDetail}
        empty="Belum ada approval"
        filters={(
          <>
            {STATUS_OPTIONS.map((option) => (
              <Chip
                key={option.value || 'all'}
                selected={filters.status === option.value}
                onClick={() => { setPage(1); setFilters((current) => ({ ...current, status: option.value })); }}
              >
                {option.label}
              </Chip>
            ))}
            <Input
              dense
              label="Jenis permintaan"
              aria-label="Jenis permintaan"
              placeholder="Jenis permintaan, mis. payment"
              fieldClassName="approval-filter"
              defaultValue={filters.requestType}
              onKeyDown={(event) => { if (event.key === 'Enter') applyRequestType(event.currentTarget.value); }}
              onBlur={(event) => applyRequestType(event.currentTarget.value)}
            />
          </>
        )}
        columns={[
          { key: 'id', header: 'ID', width: 64 },
          { key: 'title', header: 'Judul' },
          {
            key: 'flowType',
            header: 'Alur',
            exportValue: (row) => statusLabel(row.flowType || 'legacy'),
            render: (row) => <StatusBadge status={row.flowType || 'legacy'} label={row.flowType ? undefined : 'Lama'} />,
          },
          {
            key: 'matrixKey',
            header: 'Matriks',
            render: (row) => (row.matrixKey ? <code className="approval-code">{row.matrixKey}</code> : null),
          },
          {
            key: 'amount',
            header: 'Jumlah',
            type: 'money',
            exportValue: (row) => row.amount,
            render: (row) => (row.amount == null ? null : formatAmount(row.amount, row.currency)),
          },
          {
            key: 'progress',
            header: 'Progres',
            exportValue: (row) => `${Number(row.approvedSteps || 0)} / ${Number(row.totalSteps || 0)}`,
            render: (row) => (
              <span>
                {Number(row.approvedSteps || 0)} / {Number(row.totalSteps || 0)}
                {Number(row.activeSteps || 0) > 0 && (
                  <span data-translate="" className="pw-muted">
                    {' '}· {row.activeSteps} aktif
                  </span>
                )}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            exportValue: (row) => statusLabel(row.status),
            render: (row) => <StatusBadge status={row.status} />,
          },
          { key: 'requesterName', header: 'Pengaju' },
        ]}
      />

      <Modal
        open={Boolean(detail) || detailLoading}
        onClose={() => {
          setDetail(null);
          setPendingSteps([]);
          setNote('');
          if (routeId) navigate('/approvals', { replace: true });
        }}
        title={detail ? <>{`Approval #${detail.id} — `}<NoTranslate>{detail.title}</NoTranslate></> : 'Approval'}
        size="lg"
      >
        {detailLoading && !detail ? (
          <LoadingState label="Memuat detail…" />
        ) : detail ? (
          <ApprovalDetail
            approval={detail}
            pendingSteps={pendingSteps}
            note={note}
            setNote={(value) => { setNote(value); setNoteError(''); }}
            noteError={noteError}
            decidingStepId={decidingStepId}
            decide={decide}
            canDecide={canDecide}
          />
        ) : null}
      </Modal>
    </Page>
  );
}

function ApprovalDetail({
  approval,
  pendingSteps,
  note,
  setNote,
  noteError,
  decidingStepId,
  decide,
  canDecide,
}) {
  const [rejectStep, setRejectStep] = useState(null);
  const pendingIds = new Set((pendingSteps || []).map((step) => Number(step.id)));
  const stages = new Map();

  for (const step of approval.steps || []) {
    const order = Number(step.orderIndex || step.level || 1);
    if (!stages.has(order)) stages.set(order, []);
    stages.get(order).push(step);
  }

  const movementType = WAREHOUSE_SUBJECTS[approval.subjectType];

  return (
    <div className="pw-stack">
      {movementType && approval.subjectId && (
        <p className="approval-movement">
          Approval ini untuk pergerakan barang Warehouse.{' '}
          <Link to={`/warehouse/movements/${movementType}/${approval.subjectId}`} className="pw-link">
            Buka detail pergerakan
          </Link>
        </p>
      )}
      <KeyValue
        columns={2}
        items={[
          { label: 'Status', value: <StatusBadge status={approval.status} /> },
          {
            label: 'Alur',
            value: <StatusBadge status={approval.flowType || 'legacy'} label={approval.flowType ? undefined : 'Lama'} />,
          },
          { label: 'Matriks', value: approval.matrixKey ? <code className="approval-code">{approval.matrixKey}</code> : null },
          { label: 'Jenis permintaan', value: approval.requestType },
          {
            label: 'Jumlah',
            value: approval.amount == null ? null : formatAmount(approval.amount, approval.currency),
          },
          { label: 'Tahap saat ini', value: approval.currentLevel },
        ]}
      />

      <section className="approval-steps" aria-labelledby="approval-steps-title">
        <h3 id="approval-steps-title" className="pw-title-section">Tahap approval</h3>
        {[...stages.entries()]
          .sort(([a], [b]) => a - b)
          .map(([order, steps]) => (
            <div key={order} className="approval-stage">
              <div className="pw-row pw-row--between approval-stage__head">
                <span className="approval-stage__title">Tahap {order}</span>
                {steps[0]?.parallelGroup && (
                  <Badge>
                    Paralel · <NoTranslate>{steps[0].parallelGroup}</NoTranslate>
                  </Badge>
                )}
              </div>

              {steps.map((step) => {
                const active =
                  step.status === 'pending' && Boolean(step.activatedAt);
                const actionable =
                  canDecide &&
                  approval.status === 'pending' &&
                  active &&
                  pendingIds.has(Number(step.id));

                return (
                  <div
                    key={step.id}
                    className="approval-step"
                  >
                    <div>
                      <div className="pw-row">
                        <span className="approval-step__who" data-no-translate={step.approverUserName ? '' : undefined}>{approverLabel(step)}</span>
                        {step.isOptional && <Badge>Opsional</Badge>}
                        {active && <StatusBadge status="active" />}
                      </div>

                      {step.delegatedFromUserId && (
                        <div className="pw-muted approval-step__meta">
                          Didelegasikan dari{' '}
                          {step.delegatedFromUserName
                            ? <NoTranslate>{step.delegatedFromUserName}</NoTranslate>
                            : `Pengguna #${step.delegatedFromUserId}`}
                        </div>
                      )}

                      {(step.escalatedAt ||
                        step.escalatedToUserId ||
                        step.escalatedToRoleId) && (
                        <div className="approval-step__meta">
                          Dieskalasi
                          {step.escalatedToUserName
                            ? ` ke ${step.escalatedToUserName}`
                            : step.escalatedToRoleName
                              ? ` ke ${step.escalatedToRoleName}`
                              : ''}
                        </div>
                      )}
                    </div>

                    <div>
                      <StatusBadge status={step.status} />
                      {step.decidedByName && (
                        <div className="pw-muted approval-step__meta">
                          oleh <NoTranslate>{step.decidedByName}</NoTranslate>
                        </div>
                      )}
                    </div>

                    <div className="approval-step__meta">
                      <div>
                        Aktif sejak:{' '}
                        {step.activatedAt ? formatDateTime(step.activatedAt) : 'Belum aktif'}
                      </div>
                      <div>
                        Tenggat: {formatDateTime(step.deadlineAt)}
                      </div>
                      {step.note && (
                        <div className="pw-muted approval-step__note">
                          Catatan: <NoTranslate>{step.note}</NoTranslate>
                        </div>
                      )}
                    </div>

                    <div>
                      {actionable ? (
                        <div className="pw-row pw-row--end">
                          {step.isOptional && (
                            <Button
                              variant="text"
                              onClick={() => decide(step, 'skip')}
                              disabled={decidingStepId === step.id}
                            >
                              Lewati
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            onClick={() => decide(step, 'request_revision')}
                            disabled={decidingStepId === step.id}
                          >
                            Minta revisi
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => setRejectStep(step)}
                            disabled={decidingStepId === step.id}
                          >
                            Tolak
                          </Button>
                          <Button
                            onClick={() => decide(step, 'approve')}
                            loading={decidingStepId === step.id}
                          >
                            Setujui
                          </Button>
                        </div>
                      ) : (
                        <span className="pw-muted">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
      </section>

      {canDecide && pendingSteps.length > 0 && (
        <Input
          label="Catatan keputusan"
          value={note}
          error={noteError}
          onChange={(event) => setNote(event.target.value)}
          hint="Wajib diisi untuk menolak, melewati, atau meminta revisi."
        />
      )}

      <ConfirmDialog
        open={Boolean(rejectStep)}
        tone="danger"
        title="Tolak approval?"
        message={`Approval #${approval.id} — ${approval.title} akan ditolak.`}
        confirmLabel="Tolak"
        loading={Boolean(rejectStep) && decidingStepId === rejectStep?.id}
        onClose={() => setRejectStep(null)}
        onConfirm={async () => {
          const step = rejectStep;
          await decide(step, 'reject');
          setRejectStep(null);
        }}
      />
    </div>
  );
}
