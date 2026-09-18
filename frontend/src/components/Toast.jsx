import { useEffect, useState } from 'react';

let pushFn = () => {};
export function toast(message, tone = 'info') { pushFn(message, tone); }

export default function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    pushFn = (message, tone) => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, message, tone }]);
      setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 3500);
    };
  }, []);
  return (
    <div style={{ position: 'fixed', top: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 200 }}>
      {items.map((i) => (
        <div key={i.id} style={{
          background: i.tone === 'error' ? '#fee2e2' : i.tone === 'success' ? '#dcfce7' : '#dbeafe',
          color: 'var(--color-text)', padding: '10px 14px', borderRadius: 8, fontSize: 14,
          boxShadow: '0 4px 12px rgba(0,0,0,.08)', minWidth: 220,
        }}>{i.message}</div>
      ))}
    </div>
  );
}
