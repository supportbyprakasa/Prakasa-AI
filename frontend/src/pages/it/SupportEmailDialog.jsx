import { useEffect, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Select from '../../components/Select';
import Switch from '../../components/Switch';
import { toast } from '../../components/Toast';

// Where "Butuh bantuan IT" sends each new ticket (setting it.support): the
// support mailbox, and the Project Tracker project whose Google Chat Space
// hears about it. Only People & Culture Supervisor/Head (it_ticket.manage)
// change it. The project list holds only projects whose Space the manager is
// in — announcements go out under their name.
export default function SupportEmailDialog({ open, onClose }) {
  const [values, setValues] = useState({ email: '', sendEmail: true, trackerProjectId: '' });
  const [projects, setProjects] = useState([]);
  const [mailReady, setMailReady] = useState(true);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setError('');
    setLoadError('');
    api.get('/it/tickets/support-settings')
      .then((r) => {
        if (!alive) return;
        const d = r.data?.data || {};
        setValues({ email: d.email || '', sendEmail: d.sendEmail !== false, trackerProjectId: d.trackerProjectId ? String(d.trackerProjectId) : '' });
        setMailReady(d.mailReady !== false);
      })
      .catch(() => { if (alive) setLoadError('Pengaturan tiket IT belum bisa dimuat.'); });
    api.get('/tracker/projects')
      .then((r) => { if (alive) setProjects(r.data?.data?.projects || []); })
      .catch(() => { if (alive) setProjects([]); });
    return () => { alive = false; };
  }, [open]);

  async function save(event) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) { setError('Tulis alamat email yang valid.'); return; }
    setBusy(true);
    try {
      await api.put('/it/tickets/support-settings', {
        email: values.email.trim(),
        sendEmail: values.sendEmail,
        trackerProjectId: values.trackerProjectId ? Number(values.trackerProjectId) : null,
      });
      toast('Pengaturan tiket IT disimpan', 'success');
      onClose();
    } catch (e) {
      setError(e?.response?.data?.error?.message || 'Pengaturan belum tersimpan. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      size="sm"
      title="Pengaturan tiket IT"
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={busy}>Batal</Button>
          <Button type="submit" form="it-support-email-form" loading={busy} disabled={Boolean(loadError)}>Simpan</Button>
        </>
      )}
    >
      <form id="it-support-email-form" className="pw-stack" onSubmit={save} noValidate>
        {loadError ? <Banner tone="error">{loadError}</Banner> : null}
        {!mailReady ? (
          <Banner tone="warning">Pengirim Gmail aplikasi belum diatur, jadi email belum terkirim. Tiket tetap masuk ke Tiket IT.</Banner>
        ) : null}
        <Input
          label="Alamat email support *"
          type="email"
          value={values.email}
          onChange={(e) => { setValues((v) => ({ ...v, email: e.target.value })); setError(''); }}
          error={error}
          hint="Setiap permintaan dari tombol Bantuan IT dikirim ke alamat ini."
        />
        <Switch
          label="Kirim email untuk setiap tiket baru"
          checked={values.sendEmail}
          onChange={(e) => setValues((v) => ({ ...v, sendEmail: e.target.checked }))}
        />
        <Select
          label="Project Tracker untuk tiket IT"
          value={values.trackerProjectId}
          onChange={(e) => { setValues((v) => ({ ...v, trackerProjectId: e.target.value })); setError(''); }}
          options={projectOptions(projects, values.trackerProjectId)}
          dataOptions
          hint={values.trackerProjectId
            ? 'Setiap tiket baru menjadi issue di project ini dan diumumkan di Space Google Chat-nya atas nama Anda. Status tiket dan issue saling mengikuti.'
            : 'Tiket tidak dibuatkan issue di Project Tracker.'}
        />
      </form>
    </Modal>
  );
}

// "Tidak disambungkan" first; a saved project the manager cannot see (not in
// its Space) stays listed so the choice is not silently dropped.
function projectOptions(projects, current) {
  const options = [{ value: '', label: 'Tidak disambungkan', translate: true }];
  for (const p of projects) options.push({ value: String(p.id), label: `${p.name} (${p.key})` });
  if (current && !projects.some((p) => String(p.id) === current)) {
    options.push({ value: current, label: 'Project tersimpan — Anda bukan anggota Space-nya', translate: true });
  }
  return options;
}
