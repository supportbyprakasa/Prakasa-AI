import { Link, useLocation, useNavigate } from 'react-router-dom';
import { forwardRef, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { useNotificationCount } from '../context/NotificationContext';
import { usePrakasaAIToolContext } from '../context/PrakasaAIToolContext';
import { useNavConfig } from './Sidebar';
import api from '../api/client';
import AppLauncher from './AppLauncher';
import BrandWordmark from './BrandWordmark';
import Avatar from './Avatar';
import Icon from './Icon';
import IconButton from './IconButton';
import ItHelpSheet from './support/ItHelpSheet';
import LanguageSwitch from './LanguageSwitch';
import { formatDateTime } from './format';
import { noTranslate } from '../i18n/NoTranslate';
import { anchoredProps, useAnchoredPosition, useOverlay, usePresence } from './useOverlay';
import { safeInAppPath } from './safeHref.js';

// Shadow only once the page is scrolled (docs/ui-guideline.md §2.1).
function useScrolled() {
  const [scrolled, setScrolled] = useState(() => window.scrollY > 0);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return scrolled;
}

// Top bar (docs/ui-guideline.md §2.1): ☰ and the product name, the search pill
// aligned with the content, then notifications (48), Prakasa AI and the app
// launcher (40) and the account avatar (40). On phones the search folds into
// an icon that opens it over the bar.
const Navbar = forwardRef(function Navbar({ onToggleSidebar, sidebarExpanded = false }, menuButtonRef) {
  const { user, logout } = useAuth();
  const { unreadCount } = useNotificationCount();
  const ai = usePrakasaAIToolContext();
  const [helpOpen, setHelpOpen] = useState(false);
  // "Butuh bantuan IT" is open to every role (it_ticket.create).
  const canAskIt = (user?.permissions || []).includes('it_ticket.create');
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  // Any page opens the sheet with ?bantuan=it (a link, or Prakasa AI's
  // buka_halaman); the parameter is removed once it has opened.
  useEffect(() => {
    if (!canAskIt) return;
    const params = new URLSearchParams(search);
    if (params.get('bantuan') !== 'it') return;
    params.delete('bantuan');
    setHelpOpen(true);
    navigate({ pathname, search: params.toString() ? `?${params}` : '' }, { replace: true });
  }, [canAskIt, pathname, search, navigate]);
  const sections = useNavConfig();
  const scrolled = useScrolled();
  const [q, setQ] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const searchBoxRef = useRef(null);
  const inputRef = useRef(null);
  const searchToggleRef = useRef(null);
  const rightRef = useRef(null);
  const notificationRef = useRef(null);
  const accountRef = useRef(null);
  const notificationButtonRef = useRef(null);
  const accountButtonRef = useRef(null);

  const closeAll = () => { setMenuOpen(false); setNotificationOpen(false); setAppsOpen(false); };

  useEffect(() => {
    if (!searchFocused && !searchOpen) return undefined;
    const onDocMouseDown = (event) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target)) setSearchFocused(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [searchFocused, searchOpen]);
  useEffect(() => { setSearchFocused(false); setSearchOpen(false); setQ(''); closeAll(); }, [pathname]);
  useEffect(() => { if (searchOpen) inputRef.current?.focus(); }, [searchOpen]);

  // Notification and account popovers: non-modal overlays in the shared stack
  // (Escape closes the top-most, focus returns to the trigger), closed by a
  // click outside too, with the menu enter/exit motion (§4.14). Like Menu they
  // are portaled to <body> and placed by the shared rule: below the trigger's
  // bottom edge, aligned to its end.
  const notificationPresence = usePresence(notificationOpen);
  const accountPresence = usePresence(menuOpen);
  useOverlay({ open: notificationOpen, containerRef: notificationRef, onEscape: () => setNotificationOpen(false), onTabOut: () => setNotificationOpen(false), modal: false });
  useOverlay({ open: menuOpen, containerRef: accountRef, onEscape: () => setMenuOpen(false), onTabOut: () => setMenuOpen(false), modal: false });
  const notificationPosition = useAnchoredPosition({
    open: notificationOpen, anchorRef: notificationButtonRef, surfaceRef: notificationRef, deps: [notifications.length],
  });
  const accountPosition = useAnchoredPosition({ open: menuOpen, anchorRef: accountButtonRef, surfaceRef: accountRef });
  useEffect(() => {
    if (!menuOpen && !notificationOpen) return undefined;
    const onPointer = (event) => {
      const inside = [rightRef, notificationRef, accountRef].some((ref) => ref.current?.contains(event.target));
      if (!inside) { setMenuOpen(false); setNotificationOpen(false); }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [menuOpen, notificationOpen]);

  useEffect(() => {
    if (!notificationOpen) return undefined;
    let active = true;
    api.get('/notifications', { params: { page: 1, limit: 3 } })
      .then((response) => { if (active) setNotifications(response.data.data || []); })
      .catch(() => { if (active) setNotifications([]); });
    return () => { active = false; };
  }, [notificationOpen]);

  const searchResults = sections.flatMap((section) => section.items).filter((item) => item.to !== '/' && item.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6);
  // Global search lives in the top bar only (no menu entry), so it follows the
  // permission, not the menu. Without it the box jumps to a matching menu page.
  const canSearchGlobally = (user?.permissions || []).includes('search.global');
  const closeSearch = () => {
    setSearchFocused(false);
    if (searchOpen) { setSearchOpen(false); searchToggleRef.current?.focus(); }
  };
  const onSearch = (event) => {
    event.preventDefault();
    if (q.trim().length < 2) return;
    setSearchFocused(false);
    setSearchOpen(false);
    if (canSearchGlobally) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
    else if (searchResults.length) navigate(searchResults[0].to);
  };

  // Prakasa AI: opens the assistant for this page when one is registered,
  // otherwise leads to the AI workspace (when the user may open it).
  const aiTool = ai?.enabled && ai.resolved && ai.resolved.tool.key !== 'ai-command' ? ai.resolved.tool : null;
  const canOpenWorkspace = (user?.permissions || []).includes('ai_command.session.view') && pathname !== '/ai-command';
  let aiButton = null;
  if (aiTool) {
    aiButton = (
      <IconButton
        size="sm"
        icon="auto_awesome"
        label={ai.open ? 'Tutup Prakasa AI' : `Bantu dengan Prakasa AI di ${aiTool.title}`}
        aria-expanded={ai.open}
        selected={ai.open}
        onClick={() => { ai.setOpen(!ai.open); closeAll(); }}
      />
    );
  } else if (canOpenWorkspace) {
    aiButton = <IconButton size="sm" icon="auto_awesome" to="/ai-command" label="Prakasa AI" />;
  }

  const notificationLabel = unreadCount > 0 ? `Notifikasi, ${unreadCount} belum dibaca` : 'Notifikasi';
  return (
    <header className={`prakasa-navbar${scrolled ? ' is-scrolled' : ''}${searchOpen ? ' is-searching' : ''}`}>
      <div className="prakasa-navbar__left">
        <span className="prakasa-navbar__menu">
          <IconButton
            ref={menuButtonRef}
            icon="menu"
            label={sidebarExpanded ? 'Tutup menu utama' : 'Buka menu utama'}
            aria-expanded={sidebarExpanded}
            onClick={onToggleSidebar}
          />
        </span>
        <Link to="/" className="prakasa-navbar__brand" aria-label="Prakasa Workspace, Beranda">
          <BrandWordmark restClassName="prakasa-navbar__brand-rest" />
        </Link>
      </div>

      <div className="prakasa-navbar__center">
        <form
          role="search"
          ref={searchBoxRef}
          className={`prakasa-navbar__search${searchFocused ? ' is-focused' : ''}`}
          onSubmit={onSearch}
          onKeyDown={(event) => { if (event.key === 'Escape') closeSearch(); }}
        >
          {searchOpen ? (
            <button type="button" className="prakasa-navbar__search-btn pw-state-layer" onClick={closeSearch} aria-label="Tutup pencarian">
              <Icon name="arrow_back" />
            </button>
          ) : (
            <button type="submit" className="prakasa-navbar__search-btn pw-state-layer" aria-label="Cari">
              <Icon name="search" />
            </button>
          )}
          <input
            ref={inputRef}
            className="prakasa-navbar__search-input"
            aria-label="Cari modul, tugas, dokumen"
            type="text"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onFocus={() => { setSearchFocused(true); closeAll(); }}
            placeholder="Cari di Prakasa Workspace"
          />
          {q && (
            <button type="button" className="prakasa-navbar__search-btn pw-state-layer" onClick={() => { setQ(''); inputRef.current?.focus(); }} aria-label="Bersihkan pencarian">
              <Icon name="close" />
            </button>
          )}
          {searchFocused && q.trim().length > 0 && (
            <div className="prakasa-navbar__results">
              <span className="prakasa-navbar__results-title" data-i18n-context="list">Modul</span>
              {searchResults.map((item) => (
                <Link key={item.to} className="prakasa-navbar__result pw-state-layer" to={item.to} onClick={() => setSearchFocused(false)}>
                  <Icon name={item.symbol || 'circle'} size="md" />
                  <span>{item.label}</span>
                </Link>
              ))}
              {!searchResults.length && <p className="prakasa-navbar__results-empty">Tidak ada modul yang cocok.</p>}
              {canSearchGlobally && q.trim().length >= 2 && (
                <button className="prakasa-navbar__result prakasa-navbar__result--all pw-state-layer" type="submit">
                  <Icon name="search" size="md" />
                  <span>Cari &ldquo;<span {...noTranslate}>{q.trim()}</span>&rdquo; di semua modul</span>
                </button>
              )}
            </div>
          )}
        </form>
      </div>

      <div className="prakasa-navbar__right" ref={rightRef}>
        <span className="pw-tooltip-anchor prakasa-navbar__search-toggle" data-pw-tooltip="Cari">
          <button
            ref={searchToggleRef}
            type="button"
            className="prakasa-navbar__search-toggle-btn pw-state-layer"
            aria-label="Cari"
            onClick={() => { setSearchOpen(true); closeAll(); }}
          >
            <Icon name="search" />
          </button>
        </span>
        <LanguageSwitch />
        <IconButton
          ref={notificationButtonRef}
          icon="notifications"
          label={notificationLabel}
          aria-haspopup="dialog"
          aria-expanded={notificationOpen}
          selected={notificationOpen}
          badge={unreadCount > 0 ? true : undefined}
          onClick={() => { setNotificationOpen((open) => !open); setAppsOpen(false); setMenuOpen(false); setSearchFocused(false); }}
        />
        {canAskIt ? (
          <IconButton
            icon="support"
            label="Butuh bantuan IT"
            aria-haspopup="dialog"
            aria-expanded={helpOpen}
            selected={helpOpen}
            onClick={() => { setHelpOpen(true); closeAll(); }}
          />
        ) : null}
        {aiButton ? <span className="prakasa-navbar__sm">{aiButton}</span> : null}
        <span className="prakasa-navbar__sm">
          <AppLauncher
            user={user}
            open={appsOpen}
            onOpenChange={(next) => { setAppsOpen(next); if (next) { setNotificationOpen(false); setMenuOpen(false); setSearchFocused(false); } }}
          />
        </span>
        <span className="pw-tooltip-anchor prakasa-navbar__sm" data-pw-tooltip={user?.email ? `Akun: ${user.email}` : 'Akun'}>
          <button
            ref={accountButtonRef}
            type="button"
            className="prakasa-navbar__account-button pw-state-layer"
            aria-label="Menu akun"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => { setMenuOpen((open) => !open); setAppsOpen(false); setNotificationOpen(false); }}
          >
            <Avatar name={user?.name || user?.email || 'P'} src={user?.avatarUrl} size="lg" />
          </button>
        </span>
        {notificationPresence.present && createPortal(
          <div
            ref={notificationRef}
            className="prakasa-navbar__popover"
            role="dialog"
            aria-label="Notifikasi"
            tabIndex={-1}
            data-state={notificationPresence.closing ? 'closing' : 'open'}
            {...anchoredProps(notificationPosition)}
            onAnimationEnd={notificationPresence.onAnimationEnd}
          >
            <div className="prakasa-navbar__popover-title">
              <strong>Notifikasi</strong>
              <IconButton size="sm" icon="close" label="Tutup notifikasi" onClick={() => setNotificationOpen(false)} />
            </div>
            {notifications.length ? notifications.map((item) => (
              <Link
                className="prakasa-navbar__notification pw-state-layer"
                to={safeInAppPath(item.actionUrl) || '/notifications'}
                key={item.id}
              >
                <span className={`prakasa-navbar__notification-mark${item.isRead ? ' is-read' : ''}`} aria-hidden="true" />
                <span className="prakasa-navbar__notification-text">
                  <span className="prakasa-navbar__notification-title">{item.title}</span>
                  <span className="prakasa-navbar__notification-time">{item.createdAt ? formatDateTime(item.createdAt) : ''}</span>
                </span>
              </Link>
            )) : <p className="prakasa-navbar__popover-empty">{unreadCount > 0 ? `${unreadCount} notifikasi belum dibaca` : 'Semua notifikasi sudah dibaca.'}</p>}
            <Link className="prakasa-navbar__popover-action pw-state-layer" to="/notifications" onClick={() => setNotificationOpen(false)}>
              Lihat semua notifikasi
            </Link>
          </div>,
          document.body,
        )}
        {accountPresence.present && createPortal(
          <div
            ref={accountRef}
            className="prakasa-navbar__popover prakasa-navbar__popover--account"
            role="dialog"
            aria-label="Akun"
            tabIndex={-1}
            data-state={accountPresence.closing ? 'closing' : 'open'}
            {...anchoredProps(accountPosition)}
            onAnimationEnd={accountPresence.onAnimationEnd}
          >
            <div className="prakasa-navbar__account">
              <span data-no-translate="" className="prakasa-navbar__account-name" {...noTranslate}>{user?.name}</span>
              <span data-no-translate="" className="prakasa-navbar__account-email" {...noTranslate}>{user?.email}</span>
            </div>
            <Link to="/akun" className="prakasa-navbar__popover-action pw-state-layer" onClick={() => setMenuOpen(false)}>
              <Icon name="manage_accounts" size="md" />
              <span>Akun saya</span>
            </Link>
            <button type="button" className="prakasa-navbar__popover-action pw-state-layer" onClick={logout}>
              <Icon name="logout" size="md" />
              <span>Keluar</span>
            </button>
          </div>,
          document.body,
        )}
      </div>
      {canAskIt ? <ItHelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} /> : null}
    </header>
  );
});

export default Navbar;
