import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import { toast } from '../../components/Toast';

export default function MeetingDetail() {
  const { id } = useParams();
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [transcript, setTranscript] = useState('');
  const [summary, setSummary] = useState(null);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/meetings/${id}`);
      setMeeting(r.data.data);
    } finally { setLoading(false); }
  };
  useEffect(load, [id]);

  const runSummary = async () => {
    setRunning(true);
    try {
      const r = await api.post('/ai/meeting-summary', {
        meetingId: Number(id),
        transcript: transcript || null,
      });
      setSummary(r.data.data);
      toast('Ringkasan dibuat', 'success');
      load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
    finally { setRunning(false); }
  };

  const confirmAction = async (itemId, assigneeId) => {
    try {
      const r = await api.post(`/ai/meeting-actions/${itemId}/confirm`, { assigneeId });
      toast(`Task #${r.data.data.taskId} dibuat`, 'success');
      load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  const dismissAction = async (itemId) => {
    try {
      await api.post(`/ai/meeting-actions/${itemId}/dismiss`);
      toast('Action item diabaikan', 'success');
      load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  const attach = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post(`/meetings/${id}/recording`, {
        recordingLink: fd.get('recordingLink') || null,
        transcriptLink: fd.get('transcriptLink') || null,
      });
      toast('Lampiran disimpan', 'success');
      load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  if (loading) return <div>Memuat…</div>;
  if (!meeting) return <div>Meeting tidak ditemukan.</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{meeting.title}</h2>
        <Badge tone={meeting.status === 'completed' ? 'success' : 'info'}>{meeting.status}</Badge>
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
        {new Date(meeting.start_time).toLocaleString('id-ID')} – {new Date(meeting.end_time).toLocaleString('id-ID')}
        {meeting.meet_link && <> · <a href={meeting.meet_link} target="_blank" rel="noreferrer">Google Meet</a></>}
      </p>

      {meeting.description && <Card title="Deskripsi"><p>{meeting.description}</p></Card>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Card title="Peserta">
          {meeting.participants.map((p) => (
            <div key={p.id} style={{ fontSize: 13, marginBottom: 6 }}>
              <b>{p.userName || p.externalName || p.externalEmail}</b> · {p.role} · {p.rsvpStatus}
            </div>
          ))}
        </Card>
        <Card title="Link Terkait">
          {meeting.links.map((l) => (
            <div key={l.id} style={{ fontSize: 13, marginBottom: 4 }}>
              {l.linkedType} #{l.linkedId}
            </div>
          ))}
          {!meeting.links.length && <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Belum ada link</div>}
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title="Rekaman / Transcript">
          <form onSubmit={attach}>
            <Input label="Recording Link (opsional)" name="recordingLink"
              defaultValue={meeting.recording_link || ''} />
            <Input label="Transcript Link (opsional)" name="transcriptLink"
              defaultValue={meeting.transcript_link || ''} />
            <Button type="submit">Simpan Lampiran</Button>
          </form>
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title="AI Meeting Summary"
          actions={<Button onClick={runSummary} disabled={running}>
            {running ? 'Memproses…' : 'Jalankan AI Summary'}
          </Button>}>
          <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)}
            placeholder="Tempel transcript / notes meeting di sini (atau gunakan transcriptLink di atas)…"
            rows={6} style={{ width: '100%', padding: 10, borderRadius: 8,
              boxShadow: 'inset 0 0 0 1px var(--color-border)', fontSize: 13 }} />
          {summary && (
            <div style={{ marginTop: 12 }}>
              <h4>Ringkasan</h4>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, background: '#f8fafc',
                padding: 12, borderRadius: 8 }}>{summary.content}</pre>
            </div>
          )}
        </Card>
      </div>

      {meeting.actionItems?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Card title="Action Items (perlu konfirmasi)">
            {meeting.actionItems.map((a) => (
              <div key={a.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: 10, boxShadow: 'inset 0 -1px 0 0 var(--color-border)', fontSize: 13,
              }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{a.title}</div>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                    {a.suggestedAssigneeName || a.suggestedAssigneeUserId || '—'} · {a.dueDate || 'tanpa due date'} · {a.priority}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {a.status === 'pending' && (
                    <>
                      <Button onClick={() => confirmAction(a.id, a.suggestedAssigneeUserId)}>Konfirmasi → Task</Button>
                      <Button variant="secondary" onClick={() => dismissAction(a.id)}>Abaikan</Button>
                    </>
                  )}
                  {a.status === 'confirmed' && <Badge tone="success">Task #{a.createdTaskId}</Badge>}
                  {a.status === 'dismissed' && <Badge tone="default">diabaikan</Badge>}
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
