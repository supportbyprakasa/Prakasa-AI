import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Upload, Paperclip, Check } from 'lucide-react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';

function decodeSubmissionValue(row, field) {
  if (!row) return undefined;
  if (field.fieldType === 'number' || field.fieldType === 'currency') {
    return row.valueNumber ?? '';
  }
  if (field.fieldType === 'date') {
    return row.valueDate ? new Date(row.valueDate).toISOString().slice(0, 10) : '';
  }
  if (field.fieldType === 'datetime') {
    return row.valueDate ? new Date(row.valueDate).toISOString().slice(0, 16) : '';
  }
  if (field.fieldType === 'user_selector') return row.valueUserId ?? '';
  if (field.fieldType === 'document_link' || field.fieldType === 'file') {
    return row.valueDocumentId ?? '';
  }
  if (field.fieldType === 'multi_select' || field.fieldType === 'checkbox') {
    let parsed = row.valueJson;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { parsed = []; }
    }
    if (field.fieldType === 'checkbox' && !(field.options || []).length) {
      return Array.isArray(parsed) ? parsed[0] === true : parsed === true;
    }
    return Array.isArray(parsed) ? parsed : [];
  }
  return row.valueText ?? '';
}

export default function FormRenderer() {
  const { slug } = useParams();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const draftId = searchParams.get('draft');
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submissionId, setSubmissionId] = useState(null);
  const [uploads, setUploads] = useState({}); // fieldKey → { name, webViewLink, loading }

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      try {
        const formResponse = await api.get(`/forms/catalog/${slug}`);
        const nextForm = formResponse.data.data;
        if (!active) return;

        const init = {};
        (nextForm.fields || []).forEach((field) => {
          if (
            field.defaultValue !== null &&
            field.defaultValue !== undefined &&
            field.defaultValue !== ''
          ) {
            init[field.fieldKey] = field.defaultValue;
          }
        });

        if (draftId) {
          const draftResponse = await api.get(`/forms/submissions/${draftId}`);
          const draft = draftResponse.data.data;
          if (
            draft.status !== 'draft' ||
            Number(draft.form_id) !== Number(nextForm.id)
          ) {
            throw new Error('Draft tidak sesuai dengan formulir ini');
          }

          const valueByFieldId = new Map(
            (draft.values || []).map((row) => [Number(row.fieldId), row])
          );
          for (const field of nextForm.fields || []) {
            const row = valueByFieldId.get(Number(field.id));
            const decoded = decodeSubmissionValue(row, field);
            if (decoded !== undefined) init[field.fieldKey] = decoded;
          }

          const nextUploads = {};
          for (const attachment of draft.attachments || []) {
            nextUploads[attachment.fieldKey] = {
              loading: false,
              name: attachment.name,
              webViewLink: attachment.webViewLink,
              driveFileId: attachment.driveFileId,
              documentId: attachment.documentId,
            };
            init[attachment.fieldKey] = attachment.documentId || attachment.driveFileId;
          }
          setUploads(nextUploads);
          setSubmissionId(Number(draftId));
        }

        setForm(nextForm);
        setValues(init);
      } catch (e) {
        toast(e.response?.data?.error?.message || e.message || 'Form tidak ditemukan', 'error');
        nav('/forms');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => { active = false; };
  }, [slug, draftId, nav]);

  const sections = useMemo(() => {
    if (!form) return [];
    const groups = {};
    (form.fields || []).forEach((f) => {
      const key = f.sectionName || '__default__';
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    });
    return Object.entries(groups).map(([name, fields]) => ({
      name: name === '__default__' ? null : name,
      fields,
    }));
  }, [form]);

  const setValue = (key, v) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: null }));
  };

  const validate = () => {
    const errs = {};
    for (const f of form.fields) {
      const v = values[f.fieldKey];
      const empty =
        v === undefined || v === null || v === '' ||
        (Array.isArray(v) && v.length === 0) ||
        (typeof v === 'boolean' && f.fieldType === 'checkbox' && v === false);
      if (f.isRequired && empty) {
        errs[f.fieldKey] = 'Wajib diisi';
        continue;
      }
      if (!empty && f.fieldType === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) errs[f.fieldKey] = 'Email tidak valid';
      }
      if (!empty && (f.fieldType === 'number' || f.fieldType === 'currency')) {
        if (isNaN(Number(v))) errs[f.fieldKey] = 'Harus angka';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const persistDraft = async () => {
    let id = submissionId;
    if (!id) {
      const created = await api.post('/forms/submit', {
        formId: form.id,
        values,
        submit: false,
      });
      id = created.data.data.id;
      setSubmissionId(id);
    }

    await api.patch(`/forms/submissions/${id}/draft`, { values });
    return id;
  };

  const uploadFile = async (field, file) => {
    if (!file) return;
    try {
      setUploads((prev) => ({ ...prev, [field.fieldKey]: { loading: true, name: file.name } }));
      const id = await persistDraft();
      const fd = new FormData();
      fd.append('file', file);
      fd.append('fieldId', String(field.id));
      fd.append('fieldKey', field.fieldKey);
      const r = await api.post(`/forms/submissions/${id}/upload-field`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploads((prev) => ({
        ...prev,
        [field.fieldKey]: {
          loading: false,
          name: r.data.data.name,
          webViewLink: r.data.data.webViewLink,
          driveFileId: r.data.data.driveFileId,
        },
      }));
      setValue(field.fieldKey, r.data.data.documentId || r.data.data.driveFileId);
      toast('File berhasil diunggah', 'success');
    } catch (e) {
      setUploads((prev) => {
        const c = { ...prev };
        delete c[field.fieldKey];
        return c;
      });
      toast(e.response?.data?.error?.message || 'Gagal mengunggah file', 'error');
    }
  };

  const submit = async (asDraft) => {
    if (!asDraft && !validate()) {
      toast('Masih ada field yang belum valid', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const id = await persistDraft();

      if (asDraft) {
        toast('Draft disimpan', 'success');
      } else {
        const response = await api.post(`/forms/submissions/${id}/finalize`);
        toast(
          `Terkirim: ${response.data.data.submissionNumber || id}`,
          'success'
        );
      }

      nav('/forms/submissions');
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menyimpan', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div>
        <Button variant="secondary" onClick={() => nav('/forms')}>
          <ArrowLeft size={14} /> Kembali
        </Button>
        <div style={{ marginTop: 16 }}>
          <SkeletonCard lines={6} />
        </div>
      </div>
    );
  }
  if (!form) return null;

  return (
    <div>
      <Button variant="secondary" onClick={() => nav('/forms')}>
        <ArrowLeft size={14} /> Kembali
      </Button>

      <div style={{ marginTop: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>{form.name}</h2>
            {form.description && (
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
                {form.description}
              </div>
            )}
          </div>
          {form.category && <Badge tone="info">{form.category}</Badge>}
        </div>
      </div>

      <Card>
        {sections.map((sec, si) => (
          <div key={si} style={{ marginBottom: 20 }}>
            {sec.name && (
              <div style={{
                fontSize: 13, fontWeight: 600, marginBottom: 12,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                {sec.name}
              </div>
            )}
            {sec.fields.map((f) => (
              <FieldRenderer
                key={f.id}
                field={f}
                value={values[f.fieldKey]}
                error={errors[f.fieldKey]}
                upload={uploads[f.fieldKey]}
                onChange={(v) => setValue(f.fieldKey, v)}
                onUpload={(file) => uploadFile(f, file)}
              />
            ))}
          </div>
        ))}

        <div style={{
          display: 'flex', gap: 8, justifyContent: 'flex-end',
          paddingTop: 16, boxShadow: 'inset 0 1px 0 0 var(--color-border)',
        }}>
          <Button variant="secondary" onClick={() => submit(true)} disabled={submitting}>
            Simpan Draft
          </Button>
          <Button onClick={() => submit(false)} disabled={submitting}>
            {submitting ? 'Mengirim…' : (<><Check size={14} /> Kirim</>)}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ============================================================
   Field renderer
   ============================================================ */

function FieldRenderer({ field, value, error, upload, onChange, onUpload }) {
  const label = (
    <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>
      {field.label}
      {field.isRequired ? <span style={{ color: 'var(--color-error)' }}> *</span> : null}
    </label>
  );

  const helpText = field.helpText ? (
    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
      {field.helpText}
    </div>
  ) : null;

  const errorText = error ? (
    <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 4 }}>{error}</div>
  ) : null;

  const wrap = (children) => (
    <div style={{ marginBottom: 16 }}>
      {label}
      {children}
      {errorText}
      {helpText}
    </div>
  );

  const inputStyle = {
    width: '100%', padding: 10, borderRadius: 8,
    boxShadow: `inset 0 0 0 1px ${error ? 'var(--color-error)' : 'var(--color-border)'}`,
    fontSize: 14,
  };

  switch (field.fieldType) {
    case 'textarea':
      return wrap(
        <textarea
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ''}
          rows={4}
          style={inputStyle}
        />
      );

    case 'select':
      return wrap(
        <select value={value || ''} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          <option value="">Pilih…</option>
          {(field.options || []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );

    case 'radio':
      return wrap(
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {(field.options || []).map((o) => (
            <label key={o.value} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
              <input
                type="radio"
                name={field.fieldKey}
                checked={String(value) === String(o.value)}
                onChange={() => onChange(o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
      );

    case 'checkbox': {
      // Single checkbox OR multi checkbox (if options exist → multi)
      if (field.options && field.options.length) {
        const arr = Array.isArray(value) ? value : [];
        return wrap(
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {field.options.map((o) => (
              <label key={o.value} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={arr.includes(o.value)}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...arr, o.value]);
                    else onChange(arr.filter((x) => x !== o.value));
                  }}
                />
                {o.label}
              </label>
            ))}
          </div>
        );
      }
      return wrap(
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.helpText || 'Ya'}
        </label>
      );
    }

    case 'multi_select': {
      const arr = Array.isArray(value) ? value : [];
      return wrap(
        <select
          multiple
          value={arr}
          onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))}
          style={{ ...inputStyle, minHeight: 100 }}
        >
          {(field.options || []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }

    case 'number':
    case 'currency':
      return wrap(
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ''}
          style={inputStyle}
        />
      );

    case 'date':
      return wrap(
        <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      );

    case 'datetime':
      return wrap(
        <input type="datetime-local" value={value || ''} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      );

    case 'email':
      return wrap(
        <input type="email" value={value || ''} onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ''} style={inputStyle} />
      );

    case 'user_selector':
      return wrap(
        <input type="number" value={value || ''} onChange={(e) => onChange(e.target.value)}
          placeholder="User ID" style={inputStyle} />
      );

    case 'entity_selector':
      return wrap(
        <input type="number" value={value || ''} onChange={(e) => onChange(e.target.value)}
          placeholder="Entity ID" style={inputStyle} />
      );

    case 'department_selector':
      return wrap(
        <input type="number" value={value || ''} onChange={(e) => onChange(e.target.value)}
          placeholder="Department ID" style={inputStyle} />
      );

    case 'document_link':
      return wrap(
        <input
          type="number"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || 'Document ID'}
          style={inputStyle}
        />
      );

    case 'file':
      return wrap(
        <div>
          {upload ? (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: 10, background: '#f8fafc', borderRadius: 8,
              boxShadow: 'inset 0 0 0 1px var(--color-border)', fontSize: 13,
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Paperclip size={14} />
                {upload.name}
              </span>
              {upload.loading ? (
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Mengunggah…</span>
              ) : upload.webViewLink ? (
                <a href={upload.webViewLink} target="_blank" rel="noreferrer"
                  style={{ fontSize: 12, color: 'var(--color-primary)' }}>
                  Buka
                </a>
              ) : null}
            </div>
          ) : (
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: 10,
              boxShadow: `inset 0 0 0 1px ${error ? 'var(--color-error)' : 'var(--color-border)'}`,
              borderRadius: 8, cursor: 'pointer', fontSize: 13,
              color: 'var(--color-text-muted)',
            }}>
              <Upload size={14} /> Pilih file…
              <input
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUpload(f);
                }}
              />
            </label>
          )}
        </div>
      );

    default:
      return wrap(
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ''}
          style={inputStyle}
        />
      );
  }
}
