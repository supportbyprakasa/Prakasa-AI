import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import Button from '../../components/Button';
import Card from '../../components/Card';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import Field from '../../components/Field';
import FormActions from '../../components/FormActions';
import Page from '../../components/Page';
import Select from '../../components/Select';
import { toast } from '../../components/Toast';
import { imageFileError } from './signatureModel';
import './signatures.css';

const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

export default function Letterhead() {
  const { user } = useAuth();
  const canManage = (user?.permissions || []).includes('letterhead.manage');
  const [divisions, setDivisions] = useState(null);
  const [divisionsError, setDivisionsError] = useState('');
  const [departmentId, setDepartmentId] = useState(null);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadDivisions = () => {
    setDivisionsError('');
    api.get('/letterhead/divisions').then((response) => {
      const data = response.data.data || {};
      const list = Array.isArray(data.divisions) ? data.divisions : [];
      setDivisions(list);
      setDepartmentId(data.defaultDepartmentId || list[0]?.id || null);
      if (!data.defaultDepartmentId && !list.length) setLoading(false);
    }).catch((error) => {
      setDivisionsError(errorMessage(error, 'Daftar divisi gagal dimuat.'));
      setLoading(false);
    });
  };
  useEffect(loadDivisions, []);

  const load = (deptId) => {
    if (!deptId) return;
    setLoading(true);
    setLoadError('');
    api.get('/letterhead', { params: { departmentId: deptId } })
      .then((response) => setCurrent(response.data.data))
      .catch((error) => { setCurrent(null); setLoadError(errorMessage(error, 'Cap surat gagal dimuat.')); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(departmentId); /* eslint-disable-next-line */ }, [departmentId]);

  const onFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const problem = imageFileError(f);
    setFileError(problem);
    if (problem) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result);
    reader.readAsDataURL(f);
  };

  const save = async () => {
    if (!file || !departmentId) return;
    setSaving(true);
    try {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      await api.post('/letterhead', { departmentId, imageBase64: base64 });
      toast('Cap surat tersimpan (terenkripsi AES-256-GCM)', 'success');
      setFile(null);
      setPreview(null);
      load(departmentId);
    } catch (err) {
      toast(errorMessage(err, 'Cap surat gagal disimpan'), 'error');
    } finally {
      setSaving(false);
    }
  };

  let currentContent;
  if (divisionsError) {
    currentContent = (
      <EmptyState
        tone="error"
        compact
        title="Daftar divisi gagal dimuat"
        description={divisionsError}
        action={<Button variant="text" onClick={loadDivisions}>Coba lagi</Button>}
      />
    );
  } else if (divisions && !departmentId) {
    currentContent = <EmptyState compact icon="domain_disabled" title="Belum ada divisi" description="Akun Anda belum terhubung ke divisi mana pun." />;
  } else if (loadError) {
    currentContent = (
      <EmptyState
        tone="error"
        compact
        title="Cap surat gagal dimuat"
        description={loadError}
        action={<Button variant="text" onClick={() => load(departmentId)}>Coba lagi</Button>}
      />
    );
  } else if (loading) {
    currentContent = <LoadingState compact label="Memuat cap surat…" />;
  } else if (current?.exists) {
    currentContent = (
      <div className="sig-preview">
        <img src={`data:${current.mimeType};base64,${current.imageBase64}`} alt="Cap surat divisi" />
      </div>
    );
  } else {
    currentContent = <EmptyState compact icon="approval" title="Belum ada cap surat" description="Divisi ini belum memiliki cap surat." />;
  }

  return (
    <Page
      title="Cap surat"
      description="Cap atau kop surat resmi divisi, dipakai bersama oleh semua anggota divisi. Disimpan terenkripsi (AES-256-GCM)."
    >
      {divisions && divisions.length > 1 ? (
        <div className="sig-toolbar">
          <Select
            label="Divisi"
            fieldClassName="sig-toolbar__select"
            value={departmentId || ''}
            onChange={(e) => setDepartmentId(Number(e.target.value))}
            options={divisions.map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>
      ) : null}

      <Card title="Cap surat saat ini">
        {currentContent}
      </Card>

      {canManage && (
        <Card title="Unggah atau ganti cap surat" variant="panel">
          <div className="pw-stack">
            <Field label="File cap surat" htmlFor="letterhead-file" hint="PNG atau JPEG, maksimum 500 KB." error={fileError}>
              <input id="letterhead-file" type="file" accept="image/png,image/jpeg" className="sig-file" onChange={onFile} />
            </Field>
            {preview && (
              <div className="sig-preview">
                <img src={preview} alt="Pratinjau cap surat" />
              </div>
            )}
            <FormActions>
              <Button icon="save" onClick={save} disabled={!file || !departmentId} loading={saving}>Simpan cap surat</Button>
            </FormActions>
          </div>
        </Card>
      )}
    </Page>
  );
}
