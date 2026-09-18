import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, FileText, Inbox } from 'lucide-react';
import api from '../../api/client';
import Card from '../../components/Card';
import Input from '../../components/Input';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';

export default function FormCatalog() {
  const nav = useNavigate();
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get('/forms', { params: { activeOnly: '1' } })
      .then((r) => setForms(r.data.data || []))
      .catch((e) => toast(e.response?.data?.error?.message || 'Gagal memuat form', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(
    () => [...new Set(forms.map((f) => f.category).filter(Boolean))].sort(),
    [forms]
  );

  const filtered = useMemo(() => {
    const qq = q.toLowerCase().trim();
    return forms.filter((f) => {
      if (category && f.category !== category) return false;
      if (!qq) return true;
      return (
        f.name.toLowerCase().includes(qq) ||
        (f.description || '').toLowerCase().includes(qq) ||
        (f.slug || '').toLowerCase().includes(qq)
      );
    });
  }, [forms, q, category]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Formulir</h2>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Pilih formulir yang ingin Anda ajukan
          </div>
        </div>
        <Button variant="secondary" onClick={() => nav('/forms/submissions')}>
          <Inbox size={16} /> Submission Saya
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
          <Search size={16} style={{
            position: 'absolute', left: 12, top: '50%',
            transform: 'translateY(-50%)', color: 'var(--color-text-muted)',
          }} />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari formulir…"
            style={{ margin: 0, paddingLeft: 34 }}
          />
        </div>
        {categories.length > 0 && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{
              padding: '8px 12px', borderRadius: 8,
              border: '1px solid var(--color-border)', fontSize: 14,
            }}
          >
            <option value="">Semua kategori</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {[1, 2, 3].map((i) => <SkeletonCard key={i} lines={2} />)}
        </div>
      )}

      {!loading && !filtered.length && (
        <div style={{
          padding: 40, textAlign: 'center', background: 'var(--color-surface)',
          border: '1px dashed var(--color-border)', borderRadius: 12,
        }}>
          <FileText size={32} style={{ color: 'var(--color-text-muted)' }} />
          <div style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 8 }}>
            Tidak ada formulir yang tersedia
          </div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
        }}>
          {filtered.map((f) => (
            <Link
              key={f.id}
              to={`/forms/${f.slug}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
                      {f.name}
                    </div>
                    {f.description && (
                      <div style={{
                        fontSize: 13, color: 'var(--color-text-muted)',
                        marginBottom: 8, lineHeight: 1.4,
                      }}>
                        {f.description}
                      </div>
                    )}
                  </div>
                  {f.category && <Badge tone="info">{f.category}</Badge>}
                </div>
                <div style={{
                  display: 'flex', gap: 12, marginTop: 12,
                  fontSize: 12, color: 'var(--color-text-muted)',
                }}>
                  <span>{f.fieldCount} field</span>
                  <span>{f.submissionCount} submission</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
