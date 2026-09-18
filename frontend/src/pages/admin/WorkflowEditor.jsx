import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import ConfirmDialog from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';

export default function WorkflowEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const isEdit = !!id;

  const [form, setForm] = useState({
    name: '', slug: '', description: '', appliesTo: '',
    isActive: true,
    statuses: [
      { code: 'draft', label: 'Draft', color: '#64748b', isInitial: true, isFinal: false, orderIndex: 0 },
      { code: 'submitted', label: 'Submitted', color: '#0ea5e9', isInitial: false, isFinal: false, orderIndex: 1 },
      { code: 'approved', label: 'Approved', color: '#16a34a', isInitial: false, isFinal: true, orderIndex: 2 },
      { code: 'rejected', label: 'Rejected', color: '#dc2626', isInitial: false, isFinal: true, orderIndex: 3 },
    ],
    transitions: [],
  });
  const [loading, setLoading] = useState(isEdit);
  const [removeStatusTarget, setRemoveStatusTarget] = useState(null);
  const [removeTransitionTarget, setRemoveTransitionTarget] = useState(null);

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/workflows/${id}`)
      .then((r) => {
        const d = r.data.data;
        setForm({
          name: d.name, slug: d.slug, description: d.description || '',
          appliesTo: d.applies_to || '',
          isActive: !!d.is_active,
          statuses: (d.statuses || []).map((s) => ({
            code: s.code, label: s.label,
            color: s.color || '#64748b',
            isInitial: !!s.isInitial, isFinal: !!s.isFinal,
            orderIndex: s.orderIndex ?? 0,
            _existingId: s.id,
          })),
          transitions: (d.transitions || []).map((t) => ({
            fromStatusCode: t.fromCode, toStatusCode: t.toCode,
            actionLabel: t.actionLabel,
            requiredPermissionCode: t.requiredPermissionCode || '',
            requiresApproval: !!t.requiresApproval,
            requiresSignature: !!t.requiresSignature,
            requiresComment: !!t.requiresComment,
            orderIndex: t.orderIndex ?? 0,
            _existingId: t.id,
          })),
        });
      })
      .catch((e) => toast('Workflow tidak ditemukan', 'error'))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  const updateStatus = (idx, key, value) => {
    setForm((prev) => {
      const copy = [...prev.statuses];
      copy[idx] = { ...copy[idx], [key]: value };
      // if setting isInitial=true, unset others
      if (key === 'isInitial' && value === true) {
        return {
          ...prev,
          statuses: copy.map((s, i) => ({ ...s, isInitial: i === idx })),
        };
      }
      return { ...prev, statuses: copy };
    });
  };

  const addStatus = () => {
    setForm((prev) => ({
      ...prev,
      statuses: [...prev.statuses, {        code: '', label: '', color: '#64748b',
        isInitial: false, isFinal: false,
        orderIndex: prev.statuses.length,
      }],
    }));
  };

  const addTransition = () => {
    if (!form.statuses.length) return;
    setForm((prev) => ({
      ...prev,
      transitions: [...prev.transitions, {
        fromStatusCode: prev.statuses[0].code,
        toStatusCode: prev.statuses[1]?.code || prev.statuses[0].code,
        actionLabel: '',
        requiredPermissionCode: '',
        requiresApproval: false,
        requiresSignature: false,
        requiresComment: false,
        orderIndex: prev.transitions.length,
      }],
    }));
  };

  const save = async () => {
    if (!form.name) return toast('Nama wajib', 'error');
    if (!form.slug) return toast('Slug wajib', 'error');
    if (!/^[a-z0-9-]+$/.test(form.slug)) return toast('Slug tidak valid', 'error');
    if (form.statuses.length < 2) return toast('Minimal 2 status', 'error');
    if (!form.statuses.some((s) => s.isInitial)) return toast('Harus ada 1 status initial', 'error');

    for (const s of form.statuses) {
      if (!s.code) return toast('Semua status harus punya code', 'error');
      if (!/^[a-z0-9_-]+$/.test(s.code)) return toast(`Status code "${s.code}" tidak valid`, 'error');
      if (!s.label) return toast(`Status "${s.code}" harus punya label`, 'error');
    }
    for (const t of form.transitions) {
      if (!t.actionLabel) return toast('Setiap transisi harus punya action label', 'error');
      if (!t.fromStatusCode || !t.toStatusCode) {
        return toast('Setiap transisi harus punya from & to status', 'error');
      }
    }

    const payload = {
      name: form.name,
      slug: form.slug,
      description: form.description || null,
      appliesTo: form.appliesTo || null,
      isActive: !!form.isActive,
      statuses: form.statuses.map((s, i) => ({
        code: s.code, label: s.label, color: s.color,
        isInitial: !!s.isInitial, isFinal: !!s.isFinal,
        orderIndex: i,
      })),
      transitions: form.transitions.map((t, i) => ({
        fromStatusCode: t.fromStatusCode,
        toStatusCode: t.toStatusCode,
        actionLabel: t.actionLabel,
        requiredPermissionCode: t.requiredPermissionCode || null,
        requiresApproval: !!t.requiresApproval,
        requiresSignature: !!t.requiresSignature,
        requiresComment: !!t.requiresComment,
        orderIndex: i,
      })),
    };

    try {
      if (isEdit) {
        // Backend update only supports metadata; statuses/transitions must be edited separately.
        // For MVP: allow full replacement via PATCH not supported → we delete/create statuses/transitions separately.
        await api.patch(`/workflows/${id}`, {
          name: payload.name,
          description: payload.description,
          appliesTo: payload.appliesTo,
          isActive: payload.isActive,
        });

        // Replace statuses & transitions
        // strategy: delete removed ones, create new ones.
        const existingStatuses = (form.statuses || []).filter((s) => s._existingId);
        const existingTransitions = (form.transitions || []).filter((t) => t._existingId);

        const originalStatuses = (await api.get(`/workflows/${id}`)).data.data.statuses || [];
        const keepStatusIds = new Set(existingStatuses.map((s) => s._existingId));
        for (const orig of originalStatuses) {
          if (!keepStatusIds.has(orig.id)) {
            try { await api.delete(`/workflows/${id}/statuses/${orig.id}`); } catch { /* may be in use */ }
          }
        }

        const originalTransitions = (await api.get(`/workflows/${id}`)).data.data.transitions || [];
        const keepTransIds = new Set(existingTransitions.map((t) => t._existingId));
        for (const orig of originalTransitions) {
          if (!keepTransIds.has(orig.id)) {
            try { await api.delete(`/workflows/${id}/transitions/${orig.id}`); } catch { /* may be in use */ }
          }
        }

        for (const s of form.statuses) {
          if (s._existingId) {
            await api.patch(`/workflows/${id}/statuses/${s._existingId}`, {
              label: s.label, color: s.color,
              isInitial: !!s.isInitial, isFinal: !!s.isFinal,
              orderIndex: s.orderIndex,
            });
          } else {
            const r = await api.post(`/workflows/${id}/statuses`, {
              code: s.code, label: s.label, color: s.color,
              isInitial: !!s.isInitial, isFinal: !!s.isFinal,
              orderIndex: s.orderIndex,
            });
            s._existingId = r.data.data.id;
          }
        }

        for (const t of form.transitions) {
          if (t._existingId) {
            await api.patch(`/workflows/${id}/transitions/${t._existingId}`, {
              actionLabel: t.actionLabel,
              requiredPermissionCode: t.requiredPermissionCode || null,
              requiresApproval: !!t.requiresApproval,
              requiresSignature: !!t.requiresSignature,
              requiresComment: !!t.requiresComment,
              orderIndex: t.orderIndex,
            });
          } else {
            await api.post(`/workflows/${id}/transitions`, {
              fromStatusCode: t.fromStatusCode,
              toStatusCode: t.toStatusCode,
              actionLabel: t.actionLabel,
              requiredPermissionCode: t.requiredPermissionCode || null,
              requiresApproval: !!t.requiresApproval,
              requiresSignature: !!t.requiresSignature,
              requiresComment: !!t.requiresComment,
              orderIndex: t.orderIndex,
            });
          }
        }

        toast('Workflow diperbarui', 'success');
      } else {
        const r = await api.post('/workflows', payload);
        toast('Workflow dibuat', 'success');
        nav(`/admin/workflows/${r.data.data.id}`);
      }
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menyimpan', 'error');
    }
  };

  const confirmRemoveStatus = async () => {
    const { idx } = removeStatusTarget;
    const s = form.statuses[idx];
    if (s._existingId) {
      try {
        await api.delete(`/workflows/${id}/statuses/${s._existingId}`);
      } catch (e) {
        toast(e.response?.data?.error?.message || 'Status sedang dipakai', 'error');
        setRemoveStatusTarget(null);
        return;
      }
    }
    setForm((prev) => ({
      ...prev,
      statuses: prev.statuses.filter((_, i) => i !== idx),
    }));
    setRemoveStatusTarget(null);
  };

  const confirmRemoveTransition = async () => {
    const { idx } = removeTransitionTarget;
    const t = form.transitions[idx];
    if (t._existingId) {
      try {
        await api.delete(`/workflows/${id}/transitions/${t._existingId}`);
      } catch (e) {
        toast(e.response?.data?.error?.message || 'Transisi sedang dipakai', 'error');
        setRemoveTransitionTarget(null);
        return;
      }
    }
    setForm((prev) => ({
      ...prev,
      transitions: prev.transitions.filter((_, i) => i !== idx),
    }));
    setRemoveTransitionTarget(null);
  };

  if (loading) return <div>Memuat…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant="secondary" onClick={() => nav('/admin/workflows')}>
          <ArrowLeft size={14} /> Workflows
        </Button>
        <Button onClick={save}>
          <Save size={14} /> {isEdit ? 'Simpan' : 'Buat Workflow'}
        </Button>
      </div>

      <h2 style={{ marginTop: 16 }}>{isEdit ? `Edit: ${form.name}` : 'Workflow Baru'}</h2>

      <Card title="Metadata">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Input label="Nama *" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Slug *" value={form.slug} disabled={isEdit}
            onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          <Input label="Applies To" value={form.appliesTo}
            onChange={(e) => setForm({ ...form, appliesTo: e.target.value })}
            placeholder="form / document_type / finance / hrga / procurement" />
        </div>
        <Input label="Deskripsi" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginTop: 8 }}>
          <input type="checkbox" checked={!!form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Aktif
        </label>
      </Card>

      <div style={{ marginTop: 12 }}>
        <Card
          title={`Statuses (${form.statuses.length})`}
          actions={<Button onClick={addStatus}><Plus size={14} /> Status</Button>}
        >
          {form.statuses.map((s, idx) => (
            <div key={idx} style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 100px 90px 90px 40px',
              gap: 8, alignItems: 'end',
              padding: 8, marginBottom: 6,
              background: '#f8fafc', borderRadius: 8,
              border: '1px solid var(--color-border)',
            }}>
              <Input label={idx === 0 ? 'Code' : ''} value={s.code} disabled={!!s._existingId}
                onChange={(e) => updateStatus(idx, 'code', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
                style={{ margin: 0 }} />
              <Input label={idx === 0 ? 'Label' : ''} value={s.label}
                onChange={(e) => updateStatus(idx, 'label', e.target.value)}
                style={{ margin: 0 }} />
              <div>
                {idx === 0 && <label style={{ fontSize: 12 }}>Color</label>}
                <input type="color" value={s.color}
                  onChange={(e) => updateStatus(idx, 'color', e.target.value)}
                  style={{ width: '100%', height: 36 }} />
              </div>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
                <input type="checkbox" checked={!!s.isInitial}
                  onChange={(e) => updateStatus(idx, 'isInitial', e.target.checked)} />
                Initial
              </label>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
                <input type="checkbox" checked={!!s.isFinal}
                  onChange={(e) => updateStatus(idx, 'isFinal', e.target.checked)} />
                Final
              </label>
              <Button variant="danger" onClick={() => setRemoveStatusTarget({ idx })}>
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card
          title={`Transitions (${form.transitions.length})`}
          actions={<Button onClick={addTransition} disabled={form.statuses.length < 2}>
            <Plus size={14} /> Transisi
          </Button>}
        >
          {form.transitions.map((t, idx) => (
            <div key={idx} style={{
              padding: 10, marginBottom: 8, background: '#f8fafc',
              borderRadius: 8, border: '1px solid var(--color-border)',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 12 }}>Dari</label>
                  <select value={t.fromStatusCode}
                    onChange={(e) => {
                      const c = [...form.transitions];
                      c[idx].fromStatusCode = e.target.value;
                      setForm({ ...form, transitions: c });
                    }}
                    style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
                    {form.statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12 }}>Ke</label>
                  <select value={t.toStatusCode}
                    onChange={(e) => {
                      const c = [...form.transitions];
                      c[idx].toStatusCode = e.target.value;
                      setForm({ ...form, transitions: c });
                    }}
                    style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
                    {form.statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                  </select>
                </div>
                <Input label="Action Label" value={t.actionLabel}
                  onChange={(e) => {
                    const c = [...form.transitions];
                    c[idx].actionLabel = e.target.value;
                    setForm({ ...form, transitions: c });
                  }}
                  style={{ margin: 0 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: 12, alignItems: 'end', marginTop: 8 }}>
                <Input label="Required Permission (opsional)" value={t.requiredPermissionCode}
                  onChange={(e) => {
                    const c = [...form.transitions];
                    c[idx].requiredPermissionCode = e.target.value;
                    setForm({ ...form, transitions: c });
                  }}
                  style={{ margin: 0 }} />
                <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
                  <input type="checkbox" checked={!!t.requiresComment}
                    onChange={(e) => {
                      const c = [...form.transitions];
                      c[idx].requiresComment = e.target.checked;
                      setForm({ ...form, transitions: c });
                    }} />
                  Comment
                </label>
                <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
                  <input type="checkbox" checked={!!t.requiresApproval}
                    onChange={(e) => {
                      const c = [...form.transitions];
                      c[idx].requiresApproval = e.target.checked;
                      setForm({ ...form, transitions: c });
                    }} />
                  Approval
                </label>
                <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
                  <input type="checkbox" checked={!!t.requiresSignature}
                    onChange={(e) => {
                      const c = [...form.transitions];
                      c[idx].requiresSignature = e.target.checked;
                      setForm({ ...form, transitions: c });
                    }} />
                  Signature
                </label>
                <Button variant="danger" onClick={() => setRemoveTransitionTarget({ idx })}>
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <ConfirmDialog
        open={!!removeStatusTarget}
        title="Hapus status?"
        message="Status ini akan dihapus dari workflow."
        confirmLabel="Ya, hapus"
        onConfirm={confirmRemoveStatus}
        onClose={() => setRemoveStatusTarget(null)}
      />
      <ConfirmDialog
        open={!!removeTransitionTarget}
        title="Hapus transisi?"
        message="Transisi ini akan dihapus dari workflow."
        confirmLabel="Ya, hapus"
        onConfirm={confirmRemoveTransition}
        onClose={() => setRemoveTransitionTarget(null)}
      />
    </div>
  );
}
