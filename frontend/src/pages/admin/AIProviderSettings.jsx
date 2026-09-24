import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';

const PROVIDERS = [
  { id: 'claude_team', label: 'Claude Team' },
  { id: 'claude', label: 'Claude API' },
  { id: 'gemini', label: 'Gemini API' },
  { id: 'openai', label: 'OpenAI API' },
  { id: 'n8n', label: 'n8n AI Gateway' },
];

const MODELS = ['sonnet', 'opus', 'haiku'];

const fieldStyle = {
  padding: 8,
  borderRadius: 8,
  boxShadow: 'inset 0 0 0 1px var(--color-border)',
  background: 'var(--color-surface)',
  fontSize: 13,
};

const errorMessage = (e, fallback) => e.response?.data?.error?.message || fallback;

export default function AIProviderSettings() {
  const { user } = useAuth();
  const canManageModules = Boolean(user?.permissions?.includes('ai.config.manage'));

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cli, setCli] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [meta, setMeta] = useState(null);
  const [form, setForm] = useState({
    enabled: false,
    allowedDepartmentIds: [],
    emailsText: '',
    model: 'sonnet',
    webResearch: false,
  });
  const [modules, setModules] = useState([]);
  const [moduleBusy, setModuleBusy] = useState(false);

  const applySettings = (settings) => {
    setForm({
      enabled: settings.enabled,
      allowedDepartmentIds: settings.allowedDepartmentIds,
      emailsText: settings.allowedEmails.join('\n'),
      model: settings.model,
      webResearch: Boolean(settings.webResearch),
    });
    setMeta({ source: settings.source, updatedAt: settings.updatedAt });
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/ai/provider-settings/claude-team');
      applySettings(r.data.data.settings);
      setCli(r.data.data.cli);
      setDepartments(r.data.data.departments || []);
      if (canManageModules) {
        const m = await api.get('/ai/modules');
        setModules(m.data.data || []);
      }
    } catch (e) {
      toast(errorMessage(e, 'Gagal memuat pengaturan AI'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const departmentsByEntity = useMemo(() => {
    const groups = new Map();
    for (const d of departments) {
      if (!groups.has(d.entityName)) groups.set(d.entityName, []);
      groups.get(d.entityName).push(d);
    }
    return [...groups.entries()];
  }, [departments]);

  const toggleDepartment = (id) => {
    setForm((f) => ({
      ...f,
      allowedDepartmentIds: f.allowedDepartmentIds.includes(id)
        ? f.allowedDepartmentIds.filter((x) => x !== id)
        : [...f.allowedDepartmentIds, id],
    }));
  };

  const save = async () => {
    const allowedEmails = form.emailsText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    setSaving(true);
    try {
      const r = await api.put('/ai/provider-settings/claude-team', {
        enabled: form.enabled,
        allowedDepartmentIds: form.allowedDepartmentIds,
        allowedEmails,
        model: form.model,
        webResearch: form.webResearch,
      });
      applySettings(r.data.data.settings);
      toast('Pengaturan Claude Team disimpan', 'success');
    } catch (e) {
      toast(errorMessage(e, 'Gagal menyimpan pengaturan'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const setModuleProvider = async (module, provider) => {
    setModuleBusy(true);
    try {
      await api.patch(`/ai/modules/${encodeURIComponent(module)}`, { provider });
      setModules((rows) => rows.map((row) => (row.module === module ? { ...row, provider } : row)));
    } catch (e) {
      toast(errorMessage(e, `Gagal mengubah engine ${module}`), 'error');
    } finally {
      setModuleBusy(false);
    }
  };

  const useClaudeTeamEverywhere = async () => {
    setModuleBusy(true);
    try {
      for (const row of modules) {
        if (row.provider !== 'claude_team') {
          await api.patch(`/ai/modules/${encodeURIComponent(row.module)}`, { provider: 'claude_team' });
        }
      }
      setModules((rows) => rows.map((row) => ({ ...row, provider: 'claude_team' })));
      toast('Claude Team dijadikan engine utama semua modul', 'success');
    } catch (e) {
      toast(errorMessage(e, 'Gagal mengubah engine modul'), 'error');
      load();
    } finally {
      setModuleBusy(false);
    }
  };

  if (loading) {
    return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Memuat pengaturan…</div>;
  }

  const modelOptions = MODELS.includes(form.model) ? MODELS : [form.model, ...MODELS];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="prakasa-ai-heading"><Sparkles size={20} /><h1>AI Provider — Claude Team</h1></div>

      <Card
        title="Akun Claude di server"
        actions={<Button variant="secondary" onClick={load}><RefreshCw size={14} /> Cek ulang</Button>}
      >
        <CliStatus cli={cli} />
        <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          Akun ini ditentukan oleh login Claude Code di komputer yang menjalankan backend, bukan dari aplikasi.
          Untuk mengganti akun, jalankan <code>claude auth logout</code> lalu <code>claude auth login</code> di server tersebut.
        </p>
      </Card>

      <Card title="Akses Claude Team">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          Aktifkan Claude Team
        </label>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={form.webResearch}
            onChange={(e) => setForm({ ...form, webResearch: e.target.checked })}
            style={{ marginTop: 3 }}
          />
          <span>
            Izinkan riset web
            <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              User dapat menyalakan "Riset web" per percakapan agar AI mencari informasi di internet dan menyertakan sumber.
              Bila percakapan memuat dokumen internal, AI hanya boleh mencari (tidak membuka URL bebas) untuk mengurangi risiko kebocoran data.
            </span>
          </span>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16, maxWidth: 240 }}>
          <label htmlFor="claude-team-model" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Model</label>
          <select
            id="claude-team-model"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            style={fieldStyle}
          >
            {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            Divisi yang boleh memakai (semua member aktif di divisi terpilih)
          </div>
          {!departments.length && (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              Belum ada divisi. Tambahkan di Administrasi → Departments.
            </div>
          )}
          {departmentsByEntity.map(([entityName, rows]) => (
            <div key={entityName} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{entityName}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
                {rows.map((d) => (
                  <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={form.allowedDepartmentIds.includes(d.id)}
                      onChange={() => toggleDepartment(d.id)}
                    />
                    {d.name}
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>({d.memberCount} member)</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
          <label htmlFor="claude-team-emails" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Email tambahan (satu per baris) — untuk user tanpa divisi, mis. Super Admin
          </label>
          <textarea
            id="claude-team-emails"
            rows={4}
            value={form.emailsText}
            onChange={(e) => setForm({ ...form, emailsText: e.target.value })}
            style={{ ...fieldStyle, fontFamily: 'monospace', resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button onClick={save} disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
          {meta?.source === 'env' && (
            <span style={{ fontSize: 12, color: 'var(--color-warning)' }}>
              Saat ini memakai nilai dari .env — simpan untuk mengelolanya dari aplikasi.
            </span>
          )}
          {meta?.source === 'database' && meta.updatedAt && (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              Terakhir diubah {new Date(meta.updatedAt).toLocaleString('id-ID')}
            </span>
          )}
        </div>
      </Card>

      {canManageModules && (
        <Card
          title="Engine utama per modul"
          actions={(
            <Button variant="secondary" onClick={useClaudeTeamEverywhere} disabled={moduleBusy}>
              Jadikan Claude Team untuk semua
            </Button>
          )}
        >
          <div className="prakasa-table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 10 }}>Modul</th>
                  <th style={{ textAlign: 'left', padding: 10 }}>Engine</th>
                </tr>
              </thead>
              <tbody>
                {modules.map((row) => (
                  <tr key={row.module} style={{ boxShadow: 'inset 0 1px 0 0 var(--color-border)' }}>
                    <td style={{ padding: 10, fontFamily: 'monospace', fontSize: 13 }}>{row.module}</td>
                    <td style={{ padding: 10 }}>
                      <select
                        value={row.provider}
                        disabled={moduleBusy}
                        onChange={(e) => setModuleProvider(row.module, e.target.value)}
                        style={fieldStyle}
                        aria-label={`Engine untuk ${row.module}`}
                      >
                        {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function CliStatus({ cli }) {
  if (!cli) return null;
  if (cli.mode === 'gateway') {
    return <div style={{ fontSize: 13 }}>{cli.message}</div>;
  }
  if (!cli.available) {
    return <div style={{ fontSize: 13, color: 'var(--color-error)' }}>{cli.message}</div>;
  }

  const warnings = [];
  if (!cli.loggedIn) warnings.push('Claude Code belum login di server.');
  if (cli.loggedIn && cli.subscriptionType !== 'team') warnings.push(`Subscription bukan Team (${cli.subscriptionType || 'tidak diketahui'}).`);
  if (cli.loggedIn && cli.authMethod !== 'claude.ai') warnings.push('Login tidak memakai akun claude.ai (bisa jadi memakai API key berbayar).');

  const rows = [
    ['Status', cli.loggedIn ? 'Login' : 'Belum login'],
    ['Email', cli.email || '—'],
    ['Organisasi', cli.orgName || '—'],
    ['Subscription', cli.subscriptionType || '—'],
    ['Metode login', cli.authMethod || '—'],
  ];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', fontSize: 13 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <span style={{ color: 'var(--color-text-muted)' }}>{k}</span>
            <strong style={{ fontWeight: 600 }}>{v}</strong>
          </div>
        ))}
      </div>
      {warnings.map((w) => (
        <div key={w} style={{ marginTop: 8, fontSize: 12.5, color: 'var(--color-warning)' }}>{w}</div>
      ))}
    </div>
  );
}
