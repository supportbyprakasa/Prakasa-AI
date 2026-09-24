import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { buildNavSections } from './navigation';
import { useNotificationCount } from '../context/NotificationContext';

export function useNavConfig() {
  const { user } = useAuth();
  return buildNavSections(user?.permissions || []);
}

export default function Sidebar({ collapsed, mobileOpen, onCloseMobile }) {
  const sections = useNavConfig();
  const { unreadCount } = useNotificationCount();

  return (
    <aside
      className={[
        'prakasa-sidebar',
        collapsed ? 'prakasa-sidebar--collapsed' : '',
        mobileOpen ? 'prakasa-sidebar--open-mobile' : '',
      ].join(' ')}
    >
      <nav className="prakasa-sidebar__nav" aria-label="Navigasi utama">
        {sections.map((section, si) => (
          <div className="prakasa-sidebar__section" key={si}>
            {section.title && (
              <h3 className="prakasa-sidebar__section-title">{section.title}</h3>
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={collapsed ? item.label : undefined}
                  onClick={() => onCloseMobile?.()}
                  className={({ isActive }) =>
                    `prakasa-sidebar__item ${isActive ? 'prakasa-sidebar__item--active' : ''}`
                  }
                >
                  <span className="prakasa-sidebar__item-icon" style={{ position: 'relative' }}>
                    <Icon size={24} strokeWidth={1.8} />
                    {item.showUnreadBadge && unreadCount > 0 && collapsed && (
                      <span
                        aria-label={`${unreadCount} notifikasi belum dibaca`}
                        style={{
                          position: 'absolute',
                          top: -4,
                          right: -4,
                          minWidth: 16,
                          height: 16,
                          padding: '0 4px',
                          borderRadius: 999,
                          background: 'var(--color-error, #dc2626)',
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxSizing: 'border-box',
                        }}
                      >
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </span>
                  <span className="prakasa-sidebar__item-label">
                    {item.label}
                    {item.showUnreadBadge && unreadCount > 0 && !collapsed && (
                      <span
                        style={{
                          marginLeft: 8,
                          padding: '1px 7px',
                          borderRadius: 999,
                          background: 'var(--color-error, #dc2626)',
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </span>
                </NavLink>
              );
            })}
          </div>
        ))}
        <div className="prakasa-sidebar__nav-spacer" aria-hidden="true" />
      </nav>
    </aside>
  );
}
