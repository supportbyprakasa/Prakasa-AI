import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronRight, LogOut, Search, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNotificationCount } from '../context/NotificationContext';
import { useNavConfig } from './Sidebar';
import api from '../api/client';

export default function Navbar() {
  const { user, logout } = useAuth();
  const { unreadCount } = useNotificationCount();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const sections = useNavConfig();
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const searchRef = useRef(null);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  useEffect(() => { setSearchOpen(false); setMenuOpen(false); setNotificationOpen(false); }, [pathname]);
  useEffect(() => {
    if (!notificationOpen) return;
    let active = true;
    api.get('/notifications', { params: { page: 1, limit: 3 } })
      .then((response) => { if (active) setNotifications(response.data.data || []); })
      .catch(() => { if (active) setNotifications([]); });
    return () => { active = false; };
  }, [notificationOpen]);
  const initials = (user?.name || user?.email || 'P').split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  const searchResults = sections.flatMap((section) => section.items).filter((item) => item.to !== '/' && item.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6);
  const canSearchGlobally = sections.some((section) => section.items.some((item) => item.to === '/search'));
  const onSearch = (event) => {
    event.preventDefault();
    if (q.trim().length < 2) return;
    setSearchOpen(false);
    if (canSearchGlobally) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
    else if (searchResults.length) navigate(searchResults[0].to);
  };
  return (
    <header className="prakasa-navbar">
      <div className="prakasa-navbar__left">
        <Link to="/" className="prakasa-navbar__brand" aria-label="Prakasa Workspace — Beranda">
          <img className="prakasa-navbar__brand-mark" src="/logo-nav.png" alt="" aria-hidden="true" /><span>Prakasa Workspace</span>
        </Link>
      </div>
      <div className="prakasa-navbar__right">
        <button type="button" className="prakasa-navbar__icon-btn" aria-label="Cari" aria-expanded={searchOpen} onClick={() => { setSearchOpen((open) => !open); setNotificationOpen(false); }}><Search size={18} /></button>
        <button type="button" className="prakasa-navbar__icon-btn prakasa-navbar__notification" aria-label="Notifikasi" aria-expanded={notificationOpen} onClick={() => { setNotificationOpen((open) => !open); setSearchOpen(false); }}><Bell size={18} />{unreadCount > 0 && <span className="prakasa-navbar__dot" />}</button>
        <span className="prakasa-navbar__divider" aria-hidden="true" />
        <button type="button" className="prakasa-navbar__profile" aria-label="Menu akun" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}</button>
        {searchOpen && <div className="prakasa-search-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}>
          <form role="search" className="prakasa-search-dialog" onSubmit={onSearch}>
            <div className="prakasa-search-dialog__input"><Search size={18} /><input ref={searchRef} aria-label="Cari modul, task, dokumen" type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Cari modul, task, dokumen…" /><button type="button" onClick={() => setSearchOpen(false)} aria-label="Tutup pencarian"><X size={16} /></button></div>
            <div className="prakasa-search-dialog__results"><span>MODUL</span>{searchResults.map((item) => { const Icon = item.icon; return <Link key={item.to} to={item.to}><span className="prakasa-search-dialog__icon"><Icon size={16} /></span>{item.label}</Link>; })}{!searchResults.length && <p>Tidak ada modul yang cocok.</p>}{canSearchGlobally && q.trim().length >= 2 && <button className="prakasa-search-dialog__all" type="submit">Cari “{q.trim()}” di semua modul</button>}</div>
          </form>
        </div>}
        {notificationOpen && <div className="prakasa-navbar__popover prakasa-navbar__popover--notifications">
          <div className="prakasa-navbar__popover-title"><strong>Notifikasi</strong><button type="button" onClick={() => setNotificationOpen(false)} aria-label="Tutup notifikasi"><X size={16} /></button></div>
          {notifications.length ? notifications.map((item) => <Link className="prakasa-navbar__notification-item" to={item.actionUrl?.startsWith('/') && !item.actionUrl.startsWith('//') ? item.actionUrl : '/notifications'} key={item.id}><span className={item.isRead ? 'is-read' : ''} /><span><strong>{item.title}</strong><small>{item.createdAt ? new Date(item.createdAt).toLocaleString('id-ID') : ''}</small></span></Link>) : <p>{unreadCount > 0 ? `${unreadCount} notifikasi belum dibaca` : 'Semua notifikasi sudah dibaca.'}</p>}
          <Link to="/notifications" onClick={() => setNotificationOpen(false)}>Lihat semua notifikasi <ChevronRight size={15} /></Link>
        </div>}
        {menuOpen && <div className="prakasa-navbar__popover prakasa-navbar__popover--account">
          <div className="prakasa-navbar__account-name">{user?.name}<small>{user?.email}</small></div>
          <button type="button" onClick={logout}><LogOut size={16} /> Keluar</button>
        </div>}
      </div>
    </header>
  );
}
