import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, LogOut, Settings2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

function initialsOf(user) {
  return (user?.name || user?.email || 'P')
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function AIAccountMenu({ compact = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const canManageProvider = (user?.permissions || []).includes('ai.provider.manage');

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const go = (path) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <div className={`ai-account${compact ? ' is-compact' : ''}`} ref={rootRef}>
      {open && (
        <div className="ai-menu is-account" role="menu" aria-label="Menu akun">
          <div className="ai-account-identity">
            <strong>{user?.name}</strong>
            <small>{user?.email}</small>
          </div>
          <button type="button" role="menuitem" className="ai-menu-item ai-ripple" onClick={() => go('/')}>
            <LayoutGrid size={17} /><span className="ai-menu-item-text"><strong>Kembali ke Work OS</strong></span>
          </button>
          {canManageProvider && (
            <button type="button" role="menuitem" className="ai-menu-item ai-ripple" onClick={() => go('/admin/ai-provider-settings')}>
              <Settings2 size={17} /><span className="ai-menu-item-text"><strong>Pengaturan AI</strong></span>
            </button>
          )}
          <button type="button" role="menuitem" className="ai-menu-item ai-ripple" onClick={logout}>
            <LogOut size={17} /><span className="ai-menu-item-text"><strong>Keluar</strong></span>
          </button>
        </div>
      )}
      <button
        type="button"
        className="ai-account-button ai-ripple"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu akun"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="ai-avatar">
          {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initialsOf(user)}
        </span>
        {!compact && (
          <span className="ai-account-text">
            <strong>{user?.name || user?.email}</strong>
            <small>{user?.email}</small>
          </span>
        )}
      </button>
    </div>
  );
}
