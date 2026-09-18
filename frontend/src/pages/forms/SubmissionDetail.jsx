import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Paperclip, GitBranch, CheckCircle2, XCircle, Clock } from 'lucide-react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';

const statusTone = (s) => ({
  draft: 'default', submitted: 'info', under_review: 'warning',
  approved: 'success', rejected: 'error', revision_requested: 'warning',
  completed: 'success', cancelled: 'default',
}[s] || 'default');

export default function SubmissionDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [transitionTarget, setTransitionTarget] = useState(null);
  const [comment, setComment] = useState('');
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/forms/submissions/${id}`);
      setSub(r.data.data);
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Submission tidak ditemukan', 'error');
      nav('/forms/submissions');
    } finally {
      setLoading(false);
    }
  };
  useEffect(load, [id]);

  const doTransition = async () => {
    if (!transitionTarget) return;
    setRunning(true);
    try {
      await api.post(`/workflow-instances/${sub.workflow_instance_id}/transition`, {
        transitionId: transitionTarget.id,
        comment: comment || null,
      });
      toast('Status diperbarui', 'success');
      setTransitionTarget(null);
      setComment('');
      load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal transisi', 'error');
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div>
        <Button variant="secondary" onClick={() => nav('/forms/submissions')}>
          <ArrowLeft size={14} /> Kembali
        </Button>
        <div style={{ marginTop: 16 }}><SkeletonCard lines={8} /></div>
      </div>
    );
  }
  if (!sub) return null;

  const wf = sub.workflowInstance;

  return (
    <div>
      <Button variant="secondary" onClick={() => nav('/forms/submissions')}>
        <ArrowLeft size={14} /> Kembali
      </Button>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginTop: 16, marginBottom: 16, gap: 12,
      }}>
        <div>
          <h2 style={{ margin: 0 }}>{sub.submission_number}</h2>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
            {sub.formName} · oleh {sub.submittedByName || '—'}
            {sub.submitted_at && (
              <> · {new Date(sub.submitted_at).toLocaleString('id-ID')}</>
            )}
          </div>
        </div>        <Badge tone={statusTone(sub.status)}>{sub.status}</Badge>
      </div>

      {wf && (
        <div style={{ marginBottom: 12 }}>
          <Card title="Workflow">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <GitBranch size={16} />
              <b>{wf.workflowName}</b>
              <span style={{ color: 'var(--color-text-muted)' }}>·</span>
              <Badge tone="info">{wf.currentStatusLabel}</Badge>
              {wf.currentIsFinal && <Badge tone="success">final</Badge>}
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                Riwayat
              </div>
              {wf.history?.map((h) => (
                <div key={h.id} style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start',
                  padding: '6px 0', fontSize: 13,
                  borderBottom: '1px solid var(--color-border)',
                }}>
                  <Clock size={14} style={{ marginTop: 2, color: 'var(--color-text-muted)' }} />
                  <div style={{ flex: 1 }}>
                    <div>
                      {h.fromCode ? <code>{h.fromCode}</code> : '—'}
                      {' → '}
                      <code>{h.toCode}</code>
                      {h.actionLabel && <span style={{ color: 'var(--color-text-muted)' }}>
                        {' '}({h.actionLabel})
                      </span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                      {h.actorName || '—'} · {new Date(h.createdAt).toLocaleString('id-ID')}
                      {h.comment && <div>“{h.comment}”</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {wf.availableTransitions?.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {wf.availableTransitions.map((t) => (
                  <Button key={t.id} onClick={() => setTransitionTarget(t)}>
                    {t.actionLabel}
                  </Button>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <Card title="Data Formulir">
        {sub.values.map((v) => (
          <div key={v.id} style={{
            padding: '10px 0', borderBottom: '1px solid var(--color-border)', fontSize: 14,
          }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{v.label}</div>
            <div style={{ marginTop: 2 }}>{renderValue(v)}</div>
          </div>
        ))}
      </Card>

      {sub.attachments?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Card title={`Lampiran (${sub.attachments.length})`}>
            {sub.attachments.map((a) => (
              <div key={a.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 0', borderBottom: '1px solid var(--color-border)', fontSize: 13,
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Paperclip size={14} />
                  <b>{a.name}</b>
                  {a.size ? <span style={{ color: 'var(--color-text-muted)' }}>
                    ({Math.round(a.size / 1024)} KB)
                  </span> : null}
                </span>
                {a.webViewLink && (
                  <a href={a.webViewLink} target="_blank" rel="noreferrer">
                    <Button variant="secondary">Buka</Button>
                  </a>
                )}
              </div>
            ))}
          </Card>
        </div>
      )}

      <Modal
        open={!!transitionTarget}
        onClose={() => { setTransitionTarget(null); setComment(''); }}
        title={`Konfirmasi: ${transitionTarget?.actionLabel || ''}`}
      >
        <div style={{ marginBottom: 12, fontSize: 13 }}>
          Status akan berubah menjadi <b>{transitionTarget?.toLabel}</b>.
        </div>
        {transitionTarget?.requiresComment && (
          <Input
            label="Komentar (wajib)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        )}
        {!transitionTarget?.requiresComment && (
          <Input
            label="Komentar (opsional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" onClick={() => { setTransitionTarget(null); setComment(''); }}>
            Batal
          </Button>
          <Button onClick={doTransition} disabled={running}>
            {running ? 'Memproses…' : 'Konfirmasi'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function renderValue(v) {
  if (v.valueText) return v.valueText;
  if (v.valueNumber !== null && v.valueNumber !== undefined) return Number(v.valueNumber).toLocaleString('id-ID');
  if (v.valueDate) return new Date(v.valueDate).toLocaleString('id-ID');
  if (v.valueJson) {
    try {
      const arr = typeof v.valueJson === 'string' ? JSON.parse(v.valueJson) : v.valueJson;
      if (Array.isArray(arr)) return arr.join(', ');
      return JSON.stringify(arr);
    } catch { return String(v.valueJson); }
  }
  if (v.valueUserName) return v.valueUserName;
  if (v.valueDocumentTitle) return v.valueDocumentTitle;
  return '—';
}
