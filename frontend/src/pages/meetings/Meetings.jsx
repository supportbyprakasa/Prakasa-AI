import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import { toast } from '../../components/Toast';

export default function Meetings() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/meetings', { params: { limit: 100 } })
      .then((r) => setRows(r.data.data))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const attendeesEmails = (fd.get('attendeeEmails') || '').toString()
      .split(',').map((s) => s.trim()).filter(Boolean);
    const body = {
      entityId: Number(fd.get('entityId')),
      title: fd.get('title'),
      description: fd.get('description') || null,
      agenda: fd.get('agenda') || null,
      startTime: fd.get('startTime'),
      endTime: fd.get('endTime'),
      meetingType: fd.get('meetingType') || 'internal',
      withMeet: true,
      participants: attendeesEmails.map((email) => ({ email, role: 'required' })),
    };
    try {
      const r = await api.post('/meetings', body);
      toast(`Meeting dibuat${r.data.data.meetLink ? ' (Meet link aktif)' : ''}`, 'success');
      setOpen(false); load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  const statusTone = (s) => ({
    scheduled: 'info', completed: 'success', cancelled: 'error',
    in_progress: 'warning', rescheduled: 'warning',
  }[s] || 'default');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Meetings</h2>
        <Button onClick={() => setOpen(true)}>+ Jadwalkan Meeting</Button>
      </div>
      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada meeting"
        columns={[
          { key: 'title', title: 'Judul',
            render: (r) => <Link to={`/meetings/${r.id}`}>{r.title}</Link> },
          { key: 'startTime', title: 'Mulai',
            render: (r) => new Date(r.startTime).toLocaleString('id-ID') },
          { key: 'organizerName', title: 'Organizer' },
          { key: 'status', title: 'Status',
            render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
          { key: 'meetLink', title: 'Meet',
            render: (r) => r.meetLink
              ? <a href={r.meetLink} target="_blank" rel="noreferrer">Join</a>
              : <span style={{ color: 'var(--color-text-muted)' }}>—</span> },
          { key: 'aiSummaryId', title: 'AI',
            render: (r) => r.aiSummaryId ? '✅' : '—' },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Jadwalkan Meeting">
        <form onSubmit={create}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <Input label="Judul" name="title" required />
          <Input label="Deskripsi" name="description" />
          <Input label="Agenda" name="agenda" />
          <Input label="Mulai (ISO, mis. 2026-09-18T09:00)" name="startTime" required />
          <Input label="Selesai (ISO)" name="endTime" required />
          <Input label="Email peserta (pisah dengan koma)" name="attendeeEmails" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Tipe</label>
            <select name="meetingType" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
              <option value="internal">Internal</option>
              <option value="client">Client</option>
              <option value="vendor">Vendor</option>
              <option value="interview">Interview</option>
              <option value="other">Other</option>
            </select>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Google Meet link akan dibuat otomatis dan undangan dikirim ke semua peserta.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit">Jadwalkan</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
