import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import { toast } from '../../components/Toast';

export default function AutomationBuilder() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanners, setScanners] = useState([]);
  const [actions, setActions] = useState([]);
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/automation').then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    api.get('/automation/scanners').then((r) => setScanners(r.data.data));
    api.get('/automation/actions').then((r) => setActions(r.data.data));
  }, []);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    let triggerConfig = {};
    let actionConfig = {};
    try {
      triggerConfig = JSON.parse(fd.get('triggerConfig') || '{}');
      actionConfig = JSON.parse(fd.get('actionConfig') || '{}');
    } catch {
      return toast('JSON tidak valid', 'error');
    }
    const body = {
      entityId: Number(fd.get('entityId')),
      name: fd.get('name'),
      description: fd.get('description') || null,
      triggerType: 'schedule',
      triggerConfig,
      actionType: fd.get('actionType'),
      actionConfig,
    };
    try {
      await api.post('/automation', body);
      toast('Rule dibuat', 'success');
      setOpen(false); load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  const runNow = async (id) => {
    try {
      await api.post(`/automation/${id}/run`);
      toast('Rule dijalankan', 'success');
      load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Automation Builder</h2>
        <Button onClick={() => setOpen(true)}>+ Rule</Button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Automation dijalankan via cPanel Cron Job (<code>automationRunner.js</code> — tiap 15 menit).
        Rule yang tersedia:
        <ul style={{ marginTop: 4 }}>
          {scanners.map((s) => <li key={s.code}><code>{s.code}</code></li>)}
        </ul>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada rule"
        columns={[
          { key: 'name', title: 'Nama' },
          { key: 'triggerType', title: 'Trigger',
            render: (r) => <code style={{ fontSize: 11 }}>{JSON.stringify(r.triggerConfig)}</code> },
          { key: 'actionType', title: 'Action' },
          { key: 'isActive', title: 'Aktif',
            render: (r) => r.isActive ? <Badge tone="success">Aktif</Badge> : <Badge>Nonaktif</Badge> },
          { key: 'lastRunStatus', title: 'Terakhir',
            render: (r) => r.lastRunAt
              ? <>{new Date(r.lastRunAt).toLocaleString('id-ID')} · {r.lastRunStatus}</>
              : '—' },
          { key: 'actions', title: 'Aksi',
            render: (r) => <Button variant="secondary" onClick={() => runNow(r.id)}>Run Now</Button> },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Rule Baru">
        <form onSubmit={create}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <Input label="Nama" name="name" required />
          <Input label="Deskripsi" name="description" />
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            triggerConfig (JSON). Contoh: <code>{`{"scan":"tasks_overdue_by_days","days":3}`}</code>
          </div>
          <textarea name="triggerConfig" rows={3} placeholder='{"scan":"tasks_overdue_by_days","days":3}'
            style={{ width: '100%', padding: 8, borderRadius: 8,
              border: '1px solid var(--color-border)', fontFamily: 'monospace', fontSize: 12, marginBottom: 12 }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Action</label>
            <select name="actionType" required style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
              {actions.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}
            </select>
          </div>

          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            actionConfig (JSON). Contoh: <code>{`{"title":"Task overdue","body":"Segera tindak lanjut"}`}</code>
          </div>
          <textarea name="actionConfig" rows={3} placeholder='{"title":"...","body":"..."}'
            style={{ width: '100%', padding: 8, borderRadius: 8,
              border: '1px solid var(--color-border)', fontFamily: 'monospace', fontSize: 12, marginBottom: 12 }} />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
