import { useEffect, useState } from 'react';
import { Plus, Trash2, Save, ArrowUp, ArrowDown } from 'lucide-react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Badge from '../../components/Badge';
import { toast } from '../../components/Toast';

const SIZES = ['small', 'medium', 'large', 'full'];

export default function DashboardLayouts() {
  const [widgets, setWidgets] = useState([]);
  const [roles, setRoles] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [selectedRole, setSelectedRole] = useState(null);
  const [layout, setLayout] = useState([]);
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/dashboard-widgets'),
      api.get('/dashboard-layouts/roles'),
      api.get('/dashboard-layouts'),
    ])
      .then(([r1, r2, r3]) => {
        setWidgets(r1.data.data || []);
        setRoles(r2.data.data || []);
        setLayouts(r3.data.data || []);
      })
      .catch((e) => toast(e.response?.data?.error?.message || 'Gagal memuat', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openRole = async (role) => {
    setSelectedRole(role);
    try {
      const r = await api.get(`/dashboard-layouts/role/${role.id}`);
      if (r.data.data) {
        setLayout(r.data.data.layout || []);
        setName(r.data.data.name || '');
        setIsDefault(!!r.data.data.isDefault);
      } else {
        setLayout([]);
        setName(`${role.name} default`);
        setIsDefault(false);
      }
    } catch {
      setLayout([]);
      setName(`${role.name} default`);
      setIsDefault(false);
    }
  };

  const addWidget = (widgetCode) => {    setLayout((prev) => [...prev, {
      widgetCode,
      size: widgets.find((w) => w.code === widgetCode)?.defaultSize || 'medium',
      order: prev.length,
      config: {},
    }]);
    setAddOpen(false);
  };

  const removeWidget = (idx) => {
    setLayout((prev) => prev.filter((_, i) => i !== idx));
  };

  const moveWidget = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= layout.length) return;
    const copy = [...layout];
    [copy[idx], copy[target]] = [copy[target], copy[idx]];
    setLayout(copy.map((e, i) => ({ ...e, order: i })));
  };

  const updateSize = (idx, size) => {
    setLayout((prev) => prev.map((e, i) => i === idx ? { ...e, size } : e));
  };

  const save = async () => {
    if (!selectedRole) return;
    try {
      await api.post('/dashboard-layouts', {
        roleId: selectedRole.id,
        name: name || null,
        layout,
        isDefault,
      });
      toast('Layout disimpan', 'success');
      load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menyimpan', 'error');
    }
  };

  const removeLayout = async (layoutId) => {
    if (!confirm('Hapus layout ini?')) return;
    try {
      await api.delete(`/dashboard-layouts/${layoutId}`);
      toast('Layout dihapus', 'success');
      load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const availableWidgets = widgets.filter((w) => w.isActive !== false);

  return (
    <div>
      <h2 style={{ margin: 0, marginBottom: 12 }}>Dashboard Layouts</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        <Card title="Per Role">
          {loading && <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Memuat…</div>}
          {!loading && !roles.length && (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Belum ada role</div>
          )}
          {roles.map((r) => {
            const existing = layouts.find((l) => l.roleId === r.id);
            return (
              <div
                key={r.id}
                onClick={() => openRole(r)}
                style={{
                  padding: 8, borderRadius: 8, cursor: 'pointer',
                  background: selectedRole?.id === r.id ? '#eef2ff' : 'transparent',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontSize: 13,
                }}
              >
                <span>{r.name}</span>
                {existing && <Badge tone="success">Set</Badge>}
              </div>
            );
          })}
        </Card>

        <div>
          {!selectedRole && (
            <Card>
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                Pilih role di kiri untuk mengonfigurasi layout dashboard.
              </div>
            </Card>
          )}

          {selectedRole && (
            <>
              <Card title={`Layout: ${selectedRole.name}`} actions={
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button onClick={() => setAddOpen(true)}>
                    <Plus size={14} /> Widget
                  </Button>
                  <Button onClick={save}><Save size={14} /> Simpan</Button>
                </div>
              }>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 8, marginBottom: 12 }}>
                  <Input label="Nama Layout" value={name}
                    onChange={(e) => setName(e.target.value)} style={{ margin: 0 }} />
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginTop: 24 }}>
                    <input type="checkbox" checked={isDefault}
                      onChange={(e) => setIsDefault(e.target.checked)} />
                    Jadikan default
                  </label>
                </div>

                {!layout.length && (
                  <div style={{
                    padding: 24, textAlign: 'center', fontSize: 13,
                    color: 'var(--color-text-muted)',
                    border: '1px dashed var(--color-border)', borderRadius: 8,
                  }}>
                    Belum ada widget. Klik "Widget" untuk menambahkan.
                  </div>
                )}

                {layout.map((entry, idx) => {
                  const w = widgets.find((x) => x.code === entry.widgetCode);
                  return (
                    <div key={idx} style={{
                      display: 'grid', gridTemplateColumns: '1fr 120px auto auto auto',
                      gap: 8, alignItems: 'center',
                      padding: 10, marginBottom: 6,
                      background: '#f8fafc', borderRadius: 8,
                      border: '1px solid var(--color-border)', fontSize: 13,
                    }}>
                      <div>
                        <b>{w?.name || entry.widgetCode}</b>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          <code>{entry.widgetCode}</code>
                        </div>
                      </div>
                      <select value={entry.size || 'medium'}
                        onChange={(e) => updateSize(idx, e.target.value)}
                        style={{ padding: 6, borderRadius: 8, border: '1px solid var(--color-border)' }}>
                        {SIZES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                      <Button variant="secondary" onClick={() => moveWidget(idx, -1)} disabled={idx === 0}>
                        <ArrowUp size={14} />
                      </Button>
                      <Button variant="secondary" onClick={() => moveWidget(idx, 1)}
                        disabled={idx === layout.length - 1}>
                        <ArrowDown size={14} />
                      </Button>
                      <Button variant="danger" onClick={() => removeWidget(idx)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  );
                })}
              </Card>

              <div style={{ marginTop: 12 }}>
                <Card title="Semua Layout Tersimpan">
                  {layouts.map((l) => (
                    <div key={l.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: 8, borderBottom: '1px solid var(--color-border)', fontSize: 13,
                    }}>
                      <span>
                        <b>{l.roleName}</b> · {l.name || '—'} · {l.layout?.length || 0} widget
                      </span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {l.isDefault && <Badge tone="info">default</Badge>}
                        <Button variant="danger" onClick={() => removeLayout(l.id)}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {!layouts.length && (
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: 8 }}>
                      Belum ada layout
                    </div>
                  )}
                </Card>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Tambah Widget">
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {availableWidgets.map((w) => (
            <div
              key={w.code}
              onClick={() => addWidget(w.code)}
              style={{
                padding: 10, marginBottom: 6, cursor: 'pointer',
                border: '1px solid var(--color-border)', borderRadius: 8,
                fontSize: 13,
              }}
            >
              <b>{w.name}</b>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                <code>{w.code}</code> · {w.category} · default {w.defaultSize}
              </div>
            </div>
          ))}
          {!availableWidgets.length && (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              Belum ada widget di katalog. Buat widget dulu via API.
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
