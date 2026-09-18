import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  Menu, Search, Bell, LogOut, User as UserIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Navbar({ onToggleSidebar }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const onSearch = (e) => {
    e.preventDefault();
    const query = q.trim();
    if (query.length < 2) return;
    navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <header className="prakasa-navbar">
      <div className="prakasa-navbar__left">
        <button
          type="button"
          className="prakasa-navbar__icon-btn"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
        >
          <Menu size={22} />
        </button>

        <Link to="/" className="prakasa-navbar__brand">
          <span className="prakasa-navbar__brand-mark">P</span>
          <span>Prakasa Work OS</span>
        </Link>
      </div>

      <div className="prakasa-navbar__center">
        <form className="prakasa-search" onSubmit={onSearch}>
          <input
            className="prakasa-search__input"
            type="search"
            placeholder="Cari di Prakasa Work OS…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
          <button className="prakasa-search__btn" type="submit" aria-label="Search">
            <Search size={20} />
          </button>
        </form>
      </div>

      <div className="prakasa-navbar__right">
        <Link
          to="/notifications"
          className="prakasa-navbar__icon-btn"
          aria-label="Notifications"
          title="Notifications"
        >
          <Bell size={22} />
        </Link>

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="prakasa-navbar__icon-btn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Account menu"
            title={user?.name || 'Account'}
          >
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="prakasa-navbar__avatar" />
            ) : (
              <UserIcon size={22} />
            )}
          </button>

          {menuOpen && (
            <>
              <div
                onClick={() => setMenuOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 39 }}
              />
              <div
                style={{
                  position: 'absolute', right: 0, top: 48, zIndex: 40,
                  background: '#fff', border: '1px solid var(--navbar-border)',
                  borderRadius: 12, minWidth: 260, padding: 8,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
                }}
              >
                <div style={{ padding: 10, borderBottom: '1px solid var(--navbar-border)' }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{user?.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{user?.email}</div>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '10px 12px', background: 'transparent', border: 'none',
                    cursor: 'pointer', fontSize: 14, borderRadius: 8, textAlign: 'left',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f2f2f2'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <LogOut size={18} /> Keluar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
