import { useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Field from '../../components/Field';
import FormActions from '../../components/FormActions';
import Page from '../../components/Page';
import { toast } from '../../components/Toast';
import { imageFileError } from './signatureModel';
import './signatures.css';

export default function SignatureAsset() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fileError, setFileError] = useState('');
  const [saving, setSaving] = useState(false);

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
    if (!file) return;
    setSaving(true);
    try {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      await api.post('/signatures/asset', { imageBase64: base64 });
      toast('Tanda tangan tersimpan (terenkripsi AES-256-GCM)', 'success');
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Tanda tangan gagal disimpan', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page
      title="Tanda tangan saya"
      description="Gambar tanda tangan disimpan terenkripsi (AES-256-GCM). Tidak ada endpoint yang mengembalikan file mentahnya ke pengguna mana pun."
    >
      <Card title="Unggah tanda tangan" variant="panel">
        <div className="pw-stack">
          <Field label="File tanda tangan" htmlFor="signature-file" hint="PNG atau JPEG, maksimum 500 KB." error={fileError}>
            <input id="signature-file" type="file" accept="image/png,image/jpeg" className="sig-file" onChange={onFile} />
          </Field>
          {preview && (
            <div className="sig-preview sig-preview--sm">
              <img src={preview} alt="Pratinjau tanda tangan" />
            </div>
          )}
          <FormActions>
            <Button icon="save" onClick={save} disabled={!file} loading={saving}>Simpan tanda tangan</Button>
          </FormActions>
        </div>
      </Card>
    </Page>
  );
}
