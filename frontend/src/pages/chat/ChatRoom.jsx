import { useEffect, useState, useRef } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import Input from '../../components/Input';
import { toast } from '../../components/Toast';

export default function ChatRoom() {
  const [rooms, setRooms] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    api.get('/chat/rooms').then((r) => setRooms(r.data.data));
  }, []);

  const loadRoom = async (r) => {
    setActive(r);
    const res = await api.get(`/chat/rooms/${r.id}/messages`);
    setMessages(res.data.data);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
  };

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await api.post(`/chat/rooms/${active.id}/messages`, { body: text });
      setText('');
      const res = await api.get(`/chat/rooms/${active.id}/messages`);
      setMessages(res.data.data);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const convertToTask = async (msgId) => {
    try {
      const r = await api.post(`/chat/messages/${msgId}/convert-to-task`, {});
      toast(`Task #${r.data.data.taskId} dibuat`, 'success');
      loadRoom(active);
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <div className="prakasa-chat-layout" style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: 16, height: 'calc(100dvh - 180px)' }}>
      <aside style={{ background: 'var(--color-surface)', boxShadow: 'inset 0 0 0 1px var(--color-border)', borderRadius: 12, overflowY: 'auto' }}>
        {rooms.map((r) => (
          <div key={r.id} onClick={() => loadRoom(r)} style={{
            padding: 12, cursor: 'pointer',
            background: active?.id === r.id ? 'rgba(31,78,216,.08)' : 'transparent',
            boxShadow: 'inset 0 -1px 0 0 var(--color-border)', fontSize: 14,
          }}>{r.name}</div>
        ))}
        {!rooms.length && <div style={{ padding: 12, color: 'var(--color-text-muted)', fontSize: 13 }}>Belum ada room.</div>}
      </aside>

      <section style={{ background: 'var(--color-surface)', boxShadow: 'inset 0 0 0 1px var(--color-border)', borderRadius: 12, display: 'flex', flexDirection: 'column' }}>
        {!active && <div style={{ padding: 20, color: 'var(--color-text-muted)' }}>Pilih room untuk mulai chat.</div>}
        {active && (
          <>
            <div style={{ padding: 12, boxShadow: 'inset 0 -1px 0 0 var(--color-border)', fontWeight: 600 }}>{active.name}</div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              {messages.map((m) => (
                <div key={m.id} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {m.userName} · {new Date(m.createdAt).toLocaleString()}
                    {m.convertedTaskId && <> · <b>Task #{m.convertedTaskId}</b></>}
                  </div>
                  <div style={{ fontSize: 14 }}>{m.body}</div>
                  {!m.convertedTaskId && (
                    <button onClick={() => convertToTask(m.id)} style={{
                      fontSize: 11, marginTop: 2, background: 'transparent',
                      border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: 0,
                    }}>Convert to Task</button>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={send} style={{ display: 'flex', gap: 8, padding: 12, boxShadow: 'inset 0 1px 0 0 var(--color-border)' }}>
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tulis pesan…" style={{ flex: 1, margin: 0 }} />
              <Button type="submit">Kirim</Button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
