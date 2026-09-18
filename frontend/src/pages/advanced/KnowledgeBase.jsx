import { useEffect, useState } from 'react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import { toast } from '../../components/Toast';

export default function KnowledgeBase() {
  const [docs, setDocs] = useState([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = () => {
    api.get('/kb/documents').then((r) => setDocs(r.data.data));
  };
  useEffect(load, []);

  const query = async (e) => {
    e.preventDefault();
    setLoading(true); setAnswer(null);
    try {
      const r = await api.post('/kb/query', { question });
      setAnswer(r.data.data);
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
    finally { setLoading(false); }
  };

  const upload = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post('/kb/documents', {
        entityId: Number(fd.get('entityId')),
        title: fd.get('title'),
        category: fd.get('category') || null,
        extractedText: fd.get('extractedText') || null,
        visibility: fd.get('visibility') || 'entity',
      });
      toast('Dokumen KB ditambahkan', 'success');
      setUploadOpen(false); load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>AI Knowledge Base</h2>
        <Button onClick={() => setUploadOpen(!uploadOpen)}>
          {uploadOpen ? 'Tutup' : '+ Dokumen KB'}
        </Button>
      </div>

      {uploadOpen && (
        <Card title="Tambah Dokumen KB">
          <form onSubmit={upload}>
            <Input label="Entity ID" name="entityId" type="number" required />
            <Input label="Judul" name="title" required />
            <Input label="Kategori" name="category" placeholder="sop/policy/guideline/faq" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              <label style={{ fontSize: 13 }}>Visibility</label>
              <select name="visibility" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
                <option value="entity">Semua entity</option>
                <option value="department">Department saja</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              <label style={{ fontSize: 13 }}>Teks dokumen (paste)</label>
              <textarea name="extractedText" rows={6} style={{
                padding: 8, borderRadius: 8, border: '1px solid var(--color-border)',
                fontFamily: 'monospace', fontSize: 12,
              }} />
            </div>
            <Button type="submit">Simpan</Button>
          </form>
        </Card>
      )}

      <div style={{ marginTop: 12 }}>
        <Card title="Tanya AI Knowledge Base">
          <form onSubmit={query} style={{ display: 'flex', gap: 8 }}>
            <Input value={question} onChange={(e) => setQuestion(e.target.value)}
              placeholder="Contoh: Bagaimana prosedur pengajuan reimbursement?"
              style={{ flex: 1, margin: 0 }} />
            <Button type="submit" disabled={loading || question.length < 3}>
              {loading ? 'Mencari…' : 'Tanya'}
            </Button>
          </form>
          {answer && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{answer.answer}</div>
              {answer.sources?.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Sumber: {answer.sources.map((s) => s.title).join(', ')}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title={`Dokumen KB (${docs.length})`}>
          {docs.map((d) => (
            <div key={d.id} style={{ fontSize: 13, padding: 6, borderBottom: '1px solid var(--color-border)' }}>
              <b>{d.title}</b> · {d.category || '—'} · {d.visibility}
            </div>
          ))}
          {!docs.length && <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Belum ada dokumen</div>}
        </Card>
      </div>
    </div>
  );
}
