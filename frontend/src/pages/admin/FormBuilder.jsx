import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Eye } from 'lucide-react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';
import { toast } from '../../components/Toast';

const FIELD_TYPES = [
  'text','textarea','email','number','currency','date','datetime',
  'select','multi_select','checkbox','radio',
  'user_selector','entity_selector','department_selector',
  'file','document_link',
];

const blankField = (orderIndex) => ({
  fieldKey: '',
  label: '',
  fieldType: 'text',
  placeholder: '',
  helpText: '',
  isRequired: false,
  defaultValue: '',
  options: [],
  validation: null,
  sectionName: '',
  orderIndex,
  referenceType: null,
  dependsOnFieldKey: null,
  dependsOnValue: null,
});

export default function FormBuilder() {
  const { id } = useParams();
  const nav = useNavigate();
  const isEdit = !!id;

  const [form, setForm] = useState({
    name: '', slug: '', description: '', category: '',
    icon: '', color: '', isActive: true, isPublic: true,
    submitPermissionCode: 'form.submit', viewPermissionCode: 'form.view',
    fields: [],
  });
  const [workflows, setWorkflows] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    api.get('/workflows', { params: { activeOnly: '1' } })
      .then((r) => setWorkflows(r.data.data || []))
      .catch(() => {});
    api.get('/document-types', { params: { activeOnly: '1' } })
      .then((r) => setDocTypes(r.data.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/forms/${id}`)
      .then((r) => {
        const d = r.data.data;
        setForm({
          name: d.name, slug: d.slug,
          description: d.description || '', category: d.category || '',
          icon: d.icon || '', color: d.color || '',
          isActive: !!d.isActive, isPublic: !!d.isPublic,
          submitPermissionCode: d.submitPermissionCode || 'form.submit',
          viewPermissionCode: d.viewPermissionCode || 'form.view',
          workflowDefinitionId: d.workflowDefinitionId || null,
          documentTypeId: d.documentTypeId || null,
          fields: (d.fields || []).map((f) => ({
            fieldKey: f.fieldKey || '',
            label: f.label || '',
            fieldType: f.fieldType || 'text',
            placeholder: f.placeholder || '',
            helpText: f.helpText || '',
            isRequired: !!f.isRequired,
            defaultValue: f.defaultValue || '',
            options: Array.isArray(f.options) ? f.options : [],
            validation: f.validation || null,
            sectionName: f.sectionName || '',
            orderIndex: f.orderIndex ?? 0,
            referenceType: f.referenceType || null,
            dependsOnFieldKey: f.dependsOnFieldKey || null,
            dependsOnValue: f.dependsOnValue || null,
          })),
        });
      })
      .catch(() => toast('Form tidak ditemukan', 'error'))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  const updateField = (idx, key, value) => {
    setForm((prev) => {
      const fields = [...prev.fields];
      fields[idx] = { ...fields[idx], [key]: value };
      return { ...prev, fields };
    });
  };

  const addField = () => {
    setForm((prev) => ({
      ...prev,
      fields: [...prev.fields, blankField(prev.fields.length)],
    }));
  };

  const removeField = (idx) => {
    if (!confirm('Hapus field ini?')) return;
    setForm((prev) => ({
      ...prev,
      fields: prev.fields.filter((_, i) => i !== idx),
    }));
  };

  const move = (idx, dir) => {
    setForm((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.fields.length) return prev;
      const copy = [...prev.fields];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return { ...prev, fields: copy };
    });
  };

  const save = async () => {
    const slug = (form.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!form.name) return toast('Nama wajib', 'error');
    if (!slug) return toast('Slug wajib', 'error');
    if (!form.fields.length) return toast('Minimal 1 field', 'error');
    for (const f of form.fields) {
      if (!f.fieldKey) return toast(`Field "${f.label || '?'}" belum punya key`, 'error');
      if (!/^[a-z0-9_]+$/.test(f.fieldKey)) {
        return toast(`Field key "${f.fieldKey}" hanya huruf kecil, angka, underscore`, 'error');
      }
      if (!f.label) return toast(`Field "${f.fieldKey}" belum punya label`, 'error');
    }

    const payload = {
      name: form.name,
      slug,
      description: form.description || null,
      category: form.category || null,
      icon: form.icon || null,
      color: form.color || null,
      isActive: !!form.isActive,
      isPublic: !!form.isPublic,
      submitPermissionCode: form.submitPermissionCode || null,
      viewPermissionCode: form.viewPermissionCode || null,
      workflowDefinitionId: form.workflowDefinitionId || null,
      documentTypeId: form.documentTypeId || null,
      fields: form.fields.map((f, i) => ({
        fieldKey: f.fieldKey,
        label: f.label,
        fieldType: f.fieldType,
        placeholder: f.placeholder || null,
        helpText: f.helpText || null,
        isRequired: !!f.isRequired,
        defaultValue: f.defaultValue || null,
        options: ['select', 'radio', 'multi_select', 'checkbox'].includes(f.fieldType)
          ? (f.options || [])
          : null,
        validation: f.validation || null,
        sectionName: f.sectionName || null,
        orderIndex: i,
        referenceType: f.referenceType || null,
        dependsOnFieldKey: f.dependsOnFieldKey || null,
        dependsOnValue: f.dependsOnValue || null,
      })),
    };

    try {
      if (isEdit) {
        await api.patch(`/forms/${id}`, payload);
        toast('Form diperbarui', 'success');
      } else {
        const r = await api.post('/forms', payload);
        toast('Form dibuat', 'success');
        nav(`/admin/forms/${r.data.data.id}`);
      }
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menyimpan', 'error');
    }
  };

  if (loading) return <div>Memuat…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant="secondary" onClick={() => nav('/admin/forms')}>
          <ArrowLeft size={14} /> Formulir
        </Button>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" onClick={() => setPreviewOpen(true)}>
            <Eye size={14} /> Preview
          </Button>
          <Button onClick={save}>{isEdit ? 'Simpan Perubahan' : 'Buat Form'}</Button>
        </div>
      </div>

      <h2 style={{ marginTop: 16 }}>{isEdit ? `Edit: ${form.name}` : 'Form Baru'}</h2>

      <Card title="Informasi Formulir">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Input label="Nama *" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Slug * (huruf kecil, dash)" value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            disabled={isEdit} />
          <Input label="Kategori" value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="it_access / shared_drive / website / dll" />
          <Input label="Icon (nama Lucide, opsional)" value={form.icon}
            onChange={(e) => setForm({ ...form, icon: e.target.value })} />
        </div>

        <Input label="Deskripsi" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
          <div>
            <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Workflow (opsional)</label>
            <select
              value={form.workflowDefinitionId || ''}
              onChange={(e) => setForm({ ...form, workflowDefinitionId: e.target.value ? Number(e.target.value) : null })}
              style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}
            >
              <option value="">Tanpa workflow</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Document Type (opsional)</label>
            <select
              value={form.documentTypeId || ''}
              onChange={(e) => setForm({ ...form, documentTypeId: e.target.value ? Number(e.target.value) : null })}
              style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}
            >
              <option value="">Tidak ada</option>
              {docTypes.map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={!!form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Aktif
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={!!form.isPublic}
              onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} />
            Semua user dalam entity boleh submit
          </label>
        </div>
      </Card>

      <div style={{ marginTop: 12 }}>
        <Card
          title={`Field (${form.fields.length})`}
          actions={<Button onClick={addField}><Plus size={14} /> Tambah Field</Button>}
        >
          {!form.fields.length && (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: 12 }}>
              Belum ada field. Klik "Tambah Field".
            </div>
          )}
          {form.fields.map((f, idx) => (
            <div key={idx} style={{
              background: '#f8fafc', border: '1px solid var(--color-border)',
              borderRadius: 10, padding: 12, marginBottom: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <b style={{ fontSize: 13 }}>Field #{idx + 1}</b>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button variant="secondary" onClick={() => move(idx, -1)} disabled={idx === 0}>
                    <ChevronUp size={14} />
                  </Button>
                  <Button variant="secondary" onClick={() => move(idx, 1)}
                    disabled={idx === form.fields.length - 1}>
                    <ChevronDown size={14} />
                  </Button>
                  <Button variant="danger" onClick={() => removeField(idx)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Input
                  label="Field Key *"
                  value={f.fieldKey}
                  onChange={(e) =>
                    updateField(idx, 'fieldKey',
                      e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
                  }
                />
                <Input
                  label="Label *"
                  value={f.label}
                  onChange={(e) => updateField(idx, 'label', e.target.value)}
                />
                <div>
                  <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Tipe</label>
                  <select
                    value={f.fieldType}
                    onChange={(e) => updateField(idx, 'fieldType', e.target.value)}
                    style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}
                  >
                    {FIELD_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <Input
                  label="Section"
                  value={f.sectionName}
                  onChange={(e) => updateField(idx, 'sectionName', e.target.value)}
                />
                <Input
                  label="Placeholder"
                  value={f.placeholder}
                  onChange={(e) => updateField(idx, 'placeholder', e.target.value)}
                />
                <Input
                  label="Help Text"
                  value={f.helpText}
                  onChange={(e) => updateField(idx, 'helpText', e.target.value)}
                />
              </div>

              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={!!f.isRequired}
                  onChange={(e) => updateField(idx, 'isRequired', e.target.checked)}
                />
                Wajib diisi
              </label>

              {['select', 'radio', 'multi_select', 'checkbox'].includes(f.fieldType) && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    Opsi (satu per baris, format: <code>value|label</code>)
                  </label>
                  <textarea
                    value={(f.options || []).map((o) => `${o.value}|${o.label}`).join('\n')}
                    onChange={(e) => {
                      const opts = e.target.value.split('\n').map((line) => {
                        const [value, label] = line.split('|').map((s) => s.trim());
                        return value ? { value, label: label || value } : null;
                      }).filter(Boolean);
                      updateField(idx, 'options', opts);
                    }}
                    rows={3}
                    style={{
                      width: '100%', padding: 8, borderRadius: 8,
                      border: '1px solid var(--color-border)',
                      fontFamily: 'monospace', fontSize: 12,
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </Card>
      </div>

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={`Preview: ${form.name || 'Form'}`}
      >
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {form.fields.map((f, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                {f.label || '(tanpa label)'} {f.isRequired && '*'}
              </div>
              <div style={{
                padding: 10, borderRadius: 8, background: '#f1f5f9',
                fontSize: 13, color: 'var(--color-text-muted)',
                fontFamily: 'monospace',
              }}>
                {f.fieldType}
                {f.placeholder && <> · placeholder: "{f.placeholder}"</>}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
