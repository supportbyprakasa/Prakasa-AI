import { useAuth } from '../context/AuthContext';
import { LogOut } from 'lucide-react';

export default function Navbar() {
  const { user, logout } = useAuth();
  return (
    <header style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '12px 24px', background: 'var(--color-surface)',
      borderBottom: '1px solid var(--color-border)'
    }}>
      <div style={{ fontWeight: 600 }}>Selamat datang{user ? `, ${user.name}` : ''}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {user?.avatarUrl && <img src={user.avatarUrl} alt="" width={28} height={28} style={{ borderRadius: '50%' }} />}
        <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>{user?.email}</span>
        <button onClick={logout} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
          background: 'transparent', border: '1px solid var(--color-border)',
          borderRadius: 8, cursor: 'pointer'
        }}>
          <LogOut size={14} /> Keluar
        </button>
      </div>
    </header>
  );
}
