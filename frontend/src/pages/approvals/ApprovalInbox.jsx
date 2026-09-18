import { Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import api from '../../api/client';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import Card from '../../components/Card';
import DataTable from '../../components/DataTable';
import FilterBar from '../../components/FilterBar';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';

const STATUS_TONE = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  revision_requested: 'warning',
  cancelled: 'default',
};

export default function ApprovalInbox() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    requestType: '',
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [pendingSteps, setPendingSteps] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState('');
  const [decidingStepId, setDecidingStepId] = useState(null);

  const canDecide = (user?.permissions || []).includes('approval.decide');

  const load = async () => {
    setLoading(true);
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
      setMeta(response.data.meta || null);
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal memuat approval', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page, filters.status, filters.requestType]);

  const openDetail = async (row) => {
    setDetailLoading(true);
    setDetail(null);
    setPendingSteps([]);
    setNote('');

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
      toast(error.response?.data?.error?.message || 'Gagal membuka approval', 'error');
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
      toast('Catatan wajib untuk reject, skip, atau request revision', 'error');
      return;
    }

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
      toast(error.response?.data?.error?.message || 'Gagal menyimpan keputusan', 'error');
    } finally {
      setDecidingStepId(null);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Approval Inbox</h2>
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: 'var(--color-text-muted)',
          }}
        >
          Sequential dan parallel approval menggunakan assignment, delegation,
          escalation, dan active stage dari backend.
        </div>
      </div>

      <FilterBar
        filters={[
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'revision_requested', label: 'Revision Requested' },
              { value: 'cancelled', label: 'Cancelled' },
            ],
          },
          {
            name: 'requestType',
            label: 'Request Type',
            type: 'text',
            placeholder: 'payment / document / form_submission',
          },
        ]}
        values={filters}
        onChange={(next) => {
          setPage(1);
          setFilters(next);
        }}
        onReset={() => {
          setPage(1);
          setFilters({ status: '', requestType: '' });
        }}
      />

      <DataTable
        loading={loading}
        rows={rows}
        meta={meta}
        onPageChange={setPage}
        columns={[
          { key: 'id', title: 'ID' },
          { key: 'title', title: 'Judul' },
          {
            key: 'flowType',
            title: 'Flow',
            render: (row) => (
              <Badge tone={row.flowType === 'parallel' ? 'warning' : 'info'}>
                {row.flowType || 'legacy'}
              </Badge>
            ),
          },
          {
            key: 'matrixKey',
            title: 'Matrix',
            render: (row) =>
              row.matrixKey ? <code style={{ fontSize: 11 }}>{row.matrixKey}</code> : '—',
          },
          {
            key: 'amount',
            title: 'Amount',
            render: (row) =>
              row.amount == null
                ? '—'
                : `${row.currency || 'IDR'} ${Number(row.amount).toLocaleString('id-ID')}`,
          },
          {
            key: 'progress',
            title: 'Progress',
            render: (row) => (
              <span>
                {Number(row.approvedSteps || 0)} / {Number(row.totalSteps || 0)}
                {Number(row.activeSteps || 0) > 0 && (
                  <span style={{ color: 'var(--color-text-muted)' }}>
                    {' '}· {row.activeSteps} aktif
                  </span>
                )}
              </span>
            ),
          },
          {
            key: 'status',
            title: 'Status',
            render: (row) => (
              <Badge tone={STATUS_TONE[row.status] || 'default'}>{row.status}</Badge>
            ),
          },
          { key: 'requesterName', title: 'Requester' },
          {
            key: 'actions',
            title: 'Aksi',
            render: (row) => (
              <Button variant="secondary" onClick={() => openDetail(row)}>
                <Eye size={14} />
                Detail
              </Button>
            ),
          },
        ]}
      />

      <Modal
        open={Boolean(detail) || detailLoading}
        onClose={() => {
          setDetail(null);
          setPendingSteps([]);
          setNote('');
        }}
        title={detail ? `Approval #${detail.id} — ${detail.title}` : 'Memuat approval…'}
        maxWidth={980}
      >
        {detailLoading && !detail ? (
          <div style={{ padding: 24 }}>Memuat detail…</div>
        ) : detail ? (
          <ApprovalDetail
            approval={detail}
            pendingSteps={pendingSteps}
            note={note}
            setNote={setNote}
            decidingStepId={decidingStepId}
            decide={decide}
            canDecide={canDecide}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function ApprovalDetail({
  approval,
  pendingSteps,
  note,
  setNote,
  decidingStepId,
  decide,
  canDecide,
}) {
  const pendingIds = new Set((pendingSteps || []).map((step) => Number(step.id)));
  const stages = new Map();

  for (const step of approval.steps || []) {
    const order = Number(step.orderIndex || step.level || 1);
    if (!stages.has(order)) stages.set(order, []);
    stages.get(order).push(step);
  }

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 10,
          marginBottom: 14,
        }}
      >
        <Summary label="Status">
          <Badge tone={STATUS_TONE[approval.status] || 'default'}>
            {approval.status}
          </Badge>
        </Summary>
        <Summary label="Flow">
          <Badge tone={approval.flow_type === 'parallel' ? 'warning' : 'info'}>
            {approval.flow_type || 'legacy'}
          </Badge>
        </Summary>
        <Summary label="Matrix">
          {approval.matrix_key ? <code>{approval.matrix_key}</code> : '—'}
        </Summary>
        <Summary label="Request Type">{approval.request_type || '—'}</Summary>
        <Summary label="Amount">
          {approval.amount == null
            ? '—'
            : `${approval.currency || 'IDR'} ${Number(approval.amount).toLocaleString('id-ID')}`}
        </Summary>
        <Summary label="Current Stage">{approval.current_level || '—'}</Summary>
      </div>

      <Card title="Approval Steps">
        {[...stages.entries()]
          .sort(([a], [b]) => a - b)
          .map(([order, steps]) => (
            <div
              key={order}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 10,
                marginBottom: 10,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '8px 10px',
                  background: '#f8fafc',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <b style={{ fontSize: 13 }}>Stage #{order}</b>
                {steps[0]?.parallelGroup && (
                  <Badge tone="warning">
                    Parallel · {steps[0].parallelGroup}
                  </Badge>
                )}
              </div>

              {steps.map((step) => {
                const active =
                  step.status === 'pending' && Boolean(step.activatedAt);
                const actionable =
                  canDecide && active && pendingIds.has(Number(step.id));

                return (
                  <div
                    key={step.id}
                    style={{
                      padding: 10,
                      borderTop: '1px solid var(--color-border)',
                      display: 'grid',
                      gridTemplateColumns: 'minmax(160px, 1.2fr) minmax(130px, .8fr) minmax(180px, 1fr) auto',
                      gap: 10,
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <b>
                          {step.approverUserName ||
                            step.approverRoleName ||
                            (step.approverUserId
                              ? `User #${step.approverUserId}`
                              : step.approverRoleId
                                ? `Role #${step.approverRoleId}`
                                : 'Legacy approver')}
                        </b>
                        {step.isOptional && <Badge tone="info">Optional</Badge>}
                        {active && <Badge tone="warning">Active</Badge>}
                      </div>

                      {step.delegatedFromUserId && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--color-text-muted)',
                            marginTop: 3,
                          }}
                        >
                          Delegated from{' '}
                          {step.delegatedFromUserName ||
                            `User #${step.delegatedFromUserId}`}
                        </div>
                      )}

                      {(step.escalatedAt ||
                        step.escalatedToUserId ||
                        step.escalatedToRoleId) && (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#92400e',
                            marginTop: 3,
                          }}
                        >
                          Escalated
                          {step.escalatedToUserName
                            ? ` ke ${step.escalatedToUserName}`
                            : step.escalatedToRoleName
                              ? ` ke ${step.escalatedToRoleName}`
                              : ''}
                        </div>
                      )}
                    </div>

                    <div>
                      <Badge tone={stepTone(step.status)}>{step.status}</Badge>
                      {step.decidedByName && (
                        <div
                          style={{
                            marginTop: 3,
                            fontSize: 11,
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          oleh {step.decidedByName}
                        </div>
                      )}
                    </div>

                    <div style={{ fontSize: 12 }}>
                      <div>
                        Activated:{' '}
                        {step.activatedAt
                          ? new Date(step.activatedAt).toLocaleString('id-ID')
                          : 'Belum aktif'}
                      </div>
                      <div>
                        Deadline:{' '}
                        {step.deadlineAt
                          ? new Date(step.deadlineAt).toLocaleString('id-ID')
                          : '—'}
                      </div>
                      {step.note && (
                        <div
                          style={{
                            marginTop: 4,
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          Note: {step.note}
                        </div>
                      )}
                    </div>

                    <div>
                      {actionable ? (
                        <div
                          style={{
                            display: 'flex',
                            gap: 5,
                            flexWrap: 'wrap',
                            justifyContent: 'flex-end',
                          }}
                        >
                          <Button
                            onClick={() => decide(step, 'approve')}
                            disabled={decidingStepId === step.id}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => decide(step, 'reject')}
                            disabled={decidingStepId === step.id}
                          >
                            Reject
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => decide(step, 'request_revision')}
                            disabled={decidingStepId === step.id}
                          >
                            Revision
                          </Button>
                          {step.isOptional && (
                            <Button
                              variant="secondary"
                              onClick={() => decide(step, 'skip')}
                              disabled={decidingStepId === step.id}
                            >
                              Skip
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span
                          style={{
                            fontSize: 12,
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          —
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
      </Card>

      {canDecide && pendingSteps.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Input
            label="Catatan keputusan"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Wajib untuk reject, skip, dan request revision"
          />
        </div>
      )}
    </div>
  );
}

function Summary({ label, children }) {
  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--color-text-muted)',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

function stepTone(status) {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'error';
  if (status === 'pending') return 'warning';
  return 'default';
}
