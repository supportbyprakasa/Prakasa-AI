import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import '../styles/layout.css';

export default function Layout() {
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('prakasa.sidebarCollapsed') === '1';
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('prakasa.sidebarCollapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  const toggleSidebar = () => {
    if (window.innerWidth <= 900) {
      setMobileOpen((v) => !v);
    } else {
      setCollapsed((v) => !v);
    }
  };

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 900) setMobileOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="prakasa-layout">
      <Navbar onToggleSidebar={toggleSidebar} />

      <div className="prakasa-layout__body">
        <Sidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />

        <div
          className={`prakasa-sidebar__backdrop ${mobileOpen ? 'prakasa-sidebar__backdrop--open' : ''}`}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />

        <main className="prakasa-layout__main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
