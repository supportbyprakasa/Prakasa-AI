import { useState, useRef, useEffect } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import Input from '../../components/Input';
import { toast } from '../../components/Toast';

export default function FieldBotChat() {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [quickAction, setQuickAction] = useState('new_visit_report');
  const bottomRef = useRef(null);

  const start = async () => {
    try {
      const r = await api.post('/sales/field-bot/sessions', { quickAction });
      setSessionId(r.data.data.id);
      setMessages([{ role: 'assistant', content: 'Halo! Silakan ketik laporan kunjungan Anda.' }]);
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal memulai', 'error');
    }
  };

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || !sessionId) return;
    const current = text;
    setMessages((m) => [...m, { role: 'user', content: current }]);
    setText('');
    try {
      const r = await api.post(`/sales/field-bot/sessions/${sessionId}/message`, { text: current });
      setMessages((m) => [...m, { role: 'assistant', content: r.data.data.reply }]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal kirim', 'error');
    }
  };

  return (
    <div>
      <h2>Field Sales Chat Bot</h2>
      {!sessionId && (
        <div style={{ marginTop: 16 }}>
          <Input label="Quick action" value={quickAction} onChange={(e) => setQuickAction(e.target.value)} />
          <Button onClick={start}>Mulai Sesi</Button>
        </div>
      )}
      {sessionId && (
        <div style={{ marginTop: 16, background: 'var(--color-surface)', borderRadius: 12, padding: 12, minHeight: 400, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                marginBottom: 8, textAlign: m.role === 'user' ? 'right' : 'left',
              }}>
                <div style={{
                  display: 'inline-block', padding: '8px 12px', borderRadius: 12,
                  background: m.role === 'user' ? 'var(--color-primary)' : '#f1f5f9',
                  color: m.role === 'user' ? '#fff' : 'var(--color-text)',
                  fontSize: 14, maxWidth: '75%', whiteSpace: 'pre-wrap',
                }}>{m.content}</div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={send} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tulis laporan…" style={{ flex: 1, margin: 0 }} />
            <Button type="submit">Kirim</Button>
          </form>
        </div>
      )}
    </div>
  );
}
