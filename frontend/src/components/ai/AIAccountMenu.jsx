import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Avatar from '../Avatar';
import Menu from '../Menu';

// The signed-in account at the foot of the AI sidebar; opens the shared Menu
// (docs/ui-guideline.md §4.14) above itself, with the account in its header.
export default function AIAccountMenu({ compact = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const menuId = useId();
  const canManageProvider = (user?.permissions || []).includes('ai.provider.manage');

  const items = [
    { key: 'workspace', icon: 'grid_view', label: 'Kembali ke Workspace', onClick: () => navigate('/') },
    ...(canManageProvider
      ? [{ key: 'settings', icon: 'settings', label: 'Pengaturan AI', onClick: () => navigate('/admin/ai-provider-settings') }]
      : []),
    { key: 'logout', icon: 'logout', label: 'Keluar', onClick: logout },
  ];

  return (
    <div className={`ai-account${compact ? ' is-compact' : ''}`}>
      <button
        ref={anchorRef}
        type="button"
        className="ai-account-button pw-state-layer"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Menu akun"
        onClick={() => setOpen((current) => !current)}
      >
        <Avatar name={user?.name || user?.email || 'P'} src={user?.avatarUrl} size="md" />
        {!compact && (
          <span className="ai-account-text">
            <span data-no-translate="" className="ai-account-name">{user?.name || user?.email}</span>
            <span data-no-translate="" className="ai-account-email">{user?.email}</span>
          </span>
        )}
      </button>
      <Menu
        id={menuId}
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        label="Menu akun"
        align="start"
        placement="top"
        className="ai-account-menu"
        header={(
          <>
            <span data-no-translate="" className="ai-account-name">{user?.name}</span>
            <span data-no-translate="" className="ai-account-email">{user?.email}</span>
          </>
        )}
        items={items}
      />
    </div>
  );
}
