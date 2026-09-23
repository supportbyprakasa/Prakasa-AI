import { useState } from 'react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import { toast } from '../../components/Toast';

export default function SignatureAsset() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);

  const onFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 500 * 1024) return toast('Maksimum ukuran file 500KB', 'error');
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result);
    reader.readAsDataURL(f);
  };

  const save = async () => {
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    try {
      await api.post('/signatures/asset', { imageBase64: base64 });
      toast('Tanda tangan tersimpan (terenkripsi AES-256-GCM)', 'success');
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal menyimpan tanda tangan', 'error');
    }
  };

  return (
    <div>
      <h2>Tanda Tangan Saya</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        Gambar tanda tangan akan disimpan <b>terenkripsi (AES-256-GCM)</b>. Tidak ada endpoint yang mengembalikan file mentah ke user manapun.
      </p>

      <Card title="Upload Tanda Tangan">
        <input type="file" accept="image/png,image/jpeg" onChange={onFile} />
        {preview && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              background: '#fff',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              display: 'inline-block',
            }}
          >
            <img src={preview} alt="preview" style={{ maxHeight: 80 }} />
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Button onClick={save} disabled={!file}>
            Simpan Tanda Tangan
          </Button>
        </div>
      </Card>
    </div>
  );
}
